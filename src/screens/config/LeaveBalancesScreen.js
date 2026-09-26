import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Card } from '../../components';
import { fetchLeaveBalances } from '../../services/odoo';
import AdminScreen, { MonthNav } from './AdminScreen';
import { GUIDES } from './guides';
import { nameOf } from './StatusRows';
import { fmtDays } from './compOffConstants';

/**
 * Every employee's leave position for a year -- Odoo's "Leave Balances" list.
 *
 * Two ledgers side by side: the paid-leave quota (allowed / taken / left) and
 * comp off (earned / used / left). They never mix: a comp-off leave is paid
 * out of the comp-off balance, never the quota. Tapping a row opens that
 * person's credits.
 */
export default function LeaveBalancesScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        setRows(await fetchLeaveBalances(year));
        setError('');
      } catch (e) {
        setError(e?.message || 'Could not load the leave balances.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [year]
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminScreen guide={GUIDES.leaveBalances}
      navigation={navigation}
      title="Leave Balances"
      subtitle="Paid leave and comp off, per employee"
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0}
      emptyTitle="No employees"
      emptyMessage="Balances appear here once employees exist."
      emptyIcon="wallet-outline"
      headerExtra={
        <MonthNav
          label={String(year)}
          onPrev={() => setYear((y) => y - 1)}
          onNext={() => setYear((y) => y + 1)}
        />
      }
    >
      {rows.map((r, i) => (
        <Pressable
          key={r.id}
          onPress={() => navigation.navigate('CompOff', { employeeId: r.id, employeeName: r.name })}
          android_ripple={{ color: withAlpha(colors.primary, 0.12) }}
          accessibilityRole="button"
          accessibilityLabel={r.name}
          style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: i === 0 ? 0 : spacing.sm }]}
        >
          <Card>
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                  {r.name}
                </Text>
                {r.department_id ? (
                  <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                    {nameOf(r.department_id)}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} />
            </View>

            <View style={[styles.ledgers, { marginTop: spacing.md }]}>
              <Ledger
                title="Paid leave"
                tone="accent"
                cells={[
                  ['Allowed', r.paid_leave_allowed],
                  ['Taken', r.paid_leave_taken],
                  ['Left', r.paid_leave_remaining],
                ]}
              />
              <Ledger
                title="Comp off"
                tone="primary"
                cells={[
                  ['Earned', r.comp_off_earned],
                  ['Used', r.comp_off_used],
                  ['Left', r.comp_off_balance],
                ]}
              />
            </View>
          </Card>
        </Pressable>
      ))}
    </AdminScreen>
  );
}

function Ledger({ title, tone, cells }) {
  const { colors, fonts, fontSize, withAlpha } = useTheme();
  const color = colors[tone] || colors.primary;
  return (
    <View style={[styles.ledger, { backgroundColor: withAlpha(color, 0.08) }]}>
      <Text style={{ color, fontFamily: fonts.semibold, fontSize: fontSize.xs, marginBottom: 6 }}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row' }}>
        {cells.map(([label, value], i) => (
          <View key={label} style={{ flex: 1 }}>
            <Text
              style={{
                color: i === cells.length - 1 ? color : colors.text,
                fontFamily: fonts.bold,
                fontSize: fontSize.base,
              }}
            >
              {fmtDays(value)}
            </Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: 10 }}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
  ledgers: { flexDirection: 'row', gap: 8 },
  ledger: { flex: 1, borderRadius: 10, padding: 10 },
});
