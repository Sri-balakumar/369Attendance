import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, AppTextInput } from '../../components';

/**
 * The four pieces every admin form on this tab is built from.
 *
 * They started as private helpers inside the attendance-rules form; once a
 * second and third form wanted the same titled card, the same muted caption
 * under a field and the same read-only-field-opens-a-picker row, copying them
 * a third time was how the three would have drifted apart.
 */

/** A titled card with a tinted icon -- one per group in the Odoo form. */
export function Section({ title, icon, tone, children, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const color = colors[tone] || colors.primary;
  return (
    <Card padded={false} style={[{ marginBottom: spacing.md }, style]}>
      <View style={[styles.head, { borderBottomColor: colors.border }]}>
        <View style={[styles.headIcon, { backgroundColor: withAlpha(color, 0.13) }]}>
          <Ionicons name={icon} size={16} color={color} />
        </View>
        <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.sm, marginLeft: 10 }}>
          {title}
        </Text>
      </View>
      <View style={{ paddingHorizontal: spacing.base, paddingVertical: spacing.md }}>{children}</View>
    </Card>
  );
}

/** Explanatory text under a field, usually the model's own help= string. */
export function Caption({ children }) {
  const { colors, fonts, fontSize, spacing } = useTheme();
  return (
    <Text
      style={{
        color: colors.muted,
        fontFamily: fonts.regular,
        fontSize: fontSize.xs,
        marginTop: spacing.sm,
        lineHeight: 17,
      }}
    >
      {children}
    </Text>
  );
}

/** A tinted callout. `tone` names a colour on the palette. */
export function Note({ tone, icon, children, style }) {
  const { colors, fonts, fontSize, withAlpha } = useTheme();
  const color = colors[tone] || colors.warning;
  return (
    <View
      style={[
        styles.note,
        { backgroundColor: withAlpha(color, 0.1), borderColor: withAlpha(color, 0.35) },
        style,
      ]}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text style={{ flex: 1, color, fontFamily: fonts.medium, fontSize: fontSize.xs, lineHeight: 17 }}>
        {children}
      </Text>
    </View>
  );
}

/**
 * A read-only field that opens a sheet.
 *
 * AppTextInput already supports exactly this: passing onPress overrides its
 * default focus-the-input behaviour, which matters because an
 * editable={false} TextInput does not reliably fire press events on iOS.
 */
export function Picker({ label, value, icon, error, disabled, onPress, style }) {
  const { colors } = useTheme();
  return (
    <AppTextInput
      label={label}
      value={value}
      icon={icon}
      error={error}
      editable={false}
      onPress={disabled ? undefined : onPress}
      style={[{ opacity: disabled ? 0.6 : 1 }, style]}
      rightSlot={<Ionicons name="chevron-down" size={17} color={colors.muted} />}
    />
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  headIcon: { width: 30, height: 30, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 11,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: 12,
  },
});
