"""Pick the attendance group from the groups the number has joined.

A group address is an 18-digit string nobody knows by heart and which is
silently useless if one digit is wrong, so it is chosen from a list instead of
typed. Trimmed from sales_automation's sa.group.picker.

The list is fetched once and kept on the wizard (`groups_json`); searching and
sorting only re-filter that copy, so typing never asks WhatsApp again - the
fetch is slow on big accounts and fails on some builds.

`/group/fetchAllGroups` can fail through the hosted panel (it drops the query
string and Evolution answers 400). The error is shown, and the address can
still be pasted on the config form by hand and checked with Send Test.
"""

import json
from datetime import datetime, timezone

from odoo import _, api, fields, models
from odoo.exceptions import UserError

SORTS = [
    ('newest', 'Newest First'),
    ('az', 'Name A to Z'),
    ('za', 'Name Z to A'),
]


class HrAttendanceWaGroupPicker(models.TransientModel):
    _name = 'hr.attendance.wa.group.picker'
    _description = 'Choose Attendance WhatsApp Group'

    config_id = fields.Many2one(
        'hr.attendance.wa.config', required=True, ondelete='cascade')
    line_ids = fields.One2many(
        'hr.attendance.wa.group.picker.line', 'picker_id', string='Groups')
    fetch_error = fields.Char(readonly=True)
    search_text = fields.Char('Search')
    sort_by = fields.Selection(SORTS, string='Sort', default='newest', required=True)
    # Every group fetched, as JSON: [{'jid', 'name', 'size', 'created'}].
    groups_json = fields.Text()
    # Ticked addresses, as JSON, including any the search currently hides.
    chosen_json = fields.Text()

    @api.model
    def default_get(self, fields_list):
        values = super().default_get(fields_list)
        config = self.env['hr.attendance.wa.config'].browse(values.get('config_id'))
        if config.exists():
            values.update(self._load(config, chosen={config.group_jid}))
        return values

    @api.model
    def _load(self, config, chosen=(), search_text='', sort_by='newest'):
        """{'line_ids', 'groups_json', 'chosen_json', 'fetch_error'} from a
        live fetch."""
        chosen = {jid for jid in chosen if jid}
        try:
            groups = config._fetch_groups()
        except UserError as err:
            return {'line_ids': [(5, 0, 0)], 'groups_json': '[]',
                    'chosen_json': json.dumps(sorted(chosen)),
                    'fetch_error': str(err).replace('\n', ' ')[:300]}
        rows = [{
            'jid': group['jid'],
            'name': group.get('name') or group['jid'],
            'size': int(group.get('size') or 0),
            'created': int(group.get('created') or 0),
        } for group in groups]
        return {
            'groups_json': json.dumps(rows),
            'chosen_json': json.dumps(sorted(chosen)),
            'fetch_error': False,
            'line_ids': self._line_commands(rows, chosen, search_text, sort_by),
        }

    @api.model
    def _line_commands(self, rows, chosen, search_text, sort_by):
        """One2many commands showing `rows` filtered by `search_text` and
        ordered by `sort_by`. `sequence` carries the order, so it survives
        the wizard being saved and read back."""
        term = (search_text or '').strip().lower()
        if term:
            rows = [r for r in rows
                    if term in (r['name'] or '').lower() or term in r['jid']]
        if sort_by == 'az':
            rows = sorted(rows, key=lambda r: (r['name'] or '').lower())
        elif sort_by == 'za':
            rows = sorted(rows, key=lambda r: (r['name'] or '').lower(), reverse=True)
        else:
            # Newest first; a group with no known date goes to the end.
            rows = sorted(rows, key=lambda r: (-(r['created'] or 0),
                                               (r['name'] or '').lower()))
        commands = [(5, 0, 0)]
        for sequence, row in enumerate(rows):
            created = row['created'] and datetime.fromtimestamp(
                row['created'], tz=timezone.utc).replace(tzinfo=None)
            commands.append((0, 0, {
                'sequence': sequence,
                'name': row['name'],
                'group_jid': row['jid'],
                'member_count': row['size'],
                'created': created or False,
                'selected': row['jid'] in chosen,
            }))
        return commands

    @staticmethod
    def _json_list(value):
        try:
            return json.loads(value or '[]')
        except ValueError:
            return []

    def _chosen(self):
        """Ticked addresses: the ticks on screen, plus earlier ticks on groups
        the search hides right now."""
        shown = set(self.line_ids.mapped('group_jid'))
        ticked = set(self.line_ids.filtered('selected').mapped('group_jid'))
        return (set(self._json_list(self.chosen_json)) - shown) | ticked

    @api.onchange('search_text', 'sort_by')
    def _onchange_filter(self):
        chosen = self._chosen()
        self.chosen_json = json.dumps(sorted(chosen))
        self.line_ids = self._line_commands(
            self._json_list(self.groups_json), chosen, self.search_text, self.sort_by)

    def action_refresh(self):
        self.ensure_one()
        self.write(self._load(self.config_id, self._chosen(),
                              self.search_text, self.sort_by))
        return {
            'type': 'ir.actions.act_window',
            'res_model': self._name,
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'new',
        }

    def action_use(self):
        self.ensure_one()
        chosen = self.line_ids.filtered(lambda l: l.selected and l.group_jid)
        if len(chosen) != 1:
            raise UserError(_("Tick exactly one group."))
        self.config_id.write({
            'group_jid': chosen.group_jid,
            'group_name': chosen.name,
        })
        return {'type': 'ir.actions.act_window_close'}


class HrAttendanceWaGroupPickerLine(models.TransientModel):
    _name = 'hr.attendance.wa.group.picker.line'
    _description = 'Selectable WhatsApp Group'
    _order = 'sequence, id'

    picker_id = fields.Many2one(
        'hr.attendance.wa.group.picker', required=True, ondelete='cascade')
    sequence = fields.Integer()
    selected = fields.Boolean('Use')
    # Read-only in the view with force_save there, not on the field: a field
    # declared readonly is not sent back when the wizard saves, and the lines
    # would lose their addresses.
    name = fields.Char('Group Name')
    # Not required: an editable x2many hands the client blank filler rows, and
    # action_use already refuses a row without an address.
    group_jid = fields.Char('Group Address')
    member_count = fields.Integer('Members')
    # When the group was created - or, for one known only from KRA's list,
    # when KRA first saw it.
    created = fields.Datetime('Created')
