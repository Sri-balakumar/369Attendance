from odoo import http
from odoo.http import request
import logging

_logger = logging.getLogger(__name__)


def _is_leave_manager():
    """Leave Manager or system admin — mirrors the check used in wfh_api."""
    user = request.env.user
    return (user.has_group('hr_attendance_369.group_leave_manager')
            or user.has_group('base.group_system'))


def _resolve_user_id(params):
    """Whose leave this call is about.

    Anyone may name themselves; only a leave manager may name somebody else.
    Returns (user_id, error) -- when error is not None it is a ready-to-return
    envelope and user_id must not be used.

    This mirrors the ownership test already in cancel_request(): the API
    refuses with a message in its own envelope rather than silently
    redirecting the caller to their own data, and rather than letting an
    AccessError surface a record-rule name to the client.

    The int() matters as much as the group check does: the value ends up in a
    domain and in a search on hr.employee, and a Many2one compared against a
    string is name-matched rather than id-matched.
    """
    requested = params.get('user_id')
    if requested in (None, '', False):
        return request.env.user.id, None
    try:
        requested = int(requested)
    except (TypeError, ValueError):
        return None, {'status': False, 'message': 'Invalid user_id.'}
    if requested != request.env.user.id and not _is_leave_manager():
        return None, {
            'status': False,
            'message': 'You can only act on your own leave requests.',
        }
    return requested, None


class LeaveAPI(http.Controller):
    """JSON-RPC endpoints consumed by the mobile app.

    Odoo 19 note: these routes previously read their payload via
    `request.jsonrequest`, an attribute removed in Odoo 17. Every route
    therefore raised AttributeError and returned {'status': False} — the whole
    API was dead. They now take the payload directly through **params, the same
    way wfh_api.py does.
    """

    @http.route('/leave/request/create', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def create_leave_request(self, **params):
        """Employee submits a new leave request."""
        try:
            user_id, error = _resolve_user_id(params)
            if error:
                return error
            leave_type = params.get('leave_type', 'casual')
            from_date = params.get('from_date')
            to_date = params.get('to_date') or False
            reason = params.get('reason', '')

            if not from_date:
                return {'status': False, 'message': 'From date is required'}
            if not reason:
                return {'status': False, 'message': 'Reason is required'}

            # This lookup stays sudo'd. hr.employee has no base.group_user ACL
            # row at all in Odoo 19, and the hr.employee.public fallback raises
            # as soon as a read touches a non-public field. It is scoped to one
            # search and nothing it returns reaches the caller.
            employee = request.env['hr.employee'].sudo().search(
                [('user_id', '=', user_id)], limit=1)
            if not employee:
                return {
                    'status': False,
                    'message': 'No employee record is linked to this user. '
                               'Please contact HR.',
                }

            # hr_employee_id is the settable link -- employee_user_id is a
            # stored readonly related on it, so writing that instead silently
            # did nothing and left these requests unlinked from any employee.
            #
            # NOT sudo: that stored related is exactly what makes the record
            # rule work. create() ends with check_access('create'), which
            # forces employee_user_id to compute before the rule domain is
            # evaluated, so an employee cannot file for a colleague. The
            # computes it needs are compute_sudo by default and still reach
            # the employee's company and wage.
            leave = request.env['hr.leave.request'].create({
                'hr_employee_id': employee.id,
                'leave_type': leave_type,
                'from_date': from_date,
                'to_date': to_date,
                'reason': reason,
            })

            # Auto-submit for approval
            leave.action_submit()

            return {
                'status': True,
                'message': 'Leave request submitted successfully',
                'data': {
                    'id': leave.id,
                    'state': leave.state,
                }
            }
        except Exception as e:
            _logger.error('[Leave API] Create error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/my_requests', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def get_my_requests(self, **params):
        """Get employee's own leave requests."""
        try:
            user_id, error = _resolve_user_id(params)
            if error:
                return error
            state_filter = params.get('state_filter')

            # NOT sudo. The record rule scopes the search to the caller's own
            # requests, so even a mistake in the check above cannot leak a
            # colleague's reason or rejection_reason.
            data = request.env['hr.leave.request'].get_my_leave_requests(
                user_id=user_id, state_filter=state_filter
            )
            return {'status': True, 'data': data}
        except Exception as e:
            _logger.error('[Leave API] My requests error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/pending', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def get_pending_requests(self, **params):
        """Manager gets all pending requests for approval."""
        try:
            if not _is_leave_manager():
                return {'status': False,
                        'message': 'Only leave managers/admins can view pending requests.'}
            data = request.env['hr.leave.request'].sudo().get_pending_requests_for_approval()
            return {'status': True, 'data': data}
        except Exception as e:
            _logger.error('[Leave API] Pending requests error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/approve', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def approve_request(self, **params):
        """Manager approves a leave request."""
        try:
            if not _is_leave_manager():
                return {'status': False,
                        'message': 'Only leave managers/admins can approve leave requests.'}

            request_id = params.get('request_id')
            if not request_id:
                return {'status': False, 'message': 'Request ID is required'}

            leave = request.env['hr.leave.request'].sudo().browse(int(request_id))
            if not leave.exists():
                return {'status': False, 'message': 'Request not found'}

            leave.action_approve()
            return {'status': True, 'message': 'Leave request approved'}
        except Exception as e:
            _logger.error('[Leave API] Approve error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/reject', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def reject_request(self, **params):
        """Manager rejects a leave request."""
        try:
            if not _is_leave_manager():
                return {'status': False,
                        'message': 'Only leave managers/admins can reject leave requests.'}

            request_id = params.get('request_id')
            rejection_reason = params.get('rejection_reason', '')

            if not request_id:
                return {'status': False, 'message': 'Request ID is required'}

            leave = request.env['hr.leave.request'].sudo().browse(int(request_id))
            if not leave.exists():
                return {'status': False, 'message': 'Request not found'}

            leave.action_reject()
            if rejection_reason:
                leave.write({'rejection_reason': rejection_reason})

            return {'status': True, 'message': 'Leave request rejected'}
        except Exception as e:
            _logger.error('[Leave API] Reject error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/cancel', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def cancel_request(self, **params):
        """Employee cancels a leave request."""
        try:
            request_id = params.get('request_id')

            if not request_id:
                return {'status': False, 'message': 'Request ID is required'}

            leave = request.env['hr.leave.request'].sudo().browse(int(request_id))
            if not leave.exists():
                return {'status': False, 'message': 'Request not found'}

            # Employees may cancel their own request; managers may cancel any.
            if leave.employee_user_id.id != request.env.user.id and not _is_leave_manager():
                return {'status': False,
                        'message': 'You can only cancel your own leave requests.'}

            leave.action_cancel()
            return {'status': True, 'message': 'Leave request cancelled'}
        except Exception as e:
            _logger.error('[Leave API] Cancel error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/report', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def get_leave_report(self, **params):
        """Get leave report with filters."""
        try:
            data = request.env['hr.leave.request'].sudo().get_leave_report(
                employee_id=params.get('employee_id'),
                department_id=params.get('department_id'),
                date_from=params.get('date_from'),
                date_to=params.get('date_to'),
                state_filter=params.get('state_filter'),
            )
            return {'status': True, 'data': data}
        except Exception as e:
            _logger.error('[Leave API] Report error: %s', str(e))
            return {'status': False, 'message': str(e)}
