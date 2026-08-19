from odoo import models, fields, api, _
from odoo.exceptions import ValidationError


class EmployeeDetailsConfig(models.Model):
    """Which employee-detail fields this company actually uses.

    Every field added by the Employee Details feature is OFF until an admin
    switches it on here. That is deliberate: the fields ship for everyone, but
    no two companies keep the same paperwork -- one runs PF and ESI, the next
    has never heard of them -- so the module refuses to guess. A company that
    upgrades and does nothing sees NO change to the employee form at all.

    Two shapes of record live in this table:

    * the COMPANY record (employee_id not set) -- the defaults, and the only
      place `config_scope` is read from;
    * an EMPLOYEE OVERRIDE (employee_id set) -- consulted only while the
      company record is in 'employee' scope.

    An employee with no override falls back to the company record, so a new
    hire is never presented with a blank form.

    Note this only governs the FIXED fields. The two list-driven parts (salary
    components and statutory ID types) are switched on by activating their own
    master records instead, which additionally lets an admin invent components
    this module never shipped.
    """
    _name = 'hr.employee.details.config'
    _description = 'Employee Details Configuration'
    _rec_name = 'display_name'
    _order = 'company_id, employee_id'

    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        required=True,
    )
    employee_id = fields.Many2one(
        'hr.employee',
        string='Employee',
        ondelete='cascade',
        index=True,
        help='Leave empty for the company-wide defaults. Set it to tailor the '
             'visible fields for one person -- which only takes effect while '
             'the company record is set to "Per Employee".',
    )
    active = fields.Boolean(default=True)

    # An override is a SIBLING of the company record, not a child -- same
    # model, employee_id set -- so there was nothing for a One2many to hang
    # off and the two had to live on separate screens. This link is what lets
    # the exceptions be edited inside the defaults form.
    #
    # A plain writable Many2one, deliberately not a stored compute: Odoo sets
    # the inverse itself when rows are added through the One2many below, and a
    # computed field would fight that.
    parent_config_id = fields.Many2one(
        'hr.employee.details.config',
        string='Company Configuration',
        ondelete='cascade',
        index=True,
        help='The company record this override belongs to. Empty on the '
             'company record itself.',
    )
    override_ids = fields.One2many(
        'hr.employee.details.config', 'parent_config_id',
        string='Exceptions',
        help='People whose visible fields differ from the defaults. Anyone '
             'not listed here follows the defaults, including new hires.',
    )

    config_scope = fields.Selection(
        [
            ('global', 'Everyone'),
            ('employee', 'Per employee'),
        ],
        string='Applies To',
        default='global',
        required=True,
        help='Who this record governs. '
             '"Everyone" -- the defaults, used for anybody who has no record '
             'of their own. There can only be one. '
             '"Per employee" -- one person, who then uses THIS record instead '
             'of the defaults. Not merged with them: whatever is unticked '
             'here is hidden for that person even if the defaults show it.',
    )

    everyone_exists = fields.Boolean(
        string='Defaults Already Exist',
        compute='_compute_everyone_exists',
        help='True once the company has its "Everyone" record. Only one is '
             'allowed, so any further record can only be for one person.',
    )

    @api.depends('company_id')
    def _compute_everyone_exists(self):
        for rec in self:
            company = rec.company_id or self.env.company
            existing = rec._company_config(company.id)
            rec.everyone_exists = bool(existing) and existing != rec._origin

    @api.model
    def default_get(self, fields_list):
        """A new record defaults to "Per employee" once the defaults exist.

        Only one "Everyone" record is allowed per company, so after it has
        been created every further record can only be for one person --
        making the user pick that on the radio each time is a choice with one
        possible answer. An explicit default from the context still wins.
        """
        values = super().default_get(fields_list)
        if 'config_scope' in fields_list and not self.env.context.get('default_config_scope'):
            if self._company_config(self.env.company.id):
                values['config_scope'] = 'employee'
        return values

    @api.onchange('config_scope')
    def _onchange_config_scope(self):
        """Picking "Everyone" drops the employee; picking "Per employee"
        leaves it empty so the required field prompts for a name."""
        if self.config_scope == 'global':
            self.employee_id = False

    @api.model
    def _assert_scope_consistent(self, config_scope, employee_id):
        """Applies To and the employee must agree.

        Checked BEFORE the duplicate guard on create: a record marked "Per
        employee" with nobody chosen otherwise looks like a second Everyone
        record, and the user gets told the company already has a
        configuration -- true, but nothing to do with what they got wrong.
        """
        if config_scope == 'employee' and not employee_id:
            raise ValidationError(_(
                'Choose the employee this record applies to, or set '
                'Applies To back to "Everyone".'))
        if config_scope == 'global' and employee_id:
            employee = self.env['hr.employee'].browse(employee_id)
            raise ValidationError(_(
                'A record for %s cannot also be the "Everyone" defaults. '
                'Set Applies To to "Per employee".', employee.name))

    @api.constrains('config_scope', 'employee_id')
    def _check_scope_matches_employee(self):
        for rec in self:
            rec._assert_scope_consistent(rec.config_scope, rec.employee_id.id)

    # ------------------------------------------------------------------
    # Section switches -- the master on/off for each block of the form
    # ------------------------------------------------------------------
    show_salary_section = fields.Boolean(
        string='Salary Breakup',
        help='Show the salary component lines on the employee Payroll tab. '
             'The components themselves are defined under Employee Details > '
             'Salary Components; only the ones activated there appear. Always '
             'restricted to HR -- an employee never sees this, whatever else '
             'they are allowed to edit about themselves.',
    )
    show_statutory_section = fields.Boolean(
        string='Statutory Identifiers',
        help='Show the identity-number block (PAN, Aadhaar, UAN, or whatever '
             'types are activated under Employee Details > Statutory ID '
             'Types).',
    )
    show_bank_section = fields.Boolean(
        string='Bank & Payment',
        help='Show the bank block. The account itself uses the standard Odoo '
             'bank-accounts field; the switches below add the branch-level '
             'details Odoo does not carry.',
    )
    show_personal_section = fields.Boolean(
        string='Personal & Emergency',
        help='Show the extra personal fields. Odoo already ships date of '
             'birth, gender, marital status, spouse name and the private '
             'address -- this only adds what it does not have.',
    )
    show_employment_section = fields.Boolean(
        string='Employment History',
        help='Show the Employment tab. Joining date, probation end and exit '
             'date are standard Odoo fields shown elsewhere on the form and '
             'are always available.',
    )

    # ------------------------------------------------------------------
    # Field switches -- only meaningful while their section is on
    # ------------------------------------------------------------------
    # Salary
    show_salary_effective_date = fields.Boolean(string='Salary Effective From')
    show_annual_ctc = fields.Boolean(string='Annual CTC')
    show_payment_mode = fields.Boolean(string='Salary Payment Mode')

    # Statutory
    show_tax_regime = fields.Boolean(string='Income Tax Regime')
    show_professional_tax_state = fields.Boolean(string='Professional Tax State')

    # Bank
    show_bank_ifsc = fields.Boolean(string='IFSC Code')
    show_bank_branch = fields.Boolean(string='Branch')
    show_bank_account_category = fields.Boolean(string='Account Category')

    # Personal & emergency
    show_blood_group = fields.Boolean(string='Blood Group')
    show_father_name = fields.Boolean(string="Father's Name")
    show_mother_name = fields.Boolean(string="Mother's Name")
    show_emergency_relation = fields.Boolean(string='Emergency Contact Relationship')
    show_second_emergency_contact = fields.Boolean(string='Second Emergency Contact')

    # Employment
    show_confirmation_date = fields.Boolean(string='Confirmation Date')
    show_notice_period = fields.Boolean(string='Notice Period')
    show_previous_employment = fields.Boolean(string='Previous Employment')
    show_qualifications = fields.Boolean(string='Qualifications')
    show_total_experience = fields.Boolean(string='Total Experience')

    # A plain UNIQUE(company_id, employee_id) does NOT work here: Postgres
    # treats NULLs as distinct, so it would happily allow several company
    # records (employee_id IS NULL) for the same company. The resolution
    # below picks one of them with limit=1, so duplicates make the whole
    # feature behave differently depending on which row is found first.
    # Two partial unique indexes say what is actually meant.
    _unique_company_config = models.UniqueIndex(
        '(company_id) WHERE employee_id IS NULL AND active IS TRUE',
        'This company already has an Employee Details configuration.',
    )
    _unique_employee_override = models.UniqueIndex(
        '(company_id, employee_id) WHERE employee_id IS NOT NULL AND active IS TRUE',
        'This employee already has a detail-field override.',
    )

    # Every switch, in one place. hr.employee mirrors these names exactly, so
    # adding a switch means adding it here and to the config form -- the
    # employee-side compute picks it up with no further edits.
    FLAG_FIELDS = (
        'show_salary_section', 'show_statutory_section', 'show_bank_section',
        'show_personal_section', 'show_employment_section',
        'show_salary_effective_date', 'show_annual_ctc', 'show_payment_mode',
        'show_tax_regime', 'show_professional_tax_state',
        'show_bank_ifsc', 'show_bank_branch', 'show_bank_account_category',
        'show_blood_group', 'show_father_name', 'show_mother_name',
        'show_emergency_relation', 'show_second_emergency_contact',
        'show_confirmation_date', 'show_notice_period',
        'show_previous_employment', 'show_qualifications',
        'show_total_experience',
    )

    def _assert_no_duplicate(self, company_id, employee_id, exclude_id=None):
        """Raise a readable error BEFORE the database raises a cryptic one.

        Called from create/write rather than an @api.constrains, because
        constraints run after the row is flushed -- by which point the unique
        index has already fired with "duplicate key value violates unique
        constraint", which tells the user nothing about what to do.
        """
        domain = [('company_id', '=', company_id)]
        domain.append(('employee_id', '=', employee_id or False))
        if exclude_id:
            domain.append(('id', '!=', exclude_id))
        if not self.sudo().search_count(domain):
            return
        if employee_id:
            employee = self.env['hr.employee'].browse(employee_id)
            raise ValidationError(_(
                '%s already has a detail-field override. Open the existing '
                'one and edit it instead of adding a second.', employee.name))
        company = self.env['res.company'].browse(company_id)
        raise ValidationError(_(
            '%s already has an Employee Details configuration, and there can '
            'only be one. Open the existing record to change it. '
            'If you meant to tailor the fields for ONE person, use '
            'Configuration > Per-Employee Fields and choose the employee '
            'there.', company.name))

    @api.model_create_multi
    def create(self, vals_list):
        """Keep company_id aligned with the employee it belongs to.

        An override is looked up by (company, employee), so a record created
        against the wrong company would be stored and then silently ignored.
        That matters most when HR fills these in while CREATING an employee,
        where the default company may not be the one being assigned.
        """
        for vals in vals_list:
            if vals.get('employee_id'):
                employee = self.env['hr.employee'].browse(vals['employee_id'])
                if employee.company_id:
                    vals['company_id'] = employee.company_id.id
            # Scope first: it produces the message that actually describes
            # what the user got wrong.
            self._assert_scope_consistent(
                vals.get('config_scope', 'global'), vals.get('employee_id'))
            company_id = vals.get('company_id') or self.env.company.id
            # Overrides created through the API or an import have no parent
            # handed to them the way the One2many does it -- fill it here so
            # they still show up in the list on the company record.
            if vals.get('employee_id') and not vals.get('parent_config_id'):
                parent = self._company_config(company_id)
                if parent:
                    vals['parent_config_id'] = parent.id
            self._assert_no_duplicate(company_id, vals.get('employee_id'))
        return super().create(vals_list)

    def write(self, vals):
        if vals.get('employee_id'):
            employee = self.env['hr.employee'].browse(vals['employee_id'])
            if employee.company_id:
                vals['company_id'] = employee.company_id.id
        if vals.get('employee_id') and not vals.get('parent_config_id'):
            for rec in self:
                if not rec.parent_config_id:
                    parent = self._company_config(
                        vals.get('company_id', rec.company_id.id))
                    if parent and parent != rec:
                        rec.parent_config_id = parent
        if 'company_id' in vals or 'employee_id' in vals:
            for rec in self:
                self._assert_no_duplicate(
                    vals.get('company_id', rec.company_id.id),
                    vals.get('employee_id', rec.employee_id.id),
                    exclude_id=rec.id)
        return super().write(vals)

    # Which field switches belong to which section. One mapping, used by the
    # onchange below -- so a new toggle only has to be listed here and in
    # FLAG_FIELDS.
    SECTION_FIELDS = {
        'show_salary_section': (
            'show_salary_effective_date', 'show_annual_ctc'),
        'show_statutory_section': (
            'show_tax_regime', 'show_professional_tax_state'),
        'show_bank_section': (
            'show_bank_ifsc', 'show_bank_branch',
            'show_bank_account_category', 'show_payment_mode'),
        'show_personal_section': (
            'show_blood_group', 'show_father_name', 'show_mother_name',
            'show_emergency_relation', 'show_second_emergency_contact'),
        'show_employment_section': (
            'show_confirmation_date', 'show_notice_period',
            'show_previous_employment', 'show_qualifications',
            'show_total_experience'),
    }

    @api.onchange('show_salary_section', 'show_statutory_section',
                  'show_bank_section', 'show_personal_section',
                  'show_employment_section')
    def _onchange_section_toggles(self):
        """Switching a section on switches its fields on.

        Without this, ticking "Personal & Emergency" changes nothing at all:
        every field inside it sits behind its own switch, and those are still
        off. The admin ticks a section, saves, opens an employee, and sees no
        difference -- which reads as the feature being broken.

        Only the SECTION fields are in the decorator above, never the
        sub-fields. That is deliberate: unticking the last sub-field by hand
        must not immediately turn them all back on.
        """
        for section, sub_fields in self.SECTION_FIELDS.items():
            if self[section]:
                # Only seed when nothing is chosen yet, so re-opening a form
                # that was deliberately narrowed does not widen it again.
                if not any(self[name] for name in sub_fields):
                    for name in sub_fields:
                        self[name] = True
            else:
                for name in sub_fields:
                    self[name] = False

    @api.depends('company_id', 'employee_id')
    def _compute_display_name(self):
        for rec in self:
            if rec.employee_id:
                rec.display_name = f'{rec.employee_id.name} - Detail Fields'
            else:
                rec.display_name = f'{rec.company_id.name} - Employee Details'

    @api.model
    def _company_config(self, company_id):
        """The company-wide record for one company, or an empty recordset."""
        return self.sudo().search([
            ('company_id', '=', company_id),
            ('employee_id', '=', False),
        ], order='id', limit=1)

    @api.model
    def get_flags_for_employees(self, employees):
        """Every switch for a whole recordset: {employee_id: {flag: bool}}.

        Two queries regardless of how many employees are passed -- one for the
        company records, one for the overrides. Doing this per employee would
        turn opening a 200-row employee list into 400 queries, so the batching
        is the point of this method rather than an optimisation.

        Employees whose company has no configuration record get all-False,
        which is what makes a fresh install show nothing at all.
        """
        blank = dict.fromkeys(self.FLAG_FIELDS, False)
        if not employees:
            return {}

        Config = self.sudo()
        company_ids = employees.company_id.ids
        company_configs = {
            cfg.company_id.id: cfg
            for cfg in Config.search([
                ('company_id', 'in', company_ids),
                ('employee_id', '=', False),
            ], order='id desc')
        }

        # An unsaved employee has a NewId, which cannot go into a domain --
        # they simply fall through to the defaults, which is the right answer
        # for a record that does not exist yet.
        saved_ids = [e.id for e in employees if isinstance(e.id, int)]
        overrides = {}
        if saved_ids:
            # No company-wide mode to check any more: if a person has their own
            # record it applies, full stop.
            overrides = {
                cfg.employee_id.id: cfg
                for cfg in Config.search([
                    ('company_id', 'in', company_ids),
                    ('employee_id', 'in', saved_ids),
                ])
            }

        result = {}
        for employee in employees:
            company_config = company_configs.get(employee.company_id.id)
            # A person's own record REPLACES the defaults for them -- it is not
            # merged, so anything unticked there stays hidden even if the
            # defaults show it. Without one, the defaults apply, which is why a
            # new hire is never shown an empty form.
            source = overrides.get(employee.id) or company_config
            result[employee.id] = (
                {name: source[name] for name in self.FLAG_FIELDS}
                if source else dict(blank)
            )
        return result
