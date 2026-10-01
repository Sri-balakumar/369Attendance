"""Which WhatsApp group hears about check-ins, and how to reach it.

One row per company. Two ways to send:

- 'odoo' (the default): the WhatsApp number connected inside Odoo under
  WhatsApp > Sessions - `whatsapp_neonize`, the same connection KRA posts its
  group reports with. Nothing to set up beyond choosing the group. Needs KRA's
  group support on top of neonize (`whatsapp_group_patch`): plain neonize
  cannot address a group. Detected at runtime, not a dependency, so this
  module still installs on a database without either.
- 'panel': an Evolution API gateway reached over HTTP - the same panel the
  sales automation modules post through - with its own few calls here instead
  of a dependency on `whatsapp_gateway`: that module and `whatsapp_neonize`
  both define `whatsapp.session` / `whatsapp.message`, so the two cannot be
  installed in one database, and KRA needs neonize.

How a mention works
-------------------
Through the panel, WhatsApp only turns "@919876543210" into a tagged, tappable
name when BOTH are sent: the digits in the text, and the member's JID in
`mentioned`. Text alone renders as literal characters; `mentioned` alone tags
nobody visibly. Through Odoo, neonize finds the "@<digits>" in the text and
fills in `mentioned` by itself. Either way the digits must be the number the
person is on WhatsApp with, country code included, and they must be in the
group - otherwise it shows as plain text, which is why `mention_for()` falls
back to the bold name when it is not confident the number is international.
"""

import base64
import calendar
import logging

import requests
from markupsafe import Markup

from odoo import _, api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

# What the phone lists under WhatsApp > Linked devices. WhatsApp takes the
# name at the moment the QR is scanned and keeps it for the life of the link,
# so it is set on the session just before a QR is asked for.
SESSION_NAME = 'Alphalize Attendance'

# (connect, read). A slow gateway must not hold a cron worker for long.
GW_TIMEOUT = (5, 30)
# fetchAllGroups walks every group the number is in; it is slow on big accounts.
GROUPS_TIMEOUT = (5, 120)
# Pause the gateway applies before sending - a burst of instant messages is
# what makes a number look automated.
SEND_DELAY_MS = 1200
# Country code + subscriber. Shorter is almost certainly a local-format number
# that would resolve to a JID nobody owns.
MIN_INTL_DIGITS = 11

# The post is "<person> <words> <time>"; these are the words out of the box,
# and what "Reset to default" puts back.
DEFAULT_WORDS = 'checked in at'
# A daily summary still unsent this long after its time is dropped: a
# "who is absent" report arriving hours late is noise.
SUMMARY_GIVE_UP_HOURS = 2


def normalize_digits(raw, country_code='91'):
    """A phone number as international digits, or '' when it cannot be one.

    "98765 43210" -> "919876543210"; "+91 98765 43210" and "0091..." keep
    their country code; a leading trunk 0 is dropped. Shorter than
    MIN_INTL_DIGITS is almost certainly a local number that would reach
    nobody, so it gives ''.
    """
    raw = raw or ''
    digits = ''.join(ch for ch in raw if ch.isdigit())
    if raw.strip().startswith('00'):
        digits = digits[2:]
    digits = digits.lstrip('0')
    cc = ''.join(ch for ch in (country_code or '') if ch.isdigit())
    if len(digits) == 10 and cc:
        digits = cc + digits
    return digits if len(digits) >= MIN_INTL_DIGITS else ''


