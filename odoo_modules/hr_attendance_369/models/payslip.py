from datetime import timedelta

import pytz

from odoo import models, fields, api, _
from odoo.exceptions import UserError

from .num_to_words import amount_in_words


class Payslip(models.Model):
    """One employee's pay for one month.

    The figures are worked out here rather than read from hr.employee.report:
    that report is regenerated on demand and stores nothing a confirmed
    payslip could rely on, and its earnings model counts attendance dates
    rather than graded days.

    Days are counted from hr.attendance.day.status -- the module's canonical
    one-row-per-day ladder -- as SETS of dates, which makes double counting
    impossible, and leave is matched by the dates that actually fall inside
    the period.

    Note what is NOT used: `hr.attendance.day.status.deduction_amount`. Its own
    docstring calls it "a DISPLAY figure" that is never summed into pay -- it
    prices half days only, because an absent day costs a full day by not being
    EARNED rather than by being deducted. Summing that column would drop every
    absent day and double-charge every half day.
    """
    _name = 'hr.payslip'
    _description = 'Payslip'
    _order = 'date_from desc, employee_name'
    _rec_name = 'display_name'

    run_id = fields.Many2one(
        'hr.payslip.run', string='Payroll Run',
        required=True, ondelete='cascade', index=True)
    employee_id = fields.Many2one(
        'hr.employee', string='Employee',
        required=True, ondelete='restrict', index=True)
    # Denormalised so a payslip still reads correctly if the employee is
    # renamed or archived later -- the same reasoning as the line snapshots.
    employee_name = fields.Char(string='Employee Name')
    department_name = fields.Char(string='Department')
    job_title = fields.Char(string='Designation')

    date_from = fields.Date(related='run_id.date_from', store=True)
    date_to = fields.Date(related='run_id.date_to', store=True)
    pay_date = fields.Date(related='run_id.pay_date')
    state = fields.Selection(related='run_id.state', store=True)
    company_id = fields.Many2one(related='run_id.company_id', store=True)
    currency_id = fields.Many2one(related='company_id.currency_id', readonly=True)

    # --- the day block -------------------------------------------------
    working_days = fields.Float(string='Working Days')
    present_days = fields.Float(string='Present Days')
    half_days = fields.Float(string='Half Days')
    absent_days = fields.Float(string='Absent Days')
    leave_days_paid = fields.Float(string='Paid Leave Days')
    leave_days_unpaid = fields.Float(string='Unpaid Leave Days')
    comp_off_days = fields.Float(
        string='Comp Off Days',
        help='Days taken as compensatory off -- time already worked on a '
             'weekly off or public holiday, being taken back. Counted apart '
             'from paid leave because it spends no leave allowance, and it is '
             'never a loss of pay.')
    lop_days = fields.Float(
        string='LOP Days',
        help='Absent days, half of each half day, and unpaid leave.')
    paid_days = fields.Float(string='Paid Days')

    # --- money ---------------------------------------------------------
    line_ids = fields.One2many('hr.payslip.line', 'payslip_id', string='Lines')
    gross_earnings = fields.Monetary(currency_field='currency_id')
    total_deductions = fields.Monetary(currency_field='currency_id')
    net_pay = fields.Monetary(
        currency_field='currency_id',
        help='Gross earnings less deductions, before rounding.')
    net_pay_rounded = fields.Monetary(
        string='Net Pay', currency_field='currency_id',
        help='Rounded to the whole rupee, which is what the bank transfers.')
    net_in_words = fields.Char(string='Net Pay in Words')
    monthly_wage = fields.Monetary(
        string='Attendance Wage Basis', currency_field='currency_id',
        help='The employee Monthly Wage at generation time. Every attendance '
             'deduction in this module is derived from it, so it is recorded '
             'here to show what the payslip was calculated against.')
    wage_mismatch = fields.Boolean(
        compute='_compute_wage_mismatch', store=True,
        help='Gross earnings disagree with the Monthly Wage. Allowed while '
             'drafting, but the run cannot be confirmed until it is resolved.')

    # --- leave balance ---------------------------------------------------
    leave_opening = fields.Float(string='Leave Opening Balance')
    leave_taken = fields.Float(string='Leave Taken')
    leave_closing = fields.Float(string='Leave Closing Balance')

    _unique_employee_run = models.Constraint(
        'UNIQUE(run_id, employee_id)',
        'This employee already has a payslip in this payroll run.',
    )

    @api.depends('employee_name', 'date_from')
    def _compute_display_name(self):
        for slip in self:
            period = slip.date_from and slip.date_from.strftime('%B %Y') or ''
            slip.display_name = '%s - %s' % (slip.employee_name or '', period)

    @api.depends('gross_earnings', 'monthly_wage', 'currency_id')
    def _compute_wage_mismatch(self):
        for slip in self:
            rounding = slip.currency_id.rounding or 0.01
            difference = (slip.gross_earnings or 0.0) - (slip.monthly_wage or 0.0)
            slip.wage_mismatch = abs(difference) >= rounding

    # ------------------------------------------------------------------
    # Calculation
    # ------------------------------------------------------------------
    def _count_days(self):
        """Day counts for the period, as sets so nothing is counted twice.

        Returns (present, half, absent, paid_leave, unpaid_leave, comp_off,
        not_employed, join_assumed). `not_employed` is the working days in the
        period before the employee joined or after they left: neither worked
        nor absent. `join_assumed` is True when no joining date is on file and
        the record's creation date stood in for it.

        `day_off` rows are counted by none of them, and that is deliberate: a
        weekly off or public holiday is outside `working_days` already, so it
        is paid by never being in the divisor. Work done on one is repaid as a
        compensatory off, not as salary.

        Leave is split by the dates that actually fall INSIDE the period, so a
        leave crossing a month boundary contributes only its days in this
        month.
        """
        self.ensure_one()
        rows = self.env['hr.attendance.day.status'].search([
            ('employee_id', '=', self.employee_id.id),
            ('date', '>=', self.run_id.date_from),
            ('date', '<=', self.run_id.date_to),
        ])
        by_status = {}
        for row in rows:
            by_status.setdefault(row.status, set()).add(row.date)

        present_dates = by_status.get('present', set()) | by_status.get('late', set())
        absent_dates = set(by_status.get('absent', set()))
        leave_dates_by_request = {}
        for row in rows.filtered(lambda r: r.status == 'leave'):
            leave_dates_by_request.setdefault(row.leave_request_id, set()).add(row.date)

        # Past working days with NO row at all. Only the absence cron creates
        # Absent rows, and it only ever stamps today, after late_until_hour --
        # so with that hour at 0, a server that was down, or days before the
        # module was installed, a no-show had no row and was paid in full while
        # the employee report showed the same day as absent. Grade such days
        # from the source data instead. Days after yesterday are left alone:
        # they have not happened yet, and today may still get its check-in.
        DayStatus = self.env['hr.attendance.day.status']
        Config = self.env['hr.attendance.late.config']
        graded = {row.date for row in rows}
        cfg = Config.get_config_for_employee(self.employee_id.id)
        try:
            tz = pytz.timezone(cfg.get('timezone') or self.employee_id.tz or 'UTC')
        except Exception:
            tz = pytz.utc

        # Working days before the employee joined or after they left. A record
        # created on the 27th used to owe 23 absences for a month it was never
        # part of. Such days are neither paid nor absent, and are kept out of
        # every other count so nothing below can claim them.
        first_day, last_employed, join_assumed = self.employee_id._employment_window(tz)
        outside = set()
        day = self.run_id.date_from
        while day <= self.run_id.date_to:
            if ((first_day and day < first_day) or (last_employed and day > last_employed)) \
                    and Config.is_working_day(day, self.employee_id.id):
                outside.add(day)
            day += timedelta(days=1)
        present_dates -= outside
        absent_dates -= outside
        half_dates = by_status.get('half_day', set()) - outside

        last_day = min(self.run_id.date_to, fields.Date.context_today(self) - timedelta(days=1))
        if last_employed:
            last_day = min(last_day, last_employed)
        first_graded = max(self.run_id.date_from, first_day) if first_day else self.run_id.date_from
        if first_graded <= last_day:
            day = first_graded
            while day <= last_day:
                if day not in graded and Config.is_working_day(day, self.employee_id.id):
                    if DayStatus._has_attendance_on(self.employee_id, day, tz):
                        present_dates.add(day)
                    else:
                        leave = DayStatus._find_leave(self.employee_id, day)
                        if leave:
                            leave_dates_by_request.setdefault(leave, set()).add(day)
                        else:
                            absent_dates.add(day)
                day += timedelta(days=1)

        present = len(present_dates)
        half = len(half_dates)
        absent = len(absent_dates)

        # Split this month's leave dates into paid and unpaid, in proportion
        # to how the leave request itself was assessed. Proportional rather
        # than chronological because the request records totals, not a
        # day-by-day paid/unpaid breakdown.
        paid_leave = unpaid_leave = comp_off = 0.0
        for request, dates in leave_dates_by_request.items():
            days_here = float(len(dates))
            # A half-day leave marks its one date as Leave, but it is half a
            # day: counting the date would pay out (or dock) a whole one.
            if request and request.is_half_day:
                days_here = min(days_here, 0.5)
            total = request.number_of_days or days_here
            if not request or not total:
                unpaid_leave += days_here
                continue
            unpaid_share = (request.unpaid_days or 0.0) / total
            unpaid_leave += round(days_here * unpaid_share, 2)
            covered = round(days_here * (1.0 - unpaid_share), 2)
            # A comp off is reported on its own line rather than as paid leave.
            # Split OUT of the covered days, never added alongside them, so the
            # two can never sum to more than the days actually taken.
            if request.leave_type == 'comp_off':
                comp_off += covered
            else:
                paid_leave += covered

        return (present, float(half), float(absent),
                paid_leave, unpaid_leave, comp_off, float(len(outside)), join_assumed)

    def _earning_and_deduction_lines(self):
        """The employee's configured components, as line values.

        Falls back to a single Basic line at the Monthly Wage when nobody has
        configured any components, so a company that never set up a breakup
        still gets a usable payslip.
        """
        self.ensure_one()
        employee = self.employee_id
        earnings, deductions = [], []
        for line in employee.salary_line_ids.filtered(lambda l: l.component_active):
            values = {
                'component_id': line.component_id.id,
                'name': line.component_id.name,
                'code': line.component_id.code,
                'sequence': line.component_id.sequence,
                'amount': line.amount,
                'category': line.component_type,
            }
            (earnings if line.component_type == 'earning' else deductions).append(values)

        if not earnings:
            earnings.append({
                'name': _('Basic'),
                'code': 'BASIC',
                'sequence': 10,
                'amount': employee.monthly_wage or 0.0,
                'category': 'earning',
            })
        return earnings, deductions

    def _compute_figures(self):
        """Fill in the whole payslip: days, lines, totals, words."""
        for slip in self:
            employee = slip.employee_id
            # Read the period from the RUN, not from slip.date_from. The latter
            # is a stored related field, so on a payslip created moments ago it
            # may not have been computed yet -- reading it gave a bare False
            # and the date maths below blew up with an AttributeError.
            date_from = slip.run_id.date_from
            date_to = slip.run_id.date_to
            if not date_from or not date_to:
                raise UserError(_(
                    'The payroll run for %s has no pay period. Set its Month '
                    'and Year, save, and generate again.', employee.name))
            config = self.env['hr.attendance.late.config'].get_config_record_for_employee(
                employee.id)
            if not config:
                raise UserError(_(
                    'No attendance configuration applies to %s, so working '
                    'days cannot be established and the payslip would pay '
                    'zero. Set up Attendances > Configuration > Office Hours '
                    '& Working Days first.', employee.name))
            working_days = config.get_working_days_in_month(
                date_from.year, date_from.month, slip.company_id.id) or 0.0
            if working_days <= 0:
                raise UserError(_(
                    'The configuration for %s gives no working days in %s.',
                    employee.name, date_from.strftime('%B %Y')))

            (present, half, absent, paid_leave, unpaid_leave,
             comp_off, not_employed, join_assumed) = slip._count_days()
            # comp_off is absent from this sum on purpose: the day was worked
            # already, so taking it back is not a loss of pay.
            lop_days = absent + (half / 2.0) + unpaid_leave

            earnings, deductions = slip._earning_and_deduction_lines()
            gross = round(sum(v['amount'] for v in earnings), 2)

            # Loss of pay is priced off the payslip's own gross, so the
            # document is internally consistent. Where gross disagrees with
            # Monthly Wage that is surfaced by wage_mismatch, not papered over.
            daily_rate = round(gross / working_days, 2) if working_days else 0.0
            lop_amount = round(daily_rate * lop_days, 2)
            if lop_amount:
                deductions.append({
                    'name': _('Loss of Pay'),
                    'code': 'LOP',
                    'sequence': 900,
                    'amount': lop_amount,
                    'category': 'deduction',
                })
            # Someone who joined or left mid-month is paid for the days they
            # were here: the other days come off at the same daily rate, on
            # their own line rather than dressed up as absences.
            not_employed_amount = round(daily_rate * not_employed, 2)
            if not_employed_amount:
                # No joining date on file means the record's creation date
                # stood in for it. Say so on the line: for staff who were here
                # before the record, HR fixes it by setting the joining date.
                if join_assumed:
                    name = _('Not on payroll (%s days; joining date not set)', '%g' % not_employed)
                else:
                    name = _('Not on payroll (%s days)', '%g' % not_employed)
                deductions.append({
                    'name': name,
                    'code': 'NOTEMP',
                    'sequence': 910,
                    'amount': not_employed_amount,
                    'category': 'deduction',
                })

            total_deductions = round(sum(v['amount'] for v in deductions), 2)
            net = round(gross - total_deductions, 2)

            balance = self.env['hr.leave.config'].get_employee_leave_balance(
                employee.id, date_from.year) or {}

            slip.line_ids.unlink()
            slip.write({
                'employee_name': employee.name,
                'department_name': employee.department_id.name or '',
                'job_title': employee.job_title or employee.job_id.name or '',
                'working_days': working_days,
                'present_days': present,
                'half_days': half,
                'absent_days': absent,
                'leave_days_paid': paid_leave,
                'leave_days_unpaid': unpaid_leave,
                'comp_off_days': comp_off,
                'lop_days': lop_days,
                'paid_days': max(working_days - lop_days - not_employed, 0.0),
                'monthly_wage': employee.monthly_wage or 0.0,
                'gross_earnings': gross,
                'total_deductions': total_deductions,
                'net_pay': net,
                'net_pay_rounded': round(net),
                'net_in_words': amount_in_words(round(net)),
                'leave_opening': balance.get('total_allowed', 0.0),
                'leave_taken': balance.get('total_used', 0.0),
                'leave_closing': balance.get('remaining', 0.0),
                'line_ids': [(0, 0, v) for v in earnings + deductions],
            })

    def action_print_payslip(self):
        return self.env.ref(
            'hr_attendance_369.action_report_payslip').report_action(self)
