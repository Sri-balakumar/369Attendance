from odoo import http, fields
from odoo.http import request
import logging

_logger = logging.getLogger(__name__)


def _my_employee():
    """The caller's hr.employee, resolved from the session and nothing else.

    None of these routes takes an employee or user id: every one of them acts
    on the signed-in person only, so there is nothing to spoof. The lookup is
    sudo'd for the same reason leave_api's is -- hr.employee has no
    base.group_user ACL in Odoo 19 -- and nothing it returns reaches the
    caller except through the payloads built below.
    """
    return request.env['hr.employee'].sudo().search(
        [('user_id', '=', request.env.user.id)], limit=1)


NO_EMPLOYEE = {
    'status': False,
    'message': 'No employee record is linked to this user. Please contact HR.',
}


class CompOffAPI(http.Controller):
    """Compensatory off for the mobile app.

    FLOW:
    1. On a weekly off or public holiday, check-in is refused until the
       employee declares the day:  POST /comp_off/today_status  tells the app
       which state to draw, and  POST /comp_off/declare  unlocks the day.
    2. The ordinary check-in / check-out follows. The check-out sizes the
       credit: a full day or a half, from the hours worked.
    3. Filing leave of type comp_off:  POST /comp_off/preview  shows which
       earned days the request will draw on; /leave/request/create then
       reserves exactly those.

    Envelope matches leave_api: `status` flag, `message` on failure, HTTP 200
    always, and a rollback before answering on any error.
    """

    @http.route('/comp_off/today_status', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def today_status(self, **params):
        try:
            employee = _my_employee()
            if not employee:
                return NO_EMPLOYEE
            data = request.env['hr.comp.off.credit']._today_status_for(employee)
            return dict(data, status=True)
        except Exception as e:
            request.env.cr.rollback()
            _logger.error('[Comp Off API] today_status error: %s', e)
            return {'status': False, 'message': str(e)}

    @http.route('/comp_off/declare', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def declare(self, **params):
        """'I am working today'. Idempotent: a second tap returns the same row."""
        try:
            employee = _my_employee()
            if not employee:
                return NO_EMPLOYEE
            Credit = request.env['hr.comp.off.credit']
            note = (params.get('note') or '').strip() or False
            credit = Credit.declare_for_today(employee, note=note)
            return {
                'status': True,
                'message': 'Today is marked as a working day. You can check in now.',
                'declaration': credit._payload(),
                'today': Credit._today_status_for(employee),
            }
        except Exception as e:
            request.env.cr.rollback()
            _logger.error('[Comp Off API] declare error: %s', e)
            return {'status': False, 'message': str(e)}

    @http.route('/comp_off/withdraw', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def withdraw(self, **params):
        """'Not working after all' -- only before the first check-in."""
        try:
            employee = _my_employee()
            if not employee:
                return NO_EMPLOYEE
            Credit = request.env['hr.comp.off.credit']
            Credit.withdraw_declaration(employee)
            return {
                'status': True,
                'message': 'Declaration removed.',
                'today': Credit._today_status_for(employee),
            }
        except Exception as e:
            request.env.cr.rollback()
            _logger.error('[Comp Off API] withdraw error: %s', e)
            return {'status': False, 'message': str(e)}

    @http.route('/comp_off/preview', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def preview(self, **params):
        """Which earned days a comp-off leave over these dates would use."""
        try:
            employee = _my_employee()
            if not employee:
                return NO_EMPLOYEE
            from_date = params.get('from_date')
            if not from_date:
                return {'status': False, 'message': 'From date is required'}
            data = request.env['hr.comp.off.credit'].preview_redemption(
                employee, from_date,
                to_date=params.get('to_date') or False,
                is_half_day=bool(params.get('is_half_day')))
            return dict(data, status=True)
        except Exception as e:
            request.env.cr.rollback()
            _logger.error('[Comp Off API] preview error: %s', e)
            return {'status': False, 'message': str(e)}

    @http.route('/comp_off/my_credits', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def my_credits(self, **params):
        """The caller's own credits, newest first, with what spent them."""
        try:
            employee = _my_employee()
            if not employee:
                return NO_EMPLOYEE
            domain = [('employee_id', '=', employee.id)]
            state = params.get('state')
            if state:
                domain.append(('state', '=', state))
            Credit = request.env['hr.comp.off.credit']
            credits = Credit.sudo().search(domain, limit=100)
            balance = Credit.sudo().get_comp_off_balance(employee.id)
            return {
                'status': True,
                'balance': balance,
                'data': [c._payload() for c in credits],
            }
        except Exception as e:
            request.env.cr.rollback()
            _logger.error('[Comp Off API] my_credits error: %s', e)
            return {'status': False, 'message': str(e)}
