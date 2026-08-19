import logging

from odoo import models, fields, api

_logger = logging.getLogger(__name__)


class EmployeeSalaryLine(models.Model):
    """One salary component, with its amount, for one employee.

    `amount` is a WRITABLE computed field (store=True, readonly=False). That
    single shape covers both cases the admin can configure: a fixed component
    is typed in by hand and kept, while a percentage component fills itself in
    from its base. Splitting them into two columns would have meant the form
    showing an empty box next to a calculated one.
    """
    _name = 'hr.employee.salary.line'
    _description = 'Employee Salary Line'
    _order = 'sequence, id'
    _rec_name = 'component_id'

    employee_id = fields.Many2one(
        'hr.employee', string='Employee',
        required=True, ondelete='cascade', index=True)
    component_id = fields.Many2one(
        'hr.salary.component', string='Component',
        required=True, ondelete='restrict')

    sequence = fields.Integer(related='component_id.sequence', store=True)
    component_type = fields.Selection(related='component_id.component_type', readonly=True)
    computation = fields.Selection(related='component_id.computation', readonly=True)
    percentage = fields.Float(related='component_id.percentage', readonly=True)
    component_active = fields.Boolean(
        related='component_id.active', readonly=True,
        help='False once the admin switches the component off. The line and '
             'its amount are kept -- the money was real -- but it is shown '
             'greyed out and cannot be added to anybody new.')

    amount = fields.Monetary(
        string='Amount',
        currency_field='currency_id',
        compute='_compute_amount',
        store=True,
        readonly=False,
        help='Typed in by hand for a fixed component; filled in automatically '
             'for a percentage one.',
    )
    currency_id = fields.Many2one(related='employee_id.currency_id', readonly=True)
    company_id = fields.Many2one(related='employee_id.company_id', store=True)

    _unique_employee_component = models.Constraint(
        'UNIQUE(employee_id, component_id)',
        'This salary component is already on the employee -- edit the '
        'existing line instead of adding a second one.',
    )

    @api.depends('component_id', 'component_id.computation',
                 'component_id.percentage', 'component_id.base_component_id',
                 'component_id.default_amount',
                 'employee_id.salary_line_ids.amount')
    def _compute_amount(self):
        """Resolve fixed, then percentage-of-component, then percentage-of-gross.

        Everything is worked out here in Python rather than by reading sibling
        `.amount` values back through the ORM, so the order is explicit and a
        half-configured setup cannot send the recompute round in circles.

        The ordering is safe because hr.salary.component forbids the two
        combinations that would make it circular: a component based on itself
        (directly or transitively), and an EARNING computed from the gross.
        """
        for employee, lines in self.grouped('employee_id').items():
            siblings = employee.salary_line_ids | lines
            resolved = {}

            # Pass 1 -- fixed amounts. A brand-new line with nothing typed in
            # yet is seeded from the component's default.
            pending = []
            for line in siblings:
                comp = line.component_id
                if not comp:
                    resolved[line] = line.amount or 0.0
                elif comp.computation == 'fixed':
                    resolved[line] = line.amount or comp.default_amount or 0.0
                else:
                    pending.append(line)

            # Pass 2..k -- percentages of another component, resolving as the
            # bases become known. Stops as soon as a pass makes no progress.
            by_component = {l.component_id: l for l in siblings if l.component_id}
            gross_based = []
            progress = True
            while progress:
                progress = False
                for line in list(pending):
                    comp = line.component_id
                    if comp.computation == 'percent_of_gross':
                        pending.remove(line)
                        gross_based.append(line)
                        progress = True
                        continue
                    base_line = by_component.get(comp.base_component_id)
                    if base_line is None:
                        # The admin enabled e.g. HRA but this employee has no
                        # Basic line. 40% of nothing is 0 -- not an error.
                        resolved[line] = 0.0
                        pending.remove(line)
                        progress = True
                    elif base_line in resolved:
                        resolved[line] = resolved[base_line] * comp.percentage / 100.0
                        pending.remove(line)
                        progress = True

            for line in pending:
                # Unreachable while the component constraints hold; kept so a
                # pathological setup yields 0 rather than a stuck recompute.
                _logger.warning(
                    'Could not resolve salary component %r for employee %r -- '
                    'falling back to 0.', line.component_id.name, employee.name)
                resolved[line] = 0.0

            # Pass 3 -- percentages of gross, once every earning is known.
            gross = sum(
                amount for line, amount in resolved.items()
                if line.component_type == 'earning'
            )
            for line in gross_based:
                resolved[line] = gross * line.component_id.percentage / 100.0

            for line in lines:
                line.amount = resolved.get(line, 0.0)
