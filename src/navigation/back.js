/**
 * Back that moves exactly one screen.
 *
 * A screen only goes back while it is the focused top of its stack, so an
 * action that finishes after the person pressed back themselves finds the
 * screen gone and pops nothing.
 *
 * That alone does not stop a fast double tap on the header chevron: the first
 * tap pops, and the second lands on the chevron of the screen underneath --
 * same place, now on top -- and pops that too (seen on the tablet: Request ->
 * queue -> HR tab). So one back per BACK_GAP_MS, app-wide.
 */

const BACK_GAP_MS = 600;
let lastBackAt = 0;

/** True while this screen is the one being shown. */
export function isTop(navigation) {
  return Boolean(navigation?.isFocused?.());
}

export function goBackOnce(navigation) {
  const now = Date.now();
  if (now - lastBackAt < BACK_GAP_MS) return;
  if (isTop(navigation) && navigation.canGoBack()) {
    lastBackAt = now;
    navigation.goBack();
  }
}
