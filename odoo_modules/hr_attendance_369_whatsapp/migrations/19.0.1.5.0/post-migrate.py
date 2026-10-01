"""Message is plain words from 1.5.0 ('checked in at') instead of a template
with {tokens}. Carry over what was set: the old default becomes the new
default; other "{mention} <words> {time}" templates keep their words; anything
else falls back to the default."""

import re

OLD_DEFAULT_WORDS = 'present'
NEW_DEFAULT_WORDS = 'checked in at'
SIMPLE = re.compile(r'^\s*\{mention\}\s*(.*?)\s*\{time\}\s*$')


def words_from_template(template):
    match = SIMPLE.match(template or '')
    words = match.group(1).strip() if match else ''
    if not words or '{' in words or words == OLD_DEFAULT_WORDS:
        return NEW_DEFAULT_WORDS
    return words


def migrate(cr, version):
    cr.execute("""
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'hr_attendance_wa_config' AND column_name = 'template'
    """)
    if not cr.fetchone():
        return
    cr.execute("SELECT id, template FROM hr_attendance_wa_config")
    for rec_id, template in cr.fetchall():
        cr.execute("UPDATE hr_attendance_wa_config SET message_text = %s WHERE id = %s",
                   (words_from_template(template), rec_id))
