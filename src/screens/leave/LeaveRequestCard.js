import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip } from '../../components';
import { formatDateRange, formatDays } from '../../utils/time';
import { leaveStateMeta, leaveTypeMeta } from './constants';

/** One leave request. */
export default function LeaveRequestCard({ item, onCancel, disabled, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const state = leaveStateMeta(item.state);
  const type = leaveTypeMeta(item.type);
  const tone = colors[state.tone] || colors.primary;

  return (
    <Card style={style}>
      <View style={styles.top}>
        {/* Tinted by STATE, not by type: it makes the row's status legible
            before a single word has been read. */}
        <View style={[styles.icon, { backgroundColor: withAlpha(tone, 0.13) }]}>
          <Ionicons name={type.icon} size={18} color={tone} />
        </View>

        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
            {item.typeLabel || type.label}
          </Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm, marginTop: 2 }}>
            {formatDateRange(item.from, item.to)} · {formatDays(item.days)}
          </Text>
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

      <Outcome item={item} />

      {item.canCancel ? (
        <Pressable
          onPress={() => onCancel?.(item)}
          disabled={disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Cancel ${item.typeLabel || type.label} request`}
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

/**
 * The line under the reason, when there is something to say.
 *
 * autoApproved is checked BEFORE approvedBy on purpose: the cron approves as
 * base.user_root, so the name branch would otherwise render the faintly
 * alarming "Approved by OdooBot".
 */
function Outcome({ item }) {
  const { colors, fonts, fontSize, spacing } = useTheme();

  if (item.state === 'approved') {
    const text = item.autoApproved
      ? 'Auto-approved'
      : item.approvedBy
        ? `Approved by ${item.approvedBy}`
        : 'Approved';
    return (
      <Text style={{ color: colors.success, fontFamily: fonts.medium, fontSize: fontSize.xs, marginTop: spacing.sm }}>
        {text}
      </Text>
    );
  }

  if (item.state === 'rejected') {
    return (
      <Text style={{ color: colors.danger, fontFamily: fonts.medium, fontSize: fontSize.xs, marginTop: spacing.sm }}>
        {item.rejectionReason || 'No reason given.'}
      </Text>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 38, height: 38, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  cancel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, alignSelf: 'flex-start' },
});
