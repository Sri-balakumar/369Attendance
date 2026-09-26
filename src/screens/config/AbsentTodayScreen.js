import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../theme';
import { fetchAbsentToday } from '../../services/odoo';
import { formatLongDate } from '../../utils/time';
import AdminScreen from './AdminScreen';
import { GUIDES } from './guides';
import { DayStatusRow } from './StatusRows';

/**
 * Who is missing today.
 *
 * The backend menuitem for this one is gated to hr.group_hr_manager and
 * base.group_system explicitly, which the Config tab already satisfies.
 */
export default function AbsentTodayScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing } = useTheme();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      setRows(await fetchAbsentToday());
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load today’s absentees.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminScreen guide={GUIDES.absentToday}
      navigation={navigation}
      title="Absent Today"
      subtitle={formatLongDate()}
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0}
      emptyTitle="Nobody is absent today"
      emptyMessage="Everyone expected in has checked in, or is on approved leave or an approved work-from-home day. Leave days appear as Leave rather than Absent."
    >
      <Text
        style={{
          color: colors.muted,
          fontFamily: fonts.medium,
          fontSize: fontSize.xs,
          marginBottom: spacing.md,
        }}
      >
        {rows.length} {rows.length === 1 ? 'person has' : 'people have'} not checked in.
      </Text>

      {rows.map((r, i) => (
        <DayStatusRow key={r.id} row={r} style={{ marginTop: i === 0 ? 0 : spacing.sm }} />
      ))}

      <View style={{ height: spacing.md }} />
    </AdminScreen>
  );
}
