import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { fetchDayStatuses } from '../../services/odoo';
import { DAY_STATUSES, SUMMARY_ORDER } from '../attendance/constants';
import AdminScreen, { MonthNav } from './AdminScreen';
import { DayStatusRow } from './StatusRows';
import { useMonth } from './useMonth';

/** How every day in the month was graded, for everybody. */
export default function DayStatusScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const month = useMonth();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        setRows(await fetchDayStatuses({ year: month.year, month: month.month }));
        setError('');
      } catch (e) {
        setError(e?.message || 'Could not load the day statuses.');
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

  const counts = useMemo(() => {
    const acc = {};
    rows.forEach((r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
    });
    return acc;
  }, [rows]);

  const shown = filter ? rows.filter((r) => r.status === filter) : rows;

  return (
    <AdminScreen
      navigation={navigation}
      title="Day Status"
      subtitle="How each day was graded"
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0}
      emptyTitle="No day status yet"
      emptyMessage="Rows appear as people check in, and the cron stamps anyone who has not once the office passes Late Window Ends. Leave that hour at 0 and this stays empty."
      emptyIcon="calendar-outline"
      headerExtra={
        <MonthNav
          label={month.label}
          onPrev={month.prev}
          onNext={month.next}
          nextDisabled={month.isCurrent}
        />
      }
    >
      {/* Tap a tally to filter. The counts are the reason to open this screen;
          the individual rows are the follow-up. */}
      <View style={styles.tallies}>
        {SUMMARY_ORDER.filter((s) => counts[s]).map((s) => {
          const meta = DAY_STATUSES[s];
          const tone = colors[meta.tone] || colors.muted;
          const active = filter === s;
          return (
            <Pressable
              key={s}
              onPress={() => setFilter(active ? null : s)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.tally,
                {
                  backgroundColor: active ? withAlpha(tone, 0.2) : colors.surface,
                  borderColor: active ? tone : colors.border,
                },
              ]}
            >
              <Text style={{ color: tone, fontFamily: fonts.bold, fontSize: fontSize.md }}>
                {counts[s]}
              </Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs }}>
                {meta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {filter ? (
        <Pressable onPress={() => setFilter(null)} hitSlop={8} style={{ marginBottom: spacing.md }}>
          <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
            Show all {rows.length}
          </Text>
        </Pressable>
      ) : null}

      {shown.map((r, i) => (
        <DayStatusRow key={r.id} row={r} style={{ marginTop: i === 0 ? 0 : spacing.sm }} />
      ))}

      <View style={{ height: spacing.md }} />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  tallies: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  tally: {
    minWidth: 68,
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    borderWidth: 1,
  },
});
