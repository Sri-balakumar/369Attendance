"""Link existing per-employee overrides to their company record.

parent_config_id is new in 19.0.7.5.0. It is what puts an override in the
Exceptions list on the company's settings form, so a row created before this
version would otherwise still exist, still apply, and yet be invisible in the
only screen that now manages them.
"""


def migrate(cr, version):
    if not version:
        return
    cr.execute("""
        UPDATE hr_employee_details_config AS override
           SET parent_config_id = company_config.id
          FROM hr_employee_details_config AS company_config
         WHERE override.employee_id IS NOT NULL
           AND override.parent_config_id IS NULL
           AND company_config.employee_id IS NULL
           AND company_config.company_id = override.company_id
    """)
