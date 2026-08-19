from odoo import models, fields, api


class ResPartnerBank(models.Model):
    """Branch-level details Odoo does not carry on a bank account.

    These live on the ACCOUNT rather than on hr.employee on purpose. Odoo 19
    gives an employee `bank_account_ids` -- a Many2many, so more than one
    account -- and an IFSC belongs to a branch, not to a person. A plain Char
    on hr.employee could not describe two accounts at two branches, and would
    duplicate the account number that already exists here.

    Extending this model costs no new dependency: res.partner.bank lives in
    `base`, and core hr already adds its own fields to it the same way.
    """
    _inherit = 'res.partner.bank'

    # Deliberately NOT `acc_type` -- base already defines that as a computed
    # normal/iban selection, and shadowing it would break bank widgets.
    bank_account_category = fields.Selection(
        [
            ('savings', 'Savings'),
            ('current', 'Current'),
            ('salary', 'Salary'),
        ],
        string='Account Category',
    )
    ifsc_code = fields.Char(
        string='IFSC Code',
        help='Branch code used for Indian bank transfers. Eleven characters, '
             'e.g. SBIN0001234.',
    )
    bank_branch = fields.Char(string='Branch')

    # No `groups=` on any of the three, on purpose: res.partner.bank is read
    # by ordinary users for customer and vendor accounts, and a group here
    # would strip the fields out of those unrelated views. Employee account
    # numbers are already masked for non-HR users by core hr.

    # --- visibility, driven by the same admin switchboard ---------------
    #
    # A bank account is not tied to one employee (it can be shared, and an
    # employee can have several), so these read the COMPANY-level record
    # rather than any per-employee override. Company granularity is the only
    # one that is well-defined here.
    show_ifsc_code = fields.Boolean(compute='_compute_bank_detail_visibility')
    show_bank_branch = fields.Boolean(compute='_compute_bank_detail_visibility')
    show_bank_account_category = fields.Boolean(compute='_compute_bank_detail_visibility')

    @api.depends_context('company')
    def _compute_bank_detail_visibility(self):
        config = self.env['hr.employee.details.config']._company_config(
            self.env.company.id)
        section = bool(config and config.show_bank_section)
        for rec in self:
            rec.show_ifsc_code = section and config.show_bank_ifsc
            rec.show_bank_branch = section and config.show_bank_branch
            rec.show_bank_account_category = section and config.show_bank_account_category
