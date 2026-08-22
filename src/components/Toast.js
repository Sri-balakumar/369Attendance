import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Text, View, StyleSheet, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

const ToastContext = createContext(() => {});

/** showToast(message, tone) — tone is a palette key: info / success / danger. */
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const showToast = useCallback((message, tone = 'info') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => timer.current && clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {/* key kept out of the spread, as in StatTiles. */}
      {toast ? <ToastView key={toast.key} message={toast.message} tone={toast.tone} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ message, tone }) {
  const { fontSize, colors, radii, fonts, shadows, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const color = colors[tone] || colors.info;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();
  }, [anim]);

  const icon = tone === 'success' ? 'checkmark-circle' : tone === 'danger' ? 'alert-circle' : 'information-circle';

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          top: insets.top + 10,
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }],
        },
      ]}
    >
      <View
        style={[
          styles.toast,
          {
            backgroundColor: colors.surface,
            borderColor: withAlpha(color, 0.35),
            borderRadius: radii.md,
          },
          shadows.raised,
        ]}
      >
        <Ionicons name={icon} size={19} color={color} />
        <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: fontSize.sm }}>{message}</Text>
      </View>
    </Animated.View>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, zIndex: 999 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderWidth: 1,
  },
});
