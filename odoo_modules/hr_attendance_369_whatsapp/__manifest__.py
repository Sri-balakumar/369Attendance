{
    'name': 'Attendance: WhatsApp Group Roll Call',
    'version': '19.0.1.5.1',
    'category': 'Human Resources/Attendance',
    'summary': 'Posts "@Employee checked in at 9:30 AM" to a WhatsApp group on '
               'the first check-in of the day, and a daily attendance summary '
               'to chosen numbers',
    'description': """
        WhatsApp Group Roll Call
        ========================

        When an employee makes their first check-in of the day - from the
        369Attendance app, the KRA board's Start Workday (through the bridge),
        a WFH check-in or the backend - one line goes to a chosen WhatsApp
        group, tagging them:

            @Employee checked in at 9:30 AM

        The words in the middle are typed on the settings form (Message), with
        a Reset to default button.

        A daily summary - who is present, on leave and absent today - can be
        sent privately to a list of WhatsApp numbers at a set time.

        Sent by default through the WhatsApp number connected inside Odoo
        (WhatsApp > Sessions, the whatsapp_neonize connection KRA posts its
        group reports with). That needs KRA's group support and is detected
        at runtime, so it is not a dependency.

        The alternative is an Evolution API gateway (the same panel the sales
        automation modules use), with its own small client rather than a
        dependency on whatsapp_gateway: that module and whatsapp_neonize both
        define whatsapp.session, so they cannot share a database, and KRA needs
        neonize.

        Configure under Attendances > Attendance Status > Configuration >
        WhatsApp Group: press Connect WhatsApp and scan the QR shown there
        (the phone lists the link as "Alphalize Attendance"), check the group
        (it starts as KRA's report group), send a test, then tick Enabled.
        Ships switched off.
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
    'assets': {
        'web.assets_backend': [
            'hr_attendance_369_whatsapp/static/src/js/wa_qr_refresh.js',
        ],
    },
    'installable': True,
    'application': False,
    'auto_install': False,
    'license': 'LGPL-3',
}
