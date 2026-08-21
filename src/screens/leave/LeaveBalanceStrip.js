import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Skeleton } from '../../components';

/**
 * Paid-leave balance.
 *
 * Four states, and they are genuinely different things -- conflating any two
 * of them would mislead:
 *
 *   loading      the call is in flight
 *   null         the call FAILED (getLeaveData swallows it so the list survives)
 *   hasQuota:false  the policy is switched off. This is NORMAL, not an error,
 *                   and today it is the state on every database here, so it
 *                   must not be dressed up in warning colours.
 *   hasQuota:true   real figures
 */
export default function LeaveBalanceStrip({ balance, year, loading, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();

  if (loading) {
    return (
      <Card style={style}>
        <Skeleton width="45%" height={16} />
        <Skeleton height={44} radius={12} style={{ marginTop: 14 }} />
        <Skeleton width="60%" height={12} style={{ marginTop: 12 }} />
      </Card>
    );
  }

  if (!balance) return <Notice style={style} icon="information-circle-outline" text="Leave balance unavailable." />;

  if (!balance.hasQuota) {
    return (
      <Notice
        style={style}
        icon="information-circle-outline"
        text="No paid-leave quota is configured. You can still apply for leave."
      />
    );
  }

  const { totalAllowed, totalUsed, remaining, perMonth, unpaidDeductionEnabled } = balance;
  const pct = totalAllowed > 0 ? Math.min(1, Math.max(0, totalUsed / totalAllowed)) : 0;
  const cells = [
    { label: 'Remaining', value: remaining, tone: colors.success },
    { label: 'Used', value: totalUsed, tone: colors.warning },
    { label: 'Allowed', value: totalAllowed, tone: colors.muted },
  ];

  return (
    <Card style={style}>
      <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.md }}>
        Paid leave
      </Text>

      <View style={[styles.row, { marginTop: spacing.md }]}>
        {cells.map((c, i) => (
          <React.Fragment key={c.label}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
            <View
              style={styles.cell}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${formatDayCount(c.value)} days ${c.label.toLowerCase()}`}
            >
              <Text style={{ color: c.tone, fontFamily: fonts.bold, fontSize: fontSize.lg }}>
                {formatDayCount(c.value)}
              </Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                {c.label}
              </Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      <View
        style={[styles.track, { backgroundColor: withAlpha(colors.muted, 0.16), marginTop: spacing.md }]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: totalAllowed, now: totalUsed }}
      >
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: colors.warning }]} />
      </View>

      <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: spacing.sm }}>
        {year}
        {perMonth ? ` · ${formatDayCount(perMonth)} day/month accrual` : ''}
      </Text>

      {/* The server counts state = 'approved' only. Anyone with a pending
          request will otherwise read this figure as simply wrong. */}
      <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
        Used counts approved leave only.
      </Text>

      {unpaidDeductionEnabled ? (
        <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
          Days beyond your quota are unpaid.
        </Text>
      ) : null}
    </Card>
  );
}

/** Leave days are Floats: show 1.5, but never 3.0. */
function formatDayCount(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function Notice({ icon, text, style }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <Card style={style}>
      <View style={styles.notice}>
        <Ionicons name={icon} size={17} color={colors.muted} />
        <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm }}>
          {text}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  cell: { flex: 1, alignItems: 'center' },
  divider: { width: 1, alignSelf: 'stretch' },
  track: { height: 6, borderRadius: radii.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radii.pill },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
