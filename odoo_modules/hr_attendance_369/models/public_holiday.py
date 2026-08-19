from odoo import models, fields, api, exceptions


class PublicHoliday(models.Model):
    _name = 'hr.public.holiday'
    _description = 'Public Holiday'
    _order = 'date asc'
    _rec_name = 'name'

    name = fields.Char(string='Holiday Name', required=True)
    date = fields.Date(string='Date', required=True)
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        required=True,
    )
    active = fields.Boolean(default=True)

    # --- Display / impact helpers -------------------------------------- #
    year = fields.Integer(
        string='Year', compute='_compute_holiday_info', store=True, index=True,
        help='Stored so the list can be filtered and grouped by year. The old '
             'hardcoded "This Year" filter stopped being useful the moment a '
             'second year existed.',
    )
    day_name = fields.Char(
        string='Day', compute='_compute_holiday_info',
        help='Which weekday this holiday falls on.',
    )
    affects_working_days = fields.Boolean(
        string='Counts', compute='_compute_holiday_info',
        help='Whether this holiday actually reduces the working days in the '
             'month -- which is the divisor for every daily rate, so it is what '
             'decides whether the holiday changes anybody\'s pay.\n\n'
             'False means the date already falls on a non-working day (a Sunday, '
             'say), so removing it from the working days changes nothing.\n\n'
             'Read from the COMPANY-WIDE working-days configuration. A department '
             'with its own config and different working days may differ.',
    )

    @api.depends('date', 'company_id')
    def _compute_holiday_info(self):
        """Year, weekday, and whether the holiday moves the payroll divisor.

        `affects_working_days` is deliberately NOT stored: it depends on the
        working-days checkboxes in hr.attendance.late.config, which is not an
        ORM dependency, so a stored value would go stale the moment somebody
        unticked Saturday and nothing would recompute it.

        The config is resolved once per company rather than once per row -- this
        renders in a list view, so a per-record search would be an N+1.
        """
        Config = self.env['hr.attendance.late.config']
        by_company = {}

        for rec in self:
            if not rec.date:
                rec.year = 0
                rec.day_name = ''
                rec.affects_working_days = False
                continue

            rec.year = rec.date.year
            rec.day_name = rec.date.strftime('%A')

            company_id = rec.company_id.id
            if company_id not in by_company:
                cfg = Config.sudo().search([
                    ('company_id', '=', company_id),
                    ('department_id', '=', False),
                ], limit=1)
                # Same fallback get_config_for_employee uses when no config
                # record exists at all: Mon-Sat working, Sunday off.
                by_company[company_id] = (
                    cfg.get_working_days_list() if cfg else [0, 1, 2, 3, 4, 5])

            rec.affects_working_days = rec.date.weekday() in by_company[company_id]

    # Odoo 19 note: the `_sql_constraints = [...]` list is no longer supported
    # (the ORM logs "Model attribute '_sql_constraints' is no longer supported"
    # and skips it), so this uniqueness rule was silently NOT created in the
    # database — duplicate holidays for the same date/company were possible.
    # models.Constraint is the Odoo 19 replacement.
    _unique_holiday_date_company = models.Constraint(
        'UNIQUE(date, company_id)',
        'A holiday already exists for this date and company.',
    )

    @api.constrains('date')
    def _check_date(self):
        for rec in self:
            if not rec.date:
                raise exceptions.ValidationError('Holiday date is required.')

    def _raise_if_duplicate(self, date, company_id, exclude_id=None):
        """Name the clashing holiday instead of letting the raw Postgres unique
        violation reach the user.

        This runs from create()/write() rather than an @api.constrains on
        purpose: Odoo flushes the INSERT -- which fires the UNIQUE(date,
        company_id) index -- BEFORE Python constraints execute, so a constrains
        method can never win the race against a SQL constraint. Checking up
        front is the only way to produce a useful message.

        The SQL constraint stays as the real guarantee; this is just the
        friendly face on it.
        """
        if not date or not company_id:
            return
        domain = [('date', '=', date), ('company_id', '=', company_id)]
        if exclude_id:
            domain.append(('id', '!=', exclude_id))
        clash = self.sudo().search(domain, limit=1)
        if not clash:
            return
        if not isinstance(date, str):
            shown = date.strftime('%d %b %Y')
        else:
            shown = date
        raise exceptions.ValidationError(
            '%s is already a holiday: "%s".\n\n'
            'One holiday per date per company. If two occasions fall on the '
            'same day, rename the existing one to cover both -- the Kerala '
            'gazette does exactly this, e.g. '
            '"Fourth Onam / Sree Narayana Guru Jayanthi".'
            % (shown, clash.name))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            self._raise_if_duplicate(
                fields.Date.to_date(vals.get('date')),
                vals.get('company_id') or self.env.company.id)
        return super().create(vals_list)

    def write(self, vals):
        if 'date' in vals or 'company_id' in vals:
            for rec in self:
                self._raise_if_duplicate(
                    fields.Date.to_date(vals.get('date')) or rec.date,
                    vals.get('company_id') or rec.company_id.id,
                    exclude_id=rec.id)
        return super().write(vals)

    @api.model
    def is_public_holiday(self, check_date, company_id=None):
        """Check if a given date is a public holiday."""
        company_id = company_id or self.env.company.id
        return bool(self.search([
            ('date', '=', check_date),
            ('company_id', '=', company_id),
        ], limit=1))
