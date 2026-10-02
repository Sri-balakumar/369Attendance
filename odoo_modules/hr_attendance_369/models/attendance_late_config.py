from datetime import timedelta

from odoo import models, fields, api, exceptions, _
import pytz


def _tz_get(self):
    return [(tz, tz) for tz in sorted(pytz.all_timezones)]


WEEKDAYS = [
    ('0', 'Monday'), ('1', 'Tuesday'), ('2', 'Wednesday'), ('3', 'Thursday'),
    ('4', 'Friday'), ('5', 'Saturday'), ('6', 'Sunday'),
]
ORDINALS = {1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th'}
WORK_DAY_FIELDS = {
    'work_monday', 'work_tuesday', 'work_wednesday', 'work_thursday',
    'work_friday', 'work_saturday', 'work_sunday',
}


def week_of_month(day):
    """Which occurrence of its weekday a date is: the 1st-7th are the 1st,
    the 8th-14th the 2nd, and so on. So the 2nd Saturday always falls on the
    8th-14th, whatever weekday the month starts on."""
    return (day.day - 1) // 7 + 1


def is_weekly_off_day(day, working_days, monthly_offs=None):
    """The one test for "is this DATE a weekly off".

    working_days is the list of weekday ints (0=Monday) ticked as working;
    monthly_offs maps a weekday int to the weeks of the month it is off even
    though it is ticked (Saturday -> {2} for "2nd Saturday off"). Everything
    that counts or grades working days goes through here, so the rule only
    has to be right once.
    """
    wd = day.weekday()
    if wd not in working_days:
        return True
    return week_of_month(day) in (monthly_offs or {}).get(wd, ())


class AttendanceLateConfig(models.Model):
    _name = 'hr.attendance.late.config'
    _description = 'Attendance Rules'
    _rec_name = 'display_name'

    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        required=True,
    )
    department_id = fields.Many2one(
        'hr.department',
        string='Department',
        help='Leave empty for company-wide setting. Set to apply only to this department.',
    )
    timezone = fields.Selection(
        _tz_get, string='Office Timezone',
        help="Timezone the office hours are defined in (e.g. Asia/Muscat). Each "
             "check-in is converted to this timezone before being compared to the "
             "start times — so the server's location doesn't matter. Leave empty to "
             "use each employee's own timezone.",
    )

    # --- Master switches ---
    # All three default True so an upgrade backfills existing configs with
    # today's behaviour and nothing changes until someone flips a switch.
    # The two sub-switches only mean anything while late_tracking_enabled is on.
    late_tracking_enabled = fields.Boolean(
        string='Late Tracking',
        default=True,
        help='Turn the whole late-tracking feature off for this scope. When off, '
             'check-ins are never flagged late, no late minutes are recorded and '
             'the late-reason popup never appears. Attendance itself is still '
             'recorded normally. Turning it back on and clicking Recompute '
             'restores the figures.',
    )
    late_reason_required = fields.Boolean(
        string='Require Late Reason',
        default=True,
        help='Ask the employee why they were late. When off, a late check-in '
             'saves without a reason and the "Enter Late Reason" button is hidden.',
    )

    # --- Office hours (one continuous period) ---
    office_start_hour = fields.Float(
        string='Office Start',
        default=8.0,
        help='Office start time in 24h format (9.5 = 9:30 AM).',
    )
    office_end_hour = fields.Float(
        string='Office End',
        default=17.0,
        help='Office end time in 24h format (18.5 = 6:30 PM).',
    )

    late_threshold_minutes = fields.Integer(
        string='Late Threshold (Minutes)',
        default=15,
        help='Grace minutes after Office Start before a check-in counts as late. '
             '15 on a 9:30 start means anyone in by 9:45 is on time.',
    )

    # --- Working Days Configuration ---
    work_monday = fields.Boolean(string='Monday', default=True)
    work_tuesday = fields.Boolean(string='Tuesday', default=True)
    work_wednesday = fields.Boolean(string='Wednesday', default=True)
    work_thursday = fields.Boolean(string='Thursday', default=True)
    work_friday = fields.Boolean(string='Friday', default=True)
    work_saturday = fields.Boolean(string='Saturday', default=True)
    work_sunday = fields.Boolean(string='Sunday', default=False)

    # A working day can still be off on some weeks of the month: "2nd Saturday
    # off" is Saturday ticked above plus one rule here with the 2nd week ticked.
    week_off_rule_ids = fields.One2many(
        'hr.attendance.week.off.rule', 'config_id',
        string='Off on Some Weeks',
        help='A working day that is off only on some weeks of the month, e.g. '
             'Saturday with 2nd ticked for "2nd Saturday off". Those dates count '
             'exactly like a weekly off: never stamped Absent, outside the '
             'working-day count, and working them needs "I am working today".',
    )
    week_off_summary = fields.Char(
        string='Some Weeks Off', compute='_compute_week_off_summary',
        help='The monthly offs in words, e.g. "2nd Saturday off".',
    )

    active = fields.Boolean(default=True)

    # --- Paid hours per day ---
    daily_work_hours = fields.Float(
        string='Daily Paid Hours',
        compute='_compute_daily_work_hours',
        store=True,
        readonly=False,
        help='Paid working hours per day. Auto-calculated as Office End minus '
             'Office Start, but editable on purpose: 9:30-18:30 spans 9 hours '
             'while only 8 are paid (1 hour lunch). This is the baseline for the '
             'half-day hours test, so a wrong value mis-grades short days. '
             'Editing the office hours recomputes and overwrites a manual value.',
    )

    @api.depends('office_start_hour', 'office_end_hour')
    def _compute_daily_work_hours(self):
        for rec in self:
            rec.daily_work_hours = max(0, rec.office_end_hour - rec.office_start_hour)

    # --- Day-status ladder (drives hr.attendance.day.status) ---
    # Every threshold defaults to 0.0 = OFF, so an upgrade changes nothing at
    # all until HR fills the numbers in. See models/attendance_day_status.py
    # for how they combine into a single day status.
    late_until_hour = fields.Float(
        string='Late Window Ends',
        default=0.0,
        help='End of the late window, 24h format (11.0 = 11:00 AM). One number '
             'doing two jobs: past it, someone who has NOT checked in is stamped '
             'Absent by the cron; past it, someone who DOES check in is Present '
             'graded Present rather than Late. Purely a status distinction - '
             'lateness costs nothing either way. '
             '0 = off, leaving lateness unbounded.',
    )
    half_day_after_hour = fields.Float(
        string='Half Day After',
        default=0.0,
        help='Check in later than this (24h format, 13.5 = 1:30 PM) and the day '
             'counts as a half day. 0 = off.',
    )
    half_day_min_hours_ratio = fields.Float(
        string='Half Day Below Ratio',
        default=0.0,
        help='Fraction of Daily Paid Hours below which a finished day counts as a '
             'half day - 0.5 catches anyone who worked less than half their hours. '
             'Applied when the check-out is written. 0 = off.',
    )
    kra_workday_creates_attendance = fields.Boolean(
        string='KRA Workday Creates Attendance',
        default=True,
        help='When on, pressing Start Workday in the KRA/KPI board creates the '
             'check-in here and End Workday writes the check-out. Turn it off to '
             'stop the bridge for this company/department without a code change. '
             'Has no effect unless the kra_kpi_attendance_bridge module is '
             'installed - this module does not depend on KRA/KPI.',
    )
    require_day_off_declaration = fields.Boolean(
        string="Day Off Needs 'I Am Working Today'",
        default=True,
        help="When on, check-in on a weekly off or a public holiday is refused "
             "until the employee taps 'I am working today' in the Attendance "
             "app. The declaration is what earns the compensatory off, sized "
             "half or full from the hours worked. Applies to every check-in "
             "route: the app, the KRA workday and the backend. Has no effect "
             "while compensatory off is switched off in the leave policy.",
    )

    @api.depends('company_id', 'department_id')
    def _compute_display_name(self):
        for rec in self:
            if rec.department_id:
                rec.display_name = f'{rec.company_id.name} / {rec.department_id.name}'
            else:
                rec.display_name = f'{rec.company_id.name} (Company-wide)'

    def get_working_days_list(self):
        """Return list of weekday integers (0=Monday..6=Sunday) that are working days."""
        self.ensure_one()
        days = []
        if self.work_monday:
            days.append(0)
        if self.work_tuesday:
            days.append(1)
        if self.work_wednesday:
            days.append(2)
        if self.work_thursday:
            days.append(3)
        if self.work_friday:
            days.append(4)
        if self.work_saturday:
            days.append(5)
        if self.work_sunday:
            days.append(6)
        return days

    def _monthly_offs(self):
        """{weekday int: {week numbers}} from the some-weeks-off rules."""
        self.ensure_one()
        return {int(rule.weekday): set(rule._weeks()) for rule in self.week_off_rule_ids}

    def _is_weekly_off(self, day):
        self.ensure_one()
        return is_weekly_off_day(day, self.get_working_days_list(), self._monthly_offs())

    @api.depends('work_monday', 'work_tuesday', 'work_wednesday', 'work_thursday',
                 'work_friday', 'work_saturday', 'work_sunday',
                 'week_off_rule_ids.weekday', 'week_off_rule_ids.week_1',
                 'week_off_rule_ids.week_2', 'week_off_rule_ids.week_3',
                 'week_off_rule_ids.week_4', 'week_off_rule_ids.week_5')
    def _compute_week_off_summary(self):
        names = dict(WEEKDAYS)
        for rec in self:
            working = rec.get_working_days_list()
            parts = []
            # A rule on a day that is off every week anyway says nothing.
            for rule in rec.week_off_rule_ids.filtered(lambda r: int(r.weekday) in working):
                weeks = [ORDINALS[n] for n in rule._weeks()]
                if not weeks:
                    continue
                shown = weeks[0] if len(weeks) == 1 else '%s & %s' % (', '.join(weeks[:-1]), weeks[-1])
                parts.append('%s %s off' % (shown, names[rule.weekday]))
            rec.week_off_summary = ' · '.join(parts)

    def set_week_off_rules(self, rules):
        """Replace this config's some-weeks-off rules in one call (the app's
        Save). rules: [{'weekday': 5, 'weeks': [2]}]. A day with no weeks is
        dropped. Recomputes once, and only when the rule really changed."""
        self.ensure_one()
        lines = {}
        for rule in rules or []:
            wd = int(rule.get('weekday', -1))
            weeks = sorted({int(w) for w in (rule.get('weeks') or []) if 1 <= int(w) <= 5})
            if 0 <= wd <= 6 and weeks:
                lines[wd] = weeks
        before = self._monthly_offs()
        Rule = self.env['hr.attendance.week.off.rule'].with_context(skip_week_off_recompute=True)
        self.with_context(skip_week_off_recompute=True).week_off_rule_ids.unlink()
        Rule.create([
            dict({'config_id': self.id, 'weekday': str(wd)},
                 **{'week_%d' % n: n in weeks for n in range(1, 6)})
            for wd, weeks in sorted(lines.items())
        ])
        self.invalidate_recordset(['week_off_rule_ids'])
        if self._monthly_offs() != before:
            self._recompute_week_off_dates()
        return True

    def _recompute_week_off_dates(self):
        """Working days changed: recount and re-grade from the 1st of this month.

        Neither the weekday ticks nor the some-weeks-off rules are ORM
        dependencies of the leave day count or the day status, so nothing
        follows them on its own. Same re-grading a holiday change does
        (hr.public.holiday._recompute_affected). Earlier months are left
        alone: they are payroll history.
        """
        if not self:
            return
        from dateutil.relativedelta import relativedelta
        start = fields.Date.context_today(self).replace(day=1)
        end = start + relativedelta(months=12)
        dates = [start + timedelta(days=i) for i in range((end - start).days)]
        self.env['hr.public.holiday']._recompute_affected(dates, set(self.mapped('company_id').ids))
        # The daily rate's divisor moved too, which the day count alone does
        # not carry to the leave deductions.
        self._recompute_affected_leaves()

    @api.model
    def is_working_day(self, check_date, employee_id):
        config_data = self.get_config_for_employee(employee_id)
        working_days = config_data.get('working_days', [0, 1, 2, 3, 4, 5])

        if is_weekly_off_day(check_date, working_days, config_data.get('monthly_offs')):
            return False

        Holiday = self.env['hr.public.holiday']
        employee = self.env['hr.employee'].browse(employee_id)
        company_id = employee.company_id.id if employee.exists() else self.env.company.id
        if Holiday.is_public_holiday(check_date, company_id):
            return False

        return True

    def get_working_days_in_month(self, year, month, company_id):
        """Working days in a month: the configured weekdays, minus public holidays.

        This is the divisor for every daily rate in the system (absent, half
        day, unpaid leave). Sundays are excluded because Sunday is unchecked in
        the working-days boxes, and public holidays are excluded here -- which
        is exactly what makes both of them PAID: they are never in the divisor,
        so a full month of attendance pays the whole wage and neither day can
        be deducted.

        Returns a float; callers divide by it.
        """
        self.ensure_one()
        import calendar
        from datetime import date as dt_date
        working_days_list = self.get_working_days_list()
        monthly_offs = self._monthly_offs()
        Holiday = self.env['hr.public.holiday']

        total = 0.0
        days_in_month = calendar.monthrange(year, month)[1]
        for day_num in range(1, days_in_month + 1):
            d = dt_date(year, month, day_num)
            if not is_weekly_off_day(d, working_days_list, monthly_offs):
                if not Holiday.is_public_holiday(d, company_id):
                    total += 1
        return total

    @api.model
    def get_config_for_employee(self, employee_id):
        employee = self.env['hr.employee'].browse(employee_id)
        defaults = {
            # An employee with no config record keeps the historical behaviour:
            # everything on.
            'late_tracking_enabled': True,
            'late_reason_required': True,
            'office_start_hour': 8.0,
            'office_end_hour': 17.0,
            'late_threshold_minutes': 15,
            'daily_work_hours': 9.0,
            'working_days': [0, 1, 2, 3, 4, 5],
            'monthly_offs': {},
            'timezone': False,
            # Ladder off by default: no config record must never start
            # stamping people absent or docking half days.
            'late_until_hour': 0.0,
            'half_day_after_hour': 0.0,
            'half_day_min_hours_ratio': 0.0,
            'kra_workday_creates_attendance': True,
            'require_day_off_declaration': True,
        }
        if not employee.exists():
            return defaults

        config = self.search([
            ('company_id', '=', employee.company_id.id),
            ('department_id', '=', employee.department_id.id),
        ], limit=1)

        if not config:
            config = self.search([
                ('company_id', '=', employee.company_id.id),
                ('department_id', '=', False),
            ], limit=1)

        if not config:
            return defaults

        return {
            'id': config.id,
            'late_tracking_enabled': config.late_tracking_enabled,
            'late_reason_required': config.late_reason_required,
            'office_start_hour': config.office_start_hour,
            'office_end_hour': config.office_end_hour,
            'late_threshold_minutes': config.late_threshold_minutes,
            'daily_work_hours': config.daily_work_hours,
            'working_days': config.get_working_days_list(),
            'monthly_offs': config._monthly_offs(),
            'timezone': config.timezone,
            'late_until_hour': config.late_until_hour,
            'half_day_after_hour': config.half_day_after_hour,
            'half_day_min_hours_ratio': config.half_day_min_hours_ratio,
            'kra_workday_creates_attendance': config.kra_workday_creates_attendance,
            'require_day_off_declaration': config.require_day_off_declaration,
        }

    @api.model
    def get_config_record_for_employee(self, employee_id):
        employee = self.env['hr.employee'].browse(employee_id)
        if not employee.exists():
            return self.browse()

        config = self.search([
            ('company_id', '=', employee.company_id.id),
            ('department_id', '=', employee.department_id.id),
        ], limit=1)

        if not config:
            config = self.search([
                ('company_id', '=', employee.company_id.id),
                ('department_id', '=', False),
            ], limit=1)

        return config or self.browse()

    # --- Office-timezone display helpers ---

    @api.model
    def get_office_timezone(self, employee_id=False):
        """Office tz name for displaying datetimes: config office timezone →
        employee's own tz → any configured office tz → UTC."""
        tz_name = False
        if employee_id:
            tz_name = self.get_config_for_employee(employee_id).get('timezone')
            if not tz_name:
                emp = self.env['hr.employee'].browse(employee_id)
                tz_name = emp.exists() and emp.tz
        if not tz_name:
            cfg = self.sudo().search([('timezone', '!=', False)], limit=1)
            tz_name = cfg.timezone if cfg else False
        return tz_name or 'UTC'

    @api.model
    def format_datetime_office(self, dt, employee_id=False):
        """UTC datetime -> 'DD Mon YYYY, HH:MM AM/PM' string in the office tz.
        Mirrors hr.attendance._compute_office_time formatting so every datetime
        reads the same way as the attendance check-in office time."""
        if not dt:
            return ''
        tz = pytz.timezone(self.get_office_timezone(employee_id))
        return pytz.utc.localize(dt).astimezone(tz).strftime('%d %b %Y, %I:%M %p')

    # --- Recompute hooks ---

    def action_recompute_records(self):
        """Manually refresh stored late + leave deductions for this config's
        scope. Reuses _recompute_affected_attendances, which also recomputes
        leave-request deductions."""
        self._recompute_affected_attendances()
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Recomputed',
                'message': 'Late and leave deductions recomputed for the last 3 months.',
                'type': 'success',
                'sticky': False,
            },
        }

    def _recompute_affected_attendances(self):
        """Force-recompute stored late-tracking fields on attendance records
        whose configuration may have been affected by changes to this config.
        Walks the rolling 3-month window so stale stored values (e.g. wrong
        deduction because wage was missing at compute time) get refreshed.
        """
        from datetime import date as dt_date
        from dateutil.relativedelta import relativedelta
        Att = self.env['hr.attendance']
        today = dt_date.today()
        date_from = today - relativedelta(months=3)
        for cfg in self:
            domain = [('date', '>=', date_from), ('date', '<=', today)]
            if cfg.company_id:
                domain.append(('employee_id.company_id', '=', cfg.company_id.id))
            if cfg.department_id:
                domain.append(('employee_id.department_id', '=', cfg.department_id.id))
            recs = Att.search(domain)
            if not recs:
                continue
            # Trigger every stored compute that depends on lateness, flushing
            # between steps so the deduction pass sees committed values from
            # the lateness pass rather than pre-compute DB state.
            recs._compute_late_info()
            recs.flush_recordset()
            recs._compute_late_minutes_display()
            recs.flush_recordset()
            recs._sync_day_status()
        # Leave deductions share the same working-days basis, so they go stale
        # for exactly the same reasons. Previously this lived in a separate
        # module (hr_leave_request) that inherited this model just to extend
        # this hook; now they ship together it is a plain call.
        self._recompute_affected_leaves()

    def _recompute_affected_leaves(self):
        """Recompute paid/unpaid status + deduction for recent leave requests of
        the employees this config covers.

        `hr.leave.request.deduction_amount` is a stored field whose dependencies
        do NOT include this config, so it never recomputes when the working days
        change — it goes stale (e.g. computed at a
        26-day basis instead of 27). Recomputing here keeps the leave list
        aligned with the monthly report.
        """
        from dateutil.relativedelta import relativedelta
        Leave = self.env['hr.leave.request']
        today = fields.Date.today()
        date_from = today - relativedelta(months=3)
        for cfg in self:
            domain = [('from_date', '>=', date_from)]
            if cfg.company_id:
                domain.append(('hr_employee_id.company_id', '=', cfg.company_id.id))
            if cfg.department_id:
                domain.append(('hr_employee_id.department_id', '=', cfg.department_id.id))
            leaves = Leave.search(domain)
            if leaves:
                leaves._compute_paid_status()
                leaves.flush_recordset()

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        recs._recompute_affected_attendances()
        return recs

    def write(self, vals):
        # The form saves its some-weeks-off lines inside this write; hold their
        # own recompute back so a save that touches three lines re-grades once.
        rules_in_vals = 'week_off_rule_ids' in vals
        target = self.with_context(skip_week_off_recompute=True) if rules_in_vals else self
        res = super(AttendanceLateConfig, target).write(vals)
        # Only recompute when a rule-affecting field changed.
        recompute_fields = {
            'late_tracking_enabled', 'late_reason_required',
            'office_start_hour', 'office_end_hour', 'late_threshold_minutes',
            'daily_work_hours', 'company_id', 'department_id', 'active',
            'timezone',
            # Ladder thresholds: these live only in config, so a stored compute
            # cannot depend on them. Changing one has to force the recompute.
            'late_until_hour', 'half_day_after_hour', 'half_day_min_hours_ratio',
        }
        if recompute_fields & set(vals.keys()):
            self._recompute_affected_attendances()
        if rules_in_vals or WORK_DAY_FIELDS & set(vals):
            self._recompute_week_off_dates()
        return res


