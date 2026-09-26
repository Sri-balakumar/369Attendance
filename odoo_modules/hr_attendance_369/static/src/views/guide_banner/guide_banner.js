/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { ListController } from "@web/views/list/list_controller";
import { FormController } from "@web/views/form/form_controller";
import { GUIDES } from "./guides";

// The yellow "how to use this page" banner above a list or form.
//
// Odoo 19 has no banner_route any more, so the banner is chosen client-side:
// each menu action puts a `guide_key` in its context, and the controller of the
// view it opens looks the copy up in guides.js. The model check keeps a key
// that travels on in the context (a record or wizard opened from that page)
// from putting the wrong text above another model's view.
function guideFor(controller, viewType) {
    const key = controller.props.context && controller.props.context.guide_key;
    const guide = key && GUIDES[key];
    if (!guide || guide.model !== controller.props.resModel) {
        return null;
    }
    if (guide.views && !guide.views.includes(viewType)) {
        return null;
    }
    return guide;
}

patch(ListController.prototype, {
    get guideBanner() {
        return guideFor(this, "list");
    },
});

patch(FormController.prototype, {
    get guideBanner() {
        return guideFor(this, "form");
    },
});
