"""Where notifications come from.

Business models do not notify from their action methods: too many real
transitions skip them. The app creates WFH requests straight into pending;
hr.attendance moves WFH to checked_in / checked_out with a raw write; comp-off
earning and expiry are raw writes; the leave reject reason is written after
action_reject returns; and any RPC write({'state': ...}) skips every action.

So the overrides below watch the STATE itself in create/write and queue what
changed on hr.attendance.notification._queue_change. The handlers (_on_*) run
at precommit, re-read the record, and check it still says what the change said
-- a change undone by a rolled-back savepoint, or overtaken by a later write in
the same transaction, is dropped rather than announced.

Imported last in models/__init__.py, so every override here wraps the
module's own create/write.
"""
import logging
from datetime import datetime, time, timedelta

import pytz

from odoo import SUPERUSER_ID, _, api, fields, models
from odoo.exceptions import AccessError, UserError

from .res_users import EMPLOYEE_DETAILS_SELF_FIELDS

_logger = logging.getLogger(__name__)

NOTE = 'hr.attendance.notification'

# Office-hours fields worth telling employees about when they change.
POLICY_FIELDS = {
    'office_start_hour', 'office_end_hour', 'late_threshold_minutes',
    'late_until_hour', 'half_day_after_hour', 'half_day_min_hours_ratio',
    'work_monday', 'work_tuesday', 'work_wednesday', 'work_thursday',
    'work_friday', 'work_saturday', 'work_sunday',
}


def _loading(env):
    """True while modules install or update: data files create holidays and
    manuals that nobody should be notified about."""
    return not env.registry.ready or env.context.get('install_mode')


def _hour(h):
    """9.5 -> '9:30 AM'."""
    h = h or 0.0
    hh, mm = int(h), int(round((h - int(h)) * 60))
    return time(hh % 24, mm % 60).strftime('%I:%M %p').lstrip('0')


# ====================================================================== #
# Business models: capture what changed                                  #
# ====================================================================== #
class HrLeaveRequest(models.Model):
    _inherit = 'hr.leave.request'

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        N = self.env[NOTE]
        for r in recs.filtered(lambda r: r.state != 'draft'):
            N._queue_change('leave', (r.id, False, r.state, False, r.cancel_requested, self.env.uid))
        return recs

    def write(self, vals):
        if 'state' not in vals and 'cancel_requested' not in vals:
            return super().write(vals)
        before = {r.id: (r.state, r.cancel_requested) for r in self}
        res = super().write(vals)
        N = self.env[NOTE]
        for r in self:
            old_state, old_cr = before[r.id]
            if old_state != r.state or old_cr != r.cancel_requested:
                N._queue_change('leave', (r.id, old_state, r.state, old_cr,
                                          r.cancel_requested, self.env.uid))
        return res


class HrWfhRequest(models.Model):
    _inherit = 'hr.wfh.request'

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        N = self.env[NOTE]
        for r in recs.filtered(lambda r: r.state != 'draft'):
            N._queue_change('wfh', (r.id, False, r.state, self.env.uid))
        return recs

    def write(self, vals):
        if 'state' not in vals:
            return super().write(vals)
        before = {r.id: r.state for r in self}
        res = super().write(vals)
        N = self.env[NOTE]
        for r in self:
            if before[r.id] != r.state:
                N._queue_change('wfh', (r.id, before[r.id], r.state, self.env.uid))
        return res


class HrCompOffCredit(models.Model):
    _inherit = 'hr.comp.off.credit'

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        N = self.env[NOTE]
        for r in recs:
            N._queue_change('compoff', (r.id, False, r.state, self.env.uid))
        return recs

    def write(self, vals):
        if 'state' not in vals:
            return super().write(vals)
        before = {r.id: r.state for r in self}
        res = super().write(vals)
        N = self.env[NOTE]
        for r in self:
            if before[r.id] != r.state:
                N._queue_change('compoff', (r.id, before[r.id], r.state, self.env.uid))
        return res


