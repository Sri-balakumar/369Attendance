"""Which WhatsApp group hears about check-ins, and how to reach it.

One row per company. The transport is an Evolution API gateway reached over
HTTP - the same panel the sales automation modules post through - but with its
own few calls here instead of a dependency on `whatsapp_gateway`: that module
and `whatsapp_neonize` both define `whatsapp.session` / `whatsapp.message`, so
the two cannot be installed in one database, and KRA needs neonize.

How a mention works
-------------------
WhatsApp only turns "@919876543210" into a tagged, tappable name when BOTH are
sent: the digits in the text, and the member's JID in `mentioned`. Text alone
renders as literal characters; `mentioned` alone tags nobody visibly. The
digits must be the number the person is on WhatsApp with, country code
included, and they must be in the group - otherwise it shows as plain text,
which is why `mention_for()` falls back to the bold name when it is not
confident the number is international.
"""

import base64
import logging

import requests

from odoo import _, api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

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

DEFAULT_TEMPLATE = '{mention} present {time}'


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
    group_jid = fields.Char(
        'Group Address',
        help="The group's WhatsApp address, e.g. 120363012345678901@g.us. "
             "Use 'Choose Group' rather than typing it; paste it here only if "
             "the group list cannot be loaded.",
    )
    group_name = fields.Char('Group Name')

    # --- the message ---------------------------------------------------
    template = fields.Char(
        'Message', default=DEFAULT_TEMPLATE, required=True,
        help="Tokens: {mention} (tags the employee), {name}, {time}, {date}.",
    )
    default_country_code = fields.Char(
        'Default Country Code', default='91',
        help="Put in front of a 10-digit mobile number so it can be tagged. "
             "WhatsApp needs the full international number.",
    )

    _unique_company = models.Constraint(
        'UNIQUE(company_id)',
        'This company already has a WhatsApp group configured.',
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
        """Every group the number has joined, as [{'jid', 'name', 'size'}]."""
        self.ensure_one()
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
            })
        return result

    def _send_group_text(self, text, mention_digits=''):
        """Post `text` to the configured group, tagging `mention_digits`.

        Raises UserError on any failure; callers decide whether that matters.
        """
        self.ensure_one()
        jid = (self.group_jid or '').strip()
        if not jid:
            raise UserError(_("Choose the WhatsApp group first."))
        if not self.instance_name:
            raise UserError(_("Set the Instance first (or use Fetch from Panel)."))
        payload = {
            'number': jid,
            'text': text,
            'delay': SEND_DELAY_MS,
        }
        if mention_digits:
            payload['mentioned'] = ['%s@s.whatsapp.net' % mention_digits]
        return self._gateway_call(
            'POST', '/message/sendText/%s' % self.instance_name, payload)

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
        digits = ''.join(ch for ch in raw if ch.isdigit())
        if raw.strip().startswith('00'):
            digits = digits[2:]
        digits = digits.lstrip('0')
        cc = ''.join(ch for ch in (self.default_country_code or '') if ch.isdigit())
        if len(digits) == 10 and cc:
            digits = cc + digits
        return digits if len(digits) >= MIN_INTL_DIGITS else ''

    def mention_for(self, employee):
        """('@<digits>', '<digits>') when taggable, else ('*Name*', '')."""
        self.ensure_one()
        digits = self.whatsapp_digits(employee)
        if digits:
            return '@%s' % digits, digits
        return '*%s*' % (employee.name or _('Someone')), ''

    @api.model
    def render(self, template, values):
        """Replace {token}s. A plain replace rather than str.format: the
        template is typed by hand, and a stray brace must not drop the post."""
        text = template or DEFAULT_TEMPLATE
        for key, value in values.items():
            text = text.replace('{%s}' % key, value or '')
        return text.strip()

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
                     "here, e.g.\n%s present 9:30 AM", mention)
        else:
            digits = ''
            text = _("✅ Attendance group connected. Check-ins will be posted here.")
        self._send_group_text(text, digits)
        return self._notify(
            _("Test sent"),
            _("Check the group '%s'.", self.group_name or self.group_jid),
        )

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
