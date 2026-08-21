from odoo import http, fields
from odoo.http import request
import json
import logging
import pytz

_logger = logging.getLogger(__name__)


def convert_to_user_tz(datetime_obj, user=None):
    """Convert UTC datetime to user's timezone"""
    if not datetime_obj:
        return ''
    if user is None:
        user = request.env.user
    user_tz = user.tz or 'Asia/Kolkata'
    try:
        if datetime_obj.tzinfo is None:
            utc_dt = pytz.UTC.localize(datetime_obj)
        else:
            utc_dt = datetime_obj
        local_tz = pytz.timezone(user_tz)
        local_dt = utc_dt.astimezone(local_tz)
        return local_dt.strftime('%Y-%m-%d %H:%M:%S')
    except Exception as e:
        _logger.error(f"Timezone conversion error: {e}")
        return str(datetime_obj)


def _is_wfh_manager():
    """WFH Manager or system admin -- mirrors _is_leave_manager in leave_api."""
    user = request.env.user
    return (user.has_group('hr_attendance_369.group_wfh_manager')
            or user.has_group('base.group_system'))


class WfhAPI(http.Controller):
    """
    REST API for WFH Requests — used by both Odoo web frontend and React Native mobile app.

    FLOW:
    1. Employee → POST /wfh/request/create   (submit WFH request)
    2. Manager  → POST /wfh/request/approve   (approve request)
    3. Manager  → POST /wfh/request/reject    (reject request)
    4. Employee → the NORMAL attendance check-in / check-out

    There is no separate WFH check-in any more. Once a request is approved
    the employee uses the same attendance button they use in the office;
    hr.attendance sees the approved request and records the day as WFH by
    itself. The app should call /wfh/today_status to know it must skip the
    geo-fence today and badge that one button 'WFH'.

    /wfh/checkin and /wfh/checkout are kept as BACKWARD-COMPATIBLE aliases
    for the mobile build already installed on employees' phones. They go
    through the very same attendance record, and are idempotent: pressing
    them after a normal check-in returns the existing times instead of
    failing.
    """

    # =============================================
    # 1. CREATE WFH REQUEST (Employee)
    # =============================================
    @http.route('/wfh/request/create', type='jsonrpc', auth='user', methods=['POST'], csrf=False)
    def create_wfh_request(self, **params):
        """Employee submits a new WFH request"""
        try:
            request_date = params.get('request_date')
            reason = params.get('reason', '').strip()

            if not request_date:
                return {'status': False, 'message': 'WFH date is required'}
            if not reason:
                return {'status': False, 'message': 'Reason is required'}

            wfh = request.env['hr.wfh.request'].create({
                'employee_user_id': request.env.user.id,
                'request_date': request_date,
                'reason': reason,
                'state': 'pending',  # Auto-submit (skip draft for mobile)
            })

            _logger.info(f"WFH Request created: {request.env.user.name} for {request_date}")

            return {
                'status': True,
                'message': 'WFH request submitted for approval',
                'request_id': wfh.id,
                'state': wfh.state,
            }
        except Exception as e:
            # Roll back before answering, for the same reason the leave create
            # does. The duplicate-date constraint fires on flush, after the row
            # exists; catching it and returning status:False without a rollback
            # still commits that row when the HTTP response succeeds.
            #
            # Worse here than for leave: this route sets state directly to
            # pending, so the phantom did not sit quietly in draft -- it went
            # straight into a manager approval queue for a request the employee
            # had just been told was refused.
            request.env.cr.rollback()
            _logger.error(f"Error creating WFH request: {str(e)}")
            return {'status': False, 'message': str(e)}

    # =============================================
    # 2. MY WFH REQUESTS (Employee)
    # =============================================
    @http.route('/wfh/request/my_requests', type='jsonrpc', auth='user', methods=['POST'], csrf=False)
    def get_my_wfh_requests(self, **params):
        """Get current user's WFH requests"""
        try:
            state_filter = params.get('state')
            result = request.env['hr.wfh.request'].get_my_wfh_requests(
                user_id=request.env.user.id,
                state_filter=state_filter,
            )
            return {
                'status': True,
                'requests': result,
                'current_user_id': request.env.user.id,
                'current_user_name': request.env.user.name,
            }
        except Exception as e:
            _logger.error(f"Error fetching WFH requests: {str(e)}")
            return {'status': False, 'message': str(e)}

    # =============================================
    # 3. CHECK TODAY'S WFH STATUS (Employee / Mobile)
    # =============================================
    @http.route('/wfh/today_status', type='jsonrpc', auth='user', methods=['POST'], csrf=False)
    def get_today_wfh_status(self, **params):
        """
        Check if the employee has an approved WFH for today.

        The app calls this on the attendance screen. It does NOT decide which
        check-in button to show -- there is only one -- it decides whether to
        skip the geo-fence and badge that button "WFH".
        """
        try:
            today = fields.Date.today()
            user_id = request.env.user.id

            wfh_today = request.env['hr.wfh.request'].sudo().search([
                ('employee_user_id', '=', user_id),
                ('request_date', '=', today),
                ('state', 'in', ['approved', 'checked_in', 'checked_out']),
            ], limit=1)

            if not wfh_today:
                return {
                    'status': True,
                    'has_wfh_today': False,
                    # Nothing special about today: normal button, normal
                    # geo-fence.
                    'use_normal_attendance': True,
                    'skip_geofence': False,
                    'message': 'No approved WFH request for today',
                }

            return {
                'status': True,
                'has_wfh_today': True,
                # The app should NOT show a separate WFH check-in card. Show
                # the ordinary check-in button (badged "WFH" if you like) and
                # skip the geo-fence -- the whole point of the approval is that
                # the employee is not at the office today.
                'use_normal_attendance': True,
                'skip_geofence': True,
                'attendance_id': wfh_today.attendance_id.id or False,
                'wfh_request': {
                    'id': wfh_today.id,
                    'state': wfh_today.state,
                    'attendance_id': wfh_today.attendance_id.id or False,
                    'can_checkin': wfh_today.can_checkin,
                    'can_checkout': wfh_today.can_checkout,
                    'checkin_time': convert_to_user_tz(wfh_today.checkin_time),
                    'checkout_time': convert_to_user_tz(wfh_today.checkout_time),
                    'worked_hours_display': wfh_today.worked_hours_display,
                },
            }
        except Exception as e:
            _logger.error(f"Error checking today's WFH status: {str(e)}")
            return {'status': False, 'message': str(e)}

    # =============================================
    # 4. CHECK-IN (Employee / Mobile App)
    # =============================================
    @http.route('/wfh/checkin', type='jsonrpc', auth='user', methods=['POST'], csrf=False)
    def wfh_checkin(self, **params):
        """
        BACKWARD-COMPATIBLE ALIAS for the normal attendance check-in.

        New app builds should not call this: on an approved WFH day the
        ordinary check-in already records the day as WFH. Kept so the build
        currently on employees' phones keeps working, and made idempotent
        so a day already opened from the normal button returns its existing
        time rather than an error.
        """
        try:
            request_id = params.get('request_id')

            if not request_id:
                # Approved OR already open: the employee may well have used the
                # normal check-in button before pressing this one.
                today = fields.Date.today()
                wfh = request.env['hr.wfh.request'].sudo().search([
                    ('employee_user_id', '=', request.env.user.id),
                    ('request_date', '=', today),
                    ('state', 'in', ('approved', 'checked_in')),
                ], limit=1)

                if not wfh:
                    return {
                        'status': False,
                        'message': 'No approved WFH request found for today. '
                                   'Please submit a WFH request and get manager approval first.',
                    }
            else:
                wfh = request.env['hr.wfh.request'].sudo().browse(int(request_id))
                if not wfh.exists():
                    return {'status': False, 'message': 'WFH request not found'}

            already_open = wfh.state == 'checked_in'

            # Creates (or adopts) the ordinary attendance record -- the same one
            # the normal check-in button would have made.
            wfh.action_checkin()

            checkin_time = convert_to_user_tz(wfh.checkin_time)
            return {
                'status': True,
                'message': (f'Already checked in at {checkin_time}' if already_open
                            else f'WFH Check-in successful at {checkin_time}'),
                'already_checked_in': already_open,
                'request_id': wfh.id,
                'checkin_time': checkin_time,
                'attendance_id': wfh.attendance_id.id,
                'state': wfh.state,
            }
        except Exception as e:
            _logger.error(f"WFH Check-in error: {str(e)}")
            return {'status': False, 'message': str(e)}

    # =============================================
    # 5. CHECK-OUT (Employee / Mobile App)
    # =============================================
    @http.route('/wfh/checkout', type='jsonrpc', auth='user', methods=['POST'], csrf=False)
    def wfh_checkout(self, **params):
        """
        BACKWARD-COMPATIBLE ALIAS for the normal attendance check-out.

        Closes the same attendance record the normal check-out button
        closes, and is idempotent for a day already closed there.
        """
        try:
            request_id = params.get('request_id')

            if not request_id:
                # Open OR already closed: the normal check-out button may have
                # closed the day a moment ago.
                today = fields.Date.today()
                wfh = request.env['hr.wfh.request'].sudo().search([
                    ('employee_user_id', '=', request.env.user.id),
                    ('request_date', '=', today),
                    ('state', 'in', ('checked_in', 'checked_out')),
                ], limit=1)

                if not wfh:
                    return {
                        'status': False,
                        'message': 'No active WFH check-in found for today.',
                    }
            else:
                wfh = request.env['hr.wfh.request'].sudo().browse(int(request_id))
                if not wfh.exists():
                    return {'status': False, 'message': 'WFH request not found'}

            already_closed = wfh.state == 'checked_out'

            # Writes check_out on the ordinary attendance record.
            wfh.action_checkout()

            return {
                'status': True,
                'message': (f'Already checked out. Worked: {wfh.worked_hours_display}'
                            if already_closed
                            else f'WFH Check-out successful. Worked: {wfh.worked_hours_display}'),
                'already_checked_out': already_closed,
                'request_id': wfh.id,
                'checkout_time': convert_to_user_tz(wfh.checkout_time),
                'worked_hours': wfh.worked_hours,
                'worked_hours_display': wfh.worked_hours_display,
                'state': wfh.state,
            }
        except Exception as e:
            _logger.error(f"WFH Check-out error: {str(e)}")
            return {'status': False, 'message': str(e)}

    # =============================================
    # 6. APPROVE REQUEST (Manager/Admin)
    # =============================================
    @http.route('/wfh/request/approve', type='jsonrpc', auth='user', methods=['POST'], csrf=False)
    def approve_wfh_request(self, **params):
        """Manager approves a WFH request"""
        try:
            request_id = params.get('request_id')

            if not request_id:
                return {'status': False, 'message': 'request_id is required'}

            # Check if user is manager/admin
            current_user = request.env.user
            is_manager = (
                current_user.has_group('hr_attendance_369.group_wfh_manager') or
                current_user.has_group('base.group_system')
            )

            if not is_manager:
                return {
                    'status': False,
                    'message': 'Only managers/admins can approve WFH requests.',
                }

            wfh = request.env['hr.wfh.request'].sudo().browse(int(request_id))
            if not wfh.exists():
                return {'status': False, 'message': 'WFH request not found'}

            wfh.action_approve()

            return {
                'status': True,
                'message': f'WFH request approved for {wfh.employee_user_id.name} on {wfh.request_date}',
                'request_id': wfh.id,
                'state': wfh.state,
            }
        except Exception as e:
            _logger.error(f"WFH Approval error: {str(e)}")
            return {'status': False, 'message': str(e)}

    # =============================================
    # 7. REJECT REQUEST (Manager/Admin)
    # =============================================
    @http.route('/wfh/request/reject', type='jsonrpc', auth='user', methods=['POST'], csrf=False)
    def reject_wfh_request(self, **params):
        """Manager rejects a WFH request"""
        try:
            request_id = params.get('request_id')
            reason = params.get('reason', '').strip()

            if not request_id:
                return {'status': False, 'message': 'request_id is required'}
            if not reason:
                return {'status': False, 'message': 'Rejection reason is required'}

            # Check if user is manager/admin
            current_user = request.env.user
            is_manager = (
                current_user.has_group('hr_attendance_369.group_wfh_manager') or
                current_user.has_group('base.group_system')
            )

            if not is_manager:
                return {
                    'status': False,
                    'message': 'Only managers/admins can reject WFH requests.',
                }

            wfh = request.env['hr.wfh.request'].sudo().browse(int(request_id))
            if not wfh.exists():
                return {'status': False, 'message': 'WFH request not found'}

            wfh.action_reject(reason)

            return {
                'status': True,
                'message': f'WFH request rejected for {wfh.employee_user_id.name}',
                'request_id': wfh.id,
                'state': wfh.state,
            }
        except Exception as e:
            _logger.error(f"WFH Rejection error: {str(e)}")
            return {'status': False, 'message': str(e)}

    # =============================================
    # 8. PENDING REQUESTS (Manager Dashboard)
    # =============================================
    @http.route('/wfh/request/pending', type='jsonrpc', auth='user', methods=['POST'], csrf=False)
    def get_pending_requests(self, **params):
        """Get all pending WFH requests for manager approval"""
        try:
            current_user = request.env.user
            is_manager = (
                current_user.has_group('hr_attendance_369.group_wfh_manager') or
                current_user.has_group('base.group_system')
            )

            if not is_manager:
                return {
                    'status': False,
                    'message': 'Only managers/admins can view pending requests.',
                }

            result = request.env['hr.wfh.request'].get_pending_requests_for_approval()

            return {
                'status': True,
                'requests': result,
                'count': len(result),
            }
        except Exception as e:
            _logger.error(f"Error fetching pending WFH requests: {str(e)}")
            return {'status': False, 'message': str(e)}

    # =============================================
    # 9. TODAY'S WFH DASHBOARD (Manager)
    # =============================================
    @http.route('/wfh/today_dashboard', type='jsonrpc', auth='user', methods=['POST'], csrf=False)
    def get_today_wfh_dashboard(self, **params):
        """Get all employees working from home today"""
        try:
            result = request.env['hr.wfh.request'].get_todays_wfh_employees()
            return {
                'status': True,
                'wfh_employees': result,
                'count': len(result),
                'date': str(fields.Date.today()),
            }
        except Exception as e:
            _logger.error(f"Error fetching WFH dashboard: {str(e)}")
            return {'status': False, 'message': str(e)}

    # =============================================
    # 10. ALL REQUESTS (Manager — with filters)
    # =============================================
    @http.route('/wfh/request/list', type='jsonrpc', auth='user', methods=['POST'], csrf=False)
    def get_all_wfh_requests(self, **params):
        """Get all WFH requests with optional filters (for manager view).

        Manager-only, and it has to be checked here: the search below is
        sudo() and takes a caller-supplied employee_id, so without this gate
        any authenticated employee could read every colleague's WFH rows --
        reason and rejection_reason included. Verified by doing exactly that
        as a plain base.group_user before the gate existed.
        """
        try:
            if not _is_wfh_manager():
                return {
                    'status': False,
                    'message': 'Only WFH managers/admins can view all requests.',
                }

            domain = []

            # Filter by state
            state = params.get('state')
            if state:
                domain.append(('state', '=', state))

            # Filter by employee
            employee_id = params.get('employee_id')
            if employee_id:
                domain.append(('employee_user_id', '=', int(employee_id)))

            # Filter by date range
            from_date = params.get('from_date')
            to_date = params.get('to_date')
            if from_date:
                domain.append(('request_date', '>=', from_date))
            if to_date:
                domain.append(('request_date', '<=', to_date))

            wfh_requests = request.env['hr.wfh.request'].sudo().search(
                domain, order='request_date desc', limit=100
            )

            result = []
            for wfh in wfh_requests:
                result.append({
                    'id': wfh.id,
                    'employee_name': wfh.employee_user_id.name,
                    'employee_id': wfh.employee_user_id.id,
                    'request_date': str(wfh.request_date),
                    'reason': wfh.reason,
                    'state': wfh.state,
                    'approved_by': wfh.approved_by.name if wfh.approved_by else '',
                    'auto_approved': wfh.auto_approved,
                    'approval_date': convert_to_user_tz(wfh.approval_date),
                    'rejection_reason': wfh.rejection_reason or '',
                    'checkin_time': convert_to_user_tz(wfh.checkin_time),
                    'checkout_time': convert_to_user_tz(wfh.checkout_time),
                    'worked_hours_display': wfh.worked_hours_display,
                })

            return {
                'status': True,
                'requests': result,
                'count': len(result),
            }
        except Exception as e:
            _logger.error(f"Error fetching WFH requests: {str(e)}")
            return {'status': False, 'message': str(e)}

    # =============================================
    # 11. CANCEL REQUEST (Employee)
    # =============================================
    @http.route('/wfh/request/cancel', type='jsonrpc', auth='user', methods=['POST'], csrf=False)
    def cancel_wfh_request(self, **params):
        """Employee cancels their WFH request"""
        try:
            request_id = params.get('request_id')

            if not request_id:
                return {'status': False, 'message': 'request_id is required'}

            wfh = request.env['hr.wfh.request'].sudo().browse(int(request_id))
            if not wfh.exists():
                return {'status': False, 'message': 'WFH request not found'}

            # Only the employee or admin can cancel
            if wfh.employee_user_id.id != request.env.user.id:
                if not request.env.user.has_group('base.group_system'):
                    return {'status': False, 'message': 'You can only cancel your own requests.'}

            wfh.action_cancel()

            return {
                'status': True,
                'message': 'WFH request cancelled',
                'request_id': wfh.id,
                'state': wfh.state,
            }
        except Exception as e:
            _logger.error(f"Error cancelling WFH request: {str(e)}")
            return {'status': False, 'message': str(e)}
