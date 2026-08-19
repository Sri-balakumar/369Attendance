from odoo import models, fields, api, _
from datetime import datetime, timedelta
import logging
import pytz

_logger = logging.getLogger(__name__)

# Labels for status_display. Kept beside the Selection so the two cannot drift.
STATUS_LABELS = {
    'present': 'Present',
    'late': 'Late',
    'half_day': 'Half Day',
    'leave': 'Leave',
    'absent': 'Absent',
}


class HrAttendanceDayStatus(models.Model):
    """One row per employee per day: what that day was worth.

    This model exists because ABSENT has no attendance record to hang off --
    that is precisely what absent means. A day-level row is the only place a
    no-show can be recorded, and it doubles as the single thing the monthly
    report and the "who is missing this morning" view both read.

    Rows are created two ways:

      * `_upsert_for_attendance` -- whenever an hr.attendance is created or
        edited, called from the compute chain in hr_attendance.py;
      * `_cron_stamp_absentees` -- once the office passes `late_until_hour`,
        for everyone with no attendance yet today. Approved leave is written as
        a `leave` row rather than skipped, so the day is positively recorded.

    The cron stamp is PROVISIONAL. When somebody finally checks in, the upsert
    finds that same row (unique on employee+date), attaches the attendance and
    clears `stamped_by_cron`, and the status recomputes itself. There is never
    a second row for the same day.
    """

    _name = 'hr.attendance.day.status'
    _description = 'Attendance Day Status'
    _order = 'date desc, employee_id'
    _rec_name = 'status_display'

    employee_id = fields.Many2one(
        'hr.employee', string='Employee',
        required=True, index=True, ondelete='cascade',
    )
    date = fields.Date(string='Date', required=True, index=True)
    company_id = fields.Many2one(
        related='employee_id.company_id', store=True, index=True,
    )

    attendance_id = fields.Many2one(
        'hr.attendance', string='Attendance', ondelete='set null',
        help='The check-in that anchors this day. Empty means nobody checked '
             'in, which is what makes the day Absent.',
    )
    is_wfh = fields.Boolean(
        string='WFH', related='attendance_id.is_wfh', readonly=True,
        help='Whether the check-in that anchors this day was made from home. '
             'Shown rather than acted on: WFH days are graded by exactly the '
             'same rules as office days, so a late WFH start still reads Late. '
             'Exempting them would change pay, which is a policy decision.',
    )
    leave_request_id = fields.Many2one(
        'hr.leave.request', string='Leave Request', ondelete='set null',
        help='The approved leave covering this day. Set instead of leaving the '
             'day Absent, so approved leave is positively recorded rather than '
             'absent-by-omission.',
    )
    stamped_by_cron = fields.Boolean(
        string='Stamped by Cron', default=False,
        help='Set when the absent cron created this row. Cleared the moment an '
             'attendance is attached, so it also reads as "still a no-show".',
    )

    status = fields.Selection([
        ('present', 'Present'),
        ('late', 'Late'),
        ('half_day', 'Half Day'),
        ('leave', 'Leave'),
        ('absent', 'Absent'),
    ], string='Status', compute='_compute_status', store=True, index=True)

    status_display = fields.Char(
        string='Day Status', compute='_compute_status', store=True,
        help='Status plus the actual start time in brackets whenever the person '
             'started late -- including when that lateness costs nothing. Free '
             'of charge is not the same as invisible.',
    )

    deduction_amount = fields.Float(
        string='Deduction', compute='_compute_status', store=True,
        help='Only a half day is docked here. An absent day costs a full day '
             'too, but by not being earned in the monthly report rather than '
             'by a deduction, so it shows 0.',
    )

    # Odoo 19 note: the `_sql_constraints = [...]` list is no longer supported
    # (the ORM logs "Model attribute '_sql_constraints' is no longer supported"
    # and skips it). models.Constraint is the replacement -- see
    # public_holiday.py, which hit exactly this.
    #
    # This uniqueness is load-bearing, not decorative: it is what guarantees the
    # cron stamp and a later check-in land on the SAME row instead of producing
    # two contradictory views of one day.
    _unique_employee_date = models.Constraint(
        'UNIQUE(employee_id, date)',
        'There is already a day status for this employee on this date.',
    )

    # ------------------------------------------------------------------ #
    # Status, label and money -- one compute, so they cannot disagree     #
    # ------------------------------------------------------------------ #
    @api.depends('attendance_id', 'attendance_id.check_in', 'attendance_id.check_out',
                 'attendance_id.is_late',
                 'employee_id', 'date',
                 'leave_request_id', 'leave_request_id.state',
                 'leave_request_id.is_paid', 'leave_request_id.leave_type',
                 'attendance_id.is_wfh')
    def _compute_status(self):
        """Grade the day, label it, and price it.

        Thresholds are tested LATEST FIRST. A 2:00 PM arrival is past the 11:00
        line as well as the 1:30 line; testing the earlier one first would stop
        there and mis-grade every afternoon start.

        Penalties never stack: the first match wins, so half day is the floor
        for anyone who showed up at all. Only a genuine no-show is absent.
        """
        Config = self.env['hr.attendance.late.config']
        for rec in self:
            att = rec.attendance_id
            cfg = Config.get_config_for_employee(rec.employee_id.id) \
                if rec.employee_id else {}

            if not att or not att.check_in:
                # Leave beats absent. Checked first, or somebody on approved
                # leave reads as a no-show.
                #
                # The STATE is checked, not just the link: a leave that was
                # cancelled or reset after the row was written must stop
                # excusing the day. `leave_request_id.state` has always been in
                # the depends above, so the row already recomputes when it
                # changes -- this is what it recomputes to.
                rec.status = ('leave'
                              if rec.leave_request_id.state == 'approved'
                              else 'absent')
            else:
                # An attendance beats leave: they came in anyway, so grade the
                # day on what they actually worked.
                rec.status = rec._grade_attendance(att, cfg)

            rec.status_display = rec._build_status_display(att, cfg)
            rec.deduction_amount = rec._price_day(att, cfg)

    def _grade_attendance(self, att, cfg):
        """Status for a day that HAS an attendance record."""
        self.ensure_one()
        hour = att._office_local_hour(cfg)

        # 1. Arrived past the half-day line -> half day, whatever else is true.
        half_after = cfg.get('half_day_after_hour') or 0.0
        if half_after > 0 and hour > half_after:
            return 'half_day'

        # 2. Finished the day having worked less than half the paid hours.
        #    Only once they have checked out: a day still in progress is not a
        #    short day, it is an unfinished one.
        ratio = cfg.get('half_day_min_hours_ratio') or 0.0
        paid = cfg.get('daily_work_hours') or 0.0
        if att.check_out and ratio > 0 and paid > 0:
            if (att.daily_total_hours or 0.0) < (paid * ratio):
                return 'half_day'

        # 3. Late, but only while lateness is still chargeable. Past
        #    late_until_hour the day is Present -- see _past_late_window.
        if att.is_late and not att._past_late_window(cfg):
            return 'late'

        return 'present'

    def _build_status_display(self, att, cfg):
        """Status label, plus the real start time in brackets when they were
        late: `Present (12:05 PM)`, `Late (10:15 AM)`.

        The bracket keys off `is_late`, not off the status, and that is the
        whole point: a start past the late window is graded Present and costs
        nothing, and would otherwise vanish from every screen HR looks at.
        Rendered in OFFICE time so it reads the same for every viewer.
        """
        self.ensure_one()
        label = STATUS_LABELS.get(self.status) or ''

        if self.status == 'leave':
            lv = self.leave_request_id
            if not lv:
                return label
            try:
                kind = dict(lv._fields['leave_type'].selection).get(
                    lv.leave_type, lv.leave_type or '')
            except Exception:
                kind = lv.leave_type or ''
            paid = 'Paid' if lv.is_paid else 'Unpaid'
            if lv.is_half_day:
                return 'Half Day Leave - %s (%s)' % (kind, paid)
            return 'Leave - %s (%s)' % (kind, paid)

        # Worked from home? Say so. is_wfh was previously computed, stored and
        # read by nothing, which meant a WFH check-in at 10:15 showed a bare
        # "Late (10:15 AM)" with no hint the person was approved to work from
        # home. The grading is unchanged -- this only makes it explicable.
        suffix = ' \u00b7 WFH' if (att and att.is_wfh) else ''

        if not att or not att.check_in or not att.is_late:
            return label + suffix
        tz_name = cfg.get('timezone') or self.employee_id.tz or 'UTC'
        try:
            local = pytz.utc.localize(att.check_in).astimezone(pytz.timezone(tz_name))
        except Exception:
            return label + suffix
        return '%s (%s)%s' % (label, local.strftime('%I:%M %p'), suffix)

    def _price_day(self, att, cfg):
        """What this day is docked.

        HALF DAY is the only status that carries an amount, because it is the
        only one where somebody worked and is still docked half their pay.
        Everything else is 0, each for its own reason:

          * absent  -- costs a full day, but by NOT BEING EARNED. The monthly
            report never counts an absent day in earned_days, so charging a
            deduction here as well would write the same loss twice.
          * late    -- recorded and labelled, never charged.
          * leave   -- priced by the report (unpaid leave) via
            calc_leave_deduction_live; charging it here too would double it.
          * present -- nothing owed.

        This column is a DISPLAY figure. Take-home pay is decided by the
        monthly report's earnings model, and the two are never summed.
        """
        self.ensure_one()
        if self.status == 'half_day':
            return round(self._full_day_wage() / 2.0, 2)
        return 0.0

    def _full_day_wage(self):
        """One day of wage. Single source: hr.employee._daily_wage()."""
        self.ensure_one()
        if not self.employee_id or not self.date:
            return 0.0
        return self.employee_id._daily_wage(self.date)

    # ------------------------------------------------------------------ #
    # Upsert from the attendance side                                    #
    # ------------------------------------------------------------------ #
    @api.model
    def _office_local_date(self, attendance, cfg=None):
        """The office-local calendar date of a check-in.

        Deliberately not `attendance.date` (UTC-derived): a 9:30 AM IST start
        is 04:00 UTC, and either side of midnight the two disagree about which
        day it belongs to.
        """
        if cfg is None:
            cfg = self.env['hr.attendance.late.config'].get_config_for_employee(
                attendance.employee_id.id)
        tz_name = cfg.get('timezone') or attendance.employee_id.tz or 'UTC'
        try:
            tz = pytz.timezone(tz_name)
        except Exception:
            tz = pytz.utc
        return pytz.utc.localize(attendance.check_in).astimezone(tz).date()

    @api.model
    def _upsert_for_attendance(self, attendance):
        """Create or refresh the day row for this attendance.

        Idempotent, and safe to call for every attendance on the day: the row
        anchors on the EARLIEST check-in, because it is the arrival time that
        grades the day.
        """
        if not attendance.employee_id or not attendance.check_in:
            return self.browse()

        day = self._office_local_date(attendance)
        row = self.sudo().search([
            ('employee_id', '=', attendance.employee_id.id),
            ('date', '=', day),
        ], limit=1)

        if not row:
            # A day the cron has not reached yet: if approved leave covers it,
            # record that too, so the row keeps the context even though the
            # attendance now decides the grade.
            leave = self._find_leave(attendance.employee_id, day)
            return self.sudo().create({
                'employee_id': attendance.employee_id.id,
                'date': day,
                'attendance_id': attendance.id,
                'leave_request_id': leave.id if leave else False,
                'stamped_by_cron': False,
            })

        vals = {}
        anchor = row.attendance_id
        if anchor != attendance:
            # Keep the earliest check-in of the day as the anchor.
            if not anchor or not anchor.check_in or attendance.check_in < anchor.check_in:
                vals['attendance_id'] = attendance.id
        if row.stamped_by_cron:
            # Somebody the cron wrote off has turned up. Clear the stamp; the
            # status recomputes from the attendance that just arrived.
            vals['stamped_by_cron'] = False
        if vals:
            row.sudo().write(vals)
        return row

    # ------------------------------------------------------------------ #
    # The absent stamp                                                   #
    # ------------------------------------------------------------------ #
    @api.model
    def _cron_stamp_absentees(self):
        """Stamp Absent on everyone with no attendance, once their own office
        has passed `late_until_hour`.

        Runs every 30 minutes rather than at one fixed clock time, because the
        cutoff is a per-company/department config value and offices can sit in
        different timezones. Idempotent: the existence check plus the
        unique(employee, date) constraint make repeated runs free.

        Returns the number of rows stamped.
        """
        Config = self.env['hr.attendance.late.config']
        now = fields.Datetime.now()
        stamped = 0

        for emp in self.env['hr.employee'].sudo().search([]):
            try:
                # One savepoint per employee: a unique-constraint race against a
                # check-in landing at the same instant must skip that person,
                # not abort the transaction and kill the sweep for everyone
                # after them.
                with self.env.cr.savepoint():
                    stamped += self._stamp_absent_for(emp, Config, now)
            except Exception:
                _logger.exception(
                    "[day-status] absent stamp failed for employee %s", emp.id)

        if stamped:
            _logger.info("[day-status] stamped %s absentee(s)", stamped)
        return stamped

    @api.model
    def _stamp_absent_for(self, employee, Config, now):
        """Stamp one employee, if they are genuinely a no-show right now.

        Returns 1 if a row was created, 0 otherwise. Every early return is a
        reason NOT to call somebody absent.
        """
        cfg = Config.get_config_for_employee(employee.id)
        limit = cfg.get('late_until_hour') or 0.0
        if limit <= 0:
            return 0  # ladder switched off for this scope

        tz_name = cfg.get('timezone') or employee.tz or 'UTC'
        try:
            tz = pytz.timezone(tz_name)
        except Exception:
            tz = pytz.utc
        local = pytz.utc.localize(now).astimezone(tz)
        if (local.hour + local.minute / 60.0) < limit:
            return 0  # cutoff not reached in this office yet

        today = local.date()
        if self.sudo().search_count([
                ('employee_id', '=', employee.id), ('date', '=', today)]):
            return 0  # a row already exists, stamped or graded

        # Weekends and public holidays both live inside is_working_day.
        if not Config.is_working_day(today, employee.id):
            return 0

        if self._has_attendance_on(employee, today, tz):
            return 0

        # Approved leave gets a POSITIVE row rather than being skipped, so the
        # day reads as Leave on every screen instead of being absent-by-omission.
        #
        # Approved WFH used to be excused here with no row at all. That was
        # wrong three ways: the monthly report ALREADY charges such a day a full
        # day (no attendance -> not in present_dates -> not earned), so the
        # screen and the payroll disagreed; it contradicted this model's own
        # premise that a day row is the only place a no-show can be recorded;
        # and because the check ran BEFORE this line, somebody with approved
        # leave AND a stale approved WFH request got no row at all -- the leave
        # row was silently swallowed.
        #
        # An approved-WFH no-show is now simply Absent, which is what it costs.
        # If they do check in later, _upsert_for_attendance attaches the
        # attendance, clears stamped_by_cron and re-grades this same row.
        leave = self._find_leave(employee, today)

        self.sudo().create({
            'employee_id': employee.id,
            'date': today,
            'leave_request_id': leave.id if leave else False,
            'stamped_by_cron': True,
        })
        return 1

    @api.model
    def _has_attendance_on(self, employee, day, tz):
        """Any check-in inside that office-local day.

        Belt and braces beside the day-row existence check: attendance created
        before this module was installed has no row, and must not be stamped
        absent retroactively.
        """
        start_local = tz.localize(datetime.combine(day, datetime.min.time()))
        start = start_local.astimezone(pytz.utc).replace(tzinfo=None)
        end = (start_local + timedelta(days=1)).astimezone(pytz.utc).replace(tzinfo=None)
        return bool(self.env['hr.attendance'].sudo().search_count([
            ('employee_id', '=', employee.id),
            ('check_in', '>=', start),
            ('check_in', '<', end),
        ]))

    @api.model
    def _find_leave(self, employee, day):
        """The approved leave covering `day`, if any.

        `to_date` is OPTIONAL -- its help text says "Leave empty for single day
        leave", and the mobile API stores False for every request it creates.
        An empty to_date therefore means "this one day", NOT "open ended".

        The obvious domain, `('to_date','>=',day)`, silently matched nothing for
        those records, because NULL >= date is false in SQL -- so every
        single-day leave was stamped Absent instead of Leave.

        The equally obvious fix, `'|', ('to_date','=',False), ('to_date','>=',day)`
        alongside `from_date <= day`, is also wrong: a single-day leave on 1 Aug
        would then match every later date as well. Hence both branches written
        out in full.
        """
        return self.env['hr.leave.request'].sudo().search([
            ('hr_employee_id', '=', employee.id),
            ('state', '=', 'approved'),
            '|',
                # single-day leave: covers from_date and nothing else
                '&', ('to_date', '=', False), ('from_date', '=', day),
                # ranged leave: from_date <= day <= to_date
                '&', ('to_date', '!=', False),
                     '&', ('from_date', '<=', day), ('to_date', '>=', day),
        ], limit=1)

    @api.model
    def _on_approved_wfh(self, employee, day):
        """True when an approved work-from-home day covers `day`.

        No longer consulted by the absent stamp -- an approved WFH no-show is
        Absent like any other. Kept because it is the one place that knows which
        request states mean "working from home today".
        """
        return bool(self.env['hr.wfh.request'].sudo().search_count([
            ('hr_employee_id', '=', employee.id),
            ('request_date', '=', day),
            ('state', 'in', ('approved', 'checked_in', 'checked_out')),
        ]))

    # ------------------------------------------------------------------ #
    # Maintenance                                                        #
    # ------------------------------------------------------------------ #
    def action_recompute(self):
        """Re-grade these rows.

        Needed because the thresholds live in config, not in an ORM dependency:
        editing `late_until_hour` cannot invalidate a stored compute by itself.
        The same reason hr.attendance.late.config already ships a Recompute
        button.
        """
        self._compute_status()
        self.flush_recordset()
        return True


