from odoo import http
from odoo.http import request

from odoo.addons.kra_kpi_module.controllers.kra_api import KraKpiAPI

from ..models.res_users_hr_role import HR_ROLE_GROUP_XMLIDS, KRA_ROLE_GROUP_XMLIDS


class KraKpiAPIHrRole(KraKpiAPI):
    """Serve the HR role to KRA's Login Management screen.

    Subclassing the KRA controller is the sanctioned way to change a route's
    behaviour without touching the module that owns it: the subclass is
    registered after the parent, so its routes win. Two things change, both
    additive:

      * `_kra_role_of` answers 'hr' for a user carrying the HR groups, so the
        user list shows HR beside Admin / User / Client;
      * `set_role` accepts role='hr', moving the user into the attendance HR
        groups and out of the KRA role groups -- the mirror of what picking a
        KRA role does.

    Everything else -- authorization, the super-admin guard, every other
    route -- is inherited untouched.
    """

    def _kra_role_of(self, user):
        role = super()._kra_role_of(user)
        if role != 'admin' and (user.has_group('hr.group_hr_user')
                                or user.has_group('hr.group_hr_manager')):
            return 'hr'
        return role

    @http.route('/kpi_user_access/set_role', type='json', auth='user',
                methods=['POST'], csrf=False)
    def user_access_set_role(self, **params):
        role = params.get('role')
        if role != 'hr':
            # A KRA role: strip the HR groups first so the dropdown stays
            # exclusive, then hand over to KRA's own logic untouched.
            result = super().user_access_set_role(**params)
            if result.get('status'):
                user = request.env['res.users'].sudo().browse(
                    int(params.get('user_id') or 0))
                if user.exists() and not user.has_group('base.group_system'):
                    ref = request.env.ref
                    cmds = []
                    for xmlid in HR_ROLE_GROUP_XMLIDS:
                        grp = ref(xmlid, raise_if_not_found=False)
                        if grp and user.has_group(xmlid):
                            cmds.append((3, grp.id))
                    if cmds:
                        user.sudo().write({'group_ids': cmds})
                    result['role'] = self._kra_role_of(user)
            return result

        # role == 'hr': same checks as the parent route, then our own move.
        if not self._is_kra_admin(request.env.user):
            return {'status': False, 'message': 'Not authorized'}
        user = request.env['res.users'].sudo().browse(
            int(params.get('user_id') or 0))
        if not user.exists():
            return {'status': False, 'message': 'User not found'}
        if user.has_group('base.group_system'):
            return {'status': False,
                    'message': "The Odoo administrator's role can't be changed here."}
        ref = request.env.ref
        cmds = []
        for xmlid in KRA_ROLE_GROUP_XMLIDS:
            grp = ref(xmlid, raise_if_not_found=False)
            if grp:
                cmds.append((3, grp.id))
        for xmlid in HR_ROLE_GROUP_XMLIDS:
            grp = ref(xmlid, raise_if_not_found=False)
            if grp:
                cmds.append((4, grp.id))
        user.sudo().write({'group_ids': cmds})
        return {'status': True, 'role': self._kra_role_of(user)}
