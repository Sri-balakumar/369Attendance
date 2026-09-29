from odoo import models, fields, _
from odoo.exceptions import UserError


class LeaveKeepWizard(models.TransientModel):
    """HR declines a cancellation request: the approved leave stays.

    The backend twin of the app's "Keep leave" prompt. The reason is required
    because the employee sees it ("HR kept this leave: ...").
    """
    _name = 'hr.leave.keep.wizard'
    _description = 'Keep Approved Leave'

    leave_id = fields.Many2one(
        'hr.leave.request', string='Leave', required=True, ondelete='cascade'
    )
    employee_name = fields.Char(related='leave_id.hr_employee_id.name', readonly=True)
    cancel_reason = fields.Text(related='leave_id.cancel_reason', readonly=True)
    reason = fields.Text(string='Why the leave stays', required=True)

    def action_keep(self):
        self.ensure_one()
        reason = (self.reason or '').strip()
        if not reason:
            raise UserError(_('Tell the employee why the leave stays.'))
        self.leave_id.action_reject_cancel(reason)
        return {'type': 'ir.actions.act_window_close'}
