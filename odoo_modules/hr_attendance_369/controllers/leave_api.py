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
            # Half a day is one date by definition; a to_date would only
            # confuse the day count.
            is_half_day = bool(params.get('is_half_day'))
            if is_half_day:
                to_date = False

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
                'is_half_day': is_half_day,
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
            # Roll back before answering.
            #
            # create() and action_submit() share this try, and the overlap
            # constraint fires on flush -- after the row exists. Catching that
            # and returning status:False without a rollback still leaves the
            # row committed when the HTTP response succeeds, so a REJECTED
            # submit silently produced a stray draft. Worse, the overlap check
            # counts draft rows, so that ghost then blocked the very dates the
            # person was told they could not have.
            request.env.cr.rollback()
            _logger.error('[Leave API] Create error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/preview_mail', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def preview_mail(self, **params):
        """The HR alert for a request that does not exist yet.

        Builds an UNSAVED request from what the employee has entered and returns
        the email's subject and rows, from the same code the real email is made
        of. Nothing is written. Recipients go back as a count only: the employee
        needs to know HR is told, not who is on the list.
        """
        try:
            user_id, error = _resolve_user_id(params)
            if error:
                return error
            employee = request.env['hr.employee'].sudo().search(
                [('user_id', '=', user_id)], limit=1)
            if not employee:
                return {'status': False,
                        'message': 'No employee record is linked to this user. Please contact HR.'}
            cfg = request.env['hr.leave.config'].sudo().search(
                [('company_id', '=', employee.company_id.id)], limit=1)
            recipients = cfg._get_notify_emails() if cfg else []
            if params.get('sample'):
                from datetime import date, timedelta
                today = date.today()
                vals = {'leave_type': 'casual',
                        'from_date': today + timedelta(days=(7 - today.weekday()) or 7),
                        'reason': 'Sample reason, as the employee types it.'}
            else:
                is_half = bool(params.get('is_half_day'))
                vals = {
                    'leave_type': params.get('leave_type') or 'casual',
                    'from_date': params.get('from_date') or False,
                    'to_date': (False if is_half else params.get('to_date')) or False,
                    'is_half_day': is_half,
                    'reason': params.get('reason') or '',
                }
            # sudo only to build an unsaved record for the caller's own
            # employee; it is never flushed.
            draft = request.env['hr.leave.request'].sudo().new(
                dict(vals, hr_employee_id=employee.id))
            return {
                'status': True,
                'enabled': bool(recipients),
                'recipients': len(recipients),
                'subject': draft.submit_mail_subject(),
                'rows': [{'label': l, 'value': v} for l, v in draft.submit_mail_rows()],
                'intro': 'A leave request is waiting for a decision.',
                'footer': 'Sent automatically by the Attendance Suite when a request '
                          'is submitted. Recipients are configured under Leave > Leave Policy.',
            }
        except Exception as e:
            _logger.error('[Leave API] preview_mail error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/preview_paid', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def preview_paid(self, **params):
        """How much of the caller's draft leave would be paid, and how much LOP.

        Priced by the same code the saved request uses, for the caller's own
        employee only. Nothing is written.
        """
        try:
            data = request.env['hr.leave.request'].preview_paid_split(
                params.get('from_date') or False,
                params.get('to_date') or False,
                bool(params.get('is_half_day')),
                params.get('leave_type') or 'casual',
            )
            return {'status': True, 'message': 'OK', 'data': data}
        except Exception as e:
            _logger.error('[Leave API] preview_paid error: %s', str(e))
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
            is_manager = _is_leave_manager()
            if leave.employee_user_id.id != request.env.user.id and not is_manager:
                return {'status': False,
                        'message': 'You can only cancel your own leave requests.'}
            # Approved leave is HR's to undo: the employee asks instead.
            if leave.state == 'approved' and not is_manager:
                return {'status': False,
                        'message': 'This leave is already approved. Use Request cancellation '
                                   'and HR will decide.'}

            leave.action_cancel()
            return {'status': True, 'message': 'Leave request cancelled'}
        except Exception as e:
            _logger.error('[Leave API] Cancel error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/request_cancel', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def request_cancel(self, **params):
        """Employee asks HR to cancel their own APPROVED leave."""
        try:
            leave = request.env['hr.leave.request'].sudo().browse(int(params.get('request_id') or 0))
            if not leave.exists():
                return {'status': False, 'message': 'Request not found'}
            if leave.employee_user_id.id != request.env.user.id:
                return {'status': False,
                        'message': 'You can only ask to cancel your own leave.'}
            leave.action_request_cancel(params.get('reason') or '')
            return {'status': True, 'message': 'Cancellation request sent to HR'}
        except Exception as e:
            _logger.error('[Leave API] request_cancel error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/approve_cancel', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def approve_cancel(self, **params):
        """HR approves a cancellation request: the leave is cancelled."""
        try:
            if not _is_leave_manager():
                return {'status': False,
                        'message': 'Only leave managers/admins can decide cancellations.'}
            leave = request.env['hr.leave.request'].sudo().browse(int(params.get('request_id') or 0))
            if not leave.exists():
                return {'status': False, 'message': 'Request not found'}
            leave.action_approve_cancel()
            return {'status': True, 'message': 'Leave cancelled'}
        except Exception as e:
            _logger.error('[Leave API] approve_cancel error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/reject_cancel', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def reject_cancel(self, **params):
        """HR keeps the leave; the employee sees the reason."""
        try:
            if not _is_leave_manager():
                return {'status': False,
                        'message': 'Only leave managers/admins can decide cancellations.'}
            leave = request.env['hr.leave.request'].sudo().browse(int(params.get('request_id') or 0))
            if not leave.exists():
                return {'status': False, 'message': 'Request not found'}
            leave.action_reject_cancel(params.get('reason') or '')
            return {'status': True, 'message': 'Leave kept'}
        except Exception as e:
            _logger.error('[Leave API] reject_cancel error: %s', str(e))
            return {'status': False, 'message': str(e)}

    @http.route('/leave/request/report', type='jsonrpc', auth='user',
                methods=['POST'], csrf=False)
    def get_leave_report(self, **params):
        """Get leave report with filters.

        Manager-only. Same reasoning as /wfh/request/list: the query is sudo(),
        unlimited, and defaults to every approved leave company-wide, so an
        ungated call handed any employee the whole table including reasons.
        """
        try:
            if not _is_leave_manager():
                return {
                    'status': False,
                    'message': 'Only leave managers/admins can view the leave report.',
                }

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
