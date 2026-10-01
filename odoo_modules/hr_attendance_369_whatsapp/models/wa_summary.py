"""Daily attendance summary, sent privately to chosen WhatsApp numbers.

Once a day, at the time set on the WhatsApp Group form, the numbers under
Send To get who is present, on leave and absent today. Nothing goes to the
group.

The status rules are hr_attendance_369's own - the day's check-ins, its
working-day and holiday calendar (`is_working_day`), its approved leaves
(`_find_leave`) - so the summary says what the app's Today board says. The
board alone is not enough: before the absent cron has run, people who have not
checked in and people on leave have no day row yet, so every employee is
looked at directly.
"""

import logging
from datetime import datetime, timedelta

import pytz

from odoo import _, api, fields, models
from odoo.exceptions import UserError, ValidationError

from .wa_config import SUMMARY_GIVE_UP_HOURS, normalize_digits

_logger = logging.getLogger(__name__)

# (key, heading, shown even when empty)
SECTIONS = [
    ('present', '✅ Present', True),
    ('leave', '🌴 On leave', False),
    ('absent', '❌ Absent', True),
    ('day_off', '🏖️ Day off', False),
]


def format_summary(day, sections):
    """The message, from {'present'|'leave'|'absent'|'day_off': [(name, note)]}.

    Kept free of the database so the wording can be checked on its own.
    """
    lines = ['📋 Attendance – %s' % day.strftime('%a %d %b %Y')]
    total = 0
    for key, heading, always in SECTIONS:
        people = sections.get(key) or []
        total += len(people)
        if not people and not always:
            continue
        lines += ['', '%s (%d)' % (heading, len(people))]
        if not people:
            lines.append('• none')
        for name, note in people:
            lines.append('• %s – %s' % (name, note) if note else '• %s' % name)
    lines += ['', 'Total: %d employees' % total]
    return '\n'.join(lines)


def summary_due(now_local, send_at, last_date):
    """'send', 'wait' or 'give_up' for a summary due at `send_at` (hours,
    e.g. 18.5) in the office day of `now_local` (timezone-aware)."""
    if last_date and last_date >= now_local.date():
        return 'wait'
    due = now_local.replace(hour=0, minute=0, second=0, microsecond=0) \
        + timedelta(hours=send_at or 0)
    if now_local < due:
        return 'wait'
    if now_local > due + timedelta(hours=SUMMARY_GIVE_UP_HOURS):
        return 'give_up'
    return 'send'


class HrAttendanceWaSummaryRecipient(models.Model):
    _name = 'hr.attendance.wa.summary.recipient'
    _description = 'Daily Summary Recipient'
    _order = 'id'

    config_id = fields.Many2one(
        'hr.attendance.wa.config', required=True, ondelete='cascade')
    name = fields.Char('Name')
    number = fields.Char('WhatsApp Number', required=True)

    def _digits(self):
        self.ensure_one()
        return normalize_digits(self.number, self.config_id.default_country_code)

    @api.constrains('number')
    def _check_number(self):
        for rec in self:
            if not rec._digits():
                raise ValidationError(_(
                    "'%s' is not a full WhatsApp number. Enter it like "
                    "9876543210 or +91 98765 43210.", rec.number))


