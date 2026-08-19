from odoo import models, fields


class PayslipLine(models.Model):
    """One earning or deduction printed on a payslip.

    A snapshot, not a live link: `name` and `code` are copied from the salary
    component at generation time so a payslip printed today still reads the
    same after somebody renames or archives that component next year. A payslip
    is a document an employee keeps; it must not change retrospectively.
    """
    _name = 'hr.payslip.line'
    _description = 'Payslip Line'
    _order = 'category desc, sequence, id'

    payslip_id = fields.Many2one(
        'hr.payslip', string='Payslip',
        required=True, ondelete='cascade', index=True)
    component_id = fields.Many2one(
        'hr.salary.component', string='Component', ondelete='restrict',
        help='Blank on Loss of Pay, which is calculated from attendance '
             'rather than configured as a component.')
    name = fields.Char(string='Description', required=True)
    code = fields.Char(string='Code')
    category = fields.Selection(
        [('earning', 'Earning'), ('deduction', 'Deduction')],
        string='Category', required=True)
    sequence = fields.Integer(string='Sequence', default=10)
    amount = fields.Monetary(string='Amount', currency_field='currency_id')
    currency_id = fields.Many2one(
        related='payslip_id.currency_id', readonly=True)
    company_id = fields.Many2one(
        related='payslip_id.company_id', store=True)