class HrAttendance(models.Model):
    _inherit = 'hr.attendance'

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        N = self.env[NOTE]
        for r in recs:
            N._queue_change('att_in', (r.id, self.env.uid))
            if r.check_out:
                N._queue_change('att_out', (r.id, self.env.uid))
        return recs

    def write(self, vals):
        if 'check_in' not in vals and 'check_out' not in vals:
            return super().write(vals)
        before = {r.id: (r.check_in, r.check_out) for r in self}
        res = super().write(vals)
        N = self.env[NOTE]
        for r in self:
            old_in, old_out = before[r.id]
            if not old_out and r.check_out:
                N._queue_change('att_out', (r.id, self.env.uid))
            elif old_out and r.check_out and (old_in != r.check_in or old_out != r.check_out):
                N._queue_change('att_edit', (r.id, self.env.uid))
            elif old_in != r.check_in and not r.check_out:
                N._queue_change('att_edit', (r.id, self.env.uid))
            # check_out cleared (a reopened day) is not news.
        return res

    def unlink(self):
        # Gathered before: once deleted there is nothing left to describe, and
        # the day re-grades through ondelete='set null' with no hook of its own.
        N = self.env[NOTE]
        gone = [(r.employee_id, r.check_in, r.check_out) for r in self.sudo()]
        res = super().unlink()
        for employee, check_in, check_out in gone:
            N._announce_attendance_deleted(employee, check_in, check_out)
        return res

    @api.model
    def app_submit_late_reason(self, attendance_id, reason):
        """The app's late-reason sheet: an employee explains THEIR OWN late
        check-in. The kiosk, KRA and app check-ins cannot ask at save time
        (they skip the backend constraint), so this is where the reason arrives.
        """
        reason = (reason or '').strip()
        if not reason:
            raise UserError(_("Please write the reason."))
        att = self.sudo().browse(int(attendance_id)).exists()
        if not att or att.employee_id.user_id != self.env.user:
            raise AccessError(_("You can only explain your own check-in."))
        att.with_context(skip_late_reason_required=True).write({'late_reason': reason})
        N = self.env[NOTE]
        emp = att.employee_id
        N._notify('hr_late_reason', N._hr_users('attendance', emp.company_id),
                  _("Late reason: %s", emp.name),
                  _("%(time)s check-in: %(reason)s", time=N._hm(att.check_in, emp), reason=reason),
                  att, 'LateRecords')
        return True


class AttendanceDayStatus(models.Model):
    _inherit = 'hr.attendance.day.status'

    @api.model
    def _upsert_for_attendance(self, attendance):
        old = False
        if attendance.employee_id and attendance.check_in:
            day = self._office_local_date(attendance)
            existing = self.sudo().search([
                ('employee_id', '=', attendance.employee_id.id), ('date', '=', day)], limit=1)
            old = existing.status if existing else False
        row = super()._upsert_for_attendance(attendance)
        if row:
            self.env[NOTE]._queue_change('day', (row.id, old))
        return row

    @api.model
    def _stamp_absent_for(self, employee, Config, now):
        stamped = super()._stamp_absent_for(employee, Config, now)
        if stamped:
            row = self.sudo().search([('employee_id', '=', employee.id),
                                      ('stamped_by_cron', '=', True)], order='id desc', limit=1)
            if row:
                self.env[NOTE]._queue_change('day', (row.id, False))
        return stamped


class AttendanceLateConfig(models.Model):
    _inherit = 'hr.attendance.late.config'

    def write(self, vals):
        res = super().write(vals)
        if POLICY_FIELDS & set(vals) and not _loading(self.env):
            self.env[NOTE]._announce_policy_change(self)
        return res


class HrPayslipRun(models.Model):
    _inherit = 'hr.payslip.run'

    def _period_label(self):
        self.ensure_one()
        return self.date_from.strftime('%B %Y') if self.date_from else self.name

    def action_generate(self):
        res = super().action_generate()
        N = self.env[NOTE]
        for run in self:
            N._notify('hr_payroll_generated', N._hr_users('payroll', run.company_id),
                      _("Payslips generated"),
                      _("%(period)s: %(n)s payslips ready to review and confirm.",
                        period=run._period_label(), n=len(run.payslip_ids)),
                      run, 'PayrollRuns')
        return res

    def action_confirm(self):
        res = super().action_confirm()
        self._announce_payslips('emp_payslip_ready', _("Payslip ready"),
                                _("Your payslip for %s is ready."))
        return res

    def action_mark_paid(self):
        res = super().action_mark_paid()
        self._announce_payslips('emp_payslip_paid', _("Salary paid"),
                                _("Your salary for %s has been paid."))
        return res

    def _announce_payslips(self, code, title, body):
        N = self.env[NOTE]
        for run in self:
            users = run.payslip_ids.mapped('employee_id.user_id')
            # No amount in the text: a push shows on a lock screen.
            N._notify(code, users, title, body % run._period_label(), run)


