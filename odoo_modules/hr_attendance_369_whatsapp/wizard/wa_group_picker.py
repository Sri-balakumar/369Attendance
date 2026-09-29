"""Pick the attendance group from the groups the number has joined.

A group address is an 18-digit string nobody knows by heart and which is
silently useless if one digit is wrong, so it is chosen from a list instead of
typed. Trimmed from sales_automation's sa.group.picker.

`/group/fetchAllGroups` can fail through the hosted panel (it drops the query
string and Evolution answers 400). The error is shown, and the address can
still be pasted on the config form by hand and checked with Send Test.
"""

from odoo import _, api, fields, models
from odoo.exceptions import UserError


class HrAttendanceWaGroupPicker(models.TransientModel):
    _name = 'hr.attendance.wa.group.picker'
    _description = 'Choose Attendance WhatsApp Group'

    config_id = fields.Many2one(
        'hr.attendance.wa.config', required=True, ondelete='cascade')
    line_ids = fields.One2many(
        'hr.attendance.wa.group.picker.line', 'picker_id', string='Groups')
    fetch_error = fields.Char(readonly=True)

    @api.model
    def default_get(self, fields_list):
        values = super().default_get(fields_list)
        config = self.env['hr.attendance.wa.config'].browse(values.get('config_id'))
        if config.exists():
            values.update(self._load(config))
        return values

    @api.model
    def _load(self, config):
        """{'line_ids': commands, 'fetch_error': str} from a live fetch."""
        try:
            groups = config._fetch_groups()
        except UserError as err:
            return {'line_ids': [(5, 0, 0)],
                    'fetch_error': str(err).replace('\n', ' ')[:300]}
        commands = [(5, 0, 0)]
        for group in sorted(groups, key=lambda g: (g['name'] or '').lower()):
            commands.append((0, 0, {
                'name': group['name'],
                'group_jid': group['jid'],
                'member_count': group['size'],
                'selected': group['jid'] == config.group_jid,
            }))
        return {'line_ids': commands, 'fetch_error': False}

    def action_refresh(self):
        self.ensure_one()
        self.write(self._load(self.config_id))
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
    _order = 'name'

    picker_id = fields.Many2one(
        'hr.attendance.wa.group.picker', required=True, ondelete='cascade')
    selected = fields.Boolean('Use')
    # Read-only in the view with force_save there, not on the field: a field
    # declared readonly is not sent back when the wizard saves, and the lines
    # would lose their addresses.
    name = fields.Char('Group Name')
    # Not required: an editable x2many hands the client blank filler rows, and
    # action_use already refuses a row without an address.
    group_jid = fields.Char('Group Address')
    member_count = fields.Integer('Members')
