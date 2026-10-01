"""1.1.0 leaves Odoo's built-in Attendances menus alone. 1.0.0 had moved,
renamed or regrouped eight of them; put each back exactly as it was before
install, from the snapshot pre_init_hook saved.

Runs after menu_layout.xml has loaded and before Odoo deletes the folders that
file no longer declares, so the "Attendance" folder that held Management and
Kiosk Mode is already empty when it goes.
"""

import json
import logging

from odoo import SUPERUSER_ID, api

_logger = logging.getLogger(__name__)

PARAM = 'hr_attendance_369_menus.original_layout'
BUILT_IN = [
    'hr_attendance.menu_hr_attendance_view_attendances_management',
    'hr_attendance.menu_action_open_form',
    'hr_attendance.menu_hr_attendance_reporting',
    'hr_attendance.menu_hr_attendance_attendance_reporting',
    'hr_attendance.menu_hr_attendance_configuration',
    'hr_attendance.menu_hr_attendance_settings',
    'hr_attendance.menu_hr_attendance_onboarding',
    'hr_attendance.menu_hr_attendance_overtime_rulesets',
]


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    try:
        original = json.loads(env['ir.config_parameter'].sudo().get_param(PARAM) or '{}')
    except ValueError:
        original = {}
    restored = 0
    for xmlid in BUILT_IN:
        vals = original.get(xmlid)
        menu = env.ref(xmlid, raise_if_not_found=False)
        if not vals or not menu:
            continue
        menu.with_context(lang='en_US').write({
            'parent_id': vals['parent_id'],
            'sequence': vals['sequence'],
            'name': vals['name'],
            'group_ids': [(6, 0, vals['group_ids'])],
        })
        restored += 1
    _logger.info("Attendance menu layout: put %d built-in menus back", restored)
