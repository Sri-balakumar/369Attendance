from odoo import models, fields, api, _
from odoo.exceptions import ValidationError


class SalaryComponent(models.Model):
    """A named piece of an employee's salary, defined by the admin.

    Deliberately NOT a set of hardcoded fields. Companies disagree about what
    a salary is made of -- one runs Basic/HRA/PF, the next pays a single
    consolidated figure and has never heard of provident fund -- so the module
    ships the presets switched OFF and lets the admin activate the ones that
    apply, or invent their own.

    `active` is therefore the on/off switch an admin uses day to day: an
    inactive component cannot be added to anybody, but lines already recorded
    against it survive untouched.
    """
    _name = 'hr.salary.component'
    _description = 'Salary Component'
    _order = 'sequence, code'

    name = fields.Char(string='Component Name', required=True, translate=True)
    code = fields.Char(
        string='Code',
        required=True,
        help='Short unique identifier for this component, e.g. BASIC or HRA. '
             'Used to tell components apart when two carry a similar name.',
    )
    component_type = fields.Selection(
        [('earning', 'Earning'), ('deduction', 'Deduction')],
        string='Type',
        default='earning',
        required=True,
        help='Earnings add up to the gross. Deductions are subtracted from it '
             'to give the net.',
    )
    computation = fields.Selection(
        [
            ('fixed', 'Fixed Amount'),
            ('percent_of_component', 'Percentage of Another Component'),
            ('percent_of_gross', 'Percentage of Gross'),
        ],
        string='Computation',
        default='fixed',
        required=True,
        help='How the amount is arrived at on each employee.\n\n'
             'Fixed Amount -- typed in by hand per employee.\n'
             'Percentage of Another Component -- e.g. HRA at 40% of Basic.\n'
             'Percentage of Gross -- only available for deductions, because '
             'the gross is the sum of the earnings and an earning derived '
             'from it would define itself.',
    )
    base_component_id = fields.Many2one(
        'hr.salary.component',
        string='Base Component',
        ondelete='restrict',
        help='The component this one is a percentage of. Deliberately a free '
             'choice rather than a fixed "Basic": a company that has no '
             'component called Basic can still express its own rules.',
    )
    percentage = fields.Float(
        string='Percentage',
        digits=(16, 4),
        help='Applied to the base component, or to the gross, depending on '
             'the Computation above.',
    )
    default_amount = fields.Monetary(
        string='Default Amount',
        currency_field='currency_id',
        help='Pre-filled when this component is first added to an employee. '
             'It stays editable per employee afterwards.',
    )
    currency_id = fields.Many2one(
        'res.currency',
        string='Currency',
        default=lambda self: self.env.company.currency_id,
    )
    sequence = fields.Integer(
        string='Sequence',
        default=10,
        help='Display order on the employee, and the order components are '
             'resolved in when one is a percentage of another.',
    )
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        help='Leave empty to make the component available to every company.',
    )
    active = fields.Boolean(
        string='Active',
        default=True,
        help='The on/off switch. Switching a component off hides it and stops '
             'it being added to anyone new, but every amount already recorded '
             'against it is kept -- that money was real.',
    )

    _unique_code_company = models.Constraint(
        'UNIQUE(code, company_id)',
        'A salary component with this code already exists for this company.',
    )

    @api.constrains('base_component_id', 'computation')
    def _check_base_component(self):
        for comp in self:
            if comp.computation == 'percent_of_component' and not comp.base_component_id:
                raise ValidationError(_(
                    '"%s" is a percentage of another component, so a Base '
                    'Component must be selected.', comp.name))
            # A base that is itself a percentage of the gross would close a
            # loop the other way round: gross -> this earning -> deduction ->
            # gross. Forbidding it keeps the resolution order well-defined.
            base = comp.base_component_id
            if base and base.computation == 'percent_of_gross':
                raise ValidationError(_(
                    '"%(name)s" cannot be based on "%(base)s", because that '
                    'component is itself a percentage of the gross. Pick a '
                    'fixed or percentage-of-component base instead.',
                    name=comp.name, base=base.name))
        # Guards A -> B -> A as well as a component based on itself. Without
        # this the amount resolution below would never settle.
        if self._has_cycle('base_component_id'):
            raise ValidationError(_(
                'A salary component cannot be based on itself, either '
                'directly or through another component.'))

    @api.constrains('computation', 'component_type')
    def _check_percent_of_gross(self):
        """An EARNING may not be a percentage of gross.

        Gross is the sum of the earnings, so an earning derived from it would
        define itself. Forbidding just this one combination is what makes the
        gross definitionally acyclic, and removes a whole class of bugs from
        the resolution in hr.employee.salary.line.
        """
        for comp in self:
            if comp.computation == 'percent_of_gross' and comp.component_type == 'earning':
                raise ValidationError(_(
                    '"%s" cannot be an Earning computed as a percentage of '
                    'Gross -- the gross is the sum of the earnings, so it '
                    'would define itself. Use "Percentage of Another '
                    'Component" instead, or make it a Deduction.', comp.name))
