"""Notifications: the bell feed, the per-event switches, and phone push.

Three models:

- hr.attendance.notify.event  one row per kind of notification, with the two
                              switches an admin can flip (bell + push). The
                              catalog lives in NOTIFY_CATALOG below and is
                              synced on every install/upgrade, never touching
                              a switch somebody already set.
- hr.attendance.push.device   the phones that asked to be told (Expo tokens),
                              the same shape as showroom_check's
                              cleaning.push.device and KRA's kpi.push.token.
- hr.attendance.notification  the feed behind the app's bell, one row per
                              person per event, and the single entry point
                              every hook calls: _notify().

Timing. Business models do not notify from inside their action methods --
too many real transitions bypass those (see notify_hooks.py). They queue what
changed on the cursor's PRECOMMIT, which runs once all the writes of the
transaction are flushed, so a message is built from the final values (a
reject reason written after action_reject is there). The feed rows are
created in that same transaction; the push goes out on POSTCOMMIT, so a save
that rolls back never puts a message on anybody's phone.

Never let a notification break the thing it reports on: every handler runs in
its own savepoint and swallows its own errors.
"""
import json
import logging
from datetime import timedelta

import pytz

from odoo import SUPERUSER_ID, _, api, fields, models

from . import notify_push as provider

_logger = logging.getLogger(__name__)

PUSH_PARAM = 'hr_attendance_369.notify_push_enabled'

CATEGORIES = [
    ('attendance', 'Attendance'),
    ('leave', 'Leave'),
    ('wfh', 'Work From Home'),
    ('compoff', 'Comp Off'),
    ('payroll', 'Payroll'),
    ('holiday', 'Holidays'),
    ('other', 'Profile & Devices'),
    ('system', 'System'),
]

AUDIENCES = [
    ('employee', 'Employee'),
    ('hr', 'HR'),
    ('admin', 'Admin'),
]

