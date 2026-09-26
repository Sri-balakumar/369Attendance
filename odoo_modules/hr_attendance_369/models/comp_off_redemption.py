from odoo import models, fields, api, _

# A redemption line is "active" -- it actually holds part of a credit -- only
# while the leave it belongs to is pending or approved. Rejected, cancelled
# and draft requests keep their lines for the record, but hold nothing.
ACTIVE_REQUEST_STATES = ('pending', 'approved')


class CompOffRedemption(models.Model):
    """Which compensatory off paid for which leave.

    The credit ledger (hr.comp.off.credit) says what was earned; the leave
    request says what was taken. This is the join, written when a comp-off
    leave is submitted and NEVER deleted afterwards: reject or cancel the
    leave and the line simply stops counting, because `request_state` says so.
    That is what lets a credit read Consumed today and still show, years on,
    exactly which holiday it was and which leave spent it.

    One line per (credit, request). A request that needs more than one credit
    -- two half days, say -- gets one line per credit, filled oldest expiry
    first by hr.leave.request._reserve_comp_off.
    """

    _name = 'hr.comp.off.redemption'
    _description = 'Compensatory Off Redemption'
    _order = 'id'

    credit_id = fields.Many2one(
        'hr.comp.off.credit', string='Credit',
        required=True, index=True, ondelete='restrict',
    )
    leave_request_id = fields.Many2one(
        'hr.leave.request', string='Leave Request',
        required=True, index=True, ondelete='cascade',
    )
    employee_id = fields.Many2one(
        related='credit_id.employee_id', store=True, index=True,
    )
    company_id = fields.Many2one(
        related='credit_id.company_id', store=True, index=True,
    )
    days = fields.Float(
        string='Days', required=True,
        help='How much of the credit this leave takes: 0.5 or 1.0.',
    )
    request_state = fields.Selection(
        related='leave_request_id.state', store=True, index=True,
        string='Leave Status',
    )
    date_earned = fields.Date(related='credit_id.date_earned', string='Day Worked')
    credit_source = fields.Selection(related='credit_id.source', string='Earned On')
    leave_from_date = fields.Date(related='leave_request_id.from_date', string='Leave From')
    leave_to_date = fields.Date(related='leave_request_id.to_date', string='Leave To')

    _unique_credit_request = models.Constraint(
        'UNIQUE(credit_id, leave_request_id)',
        'A leave request can draw on a given compensatory off only once.',
    )

    def _is_active(self):
        self.ensure_one()
        return (self.leave_request_id.state in ACTIVE_REQUEST_STATES
                and (self.days or 0.0) > 0.0)
