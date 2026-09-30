"""Sending a push notification through Expo's push service.

Ported from showroom_check's cleaning_push_provider.py, which is itself the
shape of kra_kpi_module's kpi_notify, so every Alphalize app sends push the same
way: plain REST with `requests`, grouped by EAS project, rejections named
rather than swallowed, and the count reported is what Expo ACCEPTED.

Expo is a relay in front of Firebase (FCM). The Firebase key lives in the EAS
account, not here -- the app still needs google-services.json.

Nothing here touches the ORM. hr.attendance.notification decides who to tell
and what to say; this file only posts a batch and reads the answer.
"""
import json
import logging

import requests

_logger = logging.getLogger(__name__)

EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
DEFAULT_TIMEOUT = 10

# Must match the channel the app creates with setNotificationChannelAsync, or
# Android 8+ files the message under a channel that does not exist and never
# shows it.
CHANNEL_ID = 'attendance'

MAX_BATCH = 100
MAX_BODY_CHARS = 160

# The one ticket error that means "this phone is gone, retire it".
RETIRE_ERRORS = {'DeviceNotRegistered'}

# Errors that mean the SETUP is wrong, not the phone. Neither is fixable from
# Odoo -- both live in the EAS account -- so the least this can do is say which.
CONFIG_ERRORS = {
    'MismatchSenderId': (
        "the FCM credentials on EAS do not match the google-services.json "
        "baked into the build. Re-upload the service account key with "
        "`eas credentials`, or rebuild against the right Firebase project."),
    'InvalidCredentials': (
        "the Firebase service account key on EAS is missing or expired. "
        "Upload it again with `eas credentials`."),
}


class PushError(Exception):
    """Anything that stopped a notification going out, as a readable sentence."""


def shorten(text, limit=MAX_BODY_CHARS):
    text = (text or '').strip()
    if len(text) <= limit:
        return text
    return text[:limit - 3].rstrip() + '...'


def build_message(token, title, body, data=None):
    return {
        'to': token,
        'title': title,
        'body': shorten(body),
        'data': data or {},
        'channelId': CHANNEL_ID,
        'priority': 'high',
        'sound': 'default',
    }


def _post(messages, timeout):
    try:
        return requests.post(
            EXPO_PUSH_URL,
            data=json.dumps(messages),
            headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
            timeout=timeout,
        )
    except requests.exceptions.Timeout:
        raise PushError("Expo did not answer in time. Check the server's internet connection.")
    except requests.exceptions.RequestException as exc:
        raise PushError("Could not reach Expo: %s" % exc)


def send_batch(messages, timeout=DEFAULT_TIMEOUT):
    """Send up to MAX_BATCH messages that share ONE EAS project.

    Returns {'sent': int, 'retire': [token, ...], 'config': str|None}. Expo
    rejects a request whose messages span two projects and delivers to nobody,
    so grouping is the caller's job (hr.attendance.push.device._grouped_by_project).
    """
    result = {'sent': 0, 'retire': [], 'config': None}
    if not messages:
        return result

    response = _post(messages, timeout)
    if response.status_code != 200:
        _logger.warning("[notify] Expo returned HTTP %s for %s message(s): %s",
                        response.status_code, len(messages), (response.text or '')[:300])
        return result

    try:
        tickets = (response.json() or {}).get('data') or []
    except ValueError:
        _logger.warning("[notify] Expo's reply could not be read.")
        return result

    # Tickets come back positionally; a short list would mis-blame tokens.
    if len(tickets) != len(messages):
        _logger.warning("[notify] Expo returned %s ticket(s) for %s message(s); "
                        "not attributing errors.", len(tickets), len(messages))
        return result

    other = {}
    for message, ticket in zip(messages, tickets):
        if ticket.get('status') == 'ok':
            result['sent'] += 1
            continue
        error = ((ticket.get('details') or {}).get('error')
                 or ticket.get('message') or 'unknown')
        if error in RETIRE_ERRORS:
            result['retire'].append(message['to'])
        elif error in CONFIG_ERRORS:
            result['config'] = '%s: %s' % (error, CONFIG_ERRORS[error])
        else:
            other[error] = other.get(error, 0) + 1

    if result['config']:
        _logger.warning("[notify] push not delivered - %s", result['config'])
    for error, count in other.items():
        _logger.warning("[notify] Expo refused %s message(s) with %s", count, error)
    return result