# (code, category, audience, name, description)
NOTIFY_CATALOG = [
    # --- Attendance -------------------------------------------------------
    ('emp_checkin', 'attendance', 'employee', 'Checked in',
     "Confirms each check-in, from the app, KRA Start Workday, WFH or the kiosk."),
    ('emp_checkout', 'attendance', 'employee', 'Checked out',
     "Confirms each check-out with the hours worked."),
    ('emp_late', 'attendance', 'employee', 'You were late',
     "Sent instead of 'Checked in' when the check-in is late; asks for a reason."),
    ('emp_halfday', 'attendance', 'employee', 'Marked Half Day',
     "The day was graded Half Day, which costs half a day's pay."),
    ('emp_absent', 'attendance', 'employee', 'Marked Absent',
     "Nobody checked in by the office's cutoff and the day was stamped Absent."),
    ('emp_checkin_reminder', 'attendance', 'employee', 'Check-in reminder',
     "Not checked in by office start plus grace, on a working day."),
    ('emp_checkout_reminder', 'attendance', 'employee', 'Check-out reminder',
     "Still checked in 30 minutes after office end."),
    ('emp_att_created', 'attendance', 'employee', 'HR added your attendance',
     "Somebody else recorded an attendance for this employee."),
    ('emp_att_edited', 'attendance', 'employee', 'HR changed your attendance',
     "Somebody else changed this employee's check-in or check-out."),
    ('emp_att_deleted', 'attendance', 'employee', 'HR deleted your attendance',
     "Somebody deleted one of this employee's attendances; the day is re-graded."),
    ('emp_policy_changed', 'attendance', 'employee', 'Office hours changed',
     "Office hours or late rules changed for the employee's office."),
    ('hr_checkin', 'attendance', 'hr', 'Employee checked in',
     "Every check-in, to attendance HR. Turn off if it is too much."),
    ('hr_checkout', 'attendance', 'hr', 'Employee checked out',
     "Every check-out, to attendance HR. Turn off if it is too much."),
    ('hr_late', 'attendance', 'hr', 'Employee checked in late',
     "Sent instead of 'Employee checked in' for a late check-in."),
    ('hr_late_reason', 'attendance', 'hr', 'Late reason submitted',
     "An employee explained a late check-in from the app."),
    ('hr_halfday', 'attendance', 'hr', 'Employee marked Half Day', ""),
    ('hr_absent_digest', 'attendance', 'hr', 'Absent today',
     "One message per absent-stamp run, listing who was stamped Absent."),
    ('hr_missed_checkout', 'attendance', 'hr', 'Missed check-outs',
     "Each morning: who never checked out yesterday."),
    ('adm_att_deleted', 'attendance', 'admin', 'Attendance deleted (audit)',
     "Who deleted whose attendance. Deletions leave no other trace."),
    ('adm_policy_changed', 'attendance', 'admin', 'Office hours changed (audit)', ""),
    # --- Leave --------------------------------------------------------------
    ('emp_leave_approved', 'leave', 'employee', 'Leave approved', ""),
    ('emp_leave_auto', 'leave', 'employee', 'Leave auto-approved', ""),
    ('emp_leave_rejected', 'leave', 'employee', 'Leave rejected', "Includes the reason."),
    ('emp_leave_cancel_ok', 'leave', 'employee', 'Leave cancellation approved', ""),
    ('emp_leave_cancel_no', 'leave', 'employee', 'Leave cancellation declined', ""),
    ('emp_leave_cancelled_by_hr', 'leave', 'employee', 'Leave cancelled by HR', ""),
    ('hr_leave_new', 'leave', 'hr', 'New leave request', ""),
    ('hr_leave_auto', 'leave', 'hr', 'Leave auto-approved', "FYI when nobody answered in time."),
    ('hr_leave_cancel_req', 'leave', 'hr', 'Leave cancellation requested', ""),
    ('hr_leave_withdrawn', 'leave', 'hr', 'Leave request withdrawn', ""),
    # --- WFH ----------------------------------------------------------------
    ('emp_wfh_approved', 'wfh', 'employee', 'WFH approved', ""),
    ('emp_wfh_auto', 'wfh', 'employee', 'WFH auto-approved', ""),
    ('emp_wfh_rejected', 'wfh', 'employee', 'WFH rejected', "Includes the reason."),
    ('emp_wfh_expired', 'wfh', 'employee', 'WFH expired', "Approved WFH day passed unused."),
    ('hr_wfh_new', 'wfh', 'hr', 'New WFH request', ""),
    ('hr_wfh_auto', 'wfh', 'hr', 'WFH auto-approved', ""),
    ('hr_wfh_withdrawn', 'wfh', 'hr', 'WFH request withdrawn', ""),
    # --- Comp off -----------------------------------------------------------
    ('emp_compoff_credited', 'compoff', 'employee', 'Comp off credited', ""),
    ('emp_compoff_cancelled', 'compoff', 'employee', 'Comp off cancelled', ""),
    ('emp_compoff_expiring', 'compoff', 'employee', 'Comp off expiring soon', "7 days before expiry."),
    ('emp_compoff_expired', 'compoff', 'employee', 'Comp off expired', ""),
    ('hr_compoff_declared', 'compoff', 'hr', 'Working on a day off',
     "An employee declared they are working today (comp off)."),
    # --- Payroll ------------------------------------------------------------
    ('emp_payslip_ready', 'payroll', 'employee', 'Payslip ready', ""),
    ('emp_payslip_paid', 'payroll', 'employee', 'Salary paid', ""),
    ('hr_payroll_generated', 'payroll', 'hr', 'Payslips generated', ""),
    # --- Holidays -----------------------------------------------------------
    ('emp_holiday_added', 'holiday', 'employee', 'Holiday added', ""),
    ('emp_holiday_moved', 'holiday', 'employee', 'Holiday moved', ""),
    ('emp_holiday_removed', 'holiday', 'employee', 'Holiday removed', ""),
    ('emp_holiday_tomorrow', 'holiday', 'employee', 'Holiday tomorrow', ""),
    # --- Profile, devices, manuals, reminders --------------------------------
    ('emp_device_changed', 'other', 'employee', 'Your device changed', ""),
    ('emp_manual_new', 'other', 'employee', 'New app manual', ""),
    ('hr_device_new', 'other', 'hr', 'Device registered', ""),
    ('hr_profile_updated', 'other', 'hr', 'Employee updated their details', ""),
    ('hr_pending_reminder', 'other', 'hr', 'Requests waiting',
     "Daily: leave and WFH requests pending for more than 24 hours."),
    # --- System -------------------------------------------------------------
    ('emp_kra_sync_failed', 'system', 'employee', 'Workday not recorded',
     "KRA Start/End Workday could not record the attendance."),
    ('adm_kra_sync_failed', 'system', 'admin', 'KRA attendance sync failed', ""),
    ('adm_kra_no_employee', 'system', 'admin', 'KRA user without employee', ""),
    ('adm_wa_failed', 'system', 'admin', 'WhatsApp post failed', ""),
    ('adm_wa_not_ready', 'system', 'admin', 'WhatsApp not set up', ""),
]

