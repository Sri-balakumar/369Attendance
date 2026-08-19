from odoo import models, fields, api, _
from odoo.exceptions import ValidationError


class EmployeePreviousEmployment(models.Model):
    """Where the employee worked before joining.

    Filled in by the employee from My Profile, so every field except the
    employer name is optional -- people rarely remember exact dates for a job
    they left a decade ago, and a half-filled row is more useful than none.
    """
    _name = 'hr.employee.previous.employment'
    _description = 'Employee Previous Employment'
    _order = 'date_to desc, date_from desc, id desc'
    # Not `name`: on this model that would be ambiguous between the employer
    # and the role. Naming the field outright avoids the guesswork.
    _rec_name = 'company_name'

    employee_id = fields.Many2one(
        'hr.employee', string='Employee',
        required=True, ondelete='cascade', index=True)
    company_name = fields.Char(string='Employer', required=True)
    job_title = fields.Char(string='Designation')
    location = fields.Char(string='Location')
    date_from = fields.Date(string='From')
    date_to = fields.Date(string='To')
    duration_months = fields.Integer(
        string='Duration (Months)',
        compute='_compute_duration',
        store=True,
        help='Stored so the employee total experience can be summed without '
             'walking every row.',
    )
    duration_display = fields.Char(string='Duration', compute='_compute_duration')
    last_drawn_salary = fields.Monetary(
        string='Last Drawn Salary', currency_field='currency_id')
    currency_id = fields.Many2one(related='employee_id.currency_id', readonly=True)
    reason_for_leaving = fields.Char(string='Reason for Leaving')
    reference_contact = fields.Char(string='Reference Contact')
    notes = fields.Text(string='Notes')

    @api.depends('date_from', 'date_to')
    def _compute_duration(self):
        for rec in self:
            if rec.date_from and rec.date_to and rec.date_to >= rec.date_from:
                months = ((rec.date_to.year - rec.date_from.year) * 12
                          + rec.date_to.month - rec.date_from.month)
                if rec.date_to.day < rec.date_from.day:
                    months -= 1
                rec.duration_months = max(months, 0)
            else:
                rec.duration_months = 0
            years, months = divmod(rec.duration_months, 12)
            if years and months:
                rec.duration_display = _('%(y)s y %(m)s m', y=years, m=months)
            elif years:
                rec.duration_display = _('%s y', years)
            elif months:
                rec.duration_display = _('%s m', months)
            else:
                rec.duration_display = ''

    @api.constrains('date_from', 'date_to')
    def _check_dates(self):
        """Both blank stays legal -- partial history is the normal case."""
        for rec in self:
            if rec.date_from and rec.date_to and rec.date_to < rec.date_from:
                raise ValidationError(_(
                    'At %s, the end date is before the start date.',
                    rec.company_name))
