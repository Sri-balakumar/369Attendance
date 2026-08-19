# Import order matters: shared helpers first, then the configuration models
# that hr_attendance reads during its compute chain, then the request models,
# and finally employee_report which aggregates across all of them.
from . import time_utils
from . import attendance_late_config
from . import attendance_day_status
from . import public_holiday
from . import hr_attendance
# Employee Details: the config and the two masters load before
# hr_employee, which reads them, and before the line models that point
# at them -- same rule the ordering comment at the top of this file sets.
from . import employee_details_config
from . import salary_component
from . import statutory_id_type
from . import hr_employee
from . import employee_salary_line
from . import employee_statutory_id
from . import employee_previous_employment
from . import employee_qualification
from . import res_partner_bank
from . import res_users
from . import employee_device
from . import attendance_late_summary
from . import help_document
from . import leave_config
from . import auto_approve_config
from . import leave_request
from . import wfh_request
from . import employee_report
# Payroll: the line model is imported before the payslip that owns it, and
# the run last, matching the ordering rule at the top of this file.
from . import num_to_words
from . import payslip_line
from . import payslip
from . import payslip_run
