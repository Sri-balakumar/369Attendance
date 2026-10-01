import React, { forwardRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import * as haptics from '../../utils/haptics';

// The login flow's own palette, taken from the reference design: a blue that
// matches the hero art, a navy title and an orange eyebrow. Only the light
// theme uses the fixed values; the dark theme falls back to theme colours.
export const AUTH = {
  blue: '#2C6EE3',
  navy: '#172554',
  orange: '#F28C28',
  label: '#1B2437',
  muted: '#7C8699',
  fieldBg: '#F7F9FC',
  fieldBorder: '#E2E8F0',
  icon: '#8A94A6',
};

export function useAuthColors() {
  const { colors, isDark } = useTheme();
  return isDark
    ? {
        blue: AUTH.blue,
        title: colors.text,
        orange: AUTH.orange,
        label: colors.text,
        muted: colors.muted,
        fieldBg: colors.surfaceAlt,
        fieldBorder: colors.border,
        icon: colors.faint,
        text: colors.text,
        danger: colors.danger,
        success: colors.success,
      }
    : {
        blue: AUTH.blue,
        title: AUTH.navy,
        orange: AUTH.orange,
        label: AUTH.label,
        muted: AUTH.muted,
        fieldBg: AUTH.fieldBg,
        fieldBorder: AUTH.fieldBorder,
        icon: AUTH.icon,
        text: '#0F172A',
        danger: colors.danger,
        success: colors.success,
      };
}

/** Eyebrow, title and subtitle at the top of each step. */
export function AuthHeading({ eyebrow, title, subtitle }) {
  const { fonts } = useTheme();
  const c = useAuthColors();
  return (
    <View>
      {eyebrow ? (
        <Text style={{ color: c.orange, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 2.2 }}>{eyebrow}</Text>
      ) : null}
      <Text style={{ color: c.title, fontFamily: fonts.bold, fontSize: 26, marginTop: eyebrow ? 5 : 0, letterSpacing: -0.3 }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ color: c.muted, fontFamily: fonts.regular, fontSize: 14, marginTop: 5, lineHeight: 20 }}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

/**
 * A labelled field: the label sits above a rounded, lightly filled box with an
 * icon on the left, as in the reference. `onPress` turns it into a picker
 * (the database list); `loading` shows a spinner in place of the value;
 * `display` shows the value read-only (a database picked automatically).
 */
const AuthField = forwardRef(function AuthField(
  { label, icon, value, onChangeText, placeholder, secure, onPress, loading, display, trailing, error, style, ...rest },
  ref
) {
  const { fonts } = useTheme();
  const c = useAuthColors();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  const borderColor = error ? c.danger : focused ? c.blue : c.fieldBorder;
  const box = (
    <View style={[styles.box, { backgroundColor: c.fieldBg, borderColor }]}>
      <Ionicons name={icon} size={20} color={focused ? c.blue : c.icon} style={{ marginRight: 12 }} />
      {onPress || loading || display ? (
        <Text
          numberOfLines={1}
          style={{ flex: 1, color: value ? c.text : c.icon, fontFamily: fonts.medium, fontSize: 16 }}
        >
          {value || placeholder}
        </Text>
      ) : (
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={c.icon}
          secureTextEntry={secure && hidden}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, { color: c.text, fontFamily: fonts.medium }, Platform.OS === 'web' ? { outlineStyle: 'none' } : null]}
          {...rest}
        />
      )}
      {loading ? <ActivityIndicator size="small" color={c.blue} /> : null}
      {secure ? (
        <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10} accessibilityRole="button" accessibilityLabel={hidden ? 'Show password' : 'Hide password'}>
          <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={c.icon} />
        </Pressable>
      ) : null}
      {trailing}
    </View>
  );

  return (
    <View style={style}>
      <Text style={{ color: c.label, fontFamily: fonts.bold, fontSize: 14, marginBottom: 7 }}>{label}</Text>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
          {box}
        </Pressable>
      ) : (
        box
      )}
      {error ? (
        <Text style={{ color: c.danger, fontFamily: fonts.medium, fontSize: 13, marginTop: 6 }}>{error}</Text>
      ) : null}
    </View>
  );
});

export default AuthField;

/** The wide blue button at the foot of each step. */
export function AuthButton({ label, icon, onPress, disabled, loading }) {
  const { fonts } = useTheme();
  const c = useAuthColors();
  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      onPressIn={disabled || loading ? undefined : haptics.press}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(loading) }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: c.blue,
          opacity: disabled ? 0.45 : pressed ? 0.88 : 1,
          shadowColor: c.blue,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 16 }}>{label}</Text>
          {icon ? <Ionicons name={icon} size={19} color="#fff" /> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.2,
    paddingHorizontal: 16,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
  button: {
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 6,
  },
});
