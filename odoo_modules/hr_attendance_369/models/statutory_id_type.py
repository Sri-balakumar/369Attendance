import logging
import re

from odoo import models, fields, api, _
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)


class StatutoryIdType(models.Model):
    """A kind of identity number the company records, defined by the admin.

    Same reasoning as hr.salary.component: PAN and Aadhaar matter in India and
    nowhere else, so they are rows rather than columns. An admin activates the
    ones their company keeps, and can add any other -- a driving licence, a
    works number -- without a code change.

    `validation_regex` is what makes that genuinely code-free: the admin can
    tighten Aadhaar from any twelve digits to the stricter UIDAI form by
    editing a field, not by shipping a new version.
    """
    _name = 'hr.statutory.id.type'
    _description = 'Statutory Identifier Type'
    _order = 'sequence, name'

    name = fields.Char(string='Identifier Name', required=True, translate=True)
    code = fields.Char(string='Code')
    validation_regex = fields.Char(
        string='Validation Pattern',
        help='Optional regular expression the whole value must match.\n\n'
             'Leave it EMPTY to accept anything. A blank pattern is strictly '
             'better than a wrong one, because a wrong one blocks valid data: '
             'that is why PF Number ships with no pattern at all -- the real '
             'establishment-code format varies too much to guess.',
    )
    validation_message = fields.Char(
        string='Validation Message',
        help='Shown when a value does not match the pattern. Write it so the '
             'person typing knows what to fix, e.g. "PAN must be 5 letters, '
             '4 digits, then 1 letter".',
    )
    is_required = fields.Boolean(
        string='Required',
        help='Only enforced on employees who already have at least one '
             'identifier recorded -- "if you started filling this in, finish '
             'it". It deliberately does NOT apply to employees with none, or '
             'no existing record could ever be saved again.',
    )
    is_confidential = fields.Boolean(string='Confidential', default=True)
    sequence = fields.Integer(string='Sequence', default=10)
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        help='Leave empty to make the identifier available to every company.',
    )
    active = fields.Boolean(
        string='Active',
        default=True,
        help='The on/off switch. Only active identifier types can be recorded '
             'against an employee; values already captured are kept.',
    )

    _unique_name_company = models.Constraint(
        'UNIQUE(name, company_id)',
        'An identifier type with this name already exists for this company.',
    )

    @api.constrains('validation_regex')
    def _check_validation_regex(self):
        """Reject a malformed pattern when the ADMIN saves it -- fail fast,
        while the person who typed it is still looking at it."""
        for rec in self:
            if not rec.validation_regex:
                continue
            try:
                re.compile(rec.validation_regex)
            except re.error as err:
                raise ValidationError(_(
                    '"%(rx)s" is not a valid pattern: %(err)s',
                    rx=rec.validation_regex, err=err))

    def _compiled_regex(self):
        """The compiled pattern, or None when there is none / it is broken.

        Deliberately does NOT raise. A type saved before this guard existed,
        or written straight to the database, must never make every employee
        form unsavable -- so a bad pattern is logged and skipped instead.
        """
        self.ensure_one()
        if not self.validation_regex:
            return None
        try:
            return re.compile(self.validation_regex)
        except re.error:
            _logger.warning(
                'Statutory ID type %r has an invalid validation pattern %r -- '
                'skipping format validation for it.',
                self.name, self.validation_regex)
            return None
