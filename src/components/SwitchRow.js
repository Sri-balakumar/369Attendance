import React from 'react';
import { View, Text, Pressable, Switch, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../theme';

/**
 * Label + optional help line + a switch, as one tappable row.
 *
 * Ten of the attendance-rule fields are booleans, so this exists rather than
 * ten inline blocks. Styling follows the Remember-me switch on the Login
 * screen so the two read as the same control.
 */
export default function SwitchRow({ label, help, value, onValueChange, disabled, last, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const on = Boolean(value);
  return (
    <Pressable
      onPress={disabled ? undefined : () => onValueChange(!on)}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: Boolean(disabled) }}
      accessibilityLabel={label}
      style={[
        styles.row,
        {
          borderBottomColor: colors.border,
          borderBottomWidth: last ? 0 : 1,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: fontSize.sm }}>
          {label}
        </Text>
        {help ? (
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.regular,
              fontSize: fontSize.xs,
              marginTop: 3,
              lineHeight: 16,
            }}
          >
            {help}
          </Text>
        ) : null}
      </View>
      <Switch
        value={on}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: withAlpha(colors.primary, 0.5) }}
        thumbColor={on ? colors.primary : colors.surface}
        // react-native-web does not read RN's thumbColor for the ON state --
        // it has its own activeThumbColor and falls back to a default green,
        // which is the one saturated colour this palette does not use. Native
        // never sees these two.
        {...(Platform.OS === 'web'
          ? { activeThumbColor: colors.primary, activeTrackColor: withAlpha(colors.primary, 0.5) }
          : null)}
        style={Platform.OS === 'ios' ? { transform: [{ scale: 0.82 }] } : undefined}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13 },
});
