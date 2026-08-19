"""Drop the tables left behind by the removed slab and waiver models.

Odoo drops a model's TABLE only on a real uninstall, never on an upgrade. When
hr.late.deduction.slab and hr.late.waiver.request were deleted from the code,
the upgrade cleaned every metadata row (ir_model, ir_model_fields,
ir_model_data) and dropped the columns of removed fields -- but both tables
survived, holding data nothing can reach any more.

THE GUARD IS NOT DECORATIVE. Both model names are ALSO defined by the legacy
`hr_attendance_late` module, which is still on disk and is installed and live on
at least one database on this server, with real rows behind those tables. A
blind DROP would destroy working data there. So a table is dropped only when no
live model claims it, checked against ir_model at run time.

Deliberately no CASCADE: nothing references either table today, and if something
unexpectedly did, this should fail loudly rather than quietly take dependent
objects with it.
"""
import logging

_logger = logging.getLogger(__name__)

# (model name, table name) for every model this module has deleted
ORPHANS = (
    ('hr.late.deduction.slab', 'hr_late_deduction_slab'),
    ('hr.late.waiver.request', 'hr_late_waiver_request'),
)


def migrate(cr, version):
    if not version:
        # Fresh install: there is no legacy table to clean up.
        return

    for model, table in ORPHANS:
        cr.execute("SELECT 1 FROM ir_model WHERE model = %s", (model,))
        if cr.fetchone():
            _logger.info(
                "[cleanup] %s is still a live model on this database -- leaving "
                "table %s alone (the legacy hr_attendance_late module is "
                "probably installed alongside us)", model, table)
            continue

        cr.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name = %s",
            (table,))
        if not cr.fetchone():
            _logger.info("[cleanup] table %s already gone", table)
            continue

        cr.execute('SELECT COUNT(*) FROM "%s"' % table)
        rows = cr.fetchone()[0]
        cr.execute('DROP TABLE IF EXISTS "%s"' % table)
        _logger.info(
            "[cleanup] dropped orphaned table %s (%s row(s)) -- model %s no "
            "longer exists", table, rows, model)
