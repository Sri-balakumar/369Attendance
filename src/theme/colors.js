// One shape, two values. Every screen reads colours through useTheme() so the
// dark palette costs nothing per-screen — see ThemeProvider.js.

const brand = {
  // Amber is the single accent: on a slate app it is the only saturated
  // colour in normal use, so it always means "this is the action".
  primary: '#F59E0B',
  primaryAlt: '#FBBF24',
  accent: '#D97706',
  // The header is a flat slate panel. Kept as a gradient array purely so the
  // five existing LinearGradient call sites need no change -- the ramp is
  // shallow enough to read as solid.
  gradient: ['#1E293B', '#0F172A'],
  header: '#1E293B',

  // Two tokens, because after this re-skin they are genuinely different
  // surfaces. White on amber is ~2:1 contrast and unreadable, so anything
  // sitting ON the accent needs dark slate instead.
  onHeader: '#FFFFFF',   // text and icons on the slate header
  onPrimary: '#1E293B',  // text on amber buttons and amber fills
};

const status = {
  success: '#10B981',
  // Deeper than the brand amber on purpose. "Late" is conventionally amber,
  // and so is the brand now, so the two hues are pulled apart and separated
  // by treatment as well: brand amber is a solid fill, status amber is a
  // tinted chip carrying an icon and a label.
  warning: '#EA580C',
  danger: '#DC2626',
  info: '#38BDF8',
};

export const light = {
  ...brand,
  ...status,
  mode: 'light',
  bg: '#F1F5F9',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F5F9',
  text: '#0F172A',
  muted: '#475569',
  faint: '#94A3B8',
  // Stronger than a soft-cornered design needs: square edges want a crisp
  // line, or the cards dissolve into the background.
  border: '#CBD5E1',
  skeleton: '#E2E8F0',
  skeletonHighlight: '#F1F5F9',
  overlay: 'rgba(15, 23, 42, 0.5)',
};

export const dark = {
  ...brand,
  ...status,
  mode: 'dark',
  bg: '#0B1120',
  surface: '#16202F',
  surfaceAlt: '#1E293B',
  text: '#E2E8F0',
  muted: '#94A3B8',
  faint: '#64748B',
  border: '#293548',
  skeleton: '#1E293B',
  skeletonHighlight: '#293548',
  overlay: 'rgba(2, 6, 23, 0.7)',
};

// #RRGGBB -> rgba(). Kept here so callers never hand-write translucent hex,
// which reads differently between the two palettes.
export function withAlpha(hex, alpha) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The readable foreground for an arbitrary background.
 *
 * Needed because `solid` buttons take their fill from `tone`: the default is
 * amber, which demands dark text (white on #F59E0B is only 2.15:1), while a
 * danger button is red and demands white.
 *
 * Deliberately compares the ACTUAL WCAG contrast against both candidates
 * rather than testing luminance against a threshold. A threshold has to be
 * guessed, and the first guess here (0.45) put amber at 0.431 on the wrong
 * side of the line -- handing back white and reintroducing the exact bug this
 * function exists to prevent. Comparing ratios cannot be off by a hair.
 */
const DARK_INK = '#1E293B';
const LIGHT_INK = '#FFFFFF';

function relativeLuminance(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a, b) {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
}

export function readableOn(background) {
  return contrastRatio(background, DARK_INK) >= contrastRatio(background, LIGHT_INK)
    ? DARK_INK
    : LIGHT_INK;
}
