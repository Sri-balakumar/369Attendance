"""Queue a group post on the first check-in of the day, and send it from a cron.

The hook sits on `create` because every check-in path ends there: the app's
/hr_attendance/systray_check_in_out, the KRA bridge's Start Workday, the WFH
check-in, the backend form. One place covers them all.

The send itself is NOT made inside the check-in request:

- the employee never waits on the network, and a slow or dead gateway cannot
  time a check-in out;
- a check-in that a constraint rejects is rolled back together with its
  'pending' mark, so nothing is ever posted for a check-in that did not happen.

Creating the record marks it pending and triggers the cron, which runs as soon
as the transaction commits.
"""

import logging
from datetime import timedelta

import pytz

from odoo import _, api, fields, models

_logger = logging.getLogger(__name__)

# A check-in created longer ago than this (HR back-filling a forgotten day, an
# import) is history, not news - do not announce it.
FRESH_WINDOW = timedelta(minutes=60)
# Give up on a post that still has not gone out this long after the check-in:
# "present 9:30" arriving at noon is noise.
STALE_AFTER = timedelta(hours=2)
MAX_ATTEMPTS = 3


class HrAttendance(models.Model):
    _inherit = 'hr.attendance'

    wa_present_state = fields.Selection([
        ('pending', 'Pending'),
        ('sent', 'Sent'),
        ('skipped', 'Skipped'),
        ('failed', 'Failed'),
    ], string='WhatsApp Group Post', readonly=True, copy=False, index=True,
        help="Whether this check-in was posted to the attendance WhatsApp "
             "group. Empty: not the first check-in of the day, or the feature "
             "is off.")
    wa_present_attempts = fields.Integer(readonly=True, copy=False)

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        queued = False
        for rec in recs:
            try:
                with self.env.cr.savepoint():
                    queued |= rec._wa_queue_present()
            except Exception:
                # A side effect: never block or roll back the check-in.
                _logger.exception("[wa-present] could not queue attendance %s", rec.id)
        if queued:
            try:
                self.env.ref(
                    'hr_attendance_369_whatsapp.ir_cron_wa_post_present'
                ).sudo()._trigger()
            except Exception:
                _logger.exception("[wa-present] could not trigger the sender cron")
        return recs

    def _wa_queue_present(self):
        """Mark this check-in for posting when it qualifies. True if marked."""
        self.ensure_one()
        if not self.employee_id or not self.check_in:
            return False
        config = self.env['hr.attendance.wa.config']._for_company(
            self.employee_id.company_id)
        if not config or not config._is_ready():
            return False
        if self.check_in < fields.Datetime.now() - FRESH_WINDOW:
            return False
        if not self._is_day_first_checkin():
            return False
        self.sudo().write({'wa_present_state': 'pending'})
        return True

    def _wa_present_text(self, config):
        """('@919876543210 checked in at 9:30 AM', '919876543210')."""
        self.ensure_one()
        employee = self.employee_id
        cfg = self.env['hr.attendance.late.config'].get_config_for_employee(employee.id)
        tz = pytz.timezone(cfg.get('timezone') or employee.tz or 'UTC')
        local = pytz.utc.localize(self.check_in).astimezone(tz)
        mention, digits = config.mention_for(employee)
        text = config.compose(mention, local.strftime('%I:%M %p').lstrip('0'))
        return text, digits

    # --- Admin alerts (hr_attendance_369's notification centre) -----------
    # The centre arrived in hr_attendance_369 11.0; on an older one the alerts
    # are skipped rather than taking the sender cron down with them.
    @api.model
    def _wa_alert_failed(self, rec, why):
        if 'hr.attendance.notification' not in self.env:
            return
        N = self.env['hr.attendance.notification']
        N._notify('adm_wa_failed', N._hr_users('admin', rec.employee_id.company_id),
                  _("WhatsApp post failed"),
                  _("%(emp)s's check-in was not posted to the group: %(why)s",
                    emp=rec.employee_id.name, why=why), rec)

    @api.model
    def _wa_alert_not_ready(self, company):
        """Once a day, not once per check-in: a switched-off gateway skips
        every post, and one message says it."""
        if 'hr.attendance.notification' not in self.env:
            return
        N = self.env['hr.attendance.notification']
        if N._once_per_day('wa_not_ready_%s' % company.id, fields.Date.context_today(self)):
            N._notify('adm_wa_not_ready', N._hr_users('admin', company),
                      _("WhatsApp posts are being skipped"),
                      _("The WhatsApp group post is not set up or switched off for %s. "
                        "Check-ins are not being announced.", company.name))

    @api.model
    def _cron_wa_post_present(self):
        """Send every pending group post. Commits after each one, so a failure
        halfway never makes the earlier ones go out twice."""
        Config = self.env['hr.attendance.wa.config']
        now = fields.Datetime.now()
        pending = self.sudo().search(
            [('wa_present_state', '=', 'pending')], order='check_in', limit=100)
        retry = False
        for rec in pending:
            config = Config._for_company(rec.employee_id.company_id)
            if not config or not config._is_ready():
                rec.wa_present_state = 'skipped'
                self._wa_alert_not_ready(rec.employee_id.company_id)
            elif rec.check_in < now - STALE_AFTER:
                _logger.warning("[wa-present] attendance %s too old to post; dropped", rec.id)
                rec.wa_present_state = 'failed'
                self._wa_alert_failed(rec, _("it was more than 2 hours old by the time it could be sent"))
            else:
                try:
                    text, digits = rec._wa_present_text(config)
                    config._send_group_text(text, digits)
                    rec.wa_present_state = 'sent'
                except Exception as err:
                    attempts = rec.wa_present_attempts + 1
                    _logger.warning("[wa-present] attendance %s attempt %s failed: %s",
                                    rec.id, attempts, err)
                    rec.write({
                        'wa_present_attempts': attempts,
                        'wa_present_state': 'failed' if attempts >= MAX_ATTEMPTS else 'pending',
                    })
                    retry = retry or attempts < MAX_ATTEMPTS
                    if attempts >= MAX_ATTEMPTS:
                        self._wa_alert_failed(rec, str(err))
            self.env.cr.commit()
        if retry:
            self.env.ref('hr_attendance_369_whatsapp.ir_cron_wa_post_present').sudo()._trigger(
                at=now + timedelta(minutes=1))