# Who "HR" is for each kind of event. Admins (base.group_system) are always
# added on top, so they get every HR notification.
HR_GROUPS = {
    'leave': ['hr_attendance_369.group_leave_manager'],
    'wfh': ['hr_attendance_369.group_wfh_manager'],
    'attendance': ['hr.group_hr_user'],
    'payroll': ['hr.group_hr_manager'],
    'admin': [],
}


class AttendanceNotifyEvent(models.Model):
    _name = 'hr.attendance.notify.event'
    _description = 'Notification Type'
    _order = 'category, audience, sequence, id'

    code = fields.Char(required=True, readonly=True, index=True)
    name = fields.Char(required=True)
    description = fields.Char()
    category = fields.Selection(CATEGORIES, required=True, default='other')
    audience = fields.Selection(AUDIENCES, string='Sent To', required=True, default='employee')
    sequence = fields.Integer(default=10)
    enabled = fields.Boolean(
        string='On', default=True,
        help="Off: nothing is sent for this event, neither the bell nor push.")
    push = fields.Boolean(
        string='Phone Push', default=True,
        help="Off: the event still appears under the app's bell, but does not "
             "buzz the phone.")

    _uniq_code = models.Constraint('UNIQUE (code)', 'Each notification type exists once.')

    @api.model
    def _sync_catalog(self):
        """Create the types that are missing and refresh their labels.

        Called from data on every install and upgrade. The two switches are
        never touched once a row exists: they are the admin's decision.
        """
        existing = {e.code: e for e in self.sudo().with_context(active_test=False).search([])}
        for seq, (code, category, audience, name, desc) in enumerate(NOTIFY_CATALOG):
            vals = {'name': name, 'description': desc or False, 'category': category,
                    'audience': audience, 'sequence': seq}
            if code in existing:
                existing[code].write(vals)
            else:
                self.sudo().create(dict(vals, code=code))
        return True

    @api.model
    def _switches(self, code):
        """(enabled, push) for a code. Unknown codes count as on."""
        event = self.sudo().search([('code', '=', code)], limit=1)
        if not event:
            return True, True
        return event.enabled, event.push

    # App-facing, admin only (the ACL decides): the Config tab's toggle list.
    @api.model
    def app_list(self):
        return [{
            'id': e.id, 'code': e.code, 'name': e.name,
            'description': e.description or '', 'category': e.category,
            'audience': e.audience, 'enabled': e.enabled, 'push': e.push,
        } for e in self.search([])]


