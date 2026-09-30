import base64

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class AttendanceHelpDocument(models.Model):
    _name = 'attendance.help.document'
    _description = 'Help / User Guide Document'
    _order = 'sequence, id'

    name = fields.Char(string='Title', required=True)
    description = fields.Char(string='Description')
    icon = fields.Char(string='Icon', default='📄',
                       help='Emoji or short label shown on the card.')
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    # Optional rich HTML shown on "Open guide" instead of the embedded PDF.
    html_content = fields.Html(string='HTML Content', sanitize=False)
    # Module-relative path to a bundled HTML body file, e.g.
    # hr_attendance_369/static/src/docs/attendance_guide.html
    html_static_path = fields.Char(string='Static HTML Path')

    # Admin-uploaded PDF.
    pdf_file = fields.Binary(string='Upload PDF', attachment=True)
    pdf_filename = fields.Char(string='PDF Filename')
    # For bundled PDFs shipped in the module's static folder.
    pdf_static_path = fields.Char(
        string='Static PDF URL',
        help='For bundled PDFs, e.g. /hr_attendance_369/static/src/docs/x.pdf')

    pdf_url = fields.Char(string='PDF URL', compute='_compute_pdf_url')

    @api.depends('pdf_file', 'pdf_filename', 'pdf_static_path')
    def _compute_pdf_url(self):
        for rec in self:
            # Uploaded PDF wins over the bundled static path, so uploading a new
            # PDF actually changes what "Open in PDF doc" opens. Static path is
            # the fallback for shipped docs with no upload.
            if rec.pdf_file:
                rec.pdf_url = '/web/content/attendance.help.document/%s/pdf_file/%s?download=false' % (
                    rec.id, rec.pdf_filename or 'document.pdf')
            elif rec.pdf_static_path:
                rec.pdf_url = rec.pdf_static_path
            else:
                rec.pdf_url = False

    # --- Mobile app manuals -----------------------------------------------------
    # Two shelves in one model, the same split as showroom_check's
    # cleaning.manual: the module's own guides (the Help popup above) and the
    # PDFs the 369 Attendance app lists under Settings > App Manual. Default
    # 'manual' so the bundled guides stay where they were after an upgrade.
    section = fields.Selection(
        [('manual', 'User manual'), ('app', 'Mobile app')],
        string='Section', default='manual', required=True,
        help="User manual: the module itself, shown in the Help popup. "
             "Mobile app: shown in the app under Settings > App Manual.")
    # Only meaningful on the Mobile app shelf -- see _visible_to_caller.
    audience = fields.Selection(
        [('all', 'Everyone'), ('admin', 'Admin'), ('hr', 'HR'), ('employee', 'Employee')],
        string='Shown to', default='all', required=True,
        help="Mobile app manuals only. Admins see every manual; HR and "
             "employees see their own plus the Everyone ones.")

    @api.constrains('pdf_file', 'pdf_filename')
    def _check_pdf_only(self):
        """Refuse anything that is not a PDF: the header decides, not the name."""
        for rec in self:
            if not rec.pdf_file:
                continue
            if not (rec.pdf_filename or '').lower().endswith('.pdf'):
                raise ValidationError(_("Only PDF files can be uploaded here."))
            try:
                header = base64.b64decode(rec.pdf_file[:12])
            except Exception as exc:  # noqa: BLE001 - any decode failure is a bad file
                raise ValidationError(_("That file could not be read as a PDF.")) from exc
            if not header.startswith(b'%PDF-'):
                raise ValidationError(_("That file is not a PDF, whatever its name says."))

    @api.model
    def _role_of(self, user):
        """'admin' | 'hr' | 'employee' -- the same split the app draws.

        Mirrors fetchCapabilities() in the app: Settings access is the admin
        (Config tab), any of the HR / leave / WFH manager hats is HR (HR tab),
        everyone else is an employee.
        """
        if user.has_group('base.group_system'):
            return 'admin'
        if (user.has_group('hr.group_hr_user')
                or user.has_group('hr_attendance_369.group_leave_manager')
                or user.has_group('hr_attendance_369.group_wfh_manager')):
            return 'hr'
        return 'employee'

    def _visible_to_caller(self, record):
        """Module guides are for everyone; app manuals go by audience."""
        if record.section != 'app':
            return True
        role = self._role_of(self.env.user)
        return role == 'admin' or record.audience in (role, 'all')

    # --- App-facing methods -----------------------------------------------------

    @api.model
    def app_bundle(self):
        """One call for the app's App Manual screen: the caller's manuals, their
        role, and whether they may upload / replace / delete (admins only)."""
        role = self._role_of(self.env.user)
        return {
            'can_edit': role == 'admin',
            'role': role,
            'manuals': self.get_manuals(),
        }

    @api.model
    def get_manuals(self):
        """The Mobile app shelf this person may open, metadata only -- no bytes.

        sudo() because the shelf is shared and the record rules keep app
        manuals away from ordinary backend users; the audience filter below is
        what decides, server-side, so an employee never receives an admin PDF.
        """
        role = self._role_of(self.env.user)
        domain = [('section', '=', 'app'), ('pdf_file', '!=', False)]
        if role != 'admin':
            domain.append(('audience', 'in', [role, 'all']))
        return [{
            'id': rec.id,
            'name': rec.name or 'Manual',
            'description': rec.description or '',
            'filename': rec.pdf_filename or (rec.name or 'Manual') + '.pdf',
            'audience': rec.audience,
            'sequence': rec.sequence,
            'write_date': fields.Datetime.to_string(rec.write_date) if rec.write_date else False,
        } for rec in self.sudo().search(domain)]

    @api.model
    def get_manual(self, manual_id):
        """One app manual's PDF as base64, or False.

        The audience is checked again rather than trusted from the list: this
        takes an id from the client, and a filtered list is not a permission.
        """
        record = self.sudo().browse(int(manual_id)).exists()
        if not record or record.section != 'app' or not record.pdf_file:
            return False
        if not self._visible_to_caller(record):
            return False
        data = record.pdf_file
        if isinstance(data, bytes):
            data = data.decode()
        return {
            'id': record.id,
            'name': record.name or 'Manual',
            'filename': record.pdf_filename or 'Manual.pdf',
            'data': data,
        }
