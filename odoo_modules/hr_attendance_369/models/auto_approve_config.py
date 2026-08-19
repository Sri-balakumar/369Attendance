from odoo import models, fields, api
from datetime import timedelta
import logging

_logger = logging.getLogger(__name__)

# How many minutes each unit is worth. Kept beside the Selection so the two
# cannot drift.
UNIT_MINUTES = {
    'minutes': 1,
    'hours': 60,
    'days': 60 * 24,
}


class RequestAutoApproveConfig(models.Model):
    """How long a request may sit unanswered before the system approves it.

    The rule is "no answer = approved". A manager who never looks at a request
    has not rejected it, and the employee cannot be left waiting forever --
    least of all for WFH, where an unapproved request means they cannot check
    in at all.

    One row per company, holding BOTH the leave and the WFH delay, because it
    is one policy decision: how long is a manager given to answer. The same
    screen is reachable from the Leave menu and the WFH menu.

    OFF BY DEFAULT, twice over: a database with no row here auto-approves
    nothing, and a row with the toggles unticked does nothing either. Auto-
    approving leave moves money (unpaid days are deducted), so it has to be a
    deliberate choice, never something that starts happening after an upgrade.
    """

    _name = 'hr.request.auto.approve.config'
    _description = 'Request Auto-Approval Configuration'
    _rec_name = 'display_name'

    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        required=True,
        index=True,
    )

    # ------------------------------------------------------------------ #
    # Leave                                                              #
    # ------------------------------------------------------------------ #
    leave_auto_approve = fields.Boolean(
        string='Auto-approve Leave Requests',
        default=False,
        help='When on, a leave request nobody has answered within the wait '
             'below is approved automatically.',
    )
    leave_delay_number = fields.Integer(
        string='Leave Wait',
        default=24,
        help='How long a manager is given to answer a leave request.',
    )
    leave_delay_unit = fields.Selection(
        [('minutes', 'Minutes'), ('hours', 'Hours'), ('days', 'Days')],
        string='Leave Wait Unit',
        default='hours',
        required=True,
    )
    leave_delay_minutes = fields.Integer(
        string='Leave Wait (Minutes)',
        compute='_compute_delay_minutes',
        store=True,
        help='The wait above expressed in minutes -- this is the figure the '
             'scheduled action actually uses. Shown so there is no doubt about '
             'what was configured.',
    )

    # ------------------------------------------------------------------ #
    # Work From Home                                                     #
    # ------------------------------------------------------------------ #
    wfh_auto_approve = fields.Boolean(
        string='Auto-approve WFH Requests',
        default=False,
        help='When on, a WFH request nobody has answered within the wait below '
             'is approved automatically. The employee can then check in with '
             'the ordinary attendance button, which records the day as WFH.',
    )
    wfh_delay_number = fields.Integer(
        string='WFH Wait',
        default=24,
        help='How long a manager is given to answer a WFH request.',
    )
    wfh_delay_unit = fields.Selection(
        [('minutes', 'Minutes'), ('hours', 'Hours'), ('days', 'Days')],
        string='WFH Wait Unit',
        default='hours',
        required=True,
    )
    wfh_delay_minutes = fields.Integer(
        string='WFH Wait (Minutes)',
        compute='_compute_delay_minutes',
        store=True,
    )

    active = fields.Boolean(default=True)

    display_name = fields.Char(
        string='Display Name',
        compute='_compute_display_name',
        store=True,
    )

    # Odoo 19 note: `_sql_constraints = [...]` is no longer supported (the ORM
    # logs "Model attribute '_sql_constraints' is no longer supported" and skips
    # it). models.Constraint is the replacement -- see public_holiday.py and
    # attendance_day_status.py, which hit exactly this.
    #
    # One row per company is load-bearing: with two rows the sweep would run
    # twice over the same requests with two different waits.
    _unique_company = models.Constraint(
        'UNIQUE(company_id)',
        'There is already an auto-approval configuration for this company.',
    )

    # ------------------------------------------------------------------ #
    # Computes                                                           #
    # ------------------------------------------------------------------ #
    @api.depends('company_id')
    def _compute_display_name(self):
        for rec in self:
            rec.display_name = '%s - Auto-Approval' % (
                rec.company_id.name or 'New')

    @api.depends('leave_delay_number', 'leave_delay_unit',
                 'wfh_delay_number', 'wfh_delay_unit')
    def _compute_delay_minutes(self):
        for rec in self:
            rec.leave_delay_minutes = max(0, rec.leave_delay_number or 0) * \
                UNIT_MINUTES.get(rec.leave_delay_unit, 60)
            rec.wfh_delay_minutes = max(0, rec.wfh_delay_number or 0) * \
                UNIT_MINUTES.get(rec.wfh_delay_unit, 60)

    # ------------------------------------------------------------------ #
    # Lookup                                                             #
    # ------------------------------------------------------------------ #
    @api.model
    def get_config_for_company(self, company_id=None):
        """Settings for a company, as a plain dict. Callable from the app.

        Returns everything switched OFF when no row exists, so a caller can
        read this without first checking whether anything is configured.
        """
        company_id = company_id or self.env.company.id
        config = self.sudo().search([('company_id', '=', company_id)], limit=1)
        if not config:
            return {
                'leave_auto_approve': False,
                'leave_delay_minutes': 0,
                'wfh_auto_approve': False,
                'wfh_delay_minutes': 0,
            }
        return {
            'id': config.id,
            'leave_auto_approve': config.leave_auto_approve,
            'leave_delay_minutes': config.leave_delay_minutes,
            'wfh_auto_approve': config.wfh_auto_approve,
            'wfh_delay_minutes': config.wfh_delay_minutes,
        }

    # ------------------------------------------------------------------ #
    # The sweep                                                          #
    # ------------------------------------------------------------------ #
    @api.model
    def _cron_auto_approve_requests(self):
        """Approve every request nobody answered in time.

        One scheduled action for both features: they share a policy, a config
        row and a code path -- the only difference is which model is swept and
        which pair of settings applies.

        Returns the number of requests approved (handy from the Odoo shell).
        """
        now = fields.Datetime.now()
        total = 0

        for cfg in self.sudo().search([]):
            if cfg.leave_auto_approve:
                total += cfg._sweep('hr.leave.request', cfg.leave_delay_minutes, now)
            if cfg.wfh_auto_approve:
                total += cfg._sweep('hr.wfh.request', cfg.wfh_delay_minutes, now)

        if total:
            _logger.info("[auto-approve] approved %s pending request(s)", total)
        return total

    def _sweep(self, model_name, delay_minutes, now):
        """Approve the overdue pending requests of one model, for this company.

        Returns how many were approved.
        """
        self.ensure_one()
        if delay_minutes <= 0:
            # A zero wait would approve everything the instant it is submitted,
            # which is indistinguishable from having no approval step at all.
            # Treated as "not configured yet" rather than "approve instantly".
            return 0

        cutoff = now - timedelta(minutes=delay_minutes)
        pending = self.env[model_name].sudo().search([
            ('state', '=', 'pending'),
            ('hr_employee_id.company_id', '=', self.company_id.id),
        ])

        approved = 0
        for rec in pending:
            # create_date is the fallback for rows that predate `submitted_on`,
            # and for any path that writes state = pending directly.
            submitted = rec.submitted_on or rec.create_date
            if not submitted or submitted > cutoff:
                continue
            try:
                # A savepoint per record: one request that cannot be approved
                # (a validation raised from a compute, a record rule) must not
                # abort the transaction and take everybody behind it down too.
                with self.env.cr.savepoint():
                    rec.action_auto_approve()
                    approved += 1
            except Exception:
                _logger.exception(
                    "[auto-approve] could not approve %s %s", model_name, rec.id)

        if approved:
            _logger.info(
                "[auto-approve] %s: %s request(s) approved for %s "
                "(waited more than %s minutes)",
                model_name, approved, self.company_id.name, delay_minutes)
        return approved
