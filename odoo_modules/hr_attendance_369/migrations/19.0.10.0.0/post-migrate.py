"""Link existing comp-off leave to the credits that pay for it.

Before this version a comp-off leave request was paid out of a running sum:
earned credits minus the paid_days of pending and approved comp-off
requests. Nothing said WHICH day off a request spent. This version records
that in hr.comp.off.redemption lines, written when a request is submitted.

Requests already pending or approved when the upgrade runs have no lines.
This back-fills them, oldest request first, with the same allocation a new
submit would make (oldest expiry first, then oldest earned). A request the
credits can no longer cover is logged, not failed: its paid/unpaid split
stays as it was, and HR can see it in the log.

Then every credit is re-derived: one fully spent by approved leave becomes
Consumed. Existing Available credits are otherwise left exactly as they
are; they were earned under the old automatic rule and stay earned.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not version:
        return

    from odoo import api, SUPERUSER_ID

    env = api.Environment(cr, SUPERUSER_ID, {})
    Credit = env['hr.comp.off.credit']
    Line = env['hr.comp.off.redemption']

    leaves = env['hr.leave.request'].search([
        ('leave_type', '=', 'comp_off'),
        ('state', 'in', ('pending', 'approved')),
    ], order='id asc')

    linked = short = 0
    for leave in leaves:
        if leave.comp_off_redemption_ids:
            continue
        # Pay for what was already being paid for, no more: paid_days is
        # the covered part under the old rule.
        need = leave.paid_days or 0.0
        if need <= 0:
            continue
        plan, missing = Credit._plan_allocation(
            leave.hr_employee_id.id, need, exclude_request_id=leave.id)
        for credit, take in plan:
            Line.create({
                'credit_id': credit.id,
                'leave_request_id': leave.id,
                'days': take,
            })
        env.flush_all()
        linked += 1
        if missing > 0.001:
            short += 1
            _logger.warning(
                '[migration 10.0.0] %s: credits cover %s of %s day(s)',
                leave.display_name, need - missing, need)

    credits = Credit.search([])
    if credits:
        credits._compute_usage()
        env.flush_all()
        credits._refresh_state()
        env.flush_all()

    _logger.info(
        '[migration 10.0.0] linked %s comp-off request(s) to their credits; '
        '%s not fully covered; %s credit(s) now consumed',
        linked, short, len(credits.filtered(lambda c: c.state == 'consumed')))
