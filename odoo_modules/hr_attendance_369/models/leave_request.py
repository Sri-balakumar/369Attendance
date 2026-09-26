from odoo import models, fields, api, exceptions
from markupsafe import Markup, escape
import calendar
from datetime import datetime, timedelta
import logging

_logger = logging.getLogger(__name__)


class LeaveRequest(models.Model):
    _name = "hr.leave.request"
    _description = "Leave Request"
    _order = "from_date desc, create_date desc"
    _rec_name = "display_name"

    # --- Core Fields ---
    # Odoo 19 note: the `states={'draft': [...]}` field attribute was removed in
    # Odoo 17 and is silently ignored, so the `readonly=True` that accompanied it
    # made these fields permanently readonly at ORM level — including in draft.
    # Draft-only editing is now enforced in the form view via
    # readonly="state != 'draft'", the pattern already used elsewhere in
    # leave_request_views.xml.
    hr_employee_id = fields.Many2one(
        'hr.employee',
        string='Employee',
        required=True,
    )
    employee_user_id = fields.Many2one(
        'res.users',
        string='Related User',
        related='hr_employee_id.user_id',
        store=True,
        readonly=True,
    )
    employee_name = fields.Char(
        string='Employee Name',
        related='hr_employee_id.name',
        store=True,
    )

    # --- Leave Details ---
    leave_type = fields.Selection([
        ('sick', 'Sick Leave'),
        ('casual', 'Casual Leave'),
        ('annual', 'Annual Leave'),
        ('personal', 'Personal Leave'),
        ('emergency', 'Emergency Leave'),
        ('comp_off', 'Compensatory Off'),
        ('other', 'Other'),
    ], string='Leave Type', required=True, default='casual')

    from_date = fields.Date(
        string='From Date',
        required=True,
    )
    to_date = fields.Date(
        string='To Date',
        help='Leave empty for single day leave.',
    )
    is_half_day = fields.Boolean(
        string='Half Day',
        default=False,
        help='Check for half day leave (0.5 day).',
    )
    reason = fields.Text(
        string='Reason for Leave',
        required=True,
    )
    number_of_days = fields.Float(
        string='Number of Days',
        compute='_compute_number_of_days',
        store=True,
    )

    # --- Paid / Unpaid ---
    is_paid = fields.Boolean(
        string='Fully Paid',
        compute='_compute_paid_status',
        store=True,
        help='True if entire leave is within paid quota.',
    )
    paid_days = fields.Float(
        string='Paid Days',
        compute='_compute_paid_status',
        store=True,
        help='Number of days covered by paid leave quota.',
    )
    unpaid_days = fields.Float(
        string='Unpaid Days',
        compute='_compute_paid_status',
        store=True,
        help='Number of days exceeding paid leave quota.',
    )
    deduction_amount = fields.Float(
        string='Deduction Amount',
        compute='_compute_paid_status',
        store=True,
        help='Amount to deduct for unpaid days.',
    )

    # --- State Machine ---
    state = fields.Selection([
        ('draft', 'Draft'),
        ('pending', 'Pending Approval'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('cancelled', 'Cancelled'),
    ], string='Status', default='draft', required=True, tracking=True)

    # --- Approval Fields ---
    approved_by = fields.Many2one(
        'res.users',
        string='Approved/Rejected By',
        readonly=True,
    )
    approval_date = fields.Datetime(
        string='Approval Date',
        readonly=True,
    )
    submitted_on = fields.Datetime(
        string='Submitted On',
        readonly=True,
        help='When this request entered Pending Approval. The auto-approval '
             'wait is counted from here, not from creation -- a request left '
             'in draft for a week has not been waiting on anybody.',
    )
    auto_approved = fields.Boolean(
        string='Auto Approved',
        readonly=True,
        help='Approved by the system because nobody answered within the '
             'configured wait, not by a person.',
    )
    rejection_reason = fields.Text(
        string='Rejection Reason',
        readonly=True,
    )

    # Cancelling APPROVED leave goes through HR. A flag rather than a new state
    # on purpose: until HR agrees the leave IS still approved, and every count
    # that keys on state == 'approved' (balances, comp-off credits, day status,
    # payroll, reports) must keep treating it that way.
    cancel_requested = fields.Boolean(
        string='Cancellation Requested', readonly=True, copy=False,
        help='The employee asked HR to cancel this approved leave.')
    cancel_reason = fields.Text(string='Cancellation Reason', readonly=True, copy=False)
    cancel_requested_on = fields.Datetime(string='Cancellation Requested On', readonly=True,
                                          copy=False)
    cancel_reject_reason = fields.Text(
        string='Cancellation Declined Because', readonly=True, copy=False,
        help='Why HR kept the leave when the employee asked to cancel it.')

    # --- Compensatory off ---
    comp_off_balance = fields.Float(
        string='Comp Off Available',
        compute='_compute_comp_off_balance',
        help='Compensatory offs this employee holds, counting requests already '
             'submitted. Shown while filing so nobody asks for days they have '
             'not earned and discovers it only when the request is refused.',
    )

    comp_off_redemption_ids = fields.One2many(
        'hr.comp.off.redemption', 'leave_request_id',
        string='Comp Off Used', readonly=True,
        help='The compensatory offs this request draws on -- which day off '
             'was worked to earn each one. Written when the request is '
             'submitted and kept for good, whatever happens to the request.',
    )
    comp_off_earned_dates = fields.Char(
        string='Earned On', compute='_compute_comp_off_earned_dates',
        help='The weekly offs and public holidays that earned the '
             'compensatory off this request spends.',
    )

    @api.depends('hr_employee_id', 'leave_type', 'state')
    def _compute_comp_off_balance(self):
        Credit = self.env['hr.comp.off.credit'].sudo()
        for rec in self:
            if not rec.hr_employee_id or rec.leave_type != 'comp_off':
                rec.comp_off_balance = 0.0
                continue
            exclude = rec.id if isinstance(rec.id, int) else None
            rec.comp_off_balance = Credit.get_comp_off_balance(
                rec.hr_employee_id.id, exclude_request_id=exclude)['balance']

    @api.depends('comp_off_redemption_ids.days',
                 'comp_off_redemption_ids.credit_id.date_earned')
    def _compute_comp_off_earned_dates(self):
        for rec in self:
            lines = rec.sudo().comp_off_redemption_ids.sorted(
                lambda l: (l.credit_id.date_earned, l.id))
            rec.comp_off_earned_dates = self._format_earned(
                [(l.credit_id, l.days) for l in lines if l.days])

    @api.model
    def _format_earned(self, pairs):
        """[(credit, days)] -> '02 Oct 2026 (Gandhi Jayanti, half day) · ...'.

        One formatter for the stored text on a submitted request and for the
        preview of an unsaved one, so the two can never read differently.
        """
        parts = []
        for credit, days in pairs:
            sources = dict(credit._fields['source'].selection)
            label = credit.holiday_name or sources.get(credit.source, '') or ''
            when = (credit.date_earned.strftime('%d %b %Y')
                    if credit.date_earned else '')
            size = 'half day' if days < 1 else '%g day' % days
            parts.append('%s (%s, %s)' % (when, label, size) if label
                         else '%s (%s)' % (when, size))
        return ' · '.join(parts)

    # --- The HR alert email ------------------------------------------------
    #
    # The email's content lives here, not in the template, so the real email,
    # the backend previews and the app's preview are built by the same code and
    # cannot drift. The mail template is a thin wrapper that calls
    # submit_mail_subject() and submit_mail_html(). These work on unsaved
    # new() records too, which Odoo's mail renderer cannot -- that is what lets
    # an employee preview the email before the request exists.

    def submit_mail_rows(self):
        """[(label, value)] for the email's detail table, in display order."""
        self.ensure_one()
        emp = self.hr_employee_id
        rows = [('Employee', '%s (ID %s)' % (self.employee_name or emp.name or '',
                                            emp.id or ''))]
        if emp.department_id:
            rows.append(('Department', emp.department_id.name))
        types = dict(self._fields['leave_type']._description_selection(self.env))
        rows.append(('Type', types.get(self.leave_type, self.leave_type or '')
                     + (' (half day)' if self.is_half_day else '')))
        if self.from_date:
            dates = self.from_date.strftime('%d %b %Y')
            if (self.to_date and self.to_date != self.from_date
                    and not self.is_half_day):
                dates += ' to ' + self.to_date.strftime('%d %b %Y')
            rows.append(('Dates', dates))
            days = '%g' % (self.number_of_days or 0)
            if self.unpaid_days:
                days += ' (%g paid, %g unpaid)' % (self.paid_days, self.unpaid_days)
            else:
                days += ' (all paid)'
            rows.append(('Days', days))
        if self.leave_type == 'comp_off':
            earned = self.comp_off_earned_dates if self.id and isinstance(self.id, int) else ''
            if not earned and emp and self.number_of_days:
                # Unsaved: show what submit WOULD draw on.
                plan, _short = self.env['hr.comp.off.credit'].sudo()._plan_allocation(
                    emp.id, self.number_of_days)
                earned = self._format_earned(plan)
            if earned:
                rows.append(('Earned on', earned))
        rows.append(('Reason', (self.reason or '').strip()))
        return rows

    def submit_mail_subject(self):
        self.ensure_one()
        when = self.from_date.strftime('%d %b %Y') if self.from_date else ''
        name = self.employee_name or self.hr_employee_id.name or 'Unknown'
        return 'Leave request: %s%s' % (name, (' · ' + when) if when else '')

    def submit_mail_html(self, record_url=None):
        """The full email body, escaped, as Markup."""
        self.ensure_one()
        td_l = 'padding: 6px 12px 6px 0; color: #6B7280; vertical-align: top;'
        td_v = 'padding: 6px 0;'
        body = []
        for label, value in self.submit_mail_rows():
            if label == 'Employee':
                name, _sep, rest = value.partition(' (ID')
                cell = Markup('<b>%s</b> (ID%s') % (name, rest)
            else:
                cell = escape(value)
            body.append(Markup('<tr><td style="%s">%s</td><td style="%s">%s</td></tr>')
                        % (td_l, label, td_v, cell))
        button = Markup('')
        if record_url:
            button = Markup(
                '<p style="margin: 16px 0 0 0;"><a href="%s" style="background-color: #F59E0B; '
                'color: #1E293B; padding: 9px 18px; border-radius: 6px; text-decoration: none; '
                'font-weight: bold;">Review and approve</a></p>') % record_url
        return Markup(
            '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #111827;">'
            '<p style="margin: 0 0 12px 0;">A leave request is waiting for a decision.</p>'
            '<table style="border-collapse: collapse; min-width: 300px;">%s</table>%s'
            '<p style="margin: 14px 0 0 0; color: #6B7280; font-size: 12px;">'
            'Sent automatically by the Attendance Suite when a request is submitted. '
            'Recipients are configured under Leave &gt; Leave Policy.</p></div>'
        ) % (Markup('').join(body), button)

    notify_enabled = fields.Boolean(
        compute='_compute_mail_preview',
        help='Whether this company emails HR when a request is submitted.')
    mail_preview_html = fields.Html(
        string='Email to HR', compute='_compute_mail_preview',
        sanitize=False,
        help='The email HR receives when this request is submitted.')

    @api.depends('hr_employee_id', 'leave_type', 'from_date', 'to_date',
                 'is_half_day', 'reason', 'number_of_days')
    def _compute_mail_preview(self):
        Config = self.env['hr.leave.config'].sudo()
        for rec in self:
            company = rec.hr_employee_id.company_id.id or self.env.company.id
            cfg = Config.search([('company_id', '=', company)], limit=1)
            rec.notify_enabled = bool(cfg and cfg._get_notify_emails())
            rec.mail_preview_html = (
                rec.submit_mail_html(record_url='#') if rec.hr_employee_id else False)

    # --- Display ---
    display_name = fields.Char(
        compute='_compute_display_name',
        store=True,
    )

    # --- Computed Fields ---

    @api.depends('hr_employee_id', 'from_date', 'leave_type')
    def _compute_display_name(self):
        type_labels = dict(self._fields['leave_type'].selection)
        for rec in self:
            name = rec.hr_employee_id.name or 'New'
            date_str = str(rec.from_date) if rec.from_date else ''
            leave_label = type_labels.get(rec.leave_type, '')
            rec.display_name = f"{leave_label} - {name} - {date_str}"

    @api.depends('from_date', 'to_date', 'is_half_day', 'hr_employee_id')
    def _compute_number_of_days(self):
        """WORKING days in the span, not calendar days.

        A leave running across a Sunday or a public holiday must not charge
        those days. The employee owed no attendance on them, they are already
        paid (being outside the payroll divisor), and billing quota for them
        would charge twice for one day off. A Fri-Tue leave over Holi is three
        days, not five.

        Holidays are NOT an ORM dependency -- they live in hr.public.holiday,
        which a compute cannot depend on -- so declaring a holiday later can
        never invalidate a value stored here. hr.public.holiday.create/write/
        unlink force the recompute instead; see _recompute_affected_leaves.

        With no employee chosen yet the working-days config cannot be resolved,
        so the span falls back to calendar days. That is the old behaviour, and
        it keeps a half-filled form showing something sane; the real figure
        lands as soon as the employee is set.
        """
        cache = {}
        for rec in self:
            rec.number_of_days = self._count_working_days(
                rec.hr_employee_id.id, rec.from_date, rec.to_date,
                rec.is_half_day, _cache=cache)

    @api.model
    def _count_working_days(self, employee_id, from_date, to_date=False,
                            is_half_day=False, _cache=None):
        """The number_of_days a request over these dates would store.

        Shared by the compute above and the comp-off preview the app shows
        while filing, so the figure on the apply sheet is the figure the
        request is charged. Config is read with sudo: is_working_day browses
        hr.employee, which an ordinary employee cannot read in Odoo 19.
        """
        if not from_date:
            return 0
        Config = self.env['hr.attendance.late.config'].sudo()
        cache = _cache if _cache is not None else {}

        def _is_working(day):
            key = (employee_id, day)
            if key not in cache:
                cache[key] = bool(Config.is_working_day(day, employee_id))
            return cache[key]

        last = from_date
        if to_date and to_date >= from_date:
            last = to_date

        if not employee_id:
            return 0.5 if is_half_day else (last - from_date).days + 1

        if is_half_day:
            return 0.5 if _is_working(from_date) else 0.0

        total = 0
        day = from_date
        while day <= last:
            if _is_working(day):
                total += 1
            day += timedelta(days=1)
        return total

    @api.model
    def _paid_quota_left(self, employee_id, on_date, config, rec_id=None):
        """Paid-leave days still free for a request dated `on_date`.

        Both caps apply: the yearly allowance and the per-month accrual, each
        reduced by the PAID days of earlier pending and approved requests. The
        smaller wins. Shared by _compute_paid_status (which prices a request)
        and preview_paid_split (which tells the employee before they submit),
        so the warning on the apply sheet is the price the request gets.

        `rec_id` limits the count to requests created before that one, which
        is what keeps the compute from counting itself and recursing. A preview
        has no record yet, so everything already filed counts.
        """
        year, month = on_date.year, on_date.month
        month_start = '%s-%02d-01' % (year, month)
        month_end = '%s-01-01' % (year + 1) if month == 12 else '%s-%02d-01' % (year, month + 1)
        base = [
            ('hr_employee_id', '=', employee_id),
            ('state', 'not in', ('rejected', 'cancelled', 'draft')),
        ]
        if rec_id is not None:
            base += [('id', '!=', rec_id), ('id', '<', rec_id)]
        used_year = sum(self.search(base + [
            ('from_date', '>=', '%s-01-01' % year),
            ('from_date', '<=', '%s-12-31' % year),
        ]).mapped('paid_days'))
        used_month = sum(self.search(base + [
            ('from_date', '>=', month_start),
            ('from_date', '<', month_end),
        ]).mapped('paid_days'))
        remaining_year = max(0, config.paid_leave_days_per_year - used_year)
        remaining_month = max(0, config.paid_leave_days_per_month - used_month)
        return {
            'remaining_year': remaining_year,
            'remaining_month': remaining_month,
            'remaining': min(remaining_year, remaining_month),
            'per_month': config.paid_leave_days_per_month,
        }

    @api.model
    def preview_paid_split(self, from_date, to_date=False, is_half_day=False,
                           leave_type='casual'):
        """How the CALLER's own leave over these dates would be priced.

        Nothing is written. The employee comes from the session, never from a
        parameter, so one person cannot probe another's balance. Returns the
        same paid/unpaid split _compute_paid_status would store, which is what
        the apply sheet's red LOP warning is drawn from.
        """
        employee = self.env['hr.employee'].sudo().search(
            [('user_id', '=', self.env.uid)], limit=1)
        if not employee or not from_date:
            return {'has_quota': False, 'working_days': 0, 'paid_days': 0, 'unpaid_days': 0}
        start = fields.Date.to_date(from_date)
        end = fields.Date.to_date(to_date) if to_date and not is_half_day else False
        days = self._count_working_days(employee.id, start, end, bool(is_half_day))
        if leave_type == 'comp_off':
            # Comp off draws on earned credits, never this quota; it has its
            # own preview.
            return {'has_quota': False, 'comp_off': True, 'working_days': days,
                    'paid_days': days, 'unpaid_days': 0}
        config = self.env['hr.leave.config'].sudo().search(
            [('company_id', '=', employee.company_id.id)], limit=1)
        deduction = not config or config.unpaid_leave_deduction_enabled
        if not config or not config.paid_leave_enabled:
            return {'has_quota': False, 'working_days': days, 'paid_days': 0,
                    'unpaid_days': days, 'is_quota_exhausted': True,
                    'deduction_enabled': deduction}
        quota = self.sudo()._paid_quota_left(employee.id, start, config)
        paid = min(days, quota['remaining'])
        unpaid = days - paid
        limited_by = None
        if unpaid > 0 or quota['remaining'] <= 0:
            limited_by = 'month' if quota['remaining_month'] < quota['remaining_year'] else 'year'
        return {
            'has_quota': True,
            'working_days': days,
            'paid_days': paid,
            'unpaid_days': unpaid,
            'remaining_year': quota['remaining_year'],
            'remaining_month': quota['remaining_month'],
            'per_month': quota['per_month'],
            'limited_by': limited_by,
            'is_quota_exhausted': quota['remaining'] <= 0,
            'deduction_enabled': deduction,
        }

    @api.depends('hr_employee_id', 'leave_type', 'number_of_days', 'state', 'from_date',
                 'comp_off_redemption_ids.days')
    def _compute_paid_status(self):
        Config = self.env['hr.leave.config']
        for rec in self:
            # Default a leave to UNPAID. It only becomes paid when an *enabled*
            # paid-leave policy with remaining quota grants it (handled below).
            # This makes both "no policy configured" and "paid leave off" unpaid,
            # instead of silently treating leaves as paid.
            rec.is_paid = False
            rec.paid_days = 0.0
            rec.unpaid_days = 0.0
            rec.deduction_amount = 0.0

            if not rec.hr_employee_id or not rec.from_date or rec.state in ('rejected', 'cancelled'):
                continue

            # Real, active leave → fully-unpaid baseline.
            rec.unpaid_days = rec.number_of_days

            company_id = rec.hr_employee_id.company_id.id
            config = Config.search([('company_id', '=', company_id)], limit=1)

            # Daily-rate denominator = working days in the leave's month
            # so a full month of unpaid leave wipes the
            # wage exactly and matches the employee report. Falls back to calendar
            # days only when no attendance config / no working days are defined.
            late_config = self.env['hr.attendance.late.config'].get_config_record_for_employee(
                rec.hr_employee_id.id
            )
            daily_basis = late_config.get_working_days_in_month(
                rec.from_date.year, rec.from_date.month, company_id
            ) if late_config else 0
            if daily_basis <= 0:
                daily_basis = calendar.monthrange(
                    rec.from_date.year, rec.from_date.month
                )[1]

            def _unpaid_deduction(unpaid_days, _rec=rec, _config=config, _basis=daily_basis):
                # Salary-based unpaid deduction: wage ÷ working days × unpaid days.
                # Deduct by default — only a SAVED policy with the box UNticked
                # turns it off. (No policy at all still deducts, since unpaid
                # leave means the day isn't paid.)
                if _config and not _config.unpaid_leave_deduction_enabled:
                    return 0.0
                emp_wage = _rec.hr_employee_id.monthly_wage or 0.0
                if emp_wage > 0 and _basis > 0:
                    # Round the daily rate to currency precision first, then per
                    # record, so it matches the report (185.19 × days).
                    daily_rate = round(emp_wage / _basis, 2)
                    return round(unpaid_days * daily_rate, 2)
                return 0.0

            if rec.leave_type == 'comp_off':
                # Drawn from compensatory offs the employee has already earned,
                # never from the paid-leave quota: this is a day they worked
                # being handed back, not an allowance being spent. So it is
                # unaffected by paid_leave_enabled, and taking one leaves the
                # yearly quota untouched. Anything past the balance is ordinary
                # unpaid leave, priced like any other.
                #
                # before_id keeps the same rule the quota below uses: only
                # requests decided EARLIER count against the balance, which is
                # also what stops this compute recursing into itself.
                #
                # ignore_policy: switching comp off off stops new requests at
                # action_submit; it must not re-price leave already taken.
                # Once submitted, the redemption lines ARE the answer: they
                # say exactly which credits pay for this leave. Before that
                # (a draft on the backend form) the balance stands in.
                lines = rec.sudo().comp_off_redemption_ids
                if rec.state in ('pending', 'approved') and lines:
                    covered = min(rec.number_of_days,
                                  sum(lines.mapped('days')))
                else:
                    exclude = rec.id if isinstance(rec.id, int) else None
                    balance = self.env['hr.comp.off.credit'].sudo().get_comp_off_balance(
                        rec.hr_employee_id.id, exclude_request_id=exclude,
                        ignore_policy=True)['balance']
                    covered = min(rec.number_of_days, balance)
                rec.paid_days = covered
                rec.unpaid_days = rec.number_of_days - covered
                rec.is_paid = rec.unpaid_days == 0
                rec.deduction_amount = _unpaid_deduction(rec.unpaid_days)
                continue

            if not config or not config.paid_leave_enabled:
                # No policy at all, or Paid Leave switched OFF → fully unpaid
                # (deducted at the salary-based rate when deduction is enabled).
                rec.deduction_amount = _unpaid_deduction(rec.unpaid_days)
                continue

            quota = self._paid_quota_left(
                rec.hr_employee_id.id, rec.from_date, config, rec_id=rec.id)
            remaining = quota['remaining']

            if rec.number_of_days <= remaining:
                # Fully paid
                rec.is_paid = True
                rec.paid_days = rec.number_of_days
                rec.unpaid_days = 0.0
                rec.deduction_amount = 0.0
            else:
                # Partially or fully unpaid — split the days; the over-quota part
                # is unpaid and deducted at the salary-based rate.
                rec.paid_days = remaining
                rec.unpaid_days = rec.number_of_days - remaining
                rec.is_paid = rec.unpaid_days == 0
                rec.deduction_amount = _unpaid_deduction(rec.unpaid_days)

    # --- Constraints ---

    @api.constrains('from_date', 'to_date')
    def _check_dates(self):
        for rec in self:
            if rec.to_date and rec.from_date and rec.to_date < rec.from_date:
                raise exceptions.ValidationError(
                    'To Date cannot be before From Date.'
                )

    @api.constrains('hr_employee_id', 'from_date', 'to_date', 'state')
    def _check_duplicate_request(self):
        for rec in self:
            if rec.state in ('rejected', 'cancelled'):
                continue
            domain = [
                ('hr_employee_id', '=', rec.hr_employee_id.id),
                ('state', 'not in', ('rejected', 'cancelled')),
                ('id', '!=', rec.id),
            ]
            to_date = rec.to_date or rec.from_date
            domain += [
                ('from_date', '<=', to_date),
                '|',
                ('to_date', '>=', rec.from_date),
                '&',
                ('to_date', '=', False),
                ('from_date', '>=', rec.from_date),
            ]
            existing = self.search(domain, limit=1)
            if existing:
                raise exceptions.ValidationError(
                    f'A leave request already exists for overlapping dates. '
                    f'Existing request: {existing.display_name}'
                )

    # --- Create ---

    @api.model_create_multi
    def create(self, vals_list):
        """Stamp `submitted_on` for anything created straight into Pending.

        The mobile API creates in draft and calls action_submit (which stamps
        it), but the backend form and any import can save a record as pending
        in one step. Without this those requests would fall back to create_date
        in the sweep -- almost always the same instant, but not by design.
        """
        now = fields.Datetime.now()
        for vals in vals_list:
            if vals.get('state') == 'pending' and not vals.get('submitted_on'):
                vals['submitted_on'] = now
        records = super().create(vals_list)
        # A comp-off request saved straight into Pending (backend form,
        # import) never passes through action_submit, so it reserves here --
        # and it is a submission, so HR is told about it here too.
        pending = records.filtered(lambda r: r.state == 'pending')
        pending.filtered(
            lambda r: r.leave_type == 'comp_off')._reserve_comp_off()
        pending._notify_submitted()
        return records

    def unlink(self):
        credits = self.sudo().mapped('comp_off_redemption_ids.credit_id')
        res = super().unlink()
        credits = credits.exists()
        if credits:
            credits._compute_usage()
            credits._refresh_state()
        return res

    # --- Compensatory off: reserve, consume, release ---

    def _reserve_comp_off(self):
        """Pin this request to specific credits, oldest expiry first.

        Called on submit. Writes one hr.comp.off.redemption per credit it
        draws on. A request resubmitted after a reject or cancel reuses its
        old lines rather than duplicating them, and any old line the new plan
        does not need is zeroed -- kept, so the history still shows it.

        Raises when the balance cannot cover the request: a comp-off request
        is refused rather than quietly turned into unpaid leave.
        """
        Credit = self.env['hr.comp.off.credit'].sudo()
        Line = self.env['hr.comp.off.redemption'].sudo()
        for rec in self:
            if rec.leave_type != 'comp_off' or not rec.hr_employee_id:
                continue
            emp = rec.hr_employee_id.sudo()
            policy = self.env['hr.leave.config'].sudo().get_config_for_company(
                emp.company_id.id)
            if not policy.get('comp_off_enabled'):
                raise exceptions.UserError(
                    'Compensatory off is switched off in the leave policy.')
            plan, short = Credit._plan_allocation(
                emp.id, rec.number_of_days, exclude_request_id=rec.id)
            if short > 0.001:
                available = rec.number_of_days - short
                raise exceptions.UserError(
                    'This request is for %g compensatory off day(s), but '
                    '%s has %g available.'
                    % (rec.number_of_days, emp.name or 'this employee',
                       available))
            existing = {l.credit_id.id: l
                        for l in rec.sudo().comp_off_redemption_ids}
            wanted = {credit.id: take for credit, take in plan}
            for credit_id, line in existing.items():
                if credit_id not in wanted and line.days:
                    line.write({'days': 0.0})
            for credit, take in plan:
                line = existing.get(credit.id)
                if line:
                    if line.days != take:
                        line.write({'days': take})
                else:
                    Line.create({
                        'credit_id': credit.id,
                        'leave_request_id': rec.id,
                        'days': take,
                    })
        self._refresh_comp_off_credits()

    def _refresh_comp_off_credits(self):
        """Re-derive Available / Consumed on every credit these requests
        touch. The lines themselves are never deleted: whether a line counts
        is decided by the request's state, which has just changed."""
        credits = self.sudo().mapped('comp_off_redemption_ids.credit_id')
        if credits:
            self.env.flush_all()
            credits._compute_usage()
            credits._refresh_state()

    def _ensure_comp_off_reserved(self, raise_on_short=True):
        """A pending comp-off request with no lines (made before this
        version, or saved in a way that skipped submit) reserves now."""
        self.ensure_one()
        if self.leave_type != 'comp_off':
            return True
        if any(l.days for l in self.sudo().comp_off_redemption_ids):
            return True
        try:
            with self.env.cr.savepoint():
                self._reserve_comp_off()
        except exceptions.UserError:
            if raise_on_short:
                raise
            return False
        return True

    # --- Day-status link ---

    def _relink_day_status(self):
        """Point the day rows this leave covers at it -- or away from it.

        A day row picks up its covering leave AT THE MOMENT IT IS CREATED, in
        `hr.attendance.day.status._find_leave`: either when the absent cron
        stamps the day, or when a check-in upserts it. A leave approved LATER
        than the day it covers therefore never reaches the row, and the day
        stays Absent.

        That used to be a corner case. Auto-approval makes it ordinary -- a
        request submitted on Friday and auto-approved on Monday covers days
        that were stamped over the weekend -- so the link has to be repaired
        from this side too.

        Only days up to today are touched: a future day has no row yet, and the
        cron (or the employee checking in) will find this leave by itself when
        the day arrives.
        """
        DayStatus = self.env['hr.attendance.day.status'].sudo()
        Config = self.env['hr.attendance.late.config']
        today = fields.Date.today()

        for rec in self:
            if not rec.hr_employee_id or not rec.from_date:
                continue
            approved = rec.state == 'approved'
            day = rec.from_date
            last = rec.to_date or rec.from_date
            while day <= last:
                if day > today:
                    break
                try:
                    # A savepoint per day: a day-status problem must never roll
                    # back the approval itself, which is the decision of record.
                    with self.env.cr.savepoint():
                        rec._relink_one_day(DayStatus, Config, day, approved)
                except Exception:
                    _logger.exception(
                        '[Leave] day-status relink failed for %s on %s',
                        rec.display_name, day)
                day += timedelta(days=1)

    def _relink_one_day(self, DayStatus, Config, day, approved):
        """Attach (or detach) this leave on one day's row."""
        self.ensure_one()
        row = DayStatus.search([
            ('employee_id', '=', self.hr_employee_id.id),
            ('date', '=', day),
        ], limit=1)

        if not approved:
            # Rejected, cancelled or reset: a day pointing at this request must
            # stop doing so, or it would keep reading Leave on the strength of a
            # decision that was undone.
            if row and row.leave_request_id.id == self.id:
                row.write({'leave_request_id': False})
            return

        if row:
            if row.leave_request_id.id != self.id:
                row.write({'leave_request_id': self.id})
            return

        # No row at all: the cron has not reached this day (or never ran).
        # Only working days get one -- weekends and public holidays are not
        # days anybody owes attendance for, and inventing rows for them would
        # put phantom Leave days in the monthly report.
        if Config.is_working_day(day, self.hr_employee_id.id):
            DayStatus.create({
                'employee_id': self.hr_employee_id.id,
                'date': day,
                'leave_request_id': self.id,
                'stamped_by_cron': False,
            })

    # --- Action Methods ---

    def action_submit(self):
        """draft → pending"""
        for rec in self:
            if rec.state != 'draft':
                raise exceptions.UserError('Only draft requests can be submitted.')
            # Every day in the span is already a day off, so the request buys
            # nothing: no quota is spent, no deduction is made, and approving it
            # would only create a leave that means nothing. Say so plainly
            # rather than letting a zero-day request through.
            if not rec.number_of_days:
                raise exceptions.UserError(
                    'Those dates are already non-working days (a weekly off or '
                    'a public holiday), so there is no leave to request.')
            # Checked here rather than left to the paid/unpaid split, which
            # would quietly turn the excess into unpaid leave and dock the pay
            # of somebody who believed they were spending a day they had
            # earned. Better to refuse, and to say what the balance actually is.
            #
            # For comp off this also PINS the request to specific credits
            # (hr.comp.off.redemption), oldest expiry first, so the employee
            # never has to say which holiday they are spending.
            if rec.leave_type == 'comp_off':
                rec._reserve_comp_off()
            # submitted_on starts the auto-approval clock.
            rec.write({'state': 'pending', 'submitted_on': fields.Datetime.now()})
        self._refresh_comp_off_credits()
        self._notify_submitted()
        _logger.info('[Leave] Request submitted: %s', self.mapped('display_name'))

    def _notify_submitted(self):
        """Email the configured HR addresses that a request was submitted.

        Called AFTER the state write and never allowed to fail it: a broken
        template or a dead mail server costs an email, not a leave request --
        the same contract _sync_day_status makes for attendance.

        force_send tries to hand the mail to the SMTP server right away; when
        that fails (both known databases currently carry only a neutralized
        'disable emails' server) Odoo keeps the mail.mail queued and its cron
        retries, so nothing is lost, only delayed until a real server exists.
        """
        template = self.env.ref(
            'hr_attendance_369.mail_template_leave_submitted',
            raise_if_not_found=False)
        if not template:
            return
        Config = self.env['hr.leave.config'].sudo()
        base_url = self.env['ir.config_parameter'].sudo().get_param(
            'web.base.url') or ''
        for rec in self:
            try:
                config = Config.search([
                    ('company_id', '=', rec.hr_employee_id.company_id.id),
                ], limit=1)
                emails = config._get_notify_emails() if config else []
                if not emails:
                    _logger.debug('[Leave] no submission recipients for %s',
                                  rec.display_name)
                    continue
                record_url = (
                    '%s/odoo/action-hr_attendance_369.action_leave_request/%s'
                    % (base_url, rec.id))
                template.sudo().with_context(record_url=record_url).send_mail(
                    rec.id, force_send=True,
                    email_values={'email_to': ', '.join(emails)})
                _logger.info('[Leave] submission mail queued for %s to %s',
                             rec.display_name, ', '.join(emails))
            except Exception:
                _logger.exception(
                    '[Leave] submission mail failed for %s', rec.display_name)

    def action_auto_approve(self):
        """pending → approved, by the system, because the wait ran out.

        Separate from action_approve for two reasons: it credits OdooBot rather
        than whoever the cron happens to run as, and it SKIPS a request that is
        no longer pending instead of raising. By the time the sweep reaches a
        record a manager may have just answered it -- that is a race, not an
        error, and it must not abort the rest of the sweep.
        """
        system = self.env.ref('base.user_root', raise_if_not_found=False)
        for rec in self:
            if rec.state != 'pending':
                continue
            if not rec._ensure_comp_off_reserved(raise_on_short=False):
                _logger.warning(
                    '[Leave] Not auto-approving %s: its compensatory off is '
                    'no longer covered.', rec.display_name)
                continue
            rec.write({
                'state': 'approved',
                'approved_by': system.id if system else False,
                'approval_date': fields.Datetime.now(),
                'auto_approved': True,
                'rejection_reason': False,
            })
            _logger.info('[Leave] Auto-approved (no answer in time): %s',
                         rec.display_name)
        self._refresh_comp_off_credits()
        self._relink_day_status()
        return True

    def action_approve(self):
        """pending → approved"""
        for rec in self:
            if rec.state != 'pending':
                raise exceptions.UserError('Only pending requests can be approved.')
            rec._ensure_comp_off_reserved()
            rec.write({
                'state': 'approved',
                'approved_by': self.env.user.id,
                'approval_date': fields.Datetime.now(),
                'auto_approved': False,
                'rejection_reason': False,
            })
        self._refresh_comp_off_credits()
        self._relink_day_status()
        _logger.info('[Leave] Request approved: %s by %s', self.mapped('display_name'), self.env.user.name)

    def action_reject(self):
        """pending → rejected (rejection reason via wizard or direct)"""
        for rec in self:
            if rec.state != 'pending':
                raise exceptions.UserError('Only pending requests can be rejected.')
            rec.write({
                'state': 'rejected',
                'approved_by': self.env.user.id,
                'approval_date': fields.Datetime.now(),
            })
        self._refresh_comp_off_credits()
        self._relink_day_status()
        _logger.info('[Leave] Request rejected: %s by %s', self.mapped('display_name'), self.env.user.name)

    def _payroll_locked_run(self):
        """A confirmed or paid payroll run covering any day of this leave.

        Once pay for those days is locked, cancelling the leave would change
        figures that were already confirmed or paid out, so it is refused and
        HR must reopen the run first.
        """
        self.ensure_one()
        end = self.to_date or self.from_date
        return self.env['hr.payslip.run'].sudo().search([
            ('company_id', '=', self.hr_employee_id.company_id.id),
            ('state', 'in', ('confirmed', 'paid')),
            ('date_from', '<=', end),
            ('date_to', '>=', self.from_date),
        ], limit=1)

    def _check_payroll_not_locked(self):
        for rec in self.filtered(lambda r: r.state == 'approved'):
            run = rec._payroll_locked_run()
            if run:
                raise exceptions.UserError(
                    'Payroll for %s is already %s, so this leave can no longer be '
                    'cancelled. Reopen the payroll run first.'
                    % (run.name or run.date_from.strftime('%B %Y'),
                       dict(run._fields['state'].selection).get(run.state, run.state).lower()))

    def action_request_cancel(self, reason=''):
        """Employee asks HR to cancel an APPROVED leave. Nothing changes yet."""
        reason = (reason or '').strip()
        if not reason:
            raise exceptions.UserError('Give a reason for cancelling this leave.')
        for rec in self:
            if rec.state != 'approved':
                raise exceptions.UserError('Only approved leave needs a cancellation request.')
            if rec.cancel_requested:
                raise exceptions.UserError('A cancellation request is already waiting for HR.')
        self._check_payroll_not_locked()
        self.write({
            'cancel_requested': True,
            'cancel_reason': reason,
            'cancel_requested_on': fields.Datetime.now(),
            'cancel_reject_reason': False,
        })

    def action_approve_cancel(self):
        """HR agrees: the approved leave is cancelled and its days come back."""
        for rec in self:
            if rec.state != 'approved' or not rec.cancel_requested:
                raise exceptions.UserError('There is no cancellation request to approve.')
        self.action_cancel()
        self.write({'cancel_requested': False})

    def action_reject_cancel(self, reason=''):
        """HR keeps the leave. The employee sees why."""
        reason = (reason or '').strip()
        if not reason:
            raise exceptions.UserError('Tell the employee why the leave stays.')
        for rec in self:
            if not rec.cancel_requested:
                raise exceptions.UserError('There is no cancellation request to decline.')
        self.write({'cancel_requested': False, 'cancel_reject_reason': reason})

    def action_cancel(self):
        """Cancel from draft/pending/approved → cancelled"""
        for rec in self:
            if rec.state not in ('draft', 'pending', 'approved'):
                raise exceptions.UserError('Cannot cancel this request.')
        # Approved leave is undone by HR only; the employee files a request.
        # Routes that already checked the caller run this with sudo.
        if (not self.env.su and any(r.state == 'approved' for r in self)
                and not self.env.user.has_group('hr_attendance_369.group_leave_manager')
                and not self.env.user.has_group('base.group_system')):
            raise exceptions.UserError(
                'This leave is already approved. Request cancellation and HR will decide.')
        self._check_payroll_not_locked()
        for rec in self:
            rec.state = 'cancelled'
        self._refresh_comp_off_credits()
        self._relink_day_status()
        _logger.info('[Leave] Request cancelled: %s', self.mapped('display_name'))

    def action_reset_to_draft(self):
        """rejected/cancelled → draft"""
        for rec in self:
            if rec.state not in ('rejected', 'cancelled'):
                raise exceptions.UserError('Only rejected or cancelled requests can be reset.')
            rec.write({
                'state': 'draft',
                'approved_by': False,
                'approval_date': False,
                'rejection_reason': False,
                # Back to draft means back to square one: the auto-approval
                # clock restarts when it is submitted again.
                'auto_approved': False,
                'submitted_on': False,
            })
        self._refresh_comp_off_credits()
        self._relink_day_status()

    # --- API Helper Methods (for mobile app) ---

    @api.model
    def get_my_leave_requests(self, user_id=None, state_filter=None):
        """Get leave requests for an employee."""
        domain = []
        if user_id:
            # Search by employee_user_id OR hr_employee_id
            employee = self.env['hr.employee'].sudo().search([('user_id', '=', user_id)], limit=1)
            if employee:
                domain.append(('hr_employee_id', '=', employee.id))
            else:
                domain.append(('employee_user_id', '=', user_id))
        if state_filter:
            domain.append(('state', '=', state_filter))

        records = self.search(domain, order='from_date desc', limit=50)
        type_labels = dict(self._fields['leave_type'].selection)
        return [{
            'id': r.id,
            'employee_name': r.employee_name or '',
            'leave_type': r.leave_type,
            'leave_type_label': type_labels.get(r.leave_type, ''),
            'from_date': str(r.from_date) if r.from_date else '',
            'to_date': str(r.to_date) if r.to_date else '',
            'number_of_days': r.number_of_days,
            'reason': r.reason or '',
            'state': r.state,
            'approved_by': r.approved_by.name if r.approved_by else '',
            'auto_approved': r.auto_approved,
            'approval_date': str(r.approval_date) if r.approval_date else '',
            'rejection_reason': r.rejection_reason or '',
            'is_half_day': bool(r.is_half_day),
            'cancel_requested': bool(r.cancel_requested),
            'cancel_reason': r.cancel_reason or '',
            'cancel_reject_reason': r.cancel_reject_reason or '',
            'comp_off_earned_dates': r.comp_off_earned_dates or '',
            'comp_off_credits': [{
                'credit_id': l.credit_id.id,
                'date_earned': str(l.credit_id.date_earned or ''),
                'source': l.credit_id.source or '',
                'holiday_name': l.credit_id.holiday_name or '',
                'days': l.days,
            } for l in r.sudo().comp_off_redemption_ids if l.days],
        } for r in records]

    @api.model
    def get_pending_requests_for_approval(self):
        """Get all pending leave requests for manager."""
        records = self.search([('state', '=', 'pending')], order='from_date asc')
        type_labels = dict(self._fields['leave_type'].selection)
        return [{
            'id': r.id,
            'employee_name': r.employee_name or '',
            'leave_type': r.leave_type,
            'leave_type_label': type_labels.get(r.leave_type, ''),
            'from_date': str(r.from_date) if r.from_date else '',
            'to_date': str(r.to_date) if r.to_date else '',
            'number_of_days': r.number_of_days,
            'reason': r.reason or '',
            'state': r.state,
            'created_on': str(r.create_date) if r.create_date else '',
        } for r in records]

    @api.model
    def get_leave_report(self, employee_id=None, department_id=None,
                         date_from=None, date_to=None, state_filter=None):
        """Get leave report data for reporting."""
        domain = [('state', '=', 'approved')]
        if state_filter:
            domain = [('state', '=', state_filter)]
        if employee_id:
            domain.append(('hr_employee_id', '=', employee_id))
        if department_id:
            domain.append(('hr_employee_id.department_id', '=', department_id))
        if date_from:
            domain.append(('from_date', '>=', date_from))
        if date_to:
            domain.append(('from_date', '<=', date_to))

        records = self.search(domain, order='from_date desc')
        type_labels = dict(self._fields['leave_type'].selection)
        return [{
            'id': r.id,
            'employee_name': r.employee_name or '',
            'department': r.hr_employee_id.department_id.name if r.hr_employee_id and r.hr_employee_id.department_id else '',
            'leave_type': r.leave_type,
            'leave_type_label': type_labels.get(r.leave_type, ''),
            'from_date': str(r.from_date) if r.from_date else '',
            'to_date': str(r.to_date) if r.to_date else '',
            'number_of_days': r.number_of_days,
            'reason': r.reason or '',
            'state': r.state,
            'approved_by': r.approved_by.name if r.approved_by else '',
            'auto_approved': r.auto_approved,
        } for r in records]
