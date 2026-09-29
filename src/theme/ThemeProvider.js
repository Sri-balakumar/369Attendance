import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { light, dark, withAlpha, readableOn } from './colors';
import { spacing, radii, fontSize, fonts, systemFonts, shadows } from './tokens';

const ThemeContext = createContext(null);

/**
 * Always opens LIGHT, whatever the phone's appearance setting says.
 *
 * Deliberate: a phone left on dark would otherwise decide how the app looks on
 * first launch, and this design is drawn and reviewed light-first. The dark
 * palette is kept and still correct -- the Home header's toggle switches to it
 * -- but it is opt-in per session rather than inherited from the system.
 */
export function ThemeProvider({ children, fontsLoaded = false }) {
  const [override, setOverride] = useState(null);

  const mode = override ?? 'light';

  // The system back / home / recents buttons follow the PHONE's theme, so a
  // phone on dark draws light buttons -- invisible, because Android paints a
  // white contrast band behind them. Edge-to-edge forbids recolouring that band
  // and it stays white in both app themes (verified on a Galaxy Tab A,
  // Android 11), so the buttons are always drawn dark.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    try {
      NavigationBar.setStyle('light');
    } catch (e) {
      console.warn('[theme] navigation bar style failed:', e?.message);
    }
  }, [mode]);

  const toggleTheme = useCallback(() => {
    setOverride((prev) => ((prev ?? 'light') === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => {
    const colors = mode === 'dark' ? dark : light;
    // Before Inter resolves, render with the platform font. Naming a family
    // that has not loaded yet shows blank text on Android.
    const type = fontsLoaded ? fonts : systemFonts;
    return {
      mode,
      isDark: mode === 'dark',
      colors,
      fonts: type,
      fontsLoaded,
      spacing,
      radii,
      fontSize,
      shadows,
      withAlpha,
      onColor: readableOn,
      toggleTheme,
      // Back to the default (light), not to the system setting.
      resetTheme: () => setOverride(null),
    };
  }, [mode, fontsLoaded, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
