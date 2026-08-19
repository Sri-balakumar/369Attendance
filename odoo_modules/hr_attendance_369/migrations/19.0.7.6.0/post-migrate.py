"""Mark existing per-person records as such.

`config_scope` used to be a company-wide MODE, so a record created for one
employee was left at its 'global' default -- the field meant something else.
It now says who the record is for, and a row claiming 'global' while carrying
an employee is rejected by _check_scope_matches_employee and would group under
the wrong heading. Idempotent.
"""


def migrate(cr, version):
    if not version:
        return
    cr.execute("""
        UPDATE hr_employee_details_config
           SET config_scope = 'employee'
         WHERE employee_id IS NOT NULL
           AND config_scope != 'employee'
    """)
