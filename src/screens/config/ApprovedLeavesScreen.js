import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip } from '../../components';
import { fetchApprovedLeaves } from '../../services/odoo';
import { formatDateKeyShort } from '../../utils/time';
import AdminScreen, { MonthNav } from './AdminScreen';
import { useMonth } from './useMonth';
import { leaveTypeLabel } from './requestConstants';

/**
 * What was actually granted in a month.
 *
 * Overlap, not containment: a leave running 28 Sep to 3 Oct belongs to both
 * months, so the domain is from_date <= end AND to_date >= start rather than
 * both dates inside the month. Filtering on from_date alone would drop it from
 * October entirely.
 */
export default function ApprovedLeavesScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const month = useMonth();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        setRows(await fetchApprovedLeaves({ year: month.year, month: month.month }));
        setError('');
      } catch (e) {
        setError(e?.message || 'Could not load the approved leaves.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [month.year, month.month]
  );

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    let days = 0;
    let paid = 0;
    let unpaid = 0;
    rows.forEach((r) => {
      days += Number(r.number_of_days) || 0;
      paid += Number(r.paid_days) || 0;
      unpaid += Number(r.unpaid_days) || 0;
    });
    return { days, paid, unpaid };
  }, [rows]);

  return (
    <AdminScreen
      navigation={navigation}
      title="Approved Leaves"
      subtitle="Granted this month"
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0}
      emptyTitle="No approved leave"
      emptyMessage="Nothing was granted for this month. Pending requests live under All Leave Requests."
      emptyIcon="calendar-outline"
      headerExtra={
        <MonthNav label={month.label} onPrev={month.prev} onNext={month.next} />
      }
    >
      <View style={styles.totals}>
        <Total label="Days" value={totals.days} tone="text" />
        <Total label="Paid" value={totals.paid} tone="success" />
        <Total label="Unpaid" value={totals.unpaid} tone="warning" />
      </View>

      {rows.map((r, i) => (
        <Card key={r.id} padded={false} style={{ marginTop: i === 0 ? 0 : spacing.sm }}>
          <View style={[styles.row, { padding: spacing.base }]}>
            <View style={[styles.icon, { backgroundColor: withAlpha(colors.success, 0.13) }]}>
              <Ionicons name="checkmark-circle-outline" size={17} color={colors.success} />
            </View>
            <View style={{ flex: 1, marginLeft: 11 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                {r.employee_name || '—'}
              </Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                {leaveTypeLabel(r.leave_type)} ·{' '}
                {r.to_date && r.to_date !== r.from_date
                  ? `${formatDateKeyShort(r.from_date)} – ${formatDateKeyShort(r.to_date)}`
                  : formatDateKeyShort(r.from_date)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.base }}>
                {r.is_half_day ? '½' : r.number_of_days}
              </Text>
              {Number(r.unpaid_days) > 0 ? (
                <Chip label={`${r.unpaid_days} unpaid`} tone="warning" size="sm" />
              ) : null}
            </View>
          </View>
        </Card>
      ))}

      <View style={{ height: spacing.md }} />
    </AdminScreen>
  );
}

function Total({ label, value, tone }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <View style={[styles.total, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={{ color: tone === 'text' ? colors.text : colors[tone], fontFamily: fonts.bold, fontSize: fontSize.md }}>
        {Number(value) % 1 === 0 ? value : value.toFixed(1)}
      </Text>
      <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 34, height: 34, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  totals: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  total: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
  },
});
