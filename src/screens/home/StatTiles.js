import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { dayStatusMeta } from '../attendance/constants';
import { formatHours } from '../../utils/time';

/** Three-up summary of today, sitting directly under the attendance card. */
export default function StatTiles({ today, style }) {
  const { fontSize, colors } = useTheme();
  // Before the first check-in there is nothing to grade yet, and the day
  // status only appears once the absent stamp runs -- "Present / On time"
  // there was a guess, and wrong for anyone who had not arrived.
  // Lateness likewise needs a check-in: someone stamped Absent was not "On
  // time" either.
  const checkedIn = Boolean(today?.checkInAt);
  const statusMeta = today?.status
    ? dayStatusMeta(today.status)
    : checkedIn
      ? dayStatusMeta('present')
      : { label: 'Not in yet', tone: 'muted' };

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
      // isLate/lateDisplay, not lateMinutes -- getHomeData has never returned
      // a lateMinutes field, so this tile read undefined every time and said
      // "On time" even for someone who arrived late.
      value: !checkedIn ? '—' : today?.isLate ? today?.lateDisplay || 'Late' : 'On time',
      tone: !checkedIn ? colors.muted : today?.isLate ? colors.warning : colors.success,
    },
  ];

  return (
    <View style={[styles.row, style]}>
      {/* key is destructured OUT of the spread: React 19 warns when a key
          arrives via {...props}, and it is identity rather than a prop. */}
      {tiles.map(({ key, ...tile }) => (
        <Tile key={key} {...tile} />
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
