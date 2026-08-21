import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip } from '../../components';
import { formatDateKeyShort, formatTime } from '../../utils/time';
import { wfhStateMeta } from './constants';

/** One WFH request. A single day, so no range and no day count. */
export default function WfhRequestCard({ item, onCancel, disabled, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const state = wfhStateMeta(item.state);
  const tone = colors[state.tone] || colors.primary;

  return (
    <Card style={style}>
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: withAlpha(tone, 0.13) }]}>
          <Ionicons name="home-outline" size={18} color={tone} />
        </View>

        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
            {formatDateKeyShort(item.date)}
          </Text>
          {item.isToday ? (
            <Text style={{ color: colors.primary, fontFamily: fonts.medium, fontSize: fontSize.xs, marginTop: 2 }}>
              Today
            </Text>
          ) : null}
        </View>

        <Chip label={state.label} tone={state.tone} icon={state.icon} size="sm" />
      </View>

      {item.reason ? (
        <Text
          numberOfLines={2}
          style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm, marginTop: spacing.sm }}
        >
          {item.reason}
        </Text>
      ) : null}

      {/* Only worth showing once the day has actually been worked. */}
      {item.checkIn ? (
        <View style={[styles.times, { borderTopColor: colors.border, marginTop: spacing.sm }]}>
          <TimeCell label="In" value={formatTime(item.checkIn)} />
          <TimeCell label="Out" value={item.checkOut ? formatTime(item.checkOut) : '--:--'} />
          {item.workedHours ? <TimeCell label="Worked" value={item.workedHours} /> : null}
        </View>
      ) : null}

      <Outcome item={item} />

      {item.canCancel ? (
        <Pressable
          onPress={() => onCancel?.(item)}
          disabled={disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Cancel WFH request for ${formatDateKeyShort(item.date)}`}
          style={({ pressed }) => [styles.cancel, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="close-circle-outline" size={15} color={colors.danger} />
          <Text style={{ color: colors.danger, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
            Cancel request
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function TimeCell({ label, value }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs }}>{label}</Text>
      <Text style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.sm, marginTop: 1 }}>
        {value}
      </Text>
    </View>
  );
}

/** autoApproved is checked first: the cron approves as OdooBot. */
function Outcome({ item }) {
  const { colors, fonts, fontSize, spacing } = useTheme();

  if (item.state === 'rejected') {
    return (
      <Text style={{ color: colors.danger, fontFamily: fonts.medium, fontSize: fontSize.xs, marginTop: spacing.sm }}>
        {item.rejectionReason || 'No reason given.'}
      </Text>
    );
  }
  if (['approved', 'checked_in', 'checked_out'].includes(item.state)) {
    const t = item.autoApproved
      ? 'Auto-approved'
      : item.approvedBy
        ? `Approved by ${item.approvedBy}`
        : 'Approved';
    return (
      <Text style={{ color: colors.success, fontFamily: fonts.medium, fontSize: fontSize.xs, marginTop: spacing.sm }}>
        {t}
      </Text>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 38, height: 38, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  times: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 10 },
  cancel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, alignSelf: 'flex-start' },
});