class HrPublicHoliday(models.Model):
    _inherit = 'hr.public.holiday'

    def _is_upcoming(self):
        return self.date and self.date >= fields.Date.context_today(self)

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        if not _loading(self.env):
            N = self.env[NOTE]
            for h in recs.filtered(lambda h: h.active and h._is_upcoming()):
                N._notify('emp_holiday_added', N._company_users(h.company_id),
                          _("Holiday: %s", h.name),
                          _("%(day)s (%(weekday)s) is a holiday.",
                            day=N._day(h.date), weekday=h.date.strftime('%A')), h)
        return recs

    def write(self, vals):
        before = {h.id: (h.date, h.active) for h in self}
        res = super().write(vals)
        if ('date' in vals or 'active' in vals) and not _loading(self.env):
            N = self.env[NOTE]
            for h in self:
                old_date, old_active = before[h.id]
                users = N._company_users(h.company_id)
                if old_active and not h.active and old_date and old_date >= fields.Date.context_today(self):
                    N._notify('emp_holiday_removed', users, _("Holiday removed"),
                              _("%(name)s on %(day)s is no longer a holiday.",
                                name=h.name, day=N._day(old_date)), h)
                elif h.active and old_date != h.date and h._is_upcoming():
                    N._notify('emp_holiday_moved', users, _("Holiday moved: %s", h.name),
                              _("Now on %(new)s (was %(old)s).",
                                new=N._day(h.date), old=N._day(old_date)), h)
        return res

    def unlink(self):
        N = self.env[NOTE]
        gone = [(h.name, h.date, h.company_id) for h in self
                if h.active and h._is_upcoming()]
        res = super().unlink()
        if not _loading(self.env):
            for name, day, company in gone:
                N._notify('emp_holiday_removed', N._company_users(company),
                          _("Holiday removed"),
                          _("%(name)s on %(day)s is no longer a holiday.",
                            name=name, day=N._day(day)))
        return res


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    def _device_snapshot(self):
        return {e.id: (e._primary_device().device_id, e._primary_device().active) for e in self}

    def _inverse_device_code(self):
        before = self._device_snapshot()
        super()._inverse_device_code()
        self._announce_device_changes(before)

    def _inverse_device_active(self):
        before = self._device_snapshot()
        super()._inverse_device_active()
        self._announce_device_changes(before)

    def _announce_device_changes(self, before):
        N = self.env[NOTE]
        for emp in self:
            old_code, old_active = before.get(emp.id, (False, False))
            dev = emp._primary_device()
            if not dev:
                continue
            if dev.device_id != old_code:
                N._notify('hr_device_new', N._hr_users('attendance', emp.company_id),
                          _("Device registered"),
                          _("%(emp)s: %(code)s", emp=emp.name, code=dev.device_id), emp)
                N._notify('emp_device_changed', emp.user_id, _("Your device changed"),
                          _("Attendance is now recorded from device %s.", dev.device_id), emp)
            elif bool(dev.active) != bool(old_active):
                N._notify('emp_device_changed', emp.user_id,
                          _("Device unblocked") if dev.active else _("Device blocked"),
                          _("Your attendance device %(code)s was %(what)s.",
                            code=dev.device_id,
                            what=_("unblocked") if dev.active else _("blocked")), emp)


class ResUsers(models.Model):
    _inherit = 'res.users'

    def write(self, vals):
        res = super().write(vals)
        changed = set(vals) & set(EMPLOYEE_DETAILS_SELF_FIELDS)
        # Only an employee editing THEMSELVES is news; HR editing somebody is
        # HR's own work.
        if changed and len(self) == 1 and self.id == self.env.uid and not _loading(self.env):
            N = self.env[NOTE]
            labels = ', '.join(sorted(self._fields[f].string for f in changed if f in self._fields))
            N._notify('hr_profile_updated', N._hr_users('attendance', self.company_id),
                      _("%s updated their details", self.name), labels,
                      self.employee_id if self.employee_id else None)
        return res


class AttendanceHelpDocument(models.Model):
    _inherit = 'attendance.help.document'

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        if not _loading(self.env):
            N = self.env[NOTE]
            for doc in recs.filtered(lambda d: d.section == 'app' and d.active):
                users = self.env['res.users'].sudo().search([('share', '=', False)])
                users = users.filtered(
                    lambda u: doc.audience == 'all' or doc._role_of(u) in ('admin', doc.audience))
                N._notify('emp_manual_new', users, _("New app manual"), doc.name, doc, 'AppManual')
        return recs