class AttendancePushDevice(models.Model):
    _name = 'hr.attendance.push.device'
    _description = 'Attendance App Phone'
    _order = 'last_seen_at desc, id desc'
    _rec_name = 'device'

    user_id = fields.Many2one('res.users', required=True, index=True, ondelete='cascade')
    token = fields.Char(string='Expo Push Token', required=True, index=True)
    platform = fields.Selection([('android', 'Android'), ('ios', 'iOS')],
                                default='android', required=True)
    device = fields.Char()
    project_id = fields.Char(
        string='EAS Project',
        help="Which EAS project minted this token. Sends are grouped by it, "
             "because Expo rejects a whole request that spans two projects.")
    active = fields.Boolean(default=True,
                            help="Cleared when Expo reports the phone as gone.")
    last_seen_at = fields.Datetime(string='Last Registered')

    _uniq_token = models.Constraint('UNIQUE (token)', 'This phone is already registered.')

    @api.model
    def register_device(self, token, platform='android', device=None, project_id=None):
        """Remember this phone for the signed-in user. Called by the app after
        sign-in. Never raises: a phone that cannot register falls back to the
        bell quietly rather than failing somebody's sign-in."""
        token = (token or '').strip()
        if not token or self.env.user.share:
            return False
        vals = {
            'user_id': self.env.user.id,
            'platform': platform if platform in ('android', 'ios') else 'android',
            'device': (device or '')[:100] or False,
            'project_id': (project_id or '').strip() or False,
            'last_seen_at': fields.Datetime.now(),
            'active': True,
        }
        # sudo(): a shared phone the next person signs in on must MOVE to them,
        # and the row belongs to somebody else until it does.
        existing = self.sudo().with_context(active_test=False).search(
            [('token', '=', token)], limit=1)
        if existing:
            existing.write(vals)
        else:
            self.sudo().create(dict(vals, token=token))
        return True

    @api.model
    def unregister_device(self, token):
        """Forget this phone. Called by the app on sign-out."""
        token = (token or '').strip()
        if token:
            self.sudo().with_context(active_test=False).search([('token', '=', token)]).unlink()
        return True

    def _grouped_by_project(self):
        groups = {}
        for device in self:
            key = device.project_id or False
            groups[key] = groups.get(key, self.browse()) | device
        return groups