class AttendanceWeekOffRule(models.Model):
    """A working day that is off on some weeks of the month.

    One line per weekday per config: Saturday with week_2 ticked is "2nd
    Saturday off". The weeks are the occurrence in the month (see
    week_of_month), not calendar weeks.
    """
    _name = 'hr.attendance.week.off.rule'
    _description = 'Weekly Off on Some Weeks'
    _order = 'config_id, weekday'

    config_id = fields.Many2one(
        'hr.attendance.late.config', string='Rules', required=True,
        ondelete='cascade', index=True,
    )
    weekday = fields.Selection(WEEKDAYS, string='Day', required=True)
    week_1 = fields.Boolean(string='1st')
    week_2 = fields.Boolean(string='2nd')
    week_3 = fields.Boolean(string='3rd')
    week_4 = fields.Boolean(string='4th')
    week_5 = fields.Boolean(string='5th')

    _unique_config_weekday = models.Constraint(
        'UNIQUE(config_id, weekday)',
        'That day already has a some-weeks-off line. Tick more weeks on it instead.',
    )

    def _weeks(self):
        self.ensure_one()
        return [n for n in range(1, 6) if self['week_%d' % n]]

    @api.constrains('week_1', 'week_2', 'week_3', 'week_4', 'week_5')
    def _check_weeks(self):
        for rec in self:
            weeks = rec._weeks()
            if not weeks:
                raise exceptions.ValidationError(
                    _('Tick at least one week for %s, or remove the line.',
                      dict(WEEKDAYS)[rec.weekday]))
            if len(weeks) == 5:
                raise exceptions.ValidationError(
                    _('All five weeks off means %s is off every week. Untick it '
                      'under Working Days instead.', dict(WEEKDAYS)[rec.weekday]))

    def _after_change(self, configs):
        if not self.env.context.get('skip_week_off_recompute'):
            configs._recompute_week_off_dates()

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        recs._after_change(recs.mapped('config_id'))
        return recs

    def write(self, vals):
        configs = self.mapped('config_id')
        res = super().write(vals)
        self._after_change(configs | self.mapped('config_id'))
        return res

    def unlink(self):
        configs = self.mapped('config_id')
        res = super().unlink()
        self._after_change(configs.exists())
        return res

