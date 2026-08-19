from odoo import models, fields, api, _
from odoo.exceptions import ValidationError


class EmployeeStatutoryId(models.Model):
    """One identity number, of one configured type, for one employee.

    Employees maintain these themselves from My Profile, so the validation has
    to be helpful rather than merely correct: an onchange warns while they are
    still typing, and the constraint is what actually guarantees it on save
    and on import.
    """
    _name = 'hr.employee.statutory.id'
    _description = 'Employee Statutory Identifier'
    _order = 'sequence, id'
    _rec_name = 'type_id'

    # Identifiers are numbers, not prose. Capping the length keeps a
    # pathological admin-supplied pattern from backtracking forever.
    MAX_VALUE_LEN = 128

    employee_id = fields.Many2one(
        'hr.employee', string='Employee',
        required=True, ondelete='cascade', index=True)
    type_id = fields.Many2one(
        'hr.statutory.id.type', string='Identifier',
        required=True, ondelete='restrict')
    sequence = fields.Integer(related='type_id.sequence', store=True)
    value = fields.Char(string='Number', tracking=True)
    type_active = fields.Boolean(related='type_id.active', readonly=True)
    company_id = fields.Many2one(related='employee_id.company_id', store=True)

    _unique_employee_type = models.Constraint(
        'UNIQUE(employee_id, type_id)',
        'This identifier is already recorded for the employee.',
    )

    def _format_error(self):
        """The error text if the value is malformed, otherwise None.

        A blank value is ALWAYS acceptable. Every employee predates this
        feature, so demanding a value on save would make existing records
        impossible to edit at all.
        """
        self.ensure_one()
        value = (self.value or '').strip()
        if not value or not self.type_id:
            return None
        if len(value) > self.MAX_VALUE_LEN:
            return _('%s is too long to be a valid identifier.', self.type_id.name)
        # sudo: an ordinary employee editing their own profile may not have
        # read access to the type master, but still needs it validated.
        pattern = self.type_id.sudo()._compiled_regex()
        # fullmatch, NOT match: match anchors only at the start, so a PAN
        # pattern would happily accept "ABCDE1234FJUNK".
        if pattern is None or pattern.fullmatch(value):
            return None
        return self.type_id.validation_message or _(
            '"%(value)s" is not a valid %(type)s.',
            value=value, type=self.type_id.name)

    @api.constrains('value', 'type_id')
    def _check_value_format(self):
        for line in self:
            error = line._format_error()
            if error:
                raise ValidationError(error)

    @api.onchange('value', 'type_id')
    def _onchange_value(self):
        """Immediate feedback while typing in the inline list, before save."""
        error = self._format_error()
        if error:
            return {'warning': {'title': _('Invalid Identifier'), 'message': error}}
