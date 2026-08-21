import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

/**
 * The 2x2 grid is where the module screens attach next: Leave and WFH map onto
 * the /leave/* and /wfh/* endpoints the Odoo addon already exposes. For now each
 * tile just says so.
 */
const ACTIONS = [
  { key: 'leave', icon: 'calendar-outline', label: 'Apply Leave', caption: 'Casual · Sick · Earned', tone: 'primary' },
  { key: 'wfh', icon: 'home-outline', label: 'Work From Home', caption: 'Request a WFH day', tone: 'accent' },
  { key: 'attendance', icon: 'list-outline', label: 'My Attendance', caption: 'Day-wise history', tone: 'info' },
  { key: 'reports', icon: 'bar-chart-outline', label: 'Reports', caption: 'Monthly summary', tone: 'success' },
];

export default function QuickActions({ onPress, style }) {
  const { colors, fonts, fontSize, spacing } = useTheme();
  return (
    <View style={style}>
      <Text
        style={{
          color: colors.text,
          fontFamily: fonts.bold,
          fontSize: fontSize.md,
          marginBottom: spacing.md,
        }}
      >
        Quick actions
      </Text>
      <View style={styles.grid}>
        {ACTIONS.map((a) => (
          <ActionTile key={a.key} action={a} onPress={() => onPress?.(a)} />
        ))}
      </View>
    </View>
  );
}

function ActionTile({ action, onPress }) {
  const { fontSize, colors, fonts, radii, shadows, withAlpha } = useTheme();
  const tone = colors[action.tone] || colors.primary;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: withAlpha(tone, 0.12), borderless: false }}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.md,
          opacity: pressed ? 0.85 : 1,
        },
        shadows.card,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: withAlpha(tone, 0.13), borderRadius: radii.sm }]}>
        <Ionicons name={action.icon} size={20} color={tone} />
      </View>
      <Text style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base, marginTop: 11 }}>
        {action.label}
      </Text>
      <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
        {action.caption}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // 48% rather than 50% leaves room for the 10px gap without a width calc.
  tile: { width: '48%', flexGrow: 1, borderWidth: 1, padding: 15 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
