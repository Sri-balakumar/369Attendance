from odoo import models, fields


# The fields an employee may fill in about THEMSELVES from My Profile.
#
# Deliberately excluded, and the exclusion is the point: everything to do with
# salary, plus the terms of employment HR owns (confirmation date, notice
# period, payment mode, professional tax state) and the visibility switches
# themselves. Odoo builds the self-service allow-list from these names, so a
# field absent here simply cannot be read or written by an ordinary user
# through their own profile, whatever the view happens to show.
EMPLOYEE_DETAILS_SELF_FIELDS = [
    'blood_group',
    'father_name',
    'mother_name',
    'emergency_contact_relation',
    'emergency_contact_2',
    'emergency_phone_2',
    'emergency_contact_relation_2',
    'tax_regime',
    'statutory_id_ids',
    'qualification_ids',
    'previous_employment_ids',
]

# Read-only mirrors of the admin's switches, so My Profile can hide whatever
# has not been turned on. Readable by the user, never writable by them.
EMPLOYEE_DETAILS_SELF_READONLY_FIELDS = [
    'show_statutory_section',
    'show_bank_section',
    'show_personal_section',
    'show_employment_section',
    'show_tax_regime',
    'show_blood_group',
    'show_father_name',
    'show_mother_name',
    'show_emergency_relation',
    'show_second_emergency_contact',
    'show_previous_employment',
    'show_qualifications',
]


class ResUsers(models.Model):
    """Let employees maintain their own details from My Profile.

    This is the mechanism core hr already uses for the private address and
    emergency contact -- related fields onto the employee, plus the two
    allow-list properties Odoo consults before letting a user touch their own
    record. Reusing it means self-service inherits the access rules that are
    already there rather than inventing a parallel set.

    `related_sudo=False` on every writable field is load-bearing: the default
    would read as superuser and quietly bypass the very access checks that
    confine an employee to their own record.
    """
    _inherit = 'res.users'

    blood_group = fields.Selection(
        related='employee_id.blood_group', readonly=False, related_sudo=False)
    father_name = fields.Char(
        related='employee_id.father_name', readonly=False, related_sudo=False)
    mother_name = fields.Char(
        related='employee_id.mother_name', readonly=False, related_sudo=False)
    emergency_contact_relation = fields.Char(
        related='employee_id.emergency_contact_relation',
        readonly=False, related_sudo=False)
    emergency_contact_2 = fields.Char(
        related='employee_id.emergency_contact_2',
        readonly=False, related_sudo=False)
    emergency_phone_2 = fields.Char(
        related='employee_id.emergency_phone_2',
        readonly=False, related_sudo=False)
    emergency_contact_relation_2 = fields.Char(
        related='employee_id.emergency_contact_relation_2',
        readonly=False, related_sudo=False)
    tax_regime = fields.Selection(
        related='employee_id.tax_regime', readonly=False, related_sudo=False)

    statutory_id_ids = fields.One2many(
        related='employee_id.statutory_id_ids',
        string='Statutory Identifiers', readonly=False, related_sudo=False)
    qualification_ids = fields.One2many(
        related='employee_id.qualification_ids',
        string='Qualifications', readonly=False, related_sudo=False)
    previous_employment_ids = fields.One2many(
        related='employee_id.previous_employment_ids',
        string='Previous Employment', readonly=False, related_sudo=False)

    # --- visibility mirrors (read-only) -------------------------------- #
    show_statutory_section = fields.Boolean(related='employee_id.show_statutory_section')
    show_bank_section = fields.Boolean(related='employee_id.show_bank_section')
    show_personal_section = fields.Boolean(related='employee_id.show_personal_section')
    show_employment_section = fields.Boolean(related='employee_id.show_employment_section')
    show_tax_regime = fields.Boolean(related='employee_id.show_tax_regime')
    show_blood_group = fields.Boolean(related='employee_id.show_blood_group')
    show_father_name = fields.Boolean(related='employee_id.show_father_name')
    show_mother_name = fields.Boolean(related='employee_id.show_mother_name')
    show_emergency_relation = fields.Boolean(related='employee_id.show_emergency_relation')
    show_second_emergency_contact = fields.Boolean(
        related='employee_id.show_second_emergency_contact')
    show_previous_employment = fields.Boolean(
        related='employee_id.show_previous_employment')
    show_qualifications = fields.Boolean(related='employee_id.show_qualifications')

    @property
    def SELF_READABLE_FIELDS(self):
        return (super().SELF_READABLE_FIELDS
                + EMPLOYEE_DETAILS_SELF_FIELDS
                + EMPLOYEE_DETAILS_SELF_READONLY_FIELDS)

    @property
    def SELF_WRITEABLE_FIELDS(self):
        return super().SELF_WRITEABLE_FIELDS + EMPLOYEE_DETAILS_SELF_FIELDS
