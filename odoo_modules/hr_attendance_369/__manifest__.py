{
    'name': 'Attendance Suite (Late, Leave, WFH, Reports, Devices)',
    'version': '19.0.8.6.0',
    'category': 'Human Resources/Attendance',
    'summary': 'Late tracking & deductions, leave requests, work-from-home, '
               'monthly employee reports and device registration in one module',
    'description': """
        Attendance Suite
        ================
        Consolidates five previously separate addons into a single module:

        - **Attendance Grading** — configurable office hours and working days
          (company-wide or per-department), a late threshold, and a day-status
          ladder that grades every day Present / Late / Half Day / Absent from
          the arrival time and the hours worked. Late arrivals are recorded but
          not charged; only half days and unpaid leave carry a deduction.
          Late reasons, public holidays.
        - **Day Status & Absence** — one row per employee per day, with a cron
          that stamps absentees once the office passes the late window, and
          per-day deductions derived from the employee's monthly wage.
        - **Leave Requests** — manager approval workflow, leave types, paid/unpaid
          configuration, balance tracking, REST API for the mobile app.
        - **Auto-Approval** — an optional, configurable wait after which an
          unanswered leave or WFH request is approved by the system rather than
          left pending forever. Off until an admin turns it on.
        - **Work From Home** — request + approval. There is no separate WFH
          check-in: once a request is approved, the employee's ordinary
          attendance check-in records itself as WFH and closes the request on
          check-out.
        - **Employee Monthly Report** — day-wise attendance, late tracking, leave
          and deductions with PDF and Excel export.
        - **Employee Devices** — register mobile devices used for attendance
          verification.

        - **Employee Details** - salary breakup, statutory identifiers,
          bank branch details, extra personal/emergency fields and
          employment history. Every field ships switched OFF: an admin
          turns on only what the company keeps, either once for everyone
          or per employee, and staff fill in their own details from My
          Profile. Salary is never visible to the employee.

        Replaces: hr_attendance_late, hr_leave_request, hr_wfh_request,
        hr_employee_report, employee_device.
    """,
    'author': 'Alphalize Technologies',
    # No KRA dependency on purpose: this suite installs standalone. The
    # workday link lives in kra_kpi_attendance_bridge, which depends on both
    # and auto-installs only where both are present.
    'depends': ['base', 'web', 'hr', 'hr_attendance'],
    'external_dependencies': {
        'python': ['pytz', 'dateutil', 'xlsxwriter'],
    },
    'data': [
        # --- security (groups before ACLs before record rules) ---
        'security/attendance_groups.xml',
        'security/ir.model.access.csv',
        'security/security_rules.xml',
        # --- seed data (paper format must precede the reports that use it) ---
        'data/late_config_data.xml',
        'data/help_document_data.xml',
        'data/paper_format.xml',
        'data/absent_stamp_cron.xml',
        'data/auto_approve_cron.xml',
        'data/payslip_sequence.xml',
        'data/salary_component_data.xml',
        'data/statutory_id_type_data.xml',
        # --- wizards ---
        'wizard/late_reason_wizard_views.xml',
        'wizard/checkout_confirm_wizard_views.xml',
        # --- views (all actions defined here) ---
        'views/hr_attendance_views.xml',
        'views/late_config_views.xml',
        'views/public_holiday_views.xml',
        'views/late_summary_views.xml',
        'views/help_document_views.xml',
        'views/leave_config_views.xml',
        'views/auto_approve_config_views.xml',
        'views/leave_request_views.xml',
        'views/wfh_request_views.xml',
        'views/employee_device_views.xml',
        'views/hr_employee_views.xml',
        'views/employee_details_config_views.xml',
        'views/salary_component_views.xml',
        'views/statutory_id_type_views.xml',
        'views/hr_employee_payroll_views.xml',
        'views/res_partner_bank_views.xml',
        'views/res_users_views.xml',
        'views/attendance_day_status_views.xml',
        'views/employee_report_views.xml',
        'views/payslip_run_views.xml',
        'views/payslip_views.xml',
        # --- menu LAST: every menuitem references an action defined above ---
        'views/menu.xml',
        # --- reports ---
        'reports/late_attendance_report.xml',
        'reports/employee_report_pdf.xml',
        'reports/payslip_report.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'hr_attendance_369/static/src/views/**/*',
            'hr_attendance_369/static/src/help_guide/**/*',
        ],
    },
    'installable': True,
    'application': True,
    'auto_install': False,
    'license': 'LGPL-3',
}
