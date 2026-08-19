from odoo import models, fields, api, _
from odoo.exceptions import ValidationError


class EmployeeQualification(models.Model):
    """One qualification the employee holds.

    Odoo ships a single certificate level per employee; most people have
    several, so this is a list. `year_of_passing` is deliberately an Integer
    rather than a Date -- old certificates routinely carry only a year, and
    demanding a full date would mean inventing one.
    """
    _name = 'hr.employee.qualification'
    _description = 'Employee Qualification'
    _order = 'year_of_passing desc, sequence, id'

    employee_id = fields.Many2one(
        'hr.employee', string='Employee',
        required=True, ondelete='cascade', index=True)
    name = fields.Char(string='Qualification', required=True)
    specialization = fields.Char(string='Specialization')
    institution = fields.Char(string='Institution')
    board_university = fields.Char(string='Board / University')
    year_of_passing = fields.Integer(string='Year of Passing')
    grade = fields.Char(string='Grade / Percentage')
    sequence = fields.Integer(string='Sequence', default=10)
    notes = fields.Text(string='Notes')

    @api.constrains('year_of_passing')
    def _check_year_of_passing(self):
        """Blank (0) stays legal; only an impossible year is rejected."""
        current_year = fields.Date.context_today(self).year
        for rec in self:
            if not rec.year_of_passing:
                continue
            if not (1900 <= rec.year_of_passing <= current_year + 10):
                raise ValidationError(_(
                    '%(year)s is not a usable year of passing for "%(name)s".',
                    year=rec.year_of_passing, name=rec.name))