class HrAttendanceDayStatusLink(models.Model):
    """Read-side link from an attendance back to the day it belongs to.

    Non-stored on purpose: the day row is keyed on (employee, office-local
    date) and one day can hold several attendances, so a stored column here
    would be a second copy of a fact that already has an owner.
    """

    _inherit = 'hr.attendance'

    day_status_id = fields.Many2one(
        'hr.attendance.day.status', string='Day Status Record',
        compute='_compute_day_status',
    )
    day_status_display = fields.Char(
        string='Day Status', compute='_compute_day_status',
        help='How this day was graded, with the start time in brackets when the '
             'person started late. Owned by hr.attendance.day.status; surfaced '
             'here so HR does not have to open a second screen.',
    )

    @api.depends('employee_id', 'check_in')
    def _compute_day_status(self):
        """Resolve every record's day row in ONE query.

        This field renders in the attendance LIST view, so a search per record
        would be an N+1 across every visible line. Keys are resolved first, then
        fetched in a single pass.
        """
        DayStatus = self.env['hr.attendance.day.status'].sudo()

        keys = {}
        for rec in self:
            rec.day_status_id = False
            rec.day_status_display = ''
            if not rec.employee_id or not rec.check_in:
                continue
            try:
                keys[rec.id] = (rec.employee_id.id, DayStatus._office_local_date(rec))
            except Exception:
                continue
        if not keys:
            return

        rows = DayStatus.search([
            ('employee_id', 'in', list({e for e, _ in keys.values()})),
            ('date', 'in', list({d for _, d in keys.values()})),
        ])
        by_key = {(r.employee_id.id, r.date): r for r in rows}

        for rec in self:
            row = by_key.get(keys.get(rec.id))
            if row:
                rec.day_status_id = row.id
                rec.day_status_display = row.status_display or ''