class AttendanceNotification(models.Model):
    _name = 'hr.attendance.notification'
    _description = 'Attendance Notification'
    _order = 'id desc'
    _rec_name = 'title'

    user_id = fields.Many2one('res.users', required=True, index=True, ondelete='cascade')
    event_code = fields.Char(index=True)
    category = fields.Selection(CATEGORIES)
    title = fields.Char(required=True)
    body = fields.Char()
    res_model = fields.Char()
    res_id = fields.Integer()
    screen = fields.Char(help="App screen the notification opens.")
    params = fields.Char(help="JSON params for that screen.")
    is_read = fields.Boolean(default=False, index=True)
    company_id = fields.Many2one('res.company', index=True)

    # ================================================================== #
    # The one entry point                                                #
    # ================================================================== #
    @api.model
    def _notify(self, code, users, title, body='', record=None, screen=None,
                params=None, include_actor=False):
        """Tell `users` about `code`. Returns the feed rows created.

        The person who caused the event is dropped unless include_actor --
        nobody needs telling what they just did, except for the confirmations
        that exist to say exactly that (checked in / checked out).
        """
        try:
            enabled, push = self.env['hr.attendance.notify.event']._switches(code)
            if not enabled or not users:
                return self.browse()
            users = users.sudo().filtered(
                lambda u: u.active and not u.share and u.id != SUPERUSER_ID)
            if not include_actor:
                users -= self.env.user
            if not users:
                return self.browse()

            category = next((c[1] for c in NOTIFY_CATALOG if c[0] == code), 'other')
            params_json = json.dumps(params) if params else False
            # A savepoint so a failed insert can never leave the business
            # transaction that called us aborted.
            with self.env.cr.savepoint():
                rows = self._create_rows(users, code, category, title, body, record,
                                         screen, params_json)
            if push:
                for row in rows:
                    self._queue_push(row.user_id.id, title, body, {
                        'notificationId': row.id,
                        'code': code,
                        'screen': screen or '',
                        'params': params or {},
                    })
            return rows
        except Exception:
            _logger.exception("[notify] could not notify %s", code)
            return self.browse()

    @api.model
    def _create_rows(self, users, code, category, title, body, record, screen, params_json):
        return self.sudo().create([{
                'user_id': u.id,
                'event_code': code,
                'category': category,
                'title': title,
                'body': body or False,
                'res_model': record._name if record else False,
                'res_id': record.id if record else 0,
                'screen': screen or False,
                'params': params_json,
                'company_id': (record.company_id.id if record and 'company_id' in record._fields
                               and record.company_id else u.company_id.id),
            } for u in users])

    # ================================================================== #
    # Push, after commit                                                 #
    # ================================================================== #
    @api.model
    def _queue_push(self, user_id, title, body, data):
        postcommit = self.env.cr.postcommit
        key = 'hr_attendance_369.push'
        if key not in postcommit.data:
            postcommit.data[key] = []
            registry = self.env.registry
            items = postcommit.data[key]

            def _send():
                try:
                    with registry.cursor() as cr:
                        env = api.Environment(cr, SUPERUSER_ID, {})
                        env['hr.attendance.notification']._send_push_items(items)
                except Exception:
                    _logger.exception("[notify] push sending failed")

            postcommit.add(_send)
        postcommit.data[key].append((user_id, title, body, data))

    @api.model
    def _push_enabled(self):
        return self.env['ir.config_parameter'].sudo().get_param(PUSH_PARAM, '1') not in ('0', 'False', 'false', '')

    @api.model
    def _send_push_items(self, items):
        """Send queued (user_id, title, body, data) items. Returns how many
        messages Expo accepted. Raises PushError only for the test button."""
        if not items or not self._push_enabled():
            return 0
        Device = self.env['hr.attendance.push.device'].sudo()
        devices = Device.search([('user_id', 'in', list({i[0] for i in items}))])
        if not devices:
            return 0
        by_user = {}
        for dev in devices:
            by_user.setdefault(dev.user_id.id, []).append(dev)

        # (project, message) pairs, then batched per project.
        per_project = {}
        for user_id, title, body, data in items:
            for dev in by_user.get(user_id, []):
                per_project.setdefault(dev.project_id or False, []).append(
                    provider.build_message(dev.token, title, body, data))

        sent, retire = 0, []
        for messages in per_project.values():
            for start in range(0, len(messages), provider.MAX_BATCH):
                result = provider.send_batch(messages[start:start + provider.MAX_BATCH])
                sent += result['sent']
                retire.extend(result['retire'])
        if retire:
            Device.search([('token', 'in', retire)]).write({'active': False})
        return sent

    # ================================================================== #
    # Changes queued by business models, handled before commit           #
    # ================================================================== #
    @api.model
    def _queue_change(self, kind, payload):
        """Remember a change; handle it once the transaction's writes are done.

        `kind` names a handler, _on_<kind>(payloads), in notify_hooks.py.
        """
        precommit = self.env.cr.precommit
        key = 'hr_attendance_369.changes'
        if key not in precommit.data:
            precommit.data[key] = []
            env = self.env

            def _run():
                queued = precommit.data.pop(key, [])
                env['hr.attendance.notification']._process_changes(queued)

            precommit.add(_run)
        precommit.data[key].append((kind, payload))

    @api.model
    def _process_changes(self, queued):
        by_kind = {}
        for kind, payload in queued:
            by_kind.setdefault(kind, []).append(payload)
        for kind, payloads in by_kind.items():
            handler = getattr(self, '_on_%s' % kind, None)
            if not handler:
                continue
            try:
                with self.env.cr.savepoint():
                    handler(payloads)
            except Exception:
                _logger.exception("[notify] handler %s failed", kind)

    # ================================================================== #
    # Recipients and formatting                                          #
    # ================================================================== #
    @api.model
    def _hr_users(self, kind, company=None):
        """Who handles `kind` ('leave' | 'wfh' | 'attendance' | 'payroll' |
        'admin'), plus every admin. Optionally narrowed to one company."""
        users = self.env['res.users'].sudo()
        for xmlid in HR_GROUPS.get(kind, []) + ['base.group_system']:
            group = self.env.ref(xmlid, raise_if_not_found=False)
            if group:
                users |= group.sudo().all_user_ids
        users = users.filtered(lambda u: u.active and not u.share and u.id != SUPERUSER_ID)
        if company:
            users = users.filtered(lambda u: company in u.company_ids)
        return users

    @api.model
    def _company_users(self, company):
        """Every signed-in employee of a company (for holidays, policy)."""
        employees = self.env['hr.employee'].sudo().search([
            ('company_id', '=', company.id), ('user_id', '!=', False)])
        return employees.mapped('user_id')

    @api.model
    def _tz(self, employee):
        name = self.env['hr.attendance.late.config'].sudo().get_office_timezone(
            employee.id if employee else False)
        try:
            return pytz.timezone(name)
        except Exception:
            return pytz.utc

    @api.model
    def _local(self, dt, employee):
        return pytz.utc.localize(dt).astimezone(self._tz(employee)) if dt else None

    @api.model
    def _hm(self, dt, employee):
        local = self._local(dt, employee)
        return local.strftime('%I:%M %p').lstrip('0') if local else ''

    @api.model
    def _day(self, d):
        return d.strftime('%d %b').lstrip('0') if d else ''

    @api.model
    def _range(self, d1, d2):
        if not d2 or d2 == d1:
            return self._day(d1)
        if d1.month == d2.month and d1.year == d2.year:
            return '%s–%s' % (str(d1.day), self._day(d2))
        return '%s – %s' % (self._day(d1), self._day(d2))

    @api.model
    def _dur(self, hours):
        """0.083 -> '5 min', 8.58 -> '8h 35m'."""
        h, m = divmod(int(round((hours or 0.0) * 60)), 60)
        if h and m:
            return '%dh %dm' % (h, m)
        return '%dh' % h if h else '%d min' % m

    @api.model
    def _plural(self, n, word):
        return '%s %s%s' % (('%g' % n) if isinstance(n, float) else n, word, '' if n == 1 else 's')

    @api.model
    def _already_sent(self, code, user, since, res_id=None):
        """Has `user` had `code` since `since` (UTC)? The once-per-day guard."""
        domain = [('event_code', '=', code), ('user_id', '=', user.id),
                  ('create_date', '>=', since)]
        if res_id:
            domain.append(('res_id', '=', res_id))
        return bool(self.sudo().search_count(domain, limit=1))

    @api.model
    def _once_per_day(self, key, day):
        """Global once-a-day guard for digests (one param per digest)."""
        param = 'hr_attendance_369.digest.%s' % key
        ICP = self.env['ir.config_parameter'].sudo()
        if ICP.get_param(param) == str(day):
            return False
        ICP.set_param(param, str(day))
        return True

    # ================================================================== #
    # App-facing                                                         #
    # ================================================================== #
    @api.model
    def app_feed(self, limit=50, offset=0):
        rows = self.search([('user_id', '=', self.env.uid)], limit=limit, offset=offset)
        return [{
            'id': r.id,
            'code': r.event_code or '',
            'category': r.category or 'other',
            'title': r.title,
            'body': r.body or '',
            'screen': r.screen or '',
            'params': json.loads(r.params) if r.params else {},
            'read': r.is_read,
            'date': fields.Datetime.to_string(r.create_date),
        } for r in rows]

    @api.model
    def unread_count(self):
        return self.search_count([('user_id', '=', self.env.uid), ('is_read', '=', False)])

    @api.model
    def mark_read(self, ids):
        self.search([('id', 'in', [int(i) for i in ids or []]),
                     ('user_id', '=', self.env.uid)]).write({'is_read': True})
        return True

    @api.model
    def mark_all_read(self):
        self.search([('user_id', '=', self.env.uid), ('is_read', '=', False)]).write(
            {'is_read': True})
        return True

    @api.model
    def action_send_test(self):
        """Backend menu / app button: a test to the caller's own phones."""
        self._notify('adm_test', self.env.user, _("Test notification"),
                     _("Notifications are working."), include_actor=True)
        return {
            'type': 'ir.actions.client', 'tag': 'display_notification',
            'params': {
                'title': _("Test sent"),
                'message': _("Check the bell in the app. Phones registered to "
                             "this account get a push too."),
                'type': 'success', 'sticky': False,
            },
        }

    @api.autovacuum
    def _gc_old_notifications(self):
        """Keep the feed bounded: read rows older than 90 days go."""
        limit = fields.Datetime.now() - timedelta(days=90)
        self.sudo().search([('is_read', '=', True), ('create_date', '<', limit)]).unlink()
