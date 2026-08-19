import calendar
from datetime import date

from odoo import models, fields, api, _
from odoo.exceptions import UserError


class PayslipRun(models.Model):
    """One month's payroll for the whole company.

    Generating for everybody at once rather than one payslip at a time is the
    point: it is the only way to notice that somebody was missed.
    """
    _name = 'hr.payslip.run'
    _description = 'Payroll Run'
    _order = 'year desc, month desc'

    name = fields.Char(string='Reference', readonly=True, copy=False)
    month = fields.Selection(
        [(str(i), calendar.month_name[i]) for i in range(1, 13)],
        string='Month', required=True,
        default=lambda self: str(fields.Date.context_today(self).month))
    year = fields.Integer(
        string='Year', required=True,
        default=lambda self: fields.Date.context_today(self).year)
    date_from = fields.Date(string='From', compute='_compute_period', store=True)
    date_to = fields.Date(string='To', compute='_compute_period', store=True)
    # Its OWN compute, deliberately not shared with the period above.
    # A single compute writing several stored fields is skipped entirely when
    # the caller supplies any one of them -- and the form always sends
    # pay_date, because readonly=False makes it an editable field. Sharing the
    # method therefore left date_from/date_to NULL on every run created from
    # the UI, while runs created in code were fine.
    pay_date = fields.Date(
        string='Pay Date', compute='_compute_pay_date', store=True, readonly=False,
        help='The date salary is credited. Printed on every payslip; defaults '
             'to the last day of the month and can be changed.')
    company_id = fields.Many2one(
        'res.company', string='Company', required=True,
        default=lambda self: self.env.company)
    currency_id = fields.Many2one(related='company_id.currency_id', readonly=True)
    state = fields.Selection(
        [('draft', 'Draft'), ('confirmed', 'Confirmed'), ('paid', 'Paid')],
        string='Status', default='draft', required=True, copy=False)

    payslip_ids = fields.One2many('hr.payslip', 'run_id', string='Payslips')
    employee_count = fields.Integer(compute='_compute_totals')
    total_gross = fields.Monetary(compute='_compute_totals', currency_field='currency_id')
    total_deductions = fields.Monetary(compute='_compute_totals', currency_field='currency_id')
    total_net = fields.Monetary(compute='_compute_totals', currency_field='currency_id')
    mismatch_count = fields.Integer(
        compute='_compute_totals',
        help='Payslips whose earnings disagree with the employee Monthly Wage. '
             'The run cannot be confirmed while any remain.')

    # One run per company per month. A second one would generate a second set
    # of payslips for the same period and nothing would say which was real.
    _unique_period = models.Constraint(
        'UNIQUE(company_id, year, month)',
        'A payroll run already exists for this company and month.',
    )

    @api.depends('month', 'year')
    def _compute_period(self):
        for run in self:
            if not run.month or not run.year:
                run.date_from = run.date_to = False
                continue
            month = int(run.month)
            last = calendar.monthrange(run.year, month)[1]
            run.date_from = date(run.year, month, 1)
            run.date_to = date(run.year, month, last)

    @api.depends('date_to')
    def _compute_pay_date(self):
        """Defaults to the last day of the month; the user may change it."""
        for run in self:
            run.pay_date = run.date_to

    @api.depends('payslip_ids.gross_earnings', 'payslip_ids.total_deductions',
                 'payslip_ids.net_pay_rounded', 'payslip_ids.wage_mismatch')
    def _compute_totals(self):
        for run in self:
            slips = run.payslip_ids
            run.employee_count = len(slips)
            run.total_gross = sum(slips.mapped('gross_earnings'))
            run.total_deductions = sum(slips.mapped('total_deductions'))
            run.total_net = sum(slips.mapped('net_pay_rounded'))
            run.mismatch_count = len(slips.filtered('wage_mismatch'))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get('name'):
                vals['name'] = self.env['ir.sequence'].next_by_code(
                    'hr.payslip.run') or _('New')
        return super().create(vals_list)

    def _employees_to_pay(self):
        """Active employees of this company, in name order."""
        self.ensure_one()
        return self.env['hr.employee'].search(
            [('company_id', '=', self.company_id.id)], order='name')

    def action_generate(self):
        """Create or refresh a payslip for every employee.

        Re-runnable while draft: existing payslips are recomputed rather than
        duplicated, so fixing somebody's salary and pressing Generate again
        does the obvious thing.
        """
        for run in self:
            if run.state != 'draft':
                raise UserError(_(
                    'This run is %s. Only a draft run can be generated.',
                    dict(self._fields['state'].selection)[run.state]))
            if not run.date_from or not run.date_to:
                raise UserError(_(
                    'This run has no pay period. Set the Month and Year, save, '
                    'and try again.'))
            employees = run._employees_to_pay()
            if not employees:
                raise UserError(_('There are no employees to pay in %s.',
                                  run.company_id.name))
            existing = {slip.employee_id: slip for slip in run.payslip_ids}
            for employee in employees:
                slip = existing.get(employee)
                if not slip:
                    slip = self.env['hr.payslip'].create({
                        'run_id': run.id,
                        'employee_id': employee.id,
                    })
                slip._compute_figures()
            # Somebody who left the company should not keep a payslip here.
            stale = run.payslip_ids.filtered(lambda s: s.employee_id not in employees)
            stale.unlink()
        return True

    def action_confirm(self):
        for run in self:
            if not run.payslip_ids:
                raise UserError(_('Generate the payslips before confirming.'))
            mismatched = run.payslip_ids.filtered('wage_mismatch')
            if mismatched:
                raise UserError(_(
                    'These payslips have earnings that disagree with the '
                    'employee Monthly Wage:\n\n%s\n\n'
                    'Monthly Wage is what every attendance deduction is '
                    'calculated from, so paying a different figure would mean '
                    'deducting against one number and paying another. Fix the '
                    'salary breakup, or set Monthly Wage to match, then '
                    'generate again.',
                    '\n'.join('  - %s: earnings %.2f vs wage %.2f' % (
                        s.employee_name, s.gross_earnings, s.monthly_wage)
                        for s in mismatched)))
            run.state = 'confirmed'
        return True

    def action_mark_paid(self):
        for run in self:
            if run.state != 'confirmed':
                raise UserError(_('Confirm the run before marking it paid.'))
            run.state = 'paid'
        return True

    def action_reset_to_draft(self):
        for run in self:
            if run.state == 'paid':
                raise UserError(_(
                    'This run is already marked paid. Reopening it would '
                    'change payslips employees have already been given.'))
            run.state = 'draft'
        return True

    def action_view_payslips(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Payslips'),
            'res_model': 'hr.payslip',
            'view_mode': 'list,form',
            'domain': [('run_id', '=', self.id)],
            'context': {'default_run_id': self.id},
        }

    def action_print_all(self):
        self.ensure_one()
        if not self.payslip_ids:
            raise UserError(_('There is nothing to print yet.'))
        return self.env.ref(
            'hr_attendance_369.action_report_payslip').report_action(self.payslip_ids)
