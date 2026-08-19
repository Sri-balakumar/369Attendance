from odoo import models, fields, api, _
from odoo.exceptions import ValidationError, UserError
from odoo.tools import format_duration
from datetime import timedelta
import logging
import pytz
from .time_utils import minutes_to_hm

_logger = logging.getLogger(__name__)


class HrAttendance(models.Model):
    _inherit = 'hr.attendance'

    # --- Late tracking fields ---
    is_late = fields.Boolean(
        string='Is Late',
        compute='_compute_late_info',
        store=True,
    )
    late_minutes = fields.Integer(
        string='Late (Minutes)',
        compute='_compute_late_info',
        store=True,
    )
    late_minutes_display = fields.Char(
        string='Late Time',
        compute='_compute_late_minutes_display',
        store=True,
    )
    expected_start_time = fields.Float(
        string='Expected Start Time',
        compute='_compute_late_info',
        store=True,
    )
    late_reason = fields.Text(
        string='Late Reason',
    )
    late_reason_required = fields.Boolean(
        string='Late Reason Required',
        compute='_compute_late_reason_required',
        store=False,
        help='Mirrors the "Require Late Reason" switch on the employee\'s Office '
             'Hours config. Loaded (invisibly) by the attendance form so the '
             'Enter Late Reason widget knows whether to render.',
    )
    daily_total_hours = fields.Float(
        string='Daily Total Hours',
        compute='_compute_daily_total_hours',
    )
    check_in_office_time = fields.Char(
        string='Check In (Office Time)',
        compute='_compute_office_time',
        help='Check-in shown in the office timezone (Office Hours config), so it '
             'reads the same for everyone regardless of the viewer\'s timezone.',
    )
    check_out_office_time = fields.Char(
        string='Check Out (Office Time)',
        compute='_compute_office_time',
        help='Check-out shown in the office timezone (Office Hours config).',
    )

    # --- Work location / WFH tracking (was: hr_wfh_request) ---
    # These are deliberately independent of the late-tracking compute chain
    # below: is_wfh depends only on work_location, so it never participates in
    # the ordered flush sequence in create()/write().
    work_location = fields.Selection([
        ('office', 'Office'),
        ('wfh', 'Work From Home'),
        ('client', 'Client Site'),
        ('other', 'Other'),
    ], string='Work Location', default='office',
        help='Where the employee worked from during this attendance.')

    wfh_request_id = fields.Many2one(
        'hr.wfh.request',
        string='WFH Request',
        ondelete='set null',
        readonly=True,
        help='The WFH request that created this attendance record.',
    )

    is_wfh = fields.Boolean(
        string='Is WFH',
        compute='_compute_is_wfh',
        store=True,
    )

    @api.depends('work_location')
    def _compute_is_wfh(self):
        for rec in self:
            rec.is_wfh = rec.work_location == 'wfh'

    # ------------------------------------------------------------------ #
    # WFH linking -- one check-in for everyone                            #
    # ------------------------------------------------------------------ #
    #
    # There is exactly ONE check-in and ONE check-out in this system: the
    # normal attendance one. An approved WFH request is not a second flow, it
    # is a fact about WHERE the day was worked -- so the employee presses the
    # same button at home as in the office and the backend fills in the rest.
    #
    # These hooks live on the ORM deliberately: that way every entry point --
    # the mobile RPC, the kiosk/systray widget, the backend form, the KRA
    # bridge, an import -- is covered by the same few lines, and none of them
    # has to know WFH exists.

    def _wfh_request_for(self):
        """The approved WFH request covering this check-in's office-local day.

        `checked_in` is in the domain as well as `approved` so re-linking an
        already-linked day (a corrected check_in, say) finds the same request
        instead of nothing.
        """
        self.ensure_one()
        Wfh = self.env['hr.wfh.request'].sudo()
        if not self.employee_id or not self.check_in:
            return Wfh.browse()
        # Office-local date, NOT `self.date`: the latter is UTC-derived, and a
        # 9:30 AM IST start is 04:00 UTC -- either side of midnight the two
        # disagree about which day the check-in belongs to.
        day = self.env['hr.attendance.day.status']._office_local_date(self)
        return Wfh.search([
            ('hr_employee_id', '=', self.employee_id.id),
            ('request_date', '=', day),
            ('state', 'in', ('approved', 'checked_in')),
        ], limit=1)

    def _link_approved_wfh(self):
        """Tag a check-in made on an approved WFH day, and open that request.

        Tagging is unconditional: if the company approved working from home for
        that date, that is what the day was, whichever button was pressed. HR
        can still flip `work_location` on the attendance afterwards.
        """
        for rec in self:
            if rec.wfh_request_id:
                # Already linked -- the legacy /wfh/checkin path sets both
                # fields itself. Nothing to decide.
                continue
            wfh = rec._wfh_request_for()
            if not wfh:
                continue
            rec.sudo().write({
                'work_location': 'wfh',
                'wfh_request_id': wfh.id,
            })
            if wfh.state == 'approved':
                # sudo: an employee cannot write their own request's state, but
                # their own check-in is precisely what opens it.
                wfh.write({
                    'state': 'checked_in',
                    'checkin_time': rec.check_in,
                    'attendance_id': rec.id,
                })

    def _sync_wfh_state(self):
        """Keep a linked WFH request in step with its attendance."""
        for rec in self:
            wfh = rec.wfh_request_id
            if not wfh:
                continue
            if rec.check_out and wfh.state == 'checked_in':
                wfh.sudo().write({
                    'state': 'checked_out',
                    'checkout_time': rec.check_out,
                })
            elif not rec.check_out and wfh.state == 'checked_out':
                # The day was reopened -- the KRA bridge does exactly this when
                # a developer restarts a workday that had been auto-closed.
                # The request follows it back, or it would read Checked Out
                # against a record that is open again.
                wfh.sudo().write({
                    'state': 'checked_in',
                    'checkout_time': False,
                })

    def _run_wfh_sync(self, link=False, close=False):
        """Run the WFH hooks defensively.

        A savepoint per step, and every failure swallowed after logging: the
        attendance is the record of fact, and a WFH bookkeeping problem must
        never block a check-in or roll one back. Same posture as
        `_sync_day_status`.
        """
        for rec in self:
            try:
                with self.env.cr.savepoint():
                    if link:
                        rec._link_approved_wfh()
                    if close:
                        rec._sync_wfh_state()
            except Exception:
                _logger.exception("[wfh] sync failed for attendance %s", rec.id)

    @api.depends('employee_id')
    def _compute_late_reason_required(self):
        Config = self.env['hr.attendance.late.config']
        for rec in self:
            if not rec.employee_id:
                rec.late_reason_required = True
                continue
            config_data = Config.get_config_for_employee(rec.employee_id.id)
            rec.late_reason_required = bool(
                config_data.get('late_tracking_enabled', True)
                and config_data.get('late_reason_required', True)
            )

    # --- Computed fields ---

    @api.depends('late_minutes')
    def _compute_late_minutes_display(self):
        for rec in self:
            rec.late_minutes_display = minutes_to_hm(rec.late_minutes)

    @api.depends('employee_id', 'check_in', 'check_out')
    def _compute_display_name(self):
        """Show the attendance name (used in m2o dropdowns, breadcrumbs, etc.) in
        the OFFICE timezone (config → employee tz → UTC) instead of the viewer's
        browser timezone, so check-in/out read as office time everywhere."""
        Config = self.env['hr.attendance.late.config']
        for att in self:
            if not att.check_in:
                att.display_name = _("New")
                continue
            tz_name = 'UTC'
            if att.employee_id:
                cfg = Config.get_config_for_employee(att.employee_id.id)
                tz_name = cfg.get('timezone') or att.employee_id.tz or 'UTC'
            tz = pytz.timezone(tz_name)
            ci = pytz.utc.localize(att.check_in).astimezone(tz).strftime('%I:%M %p')
            if not att.check_out:
                att.display_name = _("From %s", ci)
            else:
                co = pytz.utc.localize(att.check_out).astimezone(tz).strftime('%I:%M %p')
                att.display_name = "%s (%s-%s)" % (format_duration(att.worked_hours), ci, co)

    @api.depends('check_in', 'check_out', 'employee_id')
    def _compute_office_time(self):
        Config = self.env['hr.attendance.late.config']
        for rec in self:
            tz_name = 'UTC'
            if rec.employee_id:
                config_data = Config.get_config_for_employee(rec.employee_id.id)
                tz_name = config_data.get('timezone') or rec.employee_id.tz or 'UTC'
            tz = pytz.timezone(tz_name)

            def _fmt(dt):
                if not dt:
                    return ''
                local = pytz.utc.localize(dt).astimezone(tz)
                return local.strftime('%d %b %Y, %I:%M %p')

            rec.check_in_office_time = _fmt(rec.check_in)
            rec.check_out_office_time = _fmt(rec.check_out)

    # --- Self-healing recompute on create / write ---
    #
    # Stored compute fields can lag when a sibling record's `is_late` is
    # updated by `_compute_late_info` but the in-memory cache hasn't been
    # flushed to the DB before the next compute runs its search. Force a
    # flush between each step so HR doesn't have to click the Recompute
    # button after every save.

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        # Before the compute chain: linking sets work_location, and the day
        # row's stored status_display reads is_wfh off it. Doing it first means
        # the row is written with the " . WFH" suffix already on it instead of
        # being corrected a moment later.
        recs._run_wfh_sync(link=True)
        try:
            # Run the FULL late-tracking compute chain after create so a brand
            # new attendance gets is_late / late_minutes populated
            # immediately. Flush between each step so downstream searches see
            # committed values from the previous step.
            recs.flush_recordset()
            recs._compute_late_info()
            recs.flush_recordset()
            recs._compute_late_minutes_display()
            recs.flush_recordset()
            recs._sync_day_status()
        except (ValidationError, UserError):
            # Validation popups (e.g. "enter the late reason", no-reentry) must
            # bubble up to the user and roll back the save, not be swallowed.
            raise
        except Exception:
            _logger.exception("[late-deduction] post-create recompute failed")
        return recs

    def write(self, vals):
        res = super().write(vals)
        # check_in moving can carry a record onto (or off) a WFH day; check_out
        # is what closes the linked request.
        if 'check_in' in vals or 'check_out' in vals:
            self._run_wfh_sync(link='check_in' in vals, close='check_out' in vals)
        if any(k in vals for k in ('check_in', 'check_out', 'employee_id')):
            try:
                self.flush_recordset()
                self._compute_late_info()
                self.flush_recordset()
                self._compute_late_minutes_display()
                self.flush_recordset()
                self._sync_day_status()
            except (ValidationError, UserError):
                raise
            except Exception:
                _logger.exception("[late-deduction] post-write recompute failed")
        return res

    @api.depends('check_in', 'employee_id')
    def _compute_late_info(self):
        """Flag a check-in as late against the single office start time.

        One continuous office day: everything is timed against
        `office_start_hour` plus the grace threshold. `is_late` and
        `late_minutes` stay honest whatever the hour. Whether the day is
        GRADED Late or Present is decided separately by `_past_late_window`;
        either way it costs nothing -- only half days and unpaid leave are
        deducted.
        """
        Config = self.env['hr.attendance.late.config']
        for rec in self:
            rec.is_late = False
            rec.late_minutes = 0
            rec.expected_start_time = 0.0

            if not rec.check_in or not rec.employee_id:
                continue

            config_data = Config.get_config_for_employee(rec.employee_id.id)

            # Master switch: with late tracking off nothing is flagged.
            # Everything downstream (deduction, the reason constraint, the
            # reason button) keys off is_late, so this one gate switches the
            # whole feature off.
            if not config_data.get('late_tracking_enabled', True):
                continue

            threshold = config_data.get('late_threshold_minutes', 15)
            office_start = config_data.get('office_start_hour', 8.0)

            tz = pytz.timezone(config_data.get('timezone') or rec.employee_id.tz or 'UTC')
            local_dt = pytz.utc.localize(rec.check_in).astimezone(tz)

            rec.expected_start_time = office_start

            office_hour = int(office_start)
            office_minute = int((office_start - office_hour) * 60)
            office_start_dt = local_dt.replace(
                hour=office_hour, minute=office_minute, second=0, microsecond=0
            )
            allowed_dt = office_start_dt + timedelta(minutes=threshold)

            if local_dt > allowed_dt:
                diff = local_dt - office_start_dt
                rec.late_minutes = int(diff.total_seconds() / 60)
                rec.is_late = True

    @api.model
    def evaluate_late_for(self, employee_id, check_in_dt):
        """Late status for a *hypothetical* check-in, without creating a record.

        Mirrors `_compute_late_info` so the "reason-before-check-in" flow can
        decide whether to prompt before any hr.attendance row exists.

        `check_in_dt` is a naive UTC datetime (same convention as the stored
        `check_in` field). Returns
        {is_late, late_minutes, late_minutes_display, expected_start_time}.
        """
        Config = self.env['hr.attendance.late.config']
        result = {
            'is_late': False,
            'late_minutes': 0,
            'late_minutes_display': '',
            'expected_start_time': 0.0,
        }
        employee = self.env['hr.employee'].sudo().browse(employee_id)
        if not check_in_dt or not employee.exists():
            return result

        config_data = Config.get_config_for_employee(employee_id)
        # Late tracking off -> never late. Keeps the mobile "should I prompt
        # for a reason?" pre-check-in call in step with the backend.
        if not config_data.get('late_tracking_enabled', True):
            return result

        threshold = config_data.get('late_threshold_minutes', 15)
        office_start = config_data.get('office_start_hour', 8.0)
        tz = pytz.timezone(config_data.get('timezone') or employee.tz or 'UTC')
        # Accept naive (assumed UTC) or tz-aware datetimes.
        if check_in_dt.tzinfo is None:
            local_dt = pytz.utc.localize(check_in_dt).astimezone(tz)
        else:
            local_dt = check_in_dt.astimezone(tz)

        office_hour = int(office_start)
        office_minute = int((office_start - office_hour) * 60)
        office_start_dt = local_dt.replace(
            hour=office_hour, minute=office_minute, second=0, microsecond=0
        )
        allowed_dt = office_start_dt + timedelta(minutes=threshold)

        result['expected_start_time'] = office_start
        if local_dt > allowed_dt:
            lm = int((local_dt - office_start_dt).total_seconds() / 60)
            result['is_late'] = True
            result['late_minutes'] = lm
            result['late_minutes_display'] = '%d:%02d' % (lm // 60, lm % 60)
        return result

    # ------------------------------------------------------------------ #
    # Office-clock helpers                                                #
    # ------------------------------------------------------------------ #
    def _office_local_hour(self, config_data=None):
        """This record's check_in as a float hour (13.5 == 1:30 PM) in the
        OFFICE timezone.

        Same timezone ladder every other compute in this file uses: the config's
        Office Timezone, then the employee's own, then UTC. Pass `config_data`
        in when the caller already has it, so a loop over many records does not
        re-read the config once per row.
        """
        self.ensure_one()
        if not self.check_in:
            return 0.0
        if config_data is None:
            config_data = self.env['hr.attendance.late.config'].get_config_for_employee(
                self.employee_id.id)
        tz = pytz.timezone(config_data.get('timezone') or self.employee_id.tz or 'UTC')
        local = pytz.utc.localize(self.check_in).astimezone(tz)
        return local.hour + local.minute / 60.0

    def _office_day_window(self, config_data=None):
        """UTC bounds of the office-local day this check-in falls in."""
        self.ensure_one()
        if config_data is None:
            config_data = self.env['hr.attendance.late.config'].get_config_for_employee(
                self.employee_id.id)
        tz = pytz.timezone(config_data.get('timezone') or self.employee_id.tz or 'UTC')
        local_dt = pytz.utc.localize(self.check_in).astimezone(tz)
        day_start = local_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        start = day_start.astimezone(pytz.utc).replace(tzinfo=None)
        end = (day_start + timedelta(days=1)).astimezone(pytz.utc).replace(tzinfo=None)
        return start, end

    def _is_day_first_checkin(self, config_data=None):
        """True when this is the EARLIEST check-in of its office-local day.

        Replaces what `late_sequence` used to do for deduplication: the day is
        graded and charged on the arrival, once. A second check-in the same day
        is blocked outright by `_check_no_reentry_same_day`, but this stays as
        the guard for the paths that legitimately bypass it (a reopened record
        from the KRA bridge, an import, a manual fix by HR).
        """
        self.ensure_one()
        if not self.check_in or not self.employee_id:
            return False
        start, end = self._office_day_window(config_data)
        earlier = self.search_count([
            ('employee_id', '=', self.employee_id.id),
            ('check_in', '>=', start),
            ('check_in', '<', self.check_in),
            ('id', '!=', self.id),
        ])
        return not earlier

    def _past_late_window(self, config_data=None):
        """True when this check-in landed at or after `late_until_hour`.

        Past that hour the day is graded Present by hr.attendance.day.status
        rather than Late. This is purely a STATUS question now -- lateness has
        no monetary consequence at all. `is_late` and `late_minutes` are left
        alone either way, so the record still shows the person was late.

        Returns False when the feature is off (late_until_hour = 0.0, the
        default), so nothing changes on a database that never configures it.
        """
        self.ensure_one()
        if not self.check_in or not self.employee_id:
            return False
        if config_data is None:
            config_data = self.env['hr.attendance.late.config'].get_config_for_employee(
                self.employee_id.id)
        limit = config_data.get('late_until_hour') or 0.0
        if limit <= 0:
            return False
        return self._office_local_hour(config_data) >= limit

    def _sync_day_status(self):
        """Upsert the hr.attendance.day.status row for each record's local day.

        Defensive by design: a day-status failure must never roll back the
        attendance itself, which is the record of fact.
        """
        DayStatus = self.env['hr.attendance.day.status'].sudo()
        for rec in self:
            if not rec.employee_id or not rec.check_in:
                continue
            try:
                # Savepoint so a day-status failure (a unique-constraint race on
                # employee+date, say) cannot leave the transaction aborted and
                # take the attendance itself down with it.
                with self.env.cr.savepoint():
                    DayStatus._upsert_for_attendance(rec)
            except Exception:
                _logger.exception("[day-status] upsert failed for attendance %s", rec.id)

    @api.depends('employee_id', 'date')
    def _compute_daily_total_hours(self):
        for rec in self:
            if not rec.employee_id or not rec.date:
                rec.daily_total_hours = 0.0
                continue

            day_records = self.search([
                ('employee_id', '=', rec.employee_id.id),
                ('date', '=', rec.date),
                ('check_out', '!=', False),
            ])
            total = sum(
                (r.check_out - r.check_in).total_seconds() / 3600.0
                for r in day_records
                if r.check_in and r.check_out
            )
            rec.daily_total_hours = round(total, 2)

    # --- Constraints ---

    # Trigger on check_in / late_reason but NOT on is_late: is_late
    # is a stored compute that depends on check_in, so it only ever flips to
    # True when check_in is (re)written — already a trigger here. Leaving is_late
    # out keeps a plain `-u` upgrade recompute (which may re-evaluate is_late on
    # historical reason-less rows) from aborting on this constraint.
    @api.constrains('late_reason', 'check_in')
    def _check_late_reason_required(self):
        """Backend-only: a late check-in cannot be saved without a Late Reason.

        Bypassed (context flag) for the non-interactive entry points that
        cannot collect a reason at save time and instead enforce it through
        their own post-check-in popup: the mobile RPC creates
        (`skip_late_reason_required`), the standard kiosk/self check-in widget
        (see the `hr.employee._attendance_action_change` override in
        hr_employee.py), and data imports (`import_file`).

        This deliberately re-introduces the previously-removed
        `_check_late_reason_required` constraint, but scoped to the interactive
        Odoo backend (form Save button + inline list edits) so it no longer
        breaks the mobile "create first, then prompt" flow.
        """
        if self.env.context.get('skip_late_reason_required') or self.env.context.get('import_file'):
            return
        Config = self.env['hr.attendance.late.config']
        for rec in self:
            if not rec.check_in:
                continue
            # Resolved per record, not once for the recordset: the config is
            # per company/department, so two employees in the same save can
            # legitimately disagree about whether a reason is required.
            if not rec.employee_id:
                continue
            config_data = Config.get_config_for_employee(rec.employee_id.id)
            if not config_data.get('late_tracking_enabled', True):
                continue
            if not config_data.get('late_reason_required', True):
                continue
            if rec.is_late and not (rec.late_reason and rec.late_reason.strip()):
                raise ValidationError(_(
                    "This is a late check-in. Please enter the Late Reason before saving."
                ))

    # --- One check-in per day enforcement ---

    @api.constrains('check_in', 'employee_id')
    def _check_no_reentry_same_day(self):
        """Block a new check-in once the employee has already checked OUT today.

        One check-in per day: the day is graded on the first arrival, so
        re-entering after a check-out would create a second arrival that
        nothing grades and nothing charges.

        Catches every entry point -- backend create, kiosk, mobile RPC,
        imports -- because it is an ORM constraint.
        """
        for rec in self:
            if not rec.check_in or not rec.employee_id:
                continue
            # Only blocks a NEW, still-open check-in. Records that already
            # carry a check_out are skipped, which is what lets the KRA bridge
            # write its check-out, and stops an upgrade recompute retroactively
            # rejecting historical rows.
            if rec.check_out:
                continue

            start, end = rec._office_day_window()
            existing_closed = self.search([
                ('employee_id', '=', rec.employee_id.id),
                ('check_in', '>=', start),
                ('check_in', '<', end),
                ('check_out', '!=', False),
                ('id', '!=', rec.id),
            ], limit=1)

            if existing_closed:
                raise ValidationError(_(
                    "You have already checked out today.\n\n"
                    "Once you check out, you cannot check in again on the "
                    "same day. Please wait until tomorrow."
                ))

    @api.onchange('check_out')
    def _onchange_check_out_warn(self):
        """Show a warning popup the moment the user fills `check_out` on
        the form, so they know this closes the day.

        This is a single-OK heads-up — the hard rule is enforced by the
        `_check_no_reentry_same_day` constraint above, which fires on any
        future re-check-in attempt regardless of UI surface.
        """
        if not self.check_out:
            return
        return {
            'warning': {
                'title': _('Confirm Check Out'),
                'message': _(
                    "You are about to check out for the day.\n\n"
                    "Once checked out, you CANNOT check in again today. "
                    "To re-enter, you would need to wait until tomorrow."
                ),
            }
        }

    # --- Wizard launchers ---

    def action_open_checkout_confirm_wizard(self):
        """Open the check-out confirmation wizard with Cancel + Sure-Check-Out
        buttons. Provides the Cancel/Confirm UX that `@api.onchange` cannot
        (onchange.warning is single-button only)."""
        self.ensure_one()
        return {
            'name': _('Confirm Check Out'),
            'type': 'ir.actions.act_window',
            'res_model': 'hr.attendance.checkout.confirm.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_attendance_id': self.id,
            },
        }

    def action_open_late_reason_wizard(self):
        """Open the late-reason wizard popup pre-filled with this attendance.
        Mirrors the mobile app's late-reason modal — the user types the reason
        in the wizard and clicks Save, which writes back to `late_reason` on
        this record (same field the mobile submitLateReason endpoint writes).
        """
        self.ensure_one()
        return {
            'name': _('Enter Late Reason'),
            'type': 'ir.actions.act_window',
            'res_model': 'hr.attendance.late.reason.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_attendance_id': self.id,
            },
        }

    # --- API methods ---

    @api.model
    def preview_late_info(self, employee_id, check_in):
        """No-save PREVIEW of the late metrics for a hypothetical check-in.

        Computes lateness on an in-memory `new()` record -- no write -- so the
        backend "Enter Late Reason" popup can show how late somebody is and
        what time was expected, before the record is saved.

        `check_in` is the UTC datetime string sent by the web client
        (serializeDateTime). Returns {} when not applicable.
        """
        if not employee_id or not check_in:
            return {}
        employee = self.env['hr.employee'].browse(employee_id)
        if not employee.exists():
            return {}

        check_in_dt = fields.Datetime.to_datetime(check_in)
        rec = self.new({'employee_id': employee_id, 'check_in': check_in_dt})
        rec._compute_late_info()
        rec._compute_late_minutes_display()

        info = {
            'is_late': bool(rec.is_late),
            'late_minutes': int(rec.late_minutes or 0),
            'late_minutes_display': rec.late_minutes_display or '',
            'expected_start_time': float(rec.expected_start_time or 0.0),
        }
        return info

    @api.model
    def get_late_attendance_report(self, employee_id=None, department_id=None,
                                   date_from=None, date_to=None):
        domain = [('is_late', '=', True)]
        if employee_id:
            domain.append(('employee_id', '=', employee_id))
        if department_id:
            domain.append(('department_id', '=', department_id))
        if date_from:
            domain.append(('date', '>=', date_from))
        if date_to:
            domain.append(('date', '<=', date_to))

        records = self.search(domain, order='date desc')
        return [{
            'id': r.id,
            'employee_id': r.employee_id.id,
            'employee_name': r.employee_id.name,
            'department': r.employee_id.department_id.name or '',
            'attendance_date': str(r.date),
            'check_in': str(r.check_in),
            'expected_start_time': r.expected_start_time,
            'late_minutes': r.late_minutes,
            'late_minutes_display': r.late_minutes_display,
            'late_reason': r.late_reason or '',
            'daily_total_hours': r.daily_total_hours,
        } for r in records]
