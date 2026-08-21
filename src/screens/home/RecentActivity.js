import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Card, Chip, Skeleton } from '../../components';
import { DAY_STATUS } from '../../services/mockOdoo';
import { formatHours, formatTime } from '../../utils/time';

/** Last five days. Status vocabulary matches attendance_day_status.py. */
export default function RecentActivity({ items = [], loading, style }) {
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
        Recent activity
      </Text>

      <Card padded={false}>
        {loading
          ? [0, 1, 2].map((i) => (
              <View key={i} style={[styles.row, { borderBottomColor: colors.border, borderBottomWidth: i < 2 ? 1 : 0 }]}>
                <Skeleton width={44} height={44} radius={14} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Skeleton width="55%" height={13} />
                  <Skeleton width="35%" height={11} style={{ marginTop: 7 }} />
                </View>
                <Skeleton width={58} height={22} radius={999} />
              </View>
            ))
          : items.map((item, i) => {
              const meta = DAY_STATUS[item.status] || DAY_STATUS.present;
              const tone = colors[meta.tone] || colors.primary;
              const d = new Date(item.date);
              return (
                <View
                  key={item.id}
                  style={[
                    styles.row,
                    { borderBottomColor: colors.border, borderBottomWidth: i < items.length - 1 ? 1 : 0 },
                  ]}
                >
                  <DateBadge date={d} tone={tone} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.timeLine}>
                      <Ionicons name="log-in-outline" size={13} color={colors.faint} />
                      <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: fontSize.sm, marginLeft: 4 }}>
                        {formatTime(item.checkIn)}
                      </Text>
                      <Text style={{ color: colors.faint, fontFamily: fonts.regular, fontSize: fontSize.sm, marginHorizontal: 6 }}>
                        →
                      </Text>
                      <Ionicons name="log-out-outline" size={13} color={colors.faint} />
                      <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: fontSize.sm, marginLeft: 4 }}>
                        {formatTime(item.checkOut)}
                      </Text>
                    </View>
                    <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 3 }}>
                      {item.hours ? formatHours(item.hours) : 'No hours recorded'}
                    </Text>
                  </View>
                  <Chip label={meta.label} tone={meta.tone} size="sm" />
                </View>
              );
            })}
      </Card>
    </View>
  );
}

function DateBadge({ date, tone }) {
  const { fontSize, colors, fonts, radii, withAlpha } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: withAlpha(tone, 0.11), borderRadius: 14 }]}>
      <Text style={{ color: tone, fontFamily: fonts.bold, fontSize: fontSize.base }}>{date.getDate()}</Text>
      <Text style={{ color: tone, fontFamily: fonts.medium, fontSize: fontSize.xs, marginTop: -1, letterSpacing: 0.5 }}>
        {date.toLocaleDateString([], { month: 'short' }).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  badge: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  timeLine: { flexDirection: 'row', alignItems: 'center' },
});
