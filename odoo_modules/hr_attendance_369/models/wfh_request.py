from odoo import api, models, fields
from odoo.exceptions import ValidationError, UserError
from datetime import datetime, timedelta
import logging

_logger = logging.getLogger(__name__)


class WfhRequest(models.Model):
    _name = "hr.wfh.request"
    _description = "Work From Home Request"
    _order = "request_date desc, create_date desc"
    _rec_name = "display_name"

    # =============================================
    # BASIC FIELDS
    # =============================================
    employee_user_id = fields.Many2one(
        'res.users',
        string='Employee',
        required=True,
        default=lambda self: self.env.user,
        index=True,
    )

    hr_employee_id = fields.Many2one(
        'hr.employee',
        string='HR Employee',
        compute='_compute_hr_employee_id',
        store=True,
    )

    request_date = fields.Date(
        string='WFH Date',
        required=True,
        help="The date the employee wants to work from home",
    )

    reason = fields.Text(
        string='Reason',
        required=True,
        help="Why do you need to work from home?",
    )

    # =============================================
    # STATE MACHINE
    # =============================================
    state = fields.Selection([
        ('draft', 'Draft'),
        ('pending', 'Pending Approval'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('checked_in', 'Checked In'),
        ('checked_out', 'Checked Out'),
        ('cancelled', 'Cancelled'),
        ('expired', 'Expired'),
    ], string='Status', default='draft', required=True, tracking=True, index=True)

    # =============================================
    # APPROVAL FIELDS
    # =============================================
    approved_by = fields.Many2one(
        'res.users',
        string='Approved/Rejected By',
        readonly=True,
    )
    approval_date = fields.Datetime(
        string='Approval Date',
        readonly=True,
    )
    rejection_reason = fields.Text(
        string='Rejection Reason',
        readonly=True,
    )
    submitted_on = fields.Datetime(
        string='Submitted On',
        readonly=True,
        help='When this request entered Pending Approval. The auto-approval '
             'wait is counted from here, not from creation -- a request left '
             'in draft for a week has not been waiting on anybody.',
    )
    auto_approved = fields.Boolean(
        string='Auto Approved',
        readonly=True,
        help='Approved by the system because nobody answered within the '
             'configured wait, not by a person.',
    )

    # =============================================
    # CHECK-IN / CHECK-OUT FIELDS
    # =============================================
    checkin_time = fields.Datetime(
        string='Check-In Time',
        readonly=True,
    )
    checkout_time = fields.Datetime(
        string='Check-Out Time',
        readonly=True,
    )
    worked_hours = fields.Float(
        string='Worked Hours',
        compute='_compute_worked_hours',
        store=True,
    )
    worked_hours_display = fields.Char(
        string='Worked Hours Display',
        compute='_compute_worked_hours_display',
    )

    # Link to auto-created hr.attendance record
    attendance_id = fields.Many2one(
        'hr.attendance',
        string='Attendance Record',
        readonly=True,
        ondelete='set null',
    )

    # =============================================
    # DISPLAY / HELPER FIELDS
    # =============================================
    display_name = fields.Char(
        string='Display Name',
        compute='_compute_display_name',
        store=True,
    )

    employee_name = fields.Char(
        related='employee_user_id.name',
        string='Employee Name',
        store=True,
    )

    is_today = fields.Boolean(
        string='Is Today',
        compute='_compute_is_today',
    )

    can_checkin = fields.Boolean(
        string='Can Check In',
        compute='_compute_can_checkin',
    )

    can_checkout = fields.Boolean(
        string='Can Check Out',
        compute='_compute_can_checkout',
    )

    # =============================================
    # COMPUTED FIELDS
    # =============================================
    @api.depends('employee_user_id')
    def _compute_hr_employee_id(self):
        for rec in self:
            if rec.employee_user_id:
                hr_emp = self.env['hr.employee'].sudo().search([
                    ('user_id', '=', rec.employee_user_id.id)
                ], limit=1)
                rec.hr_employee_id = hr_emp.id if hr_emp else False
            else:
                rec.hr_employee_id = False

    @api.depends('employee_user_id', 'request_date')
    def _compute_display_name(self):
        for rec in self:
            if rec.employee_user_id and rec.request_date:
                rec.display_name = f"WFH - {rec.employee_user_id.name} - {rec.request_date}"
            else:
                rec.display_name = "New WFH Request"

    @api.depends('checkin_time', 'checkout_time')
    def _compute_worked_hours(self):
        for rec in self:
            if rec.checkin_time and rec.checkout_time:
                delta = rec.checkout_time - rec.checkin_time
                rec.worked_hours = delta.total_seconds() / 3600.0
            else:
                rec.worked_hours = 0.0

    def _compute_worked_hours_display(self):
        for rec in self:
            if rec.worked_hours:
                hours = int(rec.worked_hours)
                minutes = int((rec.worked_hours - hours) * 60)
                rec.worked_hours_display = f"{hours}h {minutes}m"
            else:
                rec.worked_hours_display = "0h 0m"

    def _compute_is_today(self):
        today = fields.Date.today()
        for rec in self:
            rec.is_today = rec.request_date == today

    def _compute_can_checkin(self):
        today = fields.Date.today()
        for rec in self:
            rec.can_checkin = (
                rec.state == 'approved'
                and rec.request_date == today
                and not rec.checkin_time
            )

    def _compute_can_checkout(self):
        for rec in self:
            rec.can_checkout = (
                rec.state == 'checked_in'
                and rec.checkin_time
                and not rec.checkout_time
            )

    # =============================================
    # CONSTRAINTS
    # =============================================
    @api.constrains('request_date')
    def _check_request_date(self):
        for rec in self:
            if rec.request_date and rec.request_date < fields.Date.today():
                raise ValidationError(
                    "You cannot request WFH for a past date. "
                    "Please select today or a future date."
                )

    @api.constrains('employee_user_id', 'request_date')
    def _check_duplicate_request(self):
        for rec in self:
            existing = self.search([
                ('employee_user_id', '=', rec.employee_user_id.id),
                ('request_date', '=', rec.request_date),
                ('state', 'not in', ['rejected', 'cancelled', 'expired']),
                ('id', '!=', rec.id),
            ], limit=1)
            if existing:
                raise ValidationError(
                    f"A WFH request already exists for {rec.employee_user_id.name} "
                    f"on {rec.request_date}. Current status: {existing.state}"
                )

    # =============================================
    # CREATE
    # =============================================
    @api.model_create_multi
    def create(self, vals_list):
        """Stamp `submitted_on` for anything created straight into Pending.

        /wfh/request/create does exactly that (it skips draft so the mobile app
        needs one call, not two), so without this the auto-approval sweep would
        have to fall back to create_date for every mobile request.
        """
        now = fields.Datetime.now()
        for vals in vals_list:
            if vals.get('state') == 'pending' and not vals.get('submitted_on'):
                vals['submitted_on'] = now
        return super().create(vals_list)

    # =============================================
    # ACTIONS — EMPLOYEE
    # =============================================
    def action_submit(self):
        """Employee submits the WFH request for approval"""
        for rec in self:
            if rec.state != 'draft':
                raise UserError("Only draft requests can be submitted.")
            # submitted_on starts the auto-approval clock.
            rec.write({'state': 'pending', 'submitted_on': fields.Datetime.now()})
        return True

    def action_cancel(self):
        """Employee cancels their own request"""
        for rec in self:
            if rec.state not in ('draft', 'pending', 'approved'):
                raise UserError("This request cannot be cancelled in its current state.")
            rec.state = 'cancelled'
        return True

    # =============================================
    # ACTIONS — MANAGER / ADMIN
    # =============================================
    def action_auto_approve(self):
        """pending → approved, by the system, because the wait ran out.

        Separate from action_approve for two reasons: it credits OdooBot rather
        than whoever the cron happens to run as, and it SKIPS a request that is
        no longer pending instead of raising. By the time the sweep reaches a
        record a manager may have just answered it -- that is a race, not an
        error, and it must not abort the rest of the sweep.
        """
        system = self.env.ref('base.user_root', raise_if_not_found=False)
        for rec in self:
            if rec.state != 'pending':
                continue
            rec.write({
                'state': 'approved',
                'approved_by': system.id if system else False,
                'approval_date': fields.Datetime.now(),
                'auto_approved': True,
                'rejection_reason': False,
            })
            _logger.info(
                f"WFH Request auto-approved (no answer in time): "
                f"{rec.employee_user_id.name} for {rec.request_date}"
            )
        return True

    def action_approve(self):
        """Manager/Admin approves the WFH request"""
        for rec in self:
            if rec.state != 'pending':
                raise UserError("Only pending requests can be approved.")
            rec.write({
                'state': 'approved',
                'approved_by': self.env.user.id,
                'approval_date': fields.Datetime.now(),
                'auto_approved': False,
                'rejection_reason': False,
            })
            _logger.info(
                f"WFH Request approved: {rec.employee_user_id.name} for {rec.request_date} "
                f"by {self.env.user.name}"
            )
        return True

    def action_reject(self, reason=''):
        """Manager/Admin rejects the WFH request"""
        for rec in self:
            if rec.state != 'pending':
                raise UserError("Only pending requests can be rejected.")
            rec.write({
                'state': 'rejected',
                'approved_by': self.env.user.id,
                'approval_date': fields.Datetime.now(),
                'rejection_reason': reason or 'No reason provided',
            })
            _logger.info(
                f"WFH Request rejected: {rec.employee_user_id.name} for {rec.request_date} "
                f"by {self.env.user.name}. Reason: {reason}"
            )
        return True

    # =============================================
    # ACTIONS — CHECK-IN / CHECK-OUT
    # =============================================
    #
    # THERE IS ONLY ONE CHECK-IN. The employee presses the same attendance
    # button at home as in the office; hr.attendance sees the approved request
    # for that day and tags itself WFH (`_link_approved_wfh`), which is also
    # what moves this request to Checked In / Checked Out.
    #
    # Both actions below therefore do nothing WFH-specific any more. They exist
    # as a manual entry point for HR and to keep the legacy /wfh/checkin and
    # /wfh/checkout endpoints — still called by the mobile build already on
    # employees' phones — working during rollout. They go through exactly the
    # same attendance record as everybody else, so no day can end up with two.

    def _todays_open_attendance(self):
        """This employee's still-open attendance on the request date, if any.

        Adopted rather than duplicated: pressing WFH check-in after having
        already checked in normally must land on the SAME record, or the day
        would carry two arrivals and core Odoo's overlap constraint would
        refuse the second one anyway.
        """
        self.ensure_one()
        Attendance = self.env['hr.attendance'].sudo()
        if not self.hr_employee_id:
            return Attendance.browse()
        DayStatus = self.env['hr.attendance.day.status']
        candidates = Attendance.search([
            ('employee_id', '=', self.hr_employee_id.id),
            ('check_out', '=', False),
        ], order='check_in desc', limit=5)
        for att in candidates:
            if att.check_in and DayStatus._office_local_date(att) == self.request_date:
                return att
        return Attendance.browse()

    def action_checkin(self):
        """Open the WFH day by creating the ordinary attendance record."""
        for rec in self:
            if rec.state == 'checked_in':
                # Already running — the employee used the normal check-in
                # button first. Idempotent on purpose: during rollout the old
                # app still presses this afterwards, and that must not fail.
                continue

            if rec.state != 'approved':
                raise UserError("You can only check in to an approved WFH request.")

            if rec.request_date != fields.Date.today():
                raise UserError(
                    f"You can only check in on the approved WFH date ({rec.request_date}). "
                    f"Today is {fields.Date.today()}."
                )

            if not rec.hr_employee_id:
                raise UserError(
                    "No HR Employee record found for your user account. "
                    "Please contact HR to link your employee record."
                )

            attendance = rec._todays_open_attendance()
            if not attendance:
                # A PLAIN attendance: no work_location, no wfh_request_id. The
                # hr.attendance hook fills both in, so there is one place that
                # decides what a WFH day looks like.
                #
                # skip_late_reason_required: this path cannot collect a reason
                # (a button, or an API call from a request approved days ago),
                # so it must never be blocked by _check_late_reason_required —
                # the same exemption the kiosk and the KRA bridge take.
                # Lateness is still recorded in full.
                attendance = self.env['hr.attendance'].sudo().with_context(
                    skip_late_reason_required=True
                ).create({
                    'employee_id': rec.hr_employee_id.id,
                    'check_in': fields.Datetime.now(),
                })
            else:
                # Adopted an existing check-in: it may predate the approval and
                # so still be untagged. Linking is idempotent.
                attendance._run_wfh_sync(link=True)

            # The hook has normally moved this request already. Written again
            # here only for the case where linking failed and was logged rather
            # than raised — the day still ends up consistent.
            if rec.state == 'approved':
                rec.write({
                    'state': 'checked_in',
                    'checkin_time': attendance.check_in,
                    'attendance_id': attendance.id,
                })

            _logger.info(
                f"WFH Check-in: {rec.employee_user_id.name} at {attendance.check_in}. "
                f"Attendance ID: {attendance.id}"
            )
        return True

    def action_checkout(self):
        """Close the WFH day by closing its ordinary attendance record."""
        for rec in self:
            if rec.state == 'checked_out':
                continue  # already closed, normally by the attendance hook

            if rec.state != 'checked_in':
                raise UserError("You can only check out from a checked-in WFH request.")

            attendance = rec.attendance_id or rec._todays_open_attendance()
            if not attendance:
                raise UserError("No attendance record found. Please contact admin.")

            now = fields.Datetime.now()
            if not attendance.check_out:
                # This write is the real check-out; _sync_wfh_state on
                # hr.attendance is what moves this request to checked_out.
                attendance.sudo().with_context(
                    skip_late_reason_required=True
                ).write({'check_out': now})

            if rec.state == 'checked_in':
                rec.write({
                    'state': 'checked_out',
                    'checkout_time': attendance.check_out or now,
                })

            _logger.info(
                f"WFH Check-out: {rec.employee_user_id.name} at {rec.checkout_time}. "
                f"Worked hours: {rec.worked_hours:.2f}"
            )
        return True

    # =============================================
    # CRON / SCHEDULED ACTIONS
    # =============================================
    @api.model
    def _cron_expire_unused_requests(self):
        """
        Cron job: Mark approved but unused WFH requests as expired
        if the date has passed without check-in.
        Run daily at midnight.
        """
        yesterday = fields.Date.today() - timedelta(days=1)
        expired_requests = self.search([
            ('state', '=', 'approved'),
            ('request_date', '<', fields.Date.today()),
            ('checkin_time', '=', False),
        ])

        if expired_requests:
            expired_requests.write({'state': 'expired'})
            _logger.info(f"Expired {len(expired_requests)} unused WFH requests.")

        return True

    @api.model
    def _cron_auto_checkout_forgotten(self):
        """
        Cron job: Auto-checkout employees who forgot to checkout.
        Sets checkout to end of workday (18:00 / 6 PM) of the WFH date.
        Run daily at midnight.
        """
        forgotten_checkins = self.search([
            ('state', '=', 'checked_in'),
            ('request_date', '<', fields.Date.today()),
            ('checkout_time', '=', False),
        ])

        for rec in forgotten_checkins:
            # Set checkout to 6 PM on the WFH date
            checkout_dt = datetime.combine(
                rec.request_date,
                datetime.strptime('18:00:00', '%H:%M:%S').time()
            )

            if rec.attendance_id:
                rec.attendance_id.sudo().write({
                    'check_out': checkout_dt,
                })

            rec.write({
                'state': 'checked_out',
                'checkout_time': checkout_dt,
            })

            _logger.warning(
                f"Auto-checkout for WFH: {rec.employee_user_id.name} on {rec.request_date}. "
                f"Employee forgot to check out."
            )

        return True

    # =============================================
    # API HELPER METHODS (for mobile app / controller)
    # =============================================
    @api.model
    def get_my_wfh_requests(self, user_id=None, state_filter=None):
        """Get WFH requests for a specific employee"""
        if not user_id:
            user_id = self.env.user.id

        domain = [('employee_user_id', '=', user_id)]
        if state_filter:
            domain.append(('state', '=', state_filter))

        requests = self.search(domain, order='request_date desc', limit=50)

        result = []
        for req in requests:
            result.append({
                'id': req.id,
                'request_date': str(req.request_date),
                'reason': req.reason,
                'state': req.state,
                'approved_by': req.approved_by.name if req.approved_by else '',
                'auto_approved': req.auto_approved,
                'approval_date': str(req.approval_date) if req.approval_date else '',
                'rejection_reason': req.rejection_reason or '',
                'checkin_time': str(req.checkin_time) if req.checkin_time else '',
                'checkout_time': str(req.checkout_time) if req.checkout_time else '',
                'worked_hours_display': req.worked_hours_display,
                'can_checkin': req.can_checkin,
                'can_checkout': req.can_checkout,
                'is_today': req.is_today,
            })

        return result

    @api.model
    def get_pending_requests_for_approval(self):
        """Get all pending WFH requests (for manager dashboard)"""
        requests = self.search([
            ('state', '=', 'pending'),
        ], order='request_date asc')

        result = []
        for req in requests:
            result.append({
                'id': req.id,
                'employee_name': req.employee_user_id.name,
                'employee_id': req.employee_user_id.id,
                'request_date': str(req.request_date),
                'reason': req.reason,
                'state': req.state,
                'created_on': str(req.create_date),
            })

        return result

    @api.model
    def get_todays_wfh_employees(self):
        """Get all employees working from home today"""
        today = fields.Date.today()
        wfh_today = self.search([
            ('request_date', '=', today),
            ('state', 'in', ['approved', 'checked_in', 'checked_out']),
        ])

        result = []
        for req in wfh_today:
            result.append({
                'id': req.id,
                'employee_name': req.employee_user_id.name,
                'employee_id': req.employee_user_id.id,
                'state': req.state,
                'checkin_time': str(req.checkin_time) if req.checkin_time else '',
                'checkout_time': str(req.checkout_time) if req.checkout_time else '',
                'worked_hours_display': req.worked_hours_display,
            })

        return result