class HrAttendanceWaConfig(models.Model):
    _inherit = 'hr.attendance.wa.config'

    summary_last_error = fields.Char('Last Problem', readonly=True, copy=False)

    # ------------------------------------------------------------------ #
    # What the summary says                                               #
    # ------------------------------------------------------------------ #

    def _summary_now(self):
        """Office-local now, timezone-aware.

        Asked for one of the company's employees, so it follows the same rule
        as the check-in posts and the absent stamp - the office config's
        timezone, else the employee's own. Without an employee it would skip
        straight to "any config with a timezone", and with none set (as on
        369application) land on UTC: a 6:30 PM summary would go out at
        midnight India time.
        """
        self.ensure_one()
        employee = self.env['hr.employee'].sudo().search(
            [('company_id', '=', self.company_id.id)], order='id', limit=1)
        tz_name = self.env['hr.attendance.late.config'].sudo().get_office_timezone(
            employee.id or False)
        return datetime.now(pytz.utc).astimezone(pytz.timezone(tz_name))

    def _summary_sections(self, day):
        """{'present'|'leave'|'absent'|'day_off': [(name, note)]} for `day`."""
        self.ensure_one()
        Late = self.env['hr.attendance.late.config'].sudo()
        DayStatus = self.env['hr.attendance.day.status'].sudo()
        Attendance = self.env['hr.attendance'].sudo()
        leave_labels = dict(self.env['hr.leave.request']._fields['leave_type']
                            ._description_selection(self.env))
        sections = {key: [] for key, _heading, _always in SECTIONS}
        # The same people the absent cron stamps: active, this company.
        employees = self.env['hr.employee'].sudo().search(
            [('company_id', '=', self.company_id.id)], order='name')
        for emp in employees:
            cfg = Late.get_config_for_employee(emp.id)
            tz = pytz.timezone(cfg.get('timezone') or emp.tz or 'UTC')
            start_local = tz.localize(datetime.combine(day, datetime.min.time()))
            start = start_local.astimezone(pytz.utc).replace(tzinfo=None)
            end = (start_local + timedelta(days=1)).astimezone(pytz.utc).replace(tzinfo=None)
            atts = Attendance.search([
                ('employee_id', '=', emp.id),
                ('check_in', '>=', start), ('check_in', '<', end),
            ], order='check_in')
            if atts:
                first = atts[0]
                notes = [pytz.utc.localize(first.check_in).astimezone(tz)
                         .strftime('%I:%M %p').lstrip('0')]
                row = DayStatus.search(
                    [('employee_id', '=', emp.id), ('date', '=', day)], limit=1)
                if row.status == 'half_day':
                    notes.append('(half day)')
                elif first.is_late:
                    notes.append('(late)')
                if any(atts.mapped('is_wfh')):
                    notes.append('(WFH)')
                sections['present'].append((emp.name, ' '.join(notes)))
            elif not Late.is_working_day(day, emp.id):
                sections['day_off'].append((emp.name, ''))
            else:
                leave = DayStatus._find_leave(emp, day)
                if leave:
                    note = leave_labels.get(leave.leave_type, '')
                    if leave.is_half_day:
                        note += ' (half day)'
                    sections['leave'].append((emp.name, note))
                else:
                    note = ('WFH approved, not checked in'
                            if DayStatus._on_approved_wfh(emp, day) else '')
                    sections['absent'].append((emp.name, note))
        return sections

    # ------------------------------------------------------------------ #
    # Sending                                                             #
    # ------------------------------------------------------------------ #

    def _summary_send(self, text):
        """Send to every number under Send To. (sent count, [problems])."""
        self.ensure_one()
        sent, problems = 0, []
        for rcpt in self.summary_recipient_ids:
            try:
                self._send_text(rcpt._digits(), text)
                sent += 1
            except Exception as err:
                problems.append('%s: %s' % (rcpt.name or rcpt.number, err))
                _logger.warning("[wa-summary] not sent to %s: %s", rcpt.number, err)
        return sent, problems

    def action_send_summary_now(self):
        """Today's summary, as it stands right now, to every number. Does not
        count as the day's summary: the scheduled one still goes out."""
        self.ensure_one()
        if not self.summary_recipient_ids:
            raise UserError(_("Add at least one number under Send To."))
        day = self._summary_now().date()
        sent, problems = self._summary_send(
            format_summary(day, self._summary_sections(day)))
        if not sent:
            raise UserError(_("The summary was not sent.\n%s", '\n'.join(problems)))
        message = _("Sent to %(sent)s of %(total)s.",
                    sent=sent, total=len(self.summary_recipient_ids))
        if problems:
            message += '\n' + '\n'.join(problems)
        return self._notify(_("Summary sent"), message)

    @api.model
    def _cron_wa_daily_summary(self):
        """Every few minutes: send each company's summary once its time has
        come. A failed send is retried on the next run, up to
        SUMMARY_GIVE_UP_HOURS after the time."""
        for config in self.sudo().search([('summary_enabled', '=', True)]):
            if not config.summary_recipient_ids:
                continue
            now = config._summary_now()
            today = now.date()
            due = summary_due(now, config.summary_time, config.summary_last_date)
            if due == 'wait':
                continue
            if due == 'give_up':
                config.summary_last_date = today
                if config.summary_last_error:
                    config._wa_summary_alert(config.summary_last_error)
                _logger.warning("[wa-summary] %s: too late to send today's summary",
                                config.company_id.name)
                self.env.cr.commit()
                continue
            sections = config._summary_sections(today)
            if not (sections['present'] or sections['leave'] or sections['absent']):
                # Weekly off or holiday for everyone: nothing to report.
                config.summary_last_date = today
                self.env.cr.commit()
                continue
            sent, problems = config._summary_send(format_summary(today, sections))
            if sent:
                config.write({'summary_last_date': today,
                              'summary_last_error': '\n'.join(problems) or False})
            else:
                config.summary_last_error = '\n'.join(problems)[:500]
            self.env.cr.commit()

    def _wa_summary_alert(self, why):
        # hr_attendance_369's notification centre, when it is installed.
        if 'hr.attendance.notification' not in self.env:
            return
        N = self.env['hr.attendance.notification']
        N._notify('adm_wa_failed', N._hr_users('admin', self.company_id),
                  _("Daily WhatsApp summary not sent"), why, self)
