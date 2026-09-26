"""Recount existing leave requests in WORKING days, and re-grade days off.

Two stored values changed meaning in this version, and neither recomputes on
its own:

1. `hr.leave.request.number_of_days` used to count calendar days, so a leave
   running across a Sunday or a public holiday charged those days too. It now
   counts only days the employee owed attendance on. The compute cannot depend
   on hr.public.holiday, so nothing would revisit the stored value.

2. `hr.attendance.day.status.status` gained `day_off`. Rows already on disk for
   weekly offs and public holidays still read `half_day`, `present` or even
   `absent`, and a stored `half_day` on a rest day is what used to cost half a
   day of pay through the payslip.

WHAT THIS DELIBERATELY DOES NOT TOUCH:

  * rejected and cancelled leave, which is history;
  * payslips, which store their own figures at generation time, so anything
    already confirmed keeps the numbers it was confirmed with.

Recomputing IS a change to live figures: a leave over Holi that charged five
days will now charge three, and an employee's paid-leave quota will show the
difference. That is the point of the change, but it is worth knowing it lands
the moment this runs.

Compensatory offs are NOT back-filled for historical rest days that were worked.
Granting hundreds of credits for days nobody expected to be paid back for is a
decision for the company, not for a migration. New credits start from the first
check-in after the upgrade.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not version:
        return

    from odoo import api, SUPERUSER_ID

    env = api.Environment(cr, SUPERUSER_ID, {})

    # --- 1. day statuses -------------------------------------------------
    # Every row, not just the suspicious ones: `day_off` is decided by the
    # working-days config and the holiday table, neither of which is readable
    # from SQL here, so the compute itself has to make the call.
    day_status = env['hr.attendance.day.status'].search([])
    if day_status:
        day_status._compute_status()
        day_status.flush_recordset()
        off = day_status.filtered(lambda r: r.status == 'day_off')
        _logger.info(
            '[migration 9.0.0] re-graded %s day status row(s); %s are now Day Off',
            len(day_status), len(off))

    # --- 2. leave requests ----------------------------------------------
    leaves = env['hr.leave.request'].search([
        ('state', 'not in', ('rejected', 'cancelled')),
    ])
    if not leaves:
        return

    before = {lv.id: lv.number_of_days for lv in leaves}
    leaves._compute_number_of_days()
    leaves.flush_recordset()

    # paid/unpaid and the deduction all hang off number_of_days, so they have
    # to follow it rather than be left describing the old figure.
    leaves._compute_paid_status()
    leaves.flush_recordset()

    changed = [lv for lv in leaves if lv.number_of_days != before.get(lv.id)]
    _logger.info(
        '[migration 9.0.0] recounted %s leave request(s); %s changed',
        len(leaves), len(changed))
    for lv in changed:
        _logger.info(
            '[migration 9.0.0]   %s: %s -> %s day(s)',
            lv.display_name, before.get(lv.id), lv.number_of_days)
