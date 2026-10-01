"""Remember the original menus before install; put them back on uninstall.

The new folders this module adds hold menus that belong to other modules, and
ir.ui.menu.parent_id is ondelete="restrict": a plain uninstall would fail on
deleting a folder that still has children. Upgrading those modules is no way
back either - it upgrades this one too (it depends on them) and re-applies the
layout. So the original parent, order, name and groups of every menu touched
are saved just before the layout is loaded, and written back on uninstall,
before Odoo removes this module's own folders.
"""

import json
import logging

_logger = logging.getLogger(__name__)

PARAM = 'hr_attendance_369_menus.original_layout'

# Every existing menu that menu_layout.xml moves, renames or regroups. Only
# custom ones: Odoo's built-in menus are left as shipped. (A database that had
# 1.0.0 also has the built-in ones in its saved snapshot; restoring those on
# uninstall writes back what they already are.)
TOUCHED = [
    'hr_attendance_369.menu_attendance_day_status',
    'hr_attendance_369.menu_attendance_absent_today',
    'hr_attendance_369.menu_late_attendance_records',
    'hr_attendance_369.menu_late_summary',
    'hr_attendance_369.menu_late_config_settings',
    'hr_attendance_369.menu_public_holidays',
    'hr_attendance_369.menu_employee_devices_root',
    'hr_attendance_369.menu_leave_all_requests',
    'hr_attendance_369.menu_my_leave_requests',
    'hr_attendance_369.menu_approved_leaves_report',
    'hr_attendance_369.menu_comp_off_credits',
    'hr_attendance_369.menu_leave_balances',
    'hr_attendance_369.menu_leave_policy_config',
    'hr_attendance_369.menu_leave_auto_approve_config',
    'hr_attendance_369.menu_wfh_all_requests',
    'hr_attendance_369.menu_my_wfh_requests',
    'hr_attendance_369.menu_wfh_auto_approve_config',
    'hr_attendance_369.menu_employee_details_config',
    'hr_attendance_369.menu_salary_component',
    'hr_attendance_369.menu_statutory_id_type',
    'hr_attendance_369.menu_payroll_root',
    'hr_attendance_369.menu_employee_report_generate',
    'hr_attendance_369.menu_employee_report_browse',
    'hr_attendance_369.menu_help_document',
    'hr_attendance_369_whatsapp.menu_wa_config',
]


def pre_init_hook(env):
    original = {}
    for xmlid in TOUCHED:
        menu = env.ref(xmlid, raise_if_not_found=False)
        if not menu:
            continue
        original[xmlid] = {
            'parent_id': menu.parent_id.id or False,
            'sequence': menu.sequence,
            'name': menu.with_context(lang='en_US').name,
            'group_ids': menu.group_ids.ids,
        }
    env['ir.config_parameter'].sudo().set_param(PARAM, json.dumps(original))
    _logger.info("Attendance menu layout: saved the original place of %d menus",
                 len(original))


def uninstall_hook(env):
    Param = env['ir.config_parameter'].sudo()
    try:
        original = json.loads(Param.get_param(PARAM) or '{}')
    except ValueError:
        original = {}
    restored = 0
    for xmlid, vals in original.items():
        menu = env.ref(xmlid, raise_if_not_found=False)
        if not menu:
            continue
        menu.with_context(lang='en_US').write({
            'parent_id': vals['parent_id'],
            'sequence': vals['sequence'],
            'name': vals['name'],
            'group_ids': [(6, 0, vals['group_ids'])],
        })
        restored += 1
    Param.search([('key', '=', PARAM)]).unlink()
    _logger.info("Attendance menu layout: put %d menus back", restored)
