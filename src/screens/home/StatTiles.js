import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { DAY_STATUS } from '../../services/mockOdoo';
import { formatHours } from '../../utils/time';

/** Three-up summary of today, sitting directly under the attendance card. */
export default function StatTiles({ today, style }) {
  const { fontSize, colors } = useTheme();
  const statusMeta = DAY_STATUS[today?.status] || DAY_STATUS.present;

  const tiles = [
    {
      key: 'worked',
      icon: 'time-outline',
      label: 'Worked',
      value: formatHours(today?.workedHours || 0),
      tone: colors.primary,
    },
    {
      key: 'status',
      icon: 'checkmark-done-outline',
      label: 'Status',
      value: statusMeta.label,
      tone: colors[statusMeta.tone] || colors.success,
    },
    {
      key: 'late',
      icon: 'alarm-outline',
      label: 'Late by',
      value: today?.lateMinutes ? `${today.lateMinutes} min` : 'On time',
      tone: today?.lateMinutes ? colors.warning : colors.success,
    },
  ];

  return (
    <View style={[styles.row, style]}>
      {tiles.map((t) => (
        <Tile key={t.key} {...t} />
      ))}
    </View>
  );
}

function Tile({ icon, label, value, tone }) {
  const { fontSize, colors, fonts, radii, shadows, withAlpha } = useTheme();
  return (
    <View
      style={[
        styles.tile,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.md,
        },
        shadows.card,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: withAlpha(tone, 0.13), borderRadius: radii.sm }]}>
        <Ionicons name={icon} size={16} color={tone} />
      </View>
      <Text
        numberOfLines={1}
        style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.base, marginTop: 9 }}
      >
        {value}
      </Text>
      <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs, marginTop: 1 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, borderWidth: 1, padding: 13 },
  icon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
});
