"""Send Through is new in 1.2.0 and defaults to WhatsApp in Odoo. A row that was
already set up with the panel keeps sending through the panel."""


def migrate(cr, version):
    cr.execute("""
        UPDATE hr_attendance_wa_config
           SET transport = 'panel'
         WHERE COALESCE(gateway_url, '') != ''
    """)
