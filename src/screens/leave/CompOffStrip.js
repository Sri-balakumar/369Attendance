import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Card } from '../../components';

/**
 * Compensatory-off balance.
 *
 * Sits beside the paid-leave strip rather than inside it, because the two are
 * different pots: paid leave is an allowance the company grants, a comp off is
 * a day already worked and owed back. Spending one costs no paid leave.
 *
 * States, same discipline as LeaveBalanceStrip -- conflating any two would
 * mislead:
 *
 *   loading         the call is in flight; the paid-leave skeleton above is
 *                   already saying that, so this renders nothing
 *   null            the call FAILED (getLeaveData swallows it so the list
 *                   survives). Silent: one failure notice above is enough.
 *   enabled:false   comp off is switched off in the leave policy. Normal, and
 *                   worth no space at all.
 *   earned 0        the feature is on but nothing has been earned yet. Shown,
 *                   because "you have none" is the answer to the question
 *                   somebody opened this screen to ask.
 */
export default function CompOffStrip({ compOff, loading, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();

  if (loading || !compOff || !compOff.enabled) return null;

  const { earned, used, balance } = compOff;

  return (
    <Card style={style}>
      <View style={styles.header}>
        <Ionicons name="swap-horizontal-outline" size={17} color={colors.primary} />
        <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.md }}>
          Compensatory off
        </Text>
      </View>

      {earned > 0 || used > 0 ? (
        <View style={[styles.row, { marginTop: spacing.md }]}>
          <Cell label="Available" value={balance} tone={colors.success} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Cell label="Used" value={used} tone={colors.warning} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Cell label="Earned" value={earned} tone={colors.muted} />
        </View>
      ) : (
        <Text
          style={{
            color: colors.muted,
            fontFamily: fonts.regular,
            fontSize: fontSize.sm,
            marginTop: spacing.sm,
          }}
        >
          None yet. On a weekly off or public holiday, tap "I'm working today" on Home and the day earns one.
        </Text>
      )}

      {balance > 0 ? (
        <View
          style={[
            styles.hint,
            {
              backgroundColor: withAlpha(colors.primary, 0.08),
              marginTop: spacing.md,
            },
          ]}
        >
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.regular,
              fontSize: fontSize.xs,
            }}
          >
            Apply with leave type Comp-off. The days you worked are picked for you, oldest first, and no paid leave is spent.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function Cell({ label, value, tone }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <View
      style={styles.cell}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${formatDayCount(value)} comp off days ${label.toLowerCase()}`}
    >
      <Text style={{ color: tone, fontFamily: fonts.bold, fontSize: fontSize.lg }}>
        {formatDayCount(value)}
      </Text>
      <Text
        style={{
          color: colors.muted,
          fontFamily: fonts.regular,
          fontSize: fontSize.xs,
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** Credits are Floats -- a half day is real. Show 1.5, but never 3.0. */
function formatDayCount(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  cell: { flex: 1, alignItems: 'center' },
  divider: { width: 1, alignSelf: 'stretch' },
  hint: { borderRadius: 10, padding: 10 },
});
