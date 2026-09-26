from odoo import models, fields, api, exceptions
import logging

_logger = logging.getLogger(__name__)


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

    def _recompute_affected_leaves(self, dates, company_ids):
        """Make leaves spanning these dates recount their days.

        hr.leave.request.number_of_days counts WORKING days, so declaring,
        moving or deleting a holiday changes it. A holiday is not an ORM
        dependency of that compute -- nothing links them -- so without this the
        stored value would quietly stay wrong, and a leave over Holi would go
        on billing five days after Holi was declared.

        Only non-final requests are touched: a rejected or cancelled leave is
        history, and a confirmed payslip has already stored its own figures.
        """
        dates = sorted(d for d in dates if d)
        if not dates:
            return
        low, high = dates[0], dates[-1]

        Leave = self.env['hr.leave.request'].sudo()
        candidates = Leave.search([
            ('state', 'not in', ('rejected', 'cancelled')),
            ('from_date', '<=', high),
        ])
        # to_date is optional and means "this one day" (see _find_leave in
        # attendance_day_status), so the real end of the span has to be worked
        # out per record rather than in the domain.
        affected = candidates.filtered(
            lambda lv: lv.from_date
            and (lv.to_date or lv.from_date) >= low
            and lv.hr_employee_id.company_id.id in company_ids)
        if not affected:
            return

        # Same shape as hr.attendance.day.status.action_recompute: call the
        # compute, then flush, so dependent stored computes (paid/unpaid days
        # and the deduction) pick the new value up through the normal ORM
        # dependency chain.
        affected._compute_number_of_days()
        affected.flush_recordset()

    def _recompute_affected_day_status(self, dates, company_ids):
        """Re-grade the day rows on these dates, and their comp-off credits.

        A day row's status depends on whether the date is a working day, but a
        holiday is not an ORM dependency of that compute either. Without this,
        a holiday declared after the absent cron stamped the day leaves it
        Absent -- and the payslip charges loss of pay for a day that is not
        even in working_days -- while anybody who worked it earns no comp off.
        Moving a holiday away has the mirror problem: the day stays Day Off.
        """
        dates = sorted(set(d for d in dates if d))
        if not dates or not company_ids:
            return
        rows = self.env['hr.attendance.day.status'].sudo().search([
            ('date', 'in', dates),
            ('employee_id.company_id', 'in', list(company_ids)),
        ])
        if not rows:
            return
        rows._compute_status()
        rows.flush_recordset()

        Credit = self.env['hr.comp.off.credit']
        for row in rows:
            # Savepointed like the attendance upsert does: a credit problem
            # must never undo the holiday change or the re-grading.
            try:
                with self.env.cr.savepoint():
                    Credit._sync_for_day(row)
            except Exception:
                _logger.exception(
                    '[holiday] comp-off sync failed for day status %s', row.id)

    def _recompute_affected(self, dates, company_ids):
        self._recompute_affected_leaves(dates, company_ids)
        self._recompute_affected_day_status(dates, company_ids)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            self._raise_if_duplicate(
                fields.Date.to_date(vals.get('date')),
                vals.get('company_id') or self.env.company.id)
        records = super().create(vals_list)
        records._recompute_affected(
            records.mapped('date'), set(records.mapped('company_id').ids))
        return records

    def write(self, vals):
        if 'date' in vals or 'company_id' in vals:
            for rec in self:
                self._raise_if_duplicate(
                    fields.Date.to_date(vals.get('date')) or rec.date,
                    vals.get('company_id') or rec.company_id.id,
                    exclude_id=rec.id)
        # Both sides of a move matter: the day it stops being a holiday has to
        # recount too, not just the day it becomes one. Archiving via `active`
        # is a change of the same kind.
        touched = list(self.mapped('date'))
        companies = set(self.mapped('company_id').ids)
        result = super().write(vals)
        touched += list(self.mapped('date'))
        companies |= set(self.mapped('company_id').ids)
        self._recompute_affected(touched, companies)
        return result

    def unlink(self):
        touched = list(self.mapped('date'))
        companies = set(self.mapped('company_id').ids)
        result = super().unlink()
        self.browse()._recompute_affected(touched, companies)
        return result

    @api.model
    def is_public_holiday(self, check_date, company_id=None):
        """Check if a given date is a public holiday."""
        company_id = company_id or self.env.company.id
        return bool(self.search([
            ('date', '=', check_date),
            ('company_id', '=', company_id),
        ], limit=1))
