{
    'name': 'Attendance: WhatsApp Group Roll Call',
    'version': '19.0.1.0.0',
    'category': 'Human Resources/Attendance',
    'summary': 'Posts "@Employee present 9:30 AM" to a WhatsApp group on the '
               'first check-in of the day',
    'description': """
        WhatsApp Group Roll Call
        ========================

        When an employee makes their first check-in of the day - from the
        369Attendance app, the KRA board's Start Workday (through the bridge),
        a WFH check-in or the backend - one line goes to a chosen WhatsApp
        group, tagging them:

            @Employee present 9:30 AM

        Sent through an Evolution API gateway (the same panel the sales
        automation modules use), with its own small client rather than a
        dependency on whatsapp_gateway: that module and whatsapp_neonize both
        define whatsapp.session, so they cannot share a database, and KRA needs
        neonize.

        Configure under Attendances > Attendance Status > Configuration >
        WhatsApp Group: paste the setup key, choose the group, send a test,
        then tick Enabled. Ships switched off.
    """,
    'author': 'Alphalize Technologies',
    'depends': ['hr_attendance_369'],
    'external_dependencies': {
        'python': ['pytz', 'requests'],
    },
    'data': [
        'security/ir.model.access.csv',
        'data/wa_cron.xml',
        'views/wa_group_picker_views.xml',
        'views/wa_config_views.xml',
        'views/hr_attendance_views.xml',
        'views/menu.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
    'license': 'LGPL-3',
}