class HrAttendanceWaConfig(models.Model):
    _name = 'hr.attendance.wa.config'
    _description = 'Attendance WhatsApp Group'
    _rec_name = 'company_id'

    company_id = fields.Many2one(
        'res.company', string='Company', required=True,
        default=lambda self: self.env.company, ondelete='cascade',
    )
    enabled = fields.Boolean(
        'Enabled', default=False,
        help="Post the first check-in of each day to the group. Off until the "
             "group is chosen and a test message has gone through.",
    )
    transport = fields.Selection([
        ('odoo', 'WhatsApp in Odoo'),
        ('panel', 'WhatsApp Panel (Evolution API)'),
    ], string='Send Through', default='odoo', required=True,
        help="WhatsApp in Odoo: the number connected under WhatsApp > Sessions, "
             "the same one KRA posts with. Panel: an Evolution API gateway, "
             "set up with a setup key.",
    )
    wa_state = fields.Selection([
        ('unavailable', 'Not Available'),
        ('none', 'Not Set Up'),
        ('disconnected', 'Disconnected'),
        ('waiting_qr', 'Scan QR Code'),
        ('connected', 'Connected'),
        ('error', 'Error'),
    ], string='WhatsApp', compute='_compute_odoo_status')
    odoo_connected = fields.Boolean(compute='_compute_odoo_status')
    odoo_status = fields.Char('WhatsApp in Odoo', compute='_compute_odoo_status')
    # Admins only: whoever scans it links their phone as the sender.
    wa_qr_html = fields.Html(
        'QR Code', compute='_compute_odoo_status', sanitize=False,
        groups='base.group_system')

    # --- the gateway ---------------------------------------------------
    gateway_url = fields.Char(
        'Gateway URL', groups='base.group_system',
        help="Base URL of the Evolution API server or panel. Filled in by "
             "itself when a setup key is pasted into API Key.",
    )
    gateway_api_key = fields.Char(
        'API Key', groups='base.group_system',
        help="The gateway's API key, or a setup key (wa1_...) from the panel, "
             "which fills in the URL as well.",
    )
    instance_name = fields.Char(
        'Instance',
        help="Which WhatsApp number on the gateway sends. 'Fetch from Panel' "
             "fills this in.",
    )

    # --- the group -----------------------------------------------------
    # Starts as the group KRA already reports to, when there is one: that is
    # almost always the team group this post is meant for.
    group_jid = fields.Char(
        'Group Address', default=lambda self: self._kra_group()[0],
        help="The group's WhatsApp address, e.g. 120363012345678901@g.us. "
             "Use 'Choose Group' rather than typing it; paste it here only if "
             "the group list cannot be loaded.",
    )
    group_name = fields.Char('Group Name', default=lambda self: self._kra_group()[1])

    # --- the message ---------------------------------------------------
    message_text = fields.Char(
        'Message', default=DEFAULT_WORDS, required=True,
        help="The words between the person's name and the check-in time, "
             "e.g. 'checked in at' gives '@Sneha checked in at 9:30 AM'.",
    )
    message_preview = fields.Char('Example', compute='_compute_message_preview')
    default_country_code = fields.Char(
        'Default Country Code', default='91',
        help="Put in front of a 10-digit mobile number so it can be tagged. "
             "WhatsApp needs the full international number.",
    )

    # --- the daily summary --------------------------------------------
    # Sent privately to the numbers below, not to the group.
    summary_enabled = fields.Boolean(
        'Send Daily Summary', default=False,
        help="Once a day, send who is present, on leave and absent to the "
             "numbers below.")
    summary_time = fields.Float(
        'Send At', default=18.5,
        help="Office time the summary goes out, e.g. 6:30 PM.")
    summary_recipient_ids = fields.One2many(
        'hr.attendance.wa.summary.recipient', 'config_id', string='Send To')
    summary_last_date = fields.Date('Last Sent', readonly=True, copy=False)

    _unique_company = models.Constraint(
        'UNIQUE(company_id)',
        'This company already has a WhatsApp group configured.',
    )
    _summary_time_range = models.Constraint(
        'CHECK(summary_time >= 0 AND summary_time < 24)',
        'Send At must be a time of day.',
    )

    # ------------------------------------------------------------------ #
    # Lookup                                                              #
    # ------------------------------------------------------------------ #

    @api.model
    def _for_company(self, company):
        return self.sudo().search([('company_id', '=', company.id)], limit=1)

    def _is_ready(self):
        self.ensure_one()
        return bool(self.enabled and (self.group_jid or '').strip())

    @api.model
    def _kra_group(self):
        """(jid, name) of the group KRA reports to in this company, else
        (False, False) - also when KRA is not installed."""
        company = self.env.company.sudo()
        if 'kpi_wa_group_jid' not in company._fields:
            return False, False
        jid = (company.kpi_wa_group_jid or '').strip()
        if not jid:
            return False, False
        return jid, company.kpi_wa_group_name or jid

    # ------------------------------------------------------------------ #
    # WhatsApp in Odoo                                                    #
    # ------------------------------------------------------------------ #

    @api.model
    def _odoo_session_model(self):
        """`whatsapp.session` when it can post to a group, else None.

        `_get_connected_client` marks whatsapp_neonize (whatsapp_gateway's
        session of the same name has none), and `wa_list_groups` marks KRA's
        group patch, without which a group address goes nowhere.
        """
        if 'whatsapp.session' not in self.env:
            return None
        Session = self.env['whatsapp.session'].sudo()
        if not (hasattr(Session, '_get_connected_client')
                and hasattr(Session, 'wa_list_groups')):
            return None
        return Session

    @api.model
    def _odoo_session(self):
        """The connected WhatsApp session, or an empty/None value."""
        Session = self._odoo_session_model()
        if Session is None:
            return None
        return Session.search([('status', '=', 'connected')], limit=1)

    @api.model
    def _odoo_link_session(self):
        """The session the posts go through: the connected one, else the
        newest - the same record KRA's Login Management page works on. There
        is only ever one: neonize lets one session connect at a time, and its
        auto-reconnect would have two knocking each other off every 5 minutes.
        """
        Session = self._odoo_session_model()
        if Session is None:
            return None
        return (Session.search([('status', '=', 'connected')], limit=1)
                or Session.search([], limit=1, order='id desc'))

    @staticmethod
    def _wa_live_status(session):
        """The session's state in this server's memory, which is what a send
        actually depends on; the status column can lag behind it."""
        try:
            from odoo.addons.whatsapp_neonize.models.whatsapp_session import _wa_status
        except ImportError:
            return None
        return _wa_status.get(session.id)

    def _compute_odoo_status(self):
        Session = self._odoo_session_model()
        session = self._odoo_link_session() if Session is not None else None
        if Session is None:
            state = 'unavailable'
        elif not session:
            state = 'none'
        else:
            state = session.status or 'disconnected'

        qr_html = False
        if state == 'waiting_qr':
            # bin_size off: the form reads with bin_size on, which would hand
            # back "1.2 Kb" instead of the picture.
            qr = session.with_context(bin_size=False).qr_image
            if qr:
                qr = qr.decode() if isinstance(qr, bytes) else qr
                qr_html = Markup(
                    '<img src="data:image/png;base64,%s" alt="WhatsApp QR code" '
                    'style="width:260px;height:260px;"/>') % qr

        if state == 'unavailable':
            status = _("Not available here: needs the WhatsApp app that KRA "
                       "uses. Choose the panel instead.")
        elif state == 'connected':
            status = _("Connected (%s)", session.name)
        elif state == 'waiting_qr':
            status = _("Scan the QR code below with the phone that should post: "
                       "WhatsApp > Linked devices > Link a device.")
        elif state == 'error':
            status = _("WhatsApp could not connect: %s. Press Connect WhatsApp "
                       "to try again.", session.error_message or _("unknown error"))
        else:
            status = _("Not connected. Press Connect WhatsApp, then scan the QR "
                       "code with the phone.")

        for rec in self:
            rec.wa_state = state
            rec.odoo_connected = state == 'connected'
            rec.odoo_status = status
            rec.wa_qr_html = qr_html

    def action_wa_connect(self):
        """Show a QR on this form. Scanning it links the phone to Odoo, listed
        on the phone as 'Alphalize Attendance'.

        Works on the one existing session (KRA and the login codes use it too)
        rather than adding a second: a second would disconnect the first.
        """
        self.ensure_one()
        if not self.env.user.has_group('base.group_system'):
            raise UserError(_("Only an administrator can connect WhatsApp."))
        Session = self._odoo_session_model()
        if Session is None:
            raise UserError(_(
                "WhatsApp in Odoo is not available on this database: it needs "
                "the WhatsApp app that KRA uses. Set Send Through to the panel."))
        session = self._odoo_link_session()
        if session and session.status == 'connected' \
                and self._wa_live_status(session) == 'connected':
            return {'type': 'ir.actions.client', 'tag': 'soft_reload'}

        renamed = False
        if not session:
            session = Session.create({'name': SESSION_NAME,
                                      'company_id': self.company_id.id})
            renamed = True
        elif session.name != SESSION_NAME:
            session.name = SESSION_NAME
            renamed = True
        # A client already showing QR codes under this name is left alone, so
        # the code on screen stays valid; anything else starts a fresh one,
        # which also makes it pair under the new name.
        if renamed or self._wa_live_status(session) != 'waiting_qr':
            session.action_connect()
        return {'type': 'ir.actions.client', 'tag': 'soft_reload'}

    def _send_text_odoo(self, target, text):
        """Send through the session connected in Odoo, to a group address or
        a number. A tag needs nothing extra: neonize turns the "@<digits>"
        already in the text into one."""
        if self._odoo_session_model() is None:
            raise UserError(_(
                "WhatsApp in Odoo is not available on this database: it needs "
                "the WhatsApp app that KRA uses. Set Send Through to the panel."))
        session = self._odoo_session()
        if not session:
            raise UserError(_(
                "WhatsApp is not connected in Odoo. Open WhatsApp > Sessions, "
                "press Connect WhatsApp and scan the QR with the phone."))
        # To a group, KRA's patch answers True once the message has left -
        # including the gateway's known missing receipt, so a sent post is
        # never retried into a duplicate - and False on a real failure. To a
        # number, neonize raises on failure. Both raise when the session is
        # connected on paper but not in this server process.
        if not session.send_message(target, text):
            raise UserError(_(
                "WhatsApp did not send the message. "
                "WhatsApp > Messages shows the error."))
        return True

    @staticmethod
    def _unix(value):
        """Seconds since 1970 from a gateway's timestamp, 0 when unknown.
        Some builds count in milliseconds."""
        try:
            value = float(value or 0)
        except (TypeError, ValueError):
            return 0
        if value > 1e12:
            value /= 1000.0
        return int(value) if value > 0 else 0

    @api.model
    def _odoo_joined_groups(self, session):
        """[{'jid', 'name', 'size', 'created'}] straight from WhatsApp.

        KRA's wa_list_groups() reads the same list but drops the creation
        date, which the picker sorts by. May raise: the call fails on some
        neonize builds.
        """
        out = []
        for group in session._get_connected_client().get_joined_groups() or []:
            try:
                jid = '%s@g.us' % group.JID.User
                out.append({
                    'jid': jid,
                    'name': getattr(getattr(group, 'GroupName', None), 'Name', '') or jid,
                    'size': len(getattr(group, 'Participants', []) or []),
                    'created': self._unix(getattr(group, 'GroupCreated', 0)),
                })
            except Exception as err:
                _logger.info("[wa-present] skipping unreadable group: %s", err)
        return out

    def _fetch_groups_odoo(self):
        """Groups to choose from, as [{'jid', 'name', 'size', 'created'}].

        Asking WhatsApp for the list fails on some neonize builds (see KRA's
        whatsapp_group_patch), so the groups KRA has seen messages in, and
        KRA's own report group, fill it too. For a group known only that way,
        'created' is when KRA first saw it.
        """
        if self._odoo_session_model() is None:
            raise UserError(_(
                "WhatsApp in Odoo is not available on this database: it needs "
                "the WhatsApp app that KRA uses. Set Send Through to the panel."))
        groups = {}
        session = self._odoo_session()
        if session:
            try:
                for group in self._odoo_joined_groups(session):
                    groups[group['jid']] = group
            except Exception as err:
                _logger.info("[wa-present] WhatsApp gave no group list: %s", err)
        if 'kpi.wa.group' in self.env:
            for seen in self.env['kpi.wa.group'].sudo().search([]):
                jid = (seen.jid or '').strip()
                if not jid.endswith('@g.us'):
                    continue
                # create_date is naive UTC; timestamp() would read it as local.
                first_seen = calendar.timegm(seen.create_date.timetuple()) \
                    if seen.create_date else 0
                if jid not in groups:
                    groups[jid] = {'jid': jid, 'name': seen.name or jid, 'size': 0,
                                   'created': first_seen}
                elif not groups[jid].get('created'):
                    groups[jid]['created'] = first_seen
        kra_jid, kra_name = self.with_company(self.company_id)._kra_group()
        if kra_jid and kra_jid not in groups:
            groups[kra_jid] = {'jid': kra_jid, 'name': kra_name, 'size': 0, 'created': 0}
        if not groups:
            raise UserError(_(
                "No groups found yet. Add the WhatsApp number to the group from "
                "the phone, send any message in the group, then press Load "
                "Groups again."))
        return list(groups.values())

    # ------------------------------------------------------------------ #
    # Setup key                                                           #
    # ------------------------------------------------------------------ #

    @api.model
    def _decode_setup_key(self, value):
        """(gateway_url, token) from a `wa1_` setup key, else (None, None).

        A setup key is `wa1_` + base64url of "<panel url>|<token>". Anything
        else is treated as a plain token.
        """
        raw = (value or '').strip()
        if not raw.startswith('wa1_'):
            return None, None
        payload = raw[4:]
        # The panel emits base64url without padding; add it back.
        payload += '=' * (-len(payload) % 4)
        try:
            decoded = base64.urlsafe_b64decode(payload.encode()).decode('utf-8')
        except (ValueError, UnicodeDecodeError):
            return None, None
        if '|' not in decoded:
            return None, None
        url, token = decoded.split('|', 1)
        url, token = url.strip().rstrip('/'), token.strip()
        if not url.startswith(('http://', 'https://')) or not token:
            return None, None
        return url, token

    def _apply_setup_key(self):
        for rec in self.sudo():
            url, token = self._decode_setup_key(rec.gateway_api_key)
            if url:
                rec.write({'gateway_url': url, 'gateway_api_key': token})

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        recs._apply_setup_key()
        return recs

    def write(self, vals):
        res = super().write(vals)
        # Only when the key itself changed, or unpacking would fight the
        # values it has just written.
        if 'gateway_api_key' in vals:
            self._apply_setup_key()
        return res

    # ------------------------------------------------------------------ #
    # Talking to the gateway                                              #
    # ------------------------------------------------------------------ #

    def _gateway_call(self, method, path, payload=None, timeout=GW_TIMEOUT):
        """One request to the gateway. Raises UserError with the gateway's own
        explanation - never a bare requests traceback in the UI."""
        self.ensure_one()
        # sudo: the key is admin-only, but HR presses Send Test too.
        rec = self.sudo()
        if not rec.gateway_url or not rec.gateway_api_key:
            raise UserError(_("Set the gateway URL and API key first."))
        url = '%s/%s' % (rec.gateway_url.rstrip('/'), path.lstrip('/'))
        headers = {
            'apikey': rec.gateway_api_key,
            'Content-Type': 'application/json',
            # The panel accepts a key only from the server and database it was
            # issued to, so these are not decoration.
            'X-Odoo-Db': self.env.cr.dbname,
            'X-Odoo-Url': self.env['ir.config_parameter'].sudo().get_param(
                'web.base.url', ''),
        }
        try:
            response = requests.request(
                method, url, headers=headers, json=payload, timeout=timeout)
        except requests.exceptions.RequestException as err:
            raise UserError(_(
                "Cannot reach the WhatsApp gateway at %(url)s.\n%(err)s",
                url=rec.gateway_url, err=err,
            )) from err

        if response.status_code >= 400:
            try:
                body = response.json()
                detail = (body.get('detail') or body.get('message')
                          or body.get('error') or '')
                if isinstance(detail, (list, dict)):
                    detail = str(detail)
            except ValueError:
                detail = (response.text or '')[:300]
            raise UserError(_(
                "The WhatsApp gateway refused the request (HTTP %(code)s).\n%(detail)s",
                code=response.status_code, detail=detail,
            ))
        try:
            return response.json()
        except ValueError:
            return {}

    def _fetch_groups(self):
        """Every group the number has joined, as
        [{'jid', 'name', 'size', 'created'}], 'created' in Unix seconds or 0."""
        self.ensure_one()
        if self.transport == 'odoo':
            return self._fetch_groups_odoo()
        if not self.instance_name:
            raise UserError(_("Set the Instance first (or use Fetch from Panel)."))
        body = self._gateway_call(
            'GET',
            '/group/fetchAllGroups/%s?getParticipants=false' % self.instance_name,
            timeout=GROUPS_TIMEOUT,
        )
        # Evolution answers with a bare list on some versions and a wrapper on
        # others.
        groups = body if isinstance(body, list) else (body or {}).get('groups') or []
        result = []
        for group in groups:
            if not isinstance(group, dict):
                continue
            jid = str(group.get('id') or '')
            if not jid.endswith('@g.us'):
                continue
            result.append({
                'jid': jid,
                'name': group.get('subject') or _('Unnamed Group'),
                'size': int(group.get('size') or 0)
                        or len(group.get('participants') or []),
                'created': self._unix(group.get('creation')),
            })
        return result

    def _send_text(self, target, text, mention_digits=''):
        """Send `text` to `target` - a group address or a number in
        international digits - tagging `mention_digits` when given.

        Raises UserError on any failure; callers decide whether that matters.
        """
        self.ensure_one()
        if self.transport == 'odoo':
            return self._send_text_odoo(target, text)
        if not self.instance_name:
            raise UserError(_("Set the Instance first (or use Fetch from Panel)."))
        payload = {
            'number': target,
            'text': text,
            'delay': SEND_DELAY_MS,
        }
        if mention_digits:
            payload['mentioned'] = ['%s@s.whatsapp.net' % mention_digits]
        return self._gateway_call(
            'POST', '/message/sendText/%s' % self.instance_name, payload)

    def _send_group_text(self, text, mention_digits=''):
        """Post `text` to the configured group, tagging `mention_digits`."""
        self.ensure_one()
        jid = (self.group_jid or '').strip()
        if not jid:
            raise UserError(_("Choose the WhatsApp group first."))
        return self._send_text(jid, text, mention_digits)

    # ------------------------------------------------------------------ #
    # Message building                                                    #
    # ------------------------------------------------------------------ #

    def whatsapp_digits(self, employee):
        """The employee's WhatsApp number as international digits, or ''."""
        self.ensure_one()
        raw = (employee.mobile_phone or employee.work_phone
               or employee.private_phone
               or (employee.user_id.partner_id.phone if employee.user_id else '')
               or '')
        return normalize_digits(raw, self.default_country_code)

    def mention_for(self, employee):
        """('@<digits>', '<digits>') when taggable, else ('*Name*', '')."""
        self.ensure_one()
        digits = self.whatsapp_digits(employee)
        if digits:
            return '@%s' % digits, digits
        return '*%s*' % (employee.name or _('Someone')), ''

    def compose(self, mention, time):
        """'@Sneha checked in at 9:30 AM': the person, the words typed in
        Message, the time. Joined, not formatted, so a '%' or '{' typed in
        Message stays as typed."""
        words = ' '.join((self[:1].message_text or '').split()) or DEFAULT_WORDS
        return '%s %s %s' % (mention, words, time)

    @api.depends('message_text')
    @api.depends_context('uid')
    def _compute_message_preview(self):
        example = '@%s' % (self.env.user.name or _('Sneha'))
        for rec in self:
            rec.message_preview = rec.compose(example, '9:30 AM')

    # ------------------------------------------------------------------ #
    # Buttons                                                             #
    # ------------------------------------------------------------------ #

    def action_fetch_config(self):
        """Ask the panel which instance this database sends through."""
        self.ensure_one()
        self._apply_setup_key()
        config = self._gateway_call('GET', '/v1/config', timeout=(5, 20))
        if config.get('instance'):
            self.instance_name = config['instance']
        state = (config.get('whatsapp') or {}).get('state') or '?'
        return self._notify(
            _("Configured from the panel"),
            _("Sends on: %(instance)s (%(state)s)",
              instance=self.instance_name or '?', state=state),
            reload=True,
        )

    def action_open_group_picker(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Choose WhatsApp Group'),
            'res_model': 'hr.attendance.wa.group.picker',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_config_id': self.id},
        }

    def action_send_test(self):
        self.ensure_one()
        employee = self.env.user.employee_id
        if employee:
            mention, digits = self.mention_for(employee)
            text = _("✅ Attendance group connected. Check-ins will be posted "
                     "here, e.g.\n%s", self.compose(mention, '9:30 AM'))
        else:
            digits = ''
            text = _("✅ Attendance group connected. Check-ins will be posted here.")
        self._send_group_text(text, digits)
        return self._notify(
            _("Test sent"),
            _("Check the group '%s'.", self.group_name or self.group_jid),
        )

    def action_reset_message(self):
        self.message_text = DEFAULT_WORDS

    def _notify(self, title, message, reload=False):
        params = {'title': title, 'message': message,
                  'type': 'success', 'sticky': False}
        if reload:
            # Show the values the button just wrote.
            params['next'] = {'type': 'ir.actions.client', 'tag': 'soft_reload'}
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': params,
        }
