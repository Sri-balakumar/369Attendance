{
    'name': 'Attendance: Menu Layout',
    'version': '19.0.1.1.1',
    'category': 'Human Resources/Attendance',
    'summary': 'Groups the custom Attendances screens into their own menus, '
               'leaving Odoo\'s built-in menus as shipped',
    'description': """
        Attendance Menu Layout
        ======================

        The custom (369) screens were spread over eight top-level menus, with
        settings in several places and reports in several more. This groups
        them into menus of their own, next to Odoo's built-in ones:

            Built-in (untouched)  Overview · Management · Kiosk Mode ·
                                  Reporting · Configuration
            Custom                Attendance Status · Requests · Payroll ·
                                  HR Reports · Setup · Help

        Odoo's built-in menus are not moved, renamed or mixed with custom
        screens. Only the custom menus move; every screen keeps its own access
        rules, so each person sees the same screens as before. Nothing is
        deleted; folders left empty are hidden by Odoo by themselves.

        Kept apart from hr_attendance_369 so the layout can go live without
        upgrading that module. Upgrading it re-applies this layout, since this
        module depends on it. Uninstalling puts every menu back where it was
        (see hooks.py).
    """,
    'author': 'Alphalize Technologies',
    'depends': ['hr_attendance_369', 'hr_attendance_369_whatsapp'],
    'data': [
        'views/menu_layout.xml',
    ],
    'pre_init_hook': 'pre_init_hook',
    'uninstall_hook': 'uninstall_hook',
    'installable': True,
    'application': False,
    'auto_install': False,
    'license': 'LGPL-3',
}
