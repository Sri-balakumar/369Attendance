import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../theme';
import { fetchLateRecords } from '../../services/odoo';
import AdminScreen, { MonthNav } from './AdminScreen';
import { GUIDES } from './guides';
import { LateRow } from './StatusRows';
import { useMonth } from './useMonth';

/** Every late check-in, newest first, one month at a time. */
export default function LateRecordsScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing } = useTheme();
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
        setRows(await fetchLateRecords({ year: month.year, month: month.month }));
        setError('');
      } catch (e) {
        setError(e?.message || 'Could not load the late records.');
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

  const totalMinutes = rows.reduce((sum, r) => sum + (Number(r.late_minutes) || 0), 0);

  return (
    <AdminScreen guide={GUIDES.lateRecords}
      navigation={navigation}
      title="Late Records"
      subtitle="Every late check-in"
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0}
      emptyTitle="Nobody was late"
      emptyMessage="No check-in in this month was flagged late. If that looks wrong, check that late tracking is on for the scope in Office Hours."
      headerExtra={
        <MonthNav
          label={month.label}
          onPrev={month.prev}
          onNext={month.next}
          nextDisabled={month.isCurrent}
        />
      }
    >
      <Text
        style={{
          color: colors.muted,
          fontFamily: fonts.medium,
          fontSize: fontSize.xs,
          marginBottom: spacing.md,
        }}
      >
        {rows.length} late {rows.length === 1 ? 'check-in' : 'check-ins'} ·{' '}
        {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m total
      </Text>

      {rows.map((r, i) => (
        <LateRow key={r.id} row={r} style={{ marginTop: i === 0 ? 0 : spacing.sm }} />
      ))}

      <View style={{ height: spacing.md }} />
    </AdminScreen>
  );
}
