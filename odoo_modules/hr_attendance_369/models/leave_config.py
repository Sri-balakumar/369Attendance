from odoo.tools.mail import email_split
from odoo import models, fields, api


class LeaveConfig(models.Model):
    _name = 'hr.leave.config'
    _description = 'Leave Configuration'
    _rec_name = 'display_name'

    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        required=True,
    )

    # --- Paid Leave Configuration ---
    paid_leave_enabled = fields.Boolean(
        string='Enable Paid Leave',
        default=True,
        help='If enabled, employees get a fixed number of paid leave days per year.',
    )
    paid_leave_days_per_year = fields.Integer(
        string='Paid Leave Days Per Year',
        default=12,
        help='Total number of paid leave days allowed per year.',
    )
    paid_leave_days_per_month = fields.Float(
        string='Paid Leave Days Per Month',
        default=1.0,
        help='Number of paid leave days allowed per month.',
    )

    # --- Unpaid Leave Configuration ---
    unpaid_leave_deduction_enabled = fields.Boolean(
        string='Enable Unpaid Leave Deduction',
        default=True,
        help='When enabled, unpaid leave deduction is calculated as: '
             'Employee Monthly Wage ÷ Working Days in Month. '
             'Half day = half of that daily rate.',
    )

    # --- Compensatory Off ---
    # Earned by working a weekly off or a public holiday; spent as a leave
    # request of type Compensatory Off. Deliberately its own allowance rather
    # than extra paid-leave quota: a comp off is a day already worked and owed
    # back, not an allowance the company grants.
    comp_off_enabled = fields.Boolean(
        string='Enable Compensatory Off',
        default=True,
        help='When enabled, working on a weekly off or a public holiday earns '
             'a compensatory off the employee can take later.',
    )
    comp_off_expiry_days = fields.Integer(
        string='Comp Off Expires After (Days)',
        default=0,
        help='Days from the date worked until the credit lapses. 0 means it '
             'never expires. Applied when the credit is earned, so shortening '
             'this later does not retroactively cancel credits already held.',
    )
    comp_off_carry_forward_enabled = fields.Boolean(
        string='Carry Comp Off Forward',
        default=True,
        help='Allow unused compensatory offs to carry into the next year. '
             'Unlike the paid-leave carry forward above, this one is applied.',
    )
    comp_off_max_carry_forward_days = fields.Integer(
        string='Max Comp Off Carried Forward',
        default=5,
    )

    # --- Grace / Carry Forward ---
    # --- Notifications ---
    notify_on_submit = fields.Boolean(
        string='Email HR on Submission',
        default=False,
        help='Send an email to the addresses below the moment a leave request '
             'is submitted, from the app or the backend. Needs a working '
             'outgoing mail server (Settings > Technical > Outgoing Mail '
             'Servers) or the mails only queue up.',
    )
    notify_emails = fields.Char(
        string='Notification Recipients',
        help='Who gets the submission email. Several addresses are separated '
             'by commas: hr@example.com, manager@example.com',
    )

    notify_preview_html = fields.Html(
        string='Email Preview', compute='_compute_notify_preview',
        sanitize=False,
        help='What HR will receive, shown with a sample request.')

    @api.depends('notify_on_submit', 'notify_emails', 'company_id')
    def _compute_notify_preview(self):
        from datetime import date, timedelta
        Leave = self.env['hr.leave.request'].sudo()
        for cfg in self:
            employee = self.env.user.employee_id or self.env['hr.employee'].sudo().search(
                [('company_id', '=', cfg.company_id.id)], limit=1)
            if not cfg.notify_on_submit or not employee:
                cfg.notify_preview_html = False
                continue
            today = date.today()
            monday = today + timedelta(days=(7 - today.weekday()) or 7)
            sample = Leave.new({
                'hr_employee_id': employee.id,
                'leave_type': 'casual',
                'from_date': monday,
                'reason': 'Sample reason, as the employee types it.',
            })
            cfg.notify_preview_html = sample.submit_mail_html(record_url='#')

    def _get_notify_emails(self):
        """The recipient list, cleaned: split on commas/semicolons, invalid
        entries dropped. Empty when the switch is off or nothing valid is
        configured -- the one test callers need."""
        self.ensure_one()
        if not self.notify_on_submit or not self.notify_emails:
            return []
        return email_split(self.notify_emails.replace(';', ','))

    carry_forward_enabled = fields.Boolean(
        string='Allow Carry Forward',
        default=False,
        help='Allow unused paid leaves to carry forward to next year.',
    )
    max_carry_forward_days = fields.Integer(
        string='Max Carry Forward Days',
        default=5,
    )

    active = fields.Boolean(default=True)

    @api.depends('company_id')
    def _compute_display_name(self):
        for rec in self:
            rec.display_name = f'{rec.company_id.name} - Leave Policy'

    @api.model
    def get_config_for_company(self, company_id=None):
        """Get leave config for a company. Callable from mobile app."""
        company_id = company_id or self.env.company.id
        config = self.search([('company_id', '=', company_id)], limit=1)
        if not config:
            return {
                'paid_leave_enabled': True,
                'paid_leave_days_per_year': 12,
                'paid_leave_days_per_month': 1.0,
                'unpaid_leave_deduction_enabled': True,
                'carry_forward_enabled': False,
                'max_carry_forward_days': 5,
                'comp_off_enabled': True,
                'comp_off_expiry_days': 0,
                'comp_off_carry_forward_enabled': True,
                'comp_off_max_carry_forward_days': 5,
                'notify_on_submit': False,
                'notify_emails': '',
            }
        return {
            'id': config.id,
            'paid_leave_enabled': config.paid_leave_enabled,
            'paid_leave_days_per_year': config.paid_leave_days_per_year,
            'paid_leave_days_per_month': config.paid_leave_days_per_month,
            'unpaid_leave_deduction_enabled': config.unpaid_leave_deduction_enabled,
            'carry_forward_enabled': config.carry_forward_enabled,
            'max_carry_forward_days': config.max_carry_forward_days,
            'comp_off_enabled': config.comp_off_enabled,
            'comp_off_expiry_days': config.comp_off_expiry_days,
            'comp_off_carry_forward_enabled': config.comp_off_carry_forward_enabled,
            'comp_off_max_carry_forward_days': config.comp_off_max_carry_forward_days,
            'notify_on_submit': config.notify_on_submit,
            'notify_emails': config.notify_emails or '',
        }

    @api.model
    def get_employee_leave_balance(self, employee_id, year=None):
        """Calculate remaining paid leave for an employee."""
        from datetime import date
        year = year or date.today().year
        # No sudo needed here, and deliberately so: a single dot-read of
        # company_id does NOT expand to hr.employee's private prefetch group,
        # so an ordinary employee can resolve it. (Verified against the live
        # server -- reading the FULL record does raise AccessError, which is
        # what makes the distinction worth stating rather than re-testing.)
        #
        # The hr.leave.request search below stays rule-scoped too, so a caller
        # passing a colleague id gets company-wide policy numbers they can
        # already read via the hr.leave.config ACL and a used total of 0 --
        # never a colleague's actual leave.
        company_id = self.env['hr.employee'].browse(employee_id).company_id.id
        config = self.search([('company_id', '=', company_id)], limit=1)

        if not config or not config.paid_leave_enabled:
            return {'has_quota': False}

        # Count all approved leave days this year.
        #
        # Compensatory off is EXCLUDED: it is drawn from days the employee
        # already worked, not from this allowance, so counting it here would
        # quietly burn a paid-leave day every time somebody took back a Sunday.
        used_records = self.env['hr.leave.request'].search([
            ('hr_employee_id', '=', employee_id),
            ('state', '=', 'approved'),
            ('leave_type', '!=', 'comp_off'),
            ('from_date', '>=', f'{year}-01-01'),
            ('from_date', '<=', f'{year}-12-31'),
        ])
        total_used = sum(r.number_of_days for r in used_records)
        total_allowed = config.paid_leave_days_per_year

        # What the NEXT request would actually get, as _compute_paid_status
        # prices it: pending requests count, and so does the monthly cap.
        # `remaining` above counts approved leave only and ignores the month,
        # so on its own it told someone "11 left" while their next day was LOP.
        pending_days = sum(self.env['hr.leave.request'].search([
            ('hr_employee_id', '=', employee_id),
            ('state', '=', 'pending'),
            ('leave_type', '!=', 'comp_off'),
            ('from_date', '>=', f'{year}-01-01'),
            ('from_date', '<=', f'{year}-12-31'),
        ]).mapped('number_of_days'))
        today = date.today()
        on = today if today.year == int(year) else date(int(year), 1, 1)
        quota = self.env['hr.leave.request']._paid_quota_left(employee_id, on, config)

        return {
            'has_quota': True,
            'total_allowed': total_allowed,
            'total_used': total_used,
            'remaining': max(0, total_allowed - total_used),
            'per_month': config.paid_leave_days_per_month,
            'unpaid_deduction_enabled': config.unpaid_leave_deduction_enabled,
            'pending_days': pending_days,
            'remaining_year_now': quota['remaining_year'],
            'remaining_this_month': quota['remaining_month'],
            'is_quota_exhausted': quota['remaining'] <= 0,
        }
