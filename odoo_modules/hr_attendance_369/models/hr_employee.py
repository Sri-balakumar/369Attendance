from odoo import api, exceptions, fields, models, _
from odoo.tools import float_is_zero


class HrEmployee(models.Model):
    """Employee extensions for this suite.

    Merged from the former `employee_device` (device registration fields) and
    `hr_attendance_late` (kiosk check-in context) addons — both inherited
    hr.employee separately, which is unnecessary now they ship together.
    """
    _inherit = 'hr.employee'

    # ------------------------------------------------------------------
    # Payroll basis
    # ------------------------------------------------------------------
    monthly_wage = fields.Float(
        string='Monthly Wage',
        groups='hr.group_hr_user',
        help='Gross monthly salary. Every deduction in this module is derived '
             'from it: absent days, half days and unpaid leave all charge '
             'monthly wage divided by the working days in that month. Leave it '
             'at 0 and those deductions simply come out as 0.',
    )

    def _daily_wage(self, on_date):
        """One day of wage for this employee, on the month `on_date` falls in.

        The divisor is get_working_days_in_month(), which counts only the
        configured working weekdays and excludes public holidays. That is
        exactly what makes Sundays and holidays PAID: they are never in the
        divisor, so a full month of attendance pays the whole wage and neither
        day can ever be deducted.

        Returns 0.0 when no wage is set or the month has no working days, so an
        employee without a wage on file simply deducts nothing.

        Replaces `contract_wage`, which needs the hr_contract module and was
        read through a try/except that silently produced 0 everywhere.
        """
        self.ensure_one()
        if not on_date or not self.monthly_wage:
            return 0.0
        config = self.env['hr.attendance.late.config'].get_config_record_for_employee(self.id)
        if not config:
            return 0.0
        working_days = config.get_working_days_in_month(
            on_date.year, on_date.month, self.company_id.id) or 0
        if working_days <= 0:
            return 0.0
        return round(self.monthly_wage / working_days, 2)


    # ------------------------------------------------------------------
    # Leave and compensatory-off balances
    # ------------------------------------------------------------------
    # Computed, not stored, and batched. These render in a list covering the
    # whole company, so a per-record balance call would be an N+1 of exactly
    # the kind public_holiday._compute_holiday_info documents avoiding: one
    # read_group per figure, then fill the recordset from the result.
    #
    # The year comes from the context (`balance_year`), which the Leave
    # Balances action sets, so the same fields can later serve a year selector
    # without being reshaped.
    paid_leave_allowed = fields.Float(
        string='Paid Leave Allowed', compute='_compute_leave_balances',
        help='The yearly paid-leave allowance from the leave policy.')
    paid_leave_taken = fields.Float(
        string='Leave Taken', compute='_compute_leave_balances',
        help='Approved paid-leave days this year. Compensatory off is not '
             'counted here -- it spends no allowance.')
    paid_leave_remaining = fields.Float(
        string='Paid Leave Left', compute='_compute_leave_balances',
        help='Allowance less what has been taken. Carry forward from last '
             'year is NOT added, because nothing in this module applies it -- '
             'this column shows what payroll actually allows.')
    comp_off_earned = fields.Float(
        string='Comp Off Earned', compute='_compute_leave_balances',
        help='Compensatory offs earned by working a weekly off or a public '
             'holiday. Cancelled credits and the unspent part of expired ones '
             'are not counted.')
    comp_off_used = fields.Float(
        string='Comp Off Used', compute='_compute_leave_balances')
    comp_off_balance = fields.Float(
        string='Comp Off Left', compute='_compute_leave_balances')

    @api.depends_context('balance_year')
    def _compute_leave_balances(self):
        if not self:
            return

        year = self.env.context.get('balance_year') or fields.Date.today().year
        year_start = '%s-01-01' % year
        year_end = '%s-12-31' % year

        Leave = self.env['hr.leave.request'].sudo()
        Credit = self.env['hr.comp.off.credit'].sudo()
        Config = self.env['hr.leave.config']

        # Paid leave taken this year, comp off deliberately excluded -- the
        # same rule hr.leave.config.get_employee_leave_balance follows, so the
        # list and the single-employee API cannot disagree. paid_days, not
        # number_of_days: the unpaid (LOP) part of a request never used quota.
        taken = {
            employee.id: total for employee, total in Leave._read_group(
                [('hr_employee_id', 'in', self.ids),
                 ('state', '=', 'approved'),
                 ('leave_type', '!=', 'comp_off'),
                 ('from_date', '>=', year_start),
                 ('from_date', '<=', year_end)],
                groupby=['hr_employee_id'],
                aggregates=['paid_days:sum'])
        }

        # Comp off earned: every credit still available, whatever year it was
        # earned in -- that IS the carry forward -- plus the part of an expired
        # credit that was spent before it lapsed, exactly as
        # hr.comp.off.credit.get_comp_off_balance counts it.
        earned = {
            employee.id: (days or 0.0) - (lapsed or 0.0)
            for employee, days, lapsed in Credit._read_group(
                [('employee_id', 'in', self.ids),
                 ('state', 'in', Credit._EARNED_STATES)],
                groupby=['employee_id'],
                aggregates=['days:sum', 'days_lapsed:sum'])
        }

        # Comp off claimed. paid_days, not number_of_days: a request that ran
        # past the balance is only partly covered by credits, and the rest is
        # unpaid leave that no credit paid for.
        claimed = {
            employee.id: total for employee, total in Leave._read_group(
                [('hr_employee_id', 'in', self.ids),
                 ('leave_type', '=', 'comp_off'),
                 ('state', 'in', ('pending', 'approved'))],
                groupby=['hr_employee_id'],
                aggregates=['paid_days:sum'])
        }

        policies = {}
        for employee in self:
            company_id = employee.company_id.id or self.env.company.id
            if company_id not in policies:
                policies[company_id] = Config.get_config_for_company(company_id)
            policy = policies[company_id]

            # Only a SAVED policy grants paid leave. get_config_for_company
            # falls back to defaults (12/yr) when no row exists, but
            # leave_request._compute_paid_status and get_employee_leave_balance
            # both treat "no row" as no quota -- every leave unpaid -- so
            # showing the defaults here would promise days payroll never pays.
            allowed = (policy.get('paid_leave_days_per_year', 0.0)
                       if policy.get('id') and policy.get('paid_leave_enabled') else 0.0)
            used = taken.get(employee.id, 0.0)
            employee.paid_leave_allowed = allowed
            employee.paid_leave_taken = used
            employee.paid_leave_remaining = max(0.0, allowed - used)

            if policy.get('comp_off_enabled'):
                credit = earned.get(employee.id, 0.0)
                spent = claimed.get(employee.id, 0.0)
            else:
                credit = spent = 0.0
            employee.comp_off_earned = credit
            employee.comp_off_used = spent
            employee.comp_off_balance = max(0.0, credit - spent)

    def action_view_comp_off_credits(self):
        """This employee's compensatory-off ledger."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Compensatory Off - %s', self.name),
            'res_model': 'hr.comp.off.credit',
            'view_mode': 'list,form',
            'domain': [('employee_id', '=', self.id)],
            'context': {'default_employee_id': self.id,
                        'search_default_available': 1},
        }

    # ------------------------------------------------------------------
    # Device registration (was: employee_device)
    # ------------------------------------------------------------------
    device_ids = fields.One2many('employee.device', 'employee_id', string='Devices')

    # Single editable view of the employee's device, surfaced so the
    # Attendances → Devices list shows one row per employee
    # (Name / Device ID / Active / PIN / Added On / Last Used). Reading reflects
    # the employee's primary device (active preferred, archived ones included);
    # writing find-or-creates / updates that device record — which also shows
    # under the employee form's Devices tab.
    device_code = fields.Char(
        string='Device ID',
        compute='_compute_device_fields',
        inverse='_inverse_device_code',
        store=False,
    )
    device_name = fields.Char(
        string='Device Name',
        compute='_compute_device_fields',
        store=False,
    )
    device_active = fields.Boolean(
        string='Active',
        compute='_compute_device_fields',
        inverse='_inverse_device_active',
        store=False,
    )
    device_added_date = fields.Datetime(
        string='Device Added On',
        compute='_compute_device_fields',
        store=False,
    )
    device_last_used = fields.Datetime(
        string='Last Used',
        compute='_compute_device_fields',
        store=False,
    )

    def _primary_device(self):
        """The employee's primary device — active first — INCLUDING archived
        ones (so a deactivated device still shows up and can be toggled back)."""
        self.ensure_one()
        Device = self.env['employee.device'].with_context(active_test=False)
        return Device.search(
            [('employee_id', '=', self.id)],
            order='active desc, create_date desc', limit=1,
        )

    @api.depends('device_ids', 'device_ids.device_id', 'device_ids.active',
                 'device_ids.create_date', 'device_ids.last_used', 'device_ids.device_name')
    def _compute_device_fields(self):
        for emp in self:
            dev = emp._primary_device()
            emp.device_code = dev.device_id if dev else False
            emp.device_name = dev.device_name if dev else False
            emp.device_active = dev.active if dev else False
            emp.device_added_date = dev.create_date if dev else False
            emp.device_last_used = dev.last_used if dev else False

    def _inverse_device_code(self):
        Device = self.env['employee.device'].with_context(active_test=False)
        for emp in self:
            code = (emp.device_code or '').strip()
            if not code:
                continue
            same = Device.search(
                [('employee_id', '=', emp.id), ('device_id', '=', code)], limit=1)
            if same:
                same.write({'active': True})
                continue
            existing = emp._primary_device()
            if existing:
                existing.write({'device_id': code, 'active': True})
            else:
                Device.create({
                    'employee_id': emp.id,
                    'device_id': code,
                    'active': True,
                })

    def _inverse_device_active(self):
        for emp in self:
            dev = emp._primary_device()
            if dev:
                dev.write({'active': bool(emp.device_active)})

    # ------------------------------------------------------------------
    # Kiosk / systray check-in (was: hr_attendance_late)
    # ------------------------------------------------------------------
    def _attendance_action_change(self, geo_information=None):
        """Standard kiosk / systray self-service check-in/out (this method
        creates the hr.attendance record). The employee cannot type a late
        reason at the kiosk, so exempt this path from the late-reason
        constraint enforced in hr.attendance — the mobile app collects the
        reason via its own post-check-in popup instead."""
        return super(
            HrEmployee, self.with_context(skip_late_reason_required=True)
        )._attendance_action_change(geo_information=geo_information)


    # ------------------------------------------------------------------
    # Salary breakup (components are configured, not hardcoded)
    #
    # `monthly_wage` above stays the authoritative deduction basis. Nothing
    # here feeds it: the breakup records what the salary is MADE OF, and any
    # disagreement between the two is surfaced rather than silently fixed.
    # ------------------------------------------------------------------
    salary_line_ids = fields.One2many(
        'hr.employee.salary.line', 'employee_id',
        string='Salary Breakup', groups='hr.group_hr_user',
        help='One line per salary component. Which components exist at all is '
             'configured under Employee Details > Salary Components.',
    )
    salary_effective_date = fields.Date(
        string='Salary Effective From', groups='hr.group_hr_user', tracking=True,
        help='When this breakup started applying. Informational -- this '
             'module keeps one current breakup rather than a dated history.',
    )
    salary_payment_mode = fields.Selection(
        [
            ('bank_transfer', 'Bank Transfer'),
            ('neft', 'NEFT'),
            ('imps', 'IMPS'),
            ('upi', 'UPI'),
            ('cheque', 'Cheque'),
            ('cash', 'Cash'),
        ],
        string='Salary Payment Mode', groups='hr.group_hr_user', tracking=True,
    )
    gross_salary = fields.Monetary(
        string='Gross (Components)', compute='_compute_salary_totals',
        currency_field='currency_id', groups='hr.group_hr_user',
        help='Sum of the earning components.',
    )
    total_deductions = fields.Monetary(
        string='Total Deductions', compute='_compute_salary_totals',
        currency_field='currency_id', groups='hr.group_hr_user',
        help='Sum of the deduction components. Unrelated to attendance '
             'deductions, which are derived from Monthly Wage.',
    )
    net_salary = fields.Monetary(
        string='Net Salary', compute='_compute_salary_totals',
        currency_field='currency_id', groups='hr.group_hr_user',
    )
    annual_ctc = fields.Monetary(
        string='Annual CTC', compute='_compute_salary_totals',
        currency_field='currency_id', groups='hr.group_hr_user',
        help='Gross of the components multiplied by twelve.',
    )
    salary_difference = fields.Monetary(
        string='Difference vs Monthly Wage', compute='_compute_salary_totals',
        currency_field='currency_id', groups='hr.group_hr_user',
        help='Component gross minus Monthly Wage. Informational only -- '
             'Monthly Wage remains the basis every attendance deduction uses, '
             'and a difference here never blocks saving.',
    )
    salary_mismatch = fields.Boolean(
        compute='_compute_salary_totals', groups='hr.group_hr_user',
        help='True only when the employee HAS component lines and their gross '
             'disagrees with Monthly Wage -- an employee with no breakup on '
             'file is never flagged.',
    )

    @api.depends('salary_line_ids.amount', 'salary_line_ids.component_type',
                 'monthly_wage', 'currency_id')
    def _compute_salary_totals(self):
        for emp in self:
            earnings = sum(
                line.amount for line in emp.salary_line_ids
                if line.component_type == 'earning')
            deductions = sum(
                line.amount for line in emp.salary_line_ids
                if line.component_type == 'deduction')
            emp.gross_salary = earnings
            emp.total_deductions = deductions
            emp.net_salary = earnings - deductions
            emp.annual_ctc = earnings * 12
            difference = earnings - (emp.monthly_wage or 0.0)
            emp.salary_difference = difference
            rounding = emp.currency_id.rounding or 0.01
            emp.salary_mismatch = bool(emp.salary_line_ids) and not float_is_zero(
                difference, precision_rounding=rounding)

    def action_sync_monthly_wage_from_components(self):
        """Copy the component gross onto Monthly Wage.

        Explicit, one employee at a time, and reversible. Deliberately never
        automatic: Monthly Wage drives every attendance deduction already
        recorded, so it changes only when somebody decides it should.
        """
        for emp in self:
            emp.monthly_wage = emp.gross_salary

    # ------------------------------------------------------------------
    # Statutory identifiers (types are configured, not hardcoded)
    # ------------------------------------------------------------------
    statutory_id_ids = fields.One2many(
        'hr.employee.statutory.id', 'employee_id',
        string='Statutory Identifiers', groups='hr.group_hr_user',
        help='PAN, Aadhaar, UAN or whatever else the company records. The '
             'available types are configured under Employee Details.',
    )
    tax_regime = fields.Selection(
        [('old', 'Old Regime'), ('new', 'New Regime')],
        string='Income Tax Regime', groups='hr.group_hr_user', tracking=True,
        help='Recorded for reference. Nothing in this module computes tax.',
    )
    professional_tax_state_id = fields.Many2one(
        'res.country.state', string='Professional Tax State',
        groups='hr.group_hr_user',
    )

    @api.constrains('statutory_id_ids')
    def _check_required_statutory_ids(self):
        """Required identifier types, enforced only once the employee has some.

        Scoped on purpose. Every employee predates this feature, so enforcing
        a required type unconditionally would make every legacy record
        unsavable -- the rule is "if you started filling this in, finish it".
        """
        IdType = self.env['hr.statutory.id.type'].sudo()
        for emp in self:
            if not emp.statutory_id_ids:
                continue
            recorded = {
                line.type_id: line.value for line in emp.statutory_id_ids
            }
            required = IdType.search([
                ('is_required', '=', True),
                ('company_id', 'in', [emp.company_id.id, False]),
            ])
            missing = [
                id_type.name for id_type in required
                if not (recorded.get(id_type) or '').strip()
            ]
            if missing:
                raise exceptions.ValidationError(_(
                    '%(employee)s is missing a required identifier: %(missing)s.',
                    employee=emp.name, missing=', '.join(missing)))

    # ------------------------------------------------------------------
    # Personal & emergency
    #
    # Only what Odoo 19 does NOT already ship. Date of birth, gender (`sex`),
    # marital status, spouse name (`spouse_complete_name`), children and the
    # private address all exist on hr.version and are reused as they are.
    # ------------------------------------------------------------------
    blood_group = fields.Selection(
        [
            ('a_pos', 'A+'),
            ('a_neg', 'A-'),
            ('b_pos', 'B+'),
            ('b_neg', 'B-'),
            ('ab_pos', 'AB+'),
            ('ab_neg', 'AB-'),
            ('o_pos', 'O+'),
            ('o_neg', 'O-'),
        ],
        string='Blood Group', groups='hr.group_hr_user',
    )
    father_name = fields.Char(string="Father's Name", groups='hr.group_hr_user')
    mother_name = fields.Char(string="Mother's Name", groups='hr.group_hr_user')
    emergency_contact_relation = fields.Char(
        string='Relationship', groups='hr.group_hr_user',
        help='How the emergency contact is related to the employee.',
    )
    emergency_contact_2 = fields.Char(
        string='Second Emergency Contact', groups='hr.group_hr_user')
    emergency_phone_2 = fields.Char(
        string='Second Emergency Phone', groups='hr.group_hr_user')
    emergency_contact_relation_2 = fields.Char(
        string='Second Relationship', groups='hr.group_hr_user')

    # ------------------------------------------------------------------
    # Employment history
    #
    # Joining date, probation end and exit are stock hr.version fields
    # (contract_date_start, trial_date_end, departure_date /
    # departure_reason_id) already rendered elsewhere on the employee form.
    # Re-declaring any of them here would SHADOW the delegated field and
    # quietly write to the wrong column, so only what stock lacks is added.
    # ------------------------------------------------------------------
    confirmation_date = fields.Date(
        string='Confirmation Date', groups='hr.group_hr_user', tracking=True,
        help='When the employee was confirmed after probation.',
    )
    notice_period_days = fields.Integer(
        string='Notice Period (Days)', groups='hr.group_hr_user', tracking=True)
    previous_employment_ids = fields.One2many(
        'hr.employee.previous.employment', 'employee_id',
        string='Previous Employment', groups='hr.group_hr_user')
    qualification_ids = fields.One2many(
        'hr.employee.qualification', 'employee_id',
        string='Qualifications', groups='hr.group_hr_user')
    experience_previous_months = fields.Integer(
        string='Previous Experience (Months)', compute='_compute_experience',
        groups='hr.group_hr_user')
    experience_current_months = fields.Integer(
        string='Current Tenure (Months)', compute='_compute_experience',
        groups='hr.group_hr_user')
    total_experience_months = fields.Integer(
        string='Total Experience (Months)', compute='_compute_experience',
        groups='hr.group_hr_user')
    total_experience_display = fields.Char(
        string='Total Experience', compute='_compute_experience',
        groups='hr.group_hr_user')

    @staticmethod
    def _whole_months_between(start, end):
        """Whole months from start to end, never negative."""
        if not start or not end or end < start:
            return 0
        months = (end.year - start.year) * 12 + end.month - start.month
        if end.day < start.day:
            months -= 1
        return max(months, 0)

    @api.depends('previous_employment_ids.duration_months')
    def _compute_experience(self):
        """Previous employment plus tenure here.

        Reads the joining and departure dates through sudo() deliberately:
        both are hr.group_hr_manager-only stock fields, so an ordinary HR user
        would otherwise hit an AccessError merely by opening the form.
        """
        today = fields.Date.context_today(self)
        for emp in self:
            previous = sum(emp.previous_employment_ids.mapped('duration_months'))
            emp.experience_previous_months = previous

            dates = emp.sudo()
            current = self._whole_months_between(
                dates.contract_date_start, dates.departure_date or today)
            emp.experience_current_months = current

            total = previous + current
            emp.total_experience_months = total
            years, months = divmod(total, 12)
            if years and months:
                emp.total_experience_display = _(
                    '%(y)s y %(m)s m', y=years, m=months)
            elif years:
                emp.total_experience_display = _('%s y', years)
            elif months:
                emp.total_experience_display = _('%s m', months)
            else:
                emp.total_experience_display = ''

    # ------------------------------------------------------------------
    # Field visibility
    #
    # Mirrors of hr.employee.details.config, so the employee form can hide
    # whatever the admin has not switched on. Non-stored, and filled by ONE
    # method doing ONE pair of queries for the whole recordset -- a per-record
    # lookup here would turn opening a 200-row list into 400 queries.
    #
    # These hide fields; they do not protect them. Confidentiality comes from
    # the `groups=` on each field above.
    # ------------------------------------------------------------------
    show_salary_section = fields.Boolean(compute='_compute_detail_visibility')
    show_statutory_section = fields.Boolean(compute='_compute_detail_visibility')
    show_bank_section = fields.Boolean(compute='_compute_detail_visibility')
    show_personal_section = fields.Boolean(compute='_compute_detail_visibility')
    show_employment_section = fields.Boolean(compute='_compute_detail_visibility')

    show_salary_effective_date = fields.Boolean(compute='_compute_detail_visibility')
    show_annual_ctc = fields.Boolean(compute='_compute_detail_visibility')
    show_payment_mode = fields.Boolean(compute='_compute_detail_visibility')

    show_tax_regime = fields.Boolean(compute='_compute_detail_visibility')
    show_professional_tax_state = fields.Boolean(compute='_compute_detail_visibility')

    show_bank_ifsc = fields.Boolean(compute='_compute_detail_visibility')
    show_bank_branch = fields.Boolean(compute='_compute_detail_visibility')
    show_bank_account_category = fields.Boolean(compute='_compute_detail_visibility')

    show_blood_group = fields.Boolean(compute='_compute_detail_visibility')
    show_father_name = fields.Boolean(compute='_compute_detail_visibility')
    show_mother_name = fields.Boolean(compute='_compute_detail_visibility')
    show_emergency_relation = fields.Boolean(compute='_compute_detail_visibility')
    show_second_emergency_contact = fields.Boolean(compute='_compute_detail_visibility')

    show_confirmation_date = fields.Boolean(compute='_compute_detail_visibility')
    show_notice_period = fields.Boolean(compute='_compute_detail_visibility')
    show_previous_employment = fields.Boolean(compute='_compute_detail_visibility')
    show_qualifications = fields.Boolean(compute='_compute_detail_visibility')
    show_total_experience = fields.Boolean(compute='_compute_detail_visibility')

    # The employee's own field settings, editable inline on the form so HR
    # can choose the fields while CREATING the employee rather than having to
    # save first and configure somewhere else afterwards.
    # At most one record. Leaving it empty means "follow the Everyone
    # defaults", which is why nothing is auto-created here; adding one means
    # this person uses it INSTEAD of the defaults.
    detail_config_ids = fields.One2many(
        'hr.employee.details.config', 'employee_id',
        string='Detail Fields', groups='hr.group_hr_manager',
    )
    # Whether anything is actually configured to put IN the sections above.
    # A section can be switched on while its master list is still empty, in
    # which case the employee form would show a blank list and no clue why --
    # these drive a short explanation and a button to go fix it.
    has_active_salary_components = fields.Boolean(
        compute='_compute_has_active_masters', groups='hr.group_hr_user')
    has_active_statutory_types = fields.Boolean(
        compute='_compute_has_active_masters', groups='hr.group_hr_user')

    @api.depends_context('company')
    def _compute_has_active_masters(self):
        """Two counts for the whole recordset, not two per employee."""
        has_components = bool(
            self.env['hr.salary.component'].sudo().search_count([]))
        has_types = bool(
            self.env['hr.statutory.id.type'].sudo().search_count([]))
        for emp in self:
            emp.has_active_salary_components = has_components
            emp.has_active_statutory_types = has_types

    @api.depends_context('company')
    @api.depends('company_id')
    def _compute_detail_visibility(self):
        Config = self.env['hr.employee.details.config']
        flags_by_employee = Config.get_flags_for_employees(self)
        blank = dict.fromkeys(Config.FLAG_FIELDS, False)
        for emp in self:
            flags = flags_by_employee.get(emp.id) or blank
            for name, value in flags.items():
                emp[name] = value
