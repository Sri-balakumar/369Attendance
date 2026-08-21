import { Platform } from 'react-native';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
};

export const radii = {
  // Roughly half the previous values. Square-ish corners are what separate
  // this app from the rounded house style used elsewhere.
  sm: 4,
  md: 8,
  lg: 12,
  // Stays fully round: chips, dots and status pills reading as capsules
  // AGAINST square cards is deliberate contrast, not inconsistency.
  pill: 999,
};

export const fontSize = {
  xs: 11,
  // A real step between xs and sm, used by meta text on the gradient headers
  // and by footnotes. It was already in use as a scattered 12 / 12.5 literal;
  // naming it stops the next screen inventing 12.5 again.
  xxs: 12,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 26,
  display: 34,
  // The one figure the Home screen is built around: the running clock on the
  // attendance card. Deliberately larger than display.
  hero: 38,
};

// Inter is loaded at startup (App.js). Until it resolves — and on any device
// where the download fails — these fall back to the platform UI font rather
// than crashing on a missing family name.
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

export const systemFonts = {
  regular: Platform.select({ ios: 'System', default: 'sans-serif' }),
  medium: Platform.select({ ios: 'System', default: 'sans-serif-medium' }),
  semibold: Platform.select({ ios: 'System', default: 'sans-serif-medium' }),
  bold: Platform.select({ ios: 'System', default: 'sans-serif' }),
};

// iOS shadow + Android elevation in one object, so a card looks raised on both.
export const shadows = {
  card: Platform.select({
    ios: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 2 },
    default: {},
  }),
  raised: Platform.select({
    ios: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.1,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
    },
    android: { elevation: 6 },
    default: {},
  }),
  float: Platform.select({
    ios: {
      shadowColor: '#F59E0B',
      shadowOpacity: 0.3,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
    },
    android: { elevation: 10 },
    default: {},
  }),
};
