import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, AppTextInput } from '../../components';

/**
 * The pieces every admin form on this tab is built from.
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
 * The yellow "how to use this page" banner: a small user manual at the top of
 * a screen. Open by default; tapping the title folds it away for this visit.
 */
export function GuideBanner({ title, intro, steps = [], icon = 'book-outline', defaultOpen = true, style }) {
  const { colors, fonts, fontSize, spacing, isDark } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  const ink = colors.guideInk;
  const body = isDark ? colors.text : colors.guideInk;
  const hasBody = Boolean(intro) || steps.length > 0;
  return (
    <View
      style={[
        styles.guide,
        { backgroundColor: colors.guideFill, borderColor: colors.guideBorder, marginBottom: spacing.md },
        style,
      ]}
    >
      <Pressable
        onPress={hasBody ? () => setOpen((o) => !o) : undefined}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}. ${open ? 'Hide' : 'Show'} the steps.`}
        style={styles.guideHead}
      >
        <View style={[styles.guideIcon, { borderColor: colors.guideBorder }]}>
          <Ionicons name={icon} size={15} color={ink} />
        </View>
        <Text style={{ flex: 1, color: ink, fontFamily: fonts.bold, fontSize: fontSize.sm }}>{title}</Text>
        {hasBody ? <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={17} color={ink} /> : null}
      </Pressable>
      {open && hasBody ? (
        <View style={{ marginTop: spacing.sm }}>
          {intro ? (
            <Text style={{ color: body, fontFamily: fonts.regular, fontSize: fontSize.xs, lineHeight: 18 }}>
              {intro}
            </Text>
          ) : null}
          {steps.map((step, i) => (
            <View key={i} style={[styles.guideStep, { marginTop: i === 0 && !intro ? 0 : 7 }]}>
              <View style={[styles.guideNum, { backgroundColor: colors.guideBorder }]}>
                <Text style={{ color: isDark ? '#1E293B' : ink, fontFamily: fonts.bold, fontSize: 10 }}>
                  {i + 1}
                </Text>
              </View>
              <Text style={{ flex: 1, color: body, fontFamily: fonts.regular, fontSize: fontSize.xs, lineHeight: 18 }}>
                {step}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
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
  guide: { borderWidth: 1, borderRadius: radii.md, padding: 12 },
  guideHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  guideIcon: {
    width: 26,
    height: 26,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  guideNum: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});