# ====================================================================== #
# The handlers and the crons                                             #
# ====================================================================== #
class AttendanceNotification(models.Model):
    _inherit = NOTE

    def _actor(self, uid):
        return self.env['res.users'].sudo().browse(uid or SUPERUSER_ID)

    def _by_other(self, actor, emp_user):
        """Did somebody OTHER than the employee do this? The kiosk (a public
        user), crons (the superuser) and the employee themself do not count."""
        return bool(actor and actor.id != SUPERUSER_ID and not actor.share
                    and actor != emp_user)

    # ------------------------------------------------------------------ #
    # Leave                                                              #
    # ------------------------------------------------------------------ #
    def _on_leave(self, payloads):
        Leave = self.env['hr.leave.request'].sudo()
        kinds = dict(Leave._fields['leave_type'].selection)
        for rid, old, new, old_cr, new_cr, actor_uid in payloads:
            rec = Leave.browse(rid).exists()
            if not rec:
                continue
            # Still true? A later write in the same transaction, or a rolled
            # back savepoint, makes this change old news.
            if old != new and rec.state != new:
                continue
            if old == new and rec.cancel_requested != new_cr:
                continue
            actor = self._actor(actor_uid)
            N = self.with_user(actor)
            emp = rec.hr_employee_id
            emp_user = rec.employee_user_id or emp.user_id
            hr = self._hr_users('leave', emp.company_id)
            who = rec.employee_name or emp.name
            kind = kinds.get(rec.leave_type, _("Leave"))
            span = self._range(rec.from_date, rec.to_date or rec.from_date)
            if rec.is_half_day:
                span += _(" (half day)")
            days = self._plural(rec.number_of_days, _("day"))

            if new == 'pending' and old != 'pending':
                N._notify('hr_leave_new', hr, _("New leave request"),
                          _("%(who)s · %(kind)s · %(span)s (%(days)s)",
                            who=who, kind=kind, span=span, days=days),
                          rec, 'LeaveQueue', {'state': 'pending'})
            elif new == 'approved' and old != 'approved':
                if rec.auto_approved:
                    N._notify('emp_leave_auto', emp_user, _("Leave approved"),
                              _("Your %(kind)s for %(span)s was approved automatically.",
                                kind=kind, span=span), rec, 'Leave')
                    N._notify('hr_leave_auto', hr, _("Leave auto-approved"),
                              _("%(who)s · %(kind)s · %(span)s. Nobody answered in time.",
                                who=who, kind=kind, span=span),
                              rec, 'LeaveQueue', {'state': 'approved'})
                else:
                    N._notify('emp_leave_approved', emp_user, _("Leave approved"),
                              _("Your %(kind)s for %(span)s was approved by %(by)s.",
                                kind=kind, span=span, by=actor.name), rec, 'Leave')
            elif new == 'rejected' and old != 'rejected':
                reason = (rec.rejection_reason or '').strip()
                N._notify('emp_leave_rejected', emp_user, _("Leave rejected"),
                          (_("Your %(kind)s for %(span)s was rejected: %(reason)s",
                             kind=kind, span=span, reason=reason) if reason else
                           _("Your %(kind)s for %(span)s was rejected.", kind=kind, span=span)),
                          rec, 'Leave')
            elif new == 'cancelled' and old != 'cancelled':
                if old == 'approved' and old_cr:
                    N._notify('emp_leave_cancel_ok', emp_user, _("Cancellation approved"),
                              _("Your %(kind)s for %(span)s is cancelled, as you asked.",
                                kind=kind, span=span), rec, 'Leave')
                elif not self._by_other(actor, emp_user):
                    N._notify('hr_leave_withdrawn', hr, _("Leave withdrawn"),
                              _("%(who)s withdrew their %(kind)s for %(span)s.",
                                who=who, kind=kind, span=span), rec, 'LeaveQueue')
                else:
                    N._notify('emp_leave_cancelled_by_hr', emp_user, _("Leave cancelled"),
                              _("Your %(kind)s for %(span)s was cancelled by %(by)s.",
                                kind=kind, span=span, by=actor.name), rec, 'Leave')
            elif old == new == 'approved' and new_cr and not old_cr:
                reason = (rec.cancel_reason or '').strip()
                N._notify('hr_leave_cancel_req', hr, _("Cancellation requested"),
                          _("%(who)s wants to cancel %(kind)s for %(span)s%(reason)s",
                            who=who, kind=kind, span=span,
                            reason=(': ' + reason) if reason else '.'),
                          rec, 'LeaveQueue', {'state': 'approved'})
            elif old == new == 'approved' and old_cr and not new_cr:
                reason = (rec.cancel_reject_reason or '').strip()
                N._notify('emp_leave_cancel_no', emp_user, _("Cancellation declined"),
                          _("Your %(kind)s for %(span)s stays approved%(reason)s",
                            kind=kind, span=span,
                            reason=(': ' + reason) if reason else '.'), rec, 'Leave')

    # ------------------------------------------------------------------ #
    # WFH                                                                #
    # ------------------------------------------------------------------ #
    def _on_wfh(self, payloads):
        Wfh = self.env['hr.wfh.request'].sudo()
        for rid, old, new, actor_uid in payloads:
            rec = Wfh.browse(rid).exists()
            if not rec or rec.state != new:
                continue
            actor = self._actor(actor_uid)
            N = self.with_user(actor)
            emp = rec.hr_employee_id
            emp_user = rec.employee_user_id
            hr = self._hr_users('wfh', emp.company_id if emp else None)
            who = rec.employee_name or emp_user.name
            day = self._day(rec.request_date)

            if new == 'pending' and old != 'pending':
                N._notify('hr_wfh_new', hr, _("New WFH request"),
                          _("%(who)s · work from home on %(day)s", who=who, day=day),
                          rec, 'WfhQueue', {'state': 'pending'})
            elif new == 'approved' and old == 'pending':
                if rec.auto_approved:
                    N._notify('emp_wfh_auto', emp_user, _("WFH approved"),
                              _("Work from home on %s was approved automatically.", day), rec, 'Wfh')
                    N._notify('hr_wfh_auto', hr, _("WFH auto-approved"),
                              _("%(who)s · %(day)s. Nobody answered in time.", who=who, day=day),
                              rec, 'WfhQueue', {'state': 'approved'})
                else:
                    N._notify('emp_wfh_approved', emp_user, _("WFH approved"),
                              _("Work from home on %(day)s was approved by %(by)s.",
                                day=day, by=actor.name), rec, 'Wfh')
            elif new == 'rejected' and old != 'rejected':
                reason = (rec.rejection_reason or '').strip()
                N._notify('emp_wfh_rejected', emp_user, _("WFH rejected"),
                          _("Work from home on %(day)s was rejected%(reason)s",
                            day=day, reason=(': ' + reason) if reason else '.'), rec, 'Wfh')
            elif new == 'cancelled' and old in ('draft', 'pending', 'approved'):
                if not self._by_other(actor, emp_user):
                    N._notify('hr_wfh_withdrawn', hr, _("WFH withdrawn"),
                              _("%(who)s withdrew work from home on %(day)s.", who=who, day=day),
                              rec, 'WfhQueue')
            elif new == 'expired':
                N._notify('emp_wfh_expired', emp_user, _("WFH expired"),
                          _("Your approved work from home on %s was not used.", day), rec, 'Wfh')

    # ------------------------------------------------------------------ #
    # Comp off                                                           #
    # ------------------------------------------------------------------ #
    def _on_compoff(self, payloads):
        Credit = self.env['hr.comp.off.credit'].sudo()
        for rid, old, new, actor_uid in payloads:
            rec = Credit.browse(rid).exists()
            if not rec or rec.state != new:
                continue
            actor = self._actor(actor_uid)
            N = self.with_user(actor)
            emp = rec.employee_id
            emp_user = emp.user_id
            day = self._day(rec.date_earned)

            if new == 'declared' and not old:
                N._notify('hr_compoff_declared', self._hr_users('attendance', emp.company_id),
                          _("Working on a day off"),
                          _("%(who)s is working on %(day)s and will earn comp off.",
                            who=emp.name, day=day),
                          rec, 'CompOff', {'employeeId': emp.id, 'employeeName': emp.name})
            elif new == 'available' and old in (False, 'declared'):
                expiry = (_(" Use it by %s.", self._day(rec.expiry_date))
                          if rec.expiry_date else '')
                if self._by_other(actor, emp_user):
                    body = _("%(by)s granted you %(days)s of comp off for %(day)s.%(exp)s",
                             by=actor.name, days=self._plural(rec.days, _("day")),
                             day=day, exp=expiry)
                else:
                    body = _("You earned %(days)s of comp off for working on %(day)s.%(exp)s",
                             days=self._plural(rec.days, _("day")), day=day, exp=expiry)
                N._notify('emp_compoff_credited', emp_user, _("Comp off credited"), body, rec, 'Leave')
            elif new == 'cancelled' and old in ('declared', 'available'):
                N._notify('emp_compoff_cancelled', emp_user, _("Comp off cancelled"),
                          _("Your comp off for %s was cancelled.", day), rec, 'Leave')
            elif new == 'expired':
                N._notify('emp_compoff_expired', emp_user, _("Comp off expired"),
                          _("%(days)s of comp off from %(day)s expired unused.",
                            days=self._plural(rec.days_lapsed or rec.days, _("day")), day=day),
                          rec, 'Leave')

    # ------------------------------------------------------------------ #
    # Attendance                                                         #
    # ------------------------------------------------------------------ #
    def _on_att_in(self, payloads):
        Att = self.env['hr.attendance'].sudo()
        for att_id, actor_uid in payloads:
            att = Att.browse(att_id).exists()
            if not att or not att.employee_id:
                continue
            actor = self._actor(actor_uid)
            N = self.with_user(actor)
            emp = att.employee_id
            emp_user = emp.user_id
            t = self._hm(att.check_in, emp)
            wfh = _(" (WFH)") if getattr(att, 'is_wfh', False) else ''
            late_by = self._dur((att.late_minutes or 0) / 60.0)
            late = _(" · %s late", late_by) if att.is_late else ''

            if self._by_other(actor, emp_user):
                N._notify('emp_att_created', emp_user, _("Attendance added"),
                          _("%(by)s recorded your check-in at %(t)s on %(day)s.",
                            by=actor.name, t=t, day=self._day(self._local(att.check_in, emp).date())),
                          att, 'Attendance')
            else:
                sent = self.browse()
                if att.is_late:
                    ask = '' if att.late_reason else _(" Tap to add the reason.")
                    sent = N._notify('emp_late', emp_user, _("You checked in late"),
                                     _("Checked in at %(t)s%(wfh)s, %(m)s late.%(ask)s",
                                       t=t, wfh=wfh, m=late_by, ask=ask),
                                     att, 'LateReason', {'attendanceId': att.id},
                                     include_actor=True)
                if not sent:
                    N._notify('emp_checkin', emp_user, _("Checked in"),
                              _("Checked in at %(t)s%(wfh)s.", t=t, wfh=wfh),
                              att, 'Attendance', include_actor=True)

            hr = self._hr_users('attendance', emp.company_id)
            sent = self.browse()
            if att.is_late:
                sent = N._notify('hr_late', hr, _("Late: %s", emp.name),
                                 _("Checked in at %(t)s%(wfh)s%(late)s.", t=t, wfh=wfh, late=late),
                                 att, 'LateRecords')
            if not sent:
                N._notify('hr_checkin', hr, _("%s checked in", emp.name),
                          _("At %(t)s%(wfh)s.", t=t, wfh=wfh), att, 'DayStatus')

    def _on_att_out(self, payloads):
        Att = self.env['hr.attendance'].sudo()
        for att_id, actor_uid in payloads:
            att = Att.browse(att_id).exists()
            if not att or not att.check_out or not att.employee_id:
                continue
            actor = self._actor(actor_uid)
            N = self.with_user(actor)
            emp = att.employee_id
            emp_user = emp.user_id
            t = self._hm(att.check_out, emp)
            worked = self._dur(att.worked_hours)
            if self._by_other(actor, emp_user):
                N._notify('emp_att_edited', emp_user, _("Attendance updated"),
                          _("%(by)s recorded your check-out at %(t)s (%(w)s worked).",
                            by=actor.name, t=t, w=worked), att, 'Attendance')
            else:
                N._notify('emp_checkout', emp_user, _("Checked out"),
                          _("Checked out at %(t)s · %(w)s worked.", t=t, w=worked),
                          att, 'Attendance', include_actor=True)
            N._notify('hr_checkout', self._hr_users('attendance', emp.company_id),
                      _("%s checked out", emp.name),
                      _("At %(t)s · %(w)s worked.", t=t, w=worked), att, 'DayStatus')

    def _on_att_edit(self, payloads):
        Att = self.env['hr.attendance'].sudo()
        seen = set()
        for att_id, actor_uid in payloads:
            att = Att.browse(att_id).exists()
            if not att or att_id in seen or not att.employee_id:
                continue
            seen.add(att_id)
            actor = self._actor(actor_uid)
            emp = att.employee_id
            if not self._by_other(actor, emp.user_id):
                continue
            span = self._hm(att.check_in, emp)
            if att.check_out:
                span += ' – ' + self._hm(att.check_out, emp)
            self.with_user(actor)._notify(
                'emp_att_edited', emp.user_id, _("Attendance changed"),
                _("%(by)s changed your attendance on %(day)s to %(span)s.",
                  by=actor.name, day=self._day(self._local(att.check_in, emp).date()), span=span),
                att, 'Attendance')

    @api.model
    def _announce_attendance_deleted(self, employee, check_in, check_out):
        if not employee:
            return
        employee = employee.sudo()
        span = self._hm(check_in, employee)
        if check_out:
            span += ' – ' + self._hm(check_out, employee)
        day = self._day(self._local(check_in, employee).date()) if check_in else ''
        self._notify('emp_att_deleted', employee.user_id, _("Attendance deleted"),
                     _("%(by)s deleted your attendance on %(day)s (%(span)s). The day is re-graded.",
                       by=self.env.user.name, day=day, span=span), screen='Attendance')
        self._notify('adm_att_deleted', self._hr_users('admin', employee.company_id),
                     _("Attendance deleted"),
                     _("%(by)s deleted %(emp)s's attendance on %(day)s (%(span)s).",
                       by=self.env.user.name, emp=employee.name, day=day, span=span))

    # ------------------------------------------------------------------ #
    # Day status: Half Day, Absent                                       #
    # ------------------------------------------------------------------ #
    def _on_day(self, payloads):
        Day = self.env['hr.attendance.day.status'].sudo()
        # Only fresh days: a policy or holiday change re-grades three months,
        # and history is not news.
        oldest = fields.Date.context_today(self) - timedelta(days=1)
        absent_by_company = {}
        done = set()
        for row_id, old in payloads:
            row = Day.browse(row_id).exists()
            if not row or row_id in done or row.date < oldest or row.status == old:
                continue
            done.add(row_id)
            emp = row.employee_id
            day = self._day(row.date)
            if row.status == 'half_day':
                self._notify('emp_halfday', emp.user_id, _("Marked Half Day"),
                             _("%(day)s: %(status)s. Half a day's pay is deducted.",
                               day=day, status=row.status_display or _("Half Day")),
                             row, 'Attendance')
                self._notify('hr_halfday', self._hr_users('attendance', emp.company_id),
                             _("Half Day: %s", emp.name),
                             _("%(day)s: %(status)s", day=day, status=row.status_display or ''),
                             row, 'DayStatus')
            elif row.status == 'absent':
                self._notify('emp_absent', emp.user_id, _("Marked Absent"),
                             _("No check-in on %s by the cutoff, so the day is marked Absent. "
                               "If you are working, check in now.", day),
                             row, 'Attendance')
                absent_by_company.setdefault(emp.company_id, []).append(emp.name)
        for company, names in absent_by_company.items():
            shown = ', '.join(names[:10]) + (_(" and %s more", len(names) - 10) if len(names) > 10 else '')
            self._notify('hr_absent_digest', self._hr_users('attendance', company),
                         _("%s absent today", len(names)), shown, screen='AbsentToday')

    # ------------------------------------------------------------------ #
    # Office hours                                                       #
    # ------------------------------------------------------------------ #
    @api.model
    def _announce_policy_change(self, configs):
        for cfg in configs.sudo():
            domain = [('company_id', '=', cfg.company_id.id), ('user_id', '!=', False)]
            if cfg.department_id:
                domain.append(('department_id', '=', cfg.department_id.id))
            employees = self.env['hr.employee'].sudo().search(domain)
            body = _("Office hours are now %(start)s – %(end)s; late after %(grace)s min.",
                     start=_hour(cfg.office_start_hour), end=_hour(cfg.office_end_hour),
                     grace=cfg.late_threshold_minutes)
            self._notify('emp_policy_changed', employees.mapped('user_id'),
                         _("Office hours changed"), body, cfg, 'Attendance')
            self._notify('adm_policy_changed', self._hr_users('admin', cfg.company_id),
                         _("Office hours changed"),
                         _("%(by)s changed %(cfg)s. %(body)s",
                           by=self.env.user.name, cfg=cfg.display_name, body=body), cfg)

    # ------------------------------------------------------------------ #
    # Crons                                                              #
    # ------------------------------------------------------------------ #
    @api.model
    def _cron_reminders(self):
        """Every 15 minutes: check-in and check-out reminders, once a day each.

        Check-in: a working day (weekday + no public holiday), past office start
        plus grace, before office end, no check-in yet and no approved leave.
        Check-out: still checked in 30 minutes after office end.
        """
        Config = self.env['hr.attendance.late.config'].sudo()
        Day = self.env['hr.attendance.day.status'].sudo()
        Att = self.env['hr.attendance'].sudo()
        now = fields.Datetime.now()
        for emp in self.env['hr.employee'].sudo().search([('user_id', '!=', False)]):
            try:
                cfg = Config.get_config_for_employee(emp.id)
                tz = self._tz(emp)
                local = pytz.utc.localize(now).astimezone(tz)
                today = local.date()
                hour = local.hour + local.minute / 60.0
                start = cfg.get('office_start_hour') or 9.0
                end = cfg.get('office_end_hour') or 18.0
                grace = (cfg.get('late_threshold_minutes') or 0) / 60.0
                day_start = tz.localize(datetime.combine(today, time.min)).astimezone(
                    pytz.utc).replace(tzinfo=None)

                if start + grace <= hour < end:
                    if (not self._already_sent('emp_checkin_reminder', emp.user_id, day_start)
                            and Config.is_working_day(today, emp.id)
                            and not Att.search_count([('employee_id', '=', emp.id),
                                                      ('check_in', '>=', day_start)], limit=1)
                            and not Day._find_leave(emp, today)):
                        self._notify('emp_checkin_reminder', emp.user_id, _("Don't forget to check in"),
                                     _("Office started at %s and you haven't checked in yet.",
                                       _hour(start)), screen='Home')
                if hour >= end + 0.5:
                    open_att = Att.search([('employee_id', '=', emp.id), ('check_out', '=', False),
                                           ('check_in', '>=', day_start)], limit=1)
                    if open_att and not self._already_sent('emp_checkout_reminder', emp.user_id, day_start):
                        self._notify('emp_checkout_reminder', emp.user_id, _("Still checked in"),
                                     _("Office closed at %s. Check out when you leave.", _hour(end)),
                                     open_att, 'Home')
            except Exception:
                _logger.exception("[notify] reminder failed for employee %s", emp.id)

    @api.model
    def _cron_daily_digests(self):
        """Hourly; each digest fires once a day after its local hour.

        09:00 missed check-outs (yesterday) · 10:00 requests waiting > 24h and
        comp off expiring in 7 days · 17:00 holiday tomorrow.
        """
        tz = self._tz(self.env['hr.employee'])
        now = fields.Datetime.now()
        local = pytz.utc.localize(now).astimezone(tz)
        today = local.date()

        def utc(d):
            return tz.localize(datetime.combine(d, time.min)).astimezone(pytz.utc).replace(tzinfo=None)

        if local.hour >= 9 and self._once_per_day('missed_checkout', today):
            open_atts = self.env['hr.attendance'].sudo().search([
                ('check_out', '=', False),
                ('check_in', '>=', utc(today - timedelta(days=1))),
                ('check_in', '<', utc(today)),
            ])
            by_company = {}
            for att in open_atts:
                by_company.setdefault(att.employee_id.company_id, []).append(att.employee_id.name)
            for company, names in by_company.items():
                self._notify('hr_missed_checkout', self._hr_users('attendance', company),
                             _("%s didn't check out yesterday", len(names)),
                             ', '.join(names[:10]), screen='DayStatus')

        if local.hour >= 10 and self._once_per_day('pending', today):
            limit = now - timedelta(hours=24)
            for model, kind, screen in (('hr.leave.request', 'leave', 'LeaveQueue'),
                                        ('hr.wfh.request', 'wfh', 'WfhQueue')):
                waiting = self.env[model].sudo().search([
                    ('state', '=', 'pending'), ('submitted_on', '<', limit)])
                by_company = {}
                for req in waiting:
                    by_company.setdefault(req.hr_employee_id.company_id, []).append(req)
                for company, reqs in by_company.items():
                    self._notify('hr_pending_reminder', self._hr_users(kind, company or None),
                                 _("%(n)s %(what)s waiting", n=len(reqs),
                                   what=_("leave requests") if kind == 'leave' else _("WFH requests")),
                                 _("Pending for more than a day. Oldest: %s.",
                                   reqs[0].employee_name or ''),
                                 screen=screen, params={'state': 'pending'})

        if local.hour >= 10 and self._once_per_day('compoff_expiring', today):
            soon = self.env['hr.comp.off.credit'].sudo().search([
                ('state', '=', 'available'), ('expiry_date', '=', today + timedelta(days=7))])
            for credit in soon:
                self._notify('emp_compoff_expiring', credit.employee_id.user_id,
                             _("Comp off expiring"),
                             _("%(days)s of comp off from %(day)s expires on %(exp)s. Use it before then.",
                               days=self._plural(credit.days_left, _("day")),
                               day=self._day(credit.date_earned), exp=self._day(credit.expiry_date)),
                             credit, 'Leave')

        if local.hour >= 17 and self._once_per_day('holiday_tomorrow', today):
            for h in self.env['hr.public.holiday'].sudo().search([
                    ('date', '=', today + timedelta(days=1))]):
                self._notify('emp_holiday_tomorrow', self._company_users(h.company_id),
                             _("Holiday tomorrow"),
                             _("%(name)s. Enjoy your day off on %(day)s.",
                               name=h.name, day=self._day(h.date)), h)
