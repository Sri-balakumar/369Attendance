/** @odoo-module **/
/**
 * Keep the WhatsApp QR on the attendance WhatsApp Group form current.
 *
 * After Connect WhatsApp, a background thread on the server writes the QR a
 * second or two later and replaces it every ~20 s as each one expires;
 * scanning flips the session to connected. The form hears about none of it,
 * so while it is waiting for a scan it reloads itself every few seconds.
 *
 * Only on this model, only while waiting, and never over unsaved edits.
 * KRA patches FormController the same way for whatsapp.session forms; the
 * names here are distinct so the two patches do not replace each other.
 */
import { patch } from "@web/core/utils/patch";
import { FormController } from "@web/views/form/form_controller";
import { onMounted, onWillUnmount } from "@odoo/owl";

const MODEL = "hr.attendance.wa.config";
const EVERY_MS = 3000;

patch(FormController.prototype, {
    setup() {
        super.setup(...arguments);
        this._attWaQrTimer = null;
        onMounted(() => this._attWaQrStart());
        onWillUnmount(() => this._attWaQrStop());
    },
    _attWaQrStart() {
        if (this.props.resModel !== MODEL) {
            return;
        }
        this._attWaQrTimer = setInterval(async () => {
            const record = this.model.root;
            if (!record || !record.resId || record.data.wa_state !== "waiting_qr") {
                return;
            }
            try {
                if (await record.isDirty()) {
                    return;
                }
                await record.load();
            } catch (e) {
                console.debug("WhatsApp QR refresh:", e);
            }
        }, EVERY_MS);
    },
    _attWaQrStop() {
        if (this._attWaQrTimer) {
            clearInterval(this._attWaQrTimer);
            this._attWaQrTimer = null;
        }
    },
});
