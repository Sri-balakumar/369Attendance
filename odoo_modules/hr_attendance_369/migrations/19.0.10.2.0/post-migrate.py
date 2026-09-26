"""Move the HR alert template onto the shared email builder.

The template is noupdate, so a module upgrade does not touch a copy already
installed (19.0.10.1.0 shipped the full email inline). This rewrites its
subject and body once to the thin wrapper that calls
hr.leave.request.submit_mail_subject() / submit_mail_html(), the same code
every preview uses. After this, the template is left alone again.
"""
import logging

_logger = logging.getLogger(__name__)

SUBJECT = "{{ object.submit_mail_subject() }}"
BODY = "<div><t t-out=\"object.submit_mail_html(ctx.get('record_url'))\"/></div>"


def migrate(cr, version):
    if not version:
        return
    from odoo import api, SUPERUSER_ID
    env = api.Environment(cr, SUPERUSER_ID, {})
    tpl = env.ref('hr_attendance_369.mail_template_leave_submitted',
                  raise_if_not_found=False)
    if not tpl:
        return
    tpl.write({'subject': SUBJECT, 'body_html': BODY})
    _logger.info('[migration 10.2.0] leave alert template now uses the shared builder')
