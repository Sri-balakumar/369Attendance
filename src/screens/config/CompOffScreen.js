import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip } from '../../components';
import { fetchCompOffCredits } from '../../services/odoo';
import { formatDateKeyShort } from '../../utils/time';
import AdminScreen, { EmptyState } from './AdminScreen';
import { GUIDES } from './guides';
import { nameOf } from './StatusRows';
import { COMP_OFF_FILTERS, compOffStateMeta, compOffSourceLabel, fmtDays } from './compOffConstants';

/**
 * The comp-off ledger: one row per day off somebody actually worked.
 *
 * Mirrors Odoo's "Compensatory Off" list. Credits are created by the server
 * on check-in and spent by summation (a comp-off leave draws down the oldest
 * credit first), so the only manual acts here are adding a credit the system
 * missed and cancelling or restoring one. Optional employeeId comes from the
 * Leave Balances drill-down.
 */
export default function CompOffScreen({ navigation, route }) {
  const employeeId = route?.params?.employeeId || null;
  const employeeName = route?.params?.employeeName || '';
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const [state, setState] = useState('available');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        setRows(await fetchCompOffCredits({ state, employeeId }));
        setError('');
      } catch (e) {
        setError(e?.message || 'Could not load the comp-off credits.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [state, employeeId]
  );

  // On focus, so a cancel or restore on the form shows up on return.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const totalLeft = rows.reduce((n, r) => n + (Number(r.days_left) || 0), 0);

  return (
    <AdminScreen guide={GUIDES.compOff}
      navigation={navigation}
      title="Compensatory Off"
      subtitle={employeeName || 'Credits for days off worked'}
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      headerExtra={
        <View style={styles.filters}>
          {COMP_OFF_FILTERS.map((f) => {
            const active = f.key === state;
            return (
              <Pressable
                key={f.label}
                onPress={() => {
                  setLoading(true);
                  setState(f.key);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.onHeader : withAlpha(colors.onHeader, 0.16),
                    borderColor: withAlpha(colors.onHeader, active ? 0 : 0.22),
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? colors.header : colors.onHeader,
                    fontFamily: active ? fonts.semibold : fonts.medium,
                    fontSize: fontSize.xs,
                  }}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      }
    >
      {/* Inline rather than AdminScreen's `empty`, which swaps out the children
          -- and with them the Add button, which is exactly what an admin needs
          when the ledger is empty. */}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState
          title="No credits here"
          message="A credit appears when someone taps I'm working today on a weekly off or a public holiday. It is sized when they check out: half a day for a short shift, a full day once they have worked enough hours."
          icon="sunny-outline"
        />
      ) : null}

      {state === 'available' && rows.length ? (
        <Text
          style={{
            color: colors.muted,
            fontFamily: fonts.regular,
            fontSize: fontSize.xs,
            marginBottom: spacing.sm,
          }}
        >
          {fmtDays(totalLeft)} day{totalLeft === 1 ? '' : 's'} still unspent across {rows.length} credit
          {rows.length === 1 ? '' : 's'}
        </Text>
      ) : null}

      {rows.map((r, i) => {
        const meta = compOffStateMeta(r.state);
        const tone = colors[meta.tone] || colors.muted;
        return (
          <Pressable
            key={r.id}
            onPress={() => navigation.navigate('CompOffForm', { id: r.id })}
            android_ripple={{ color: withAlpha(tone, 0.12) }}
            accessibilityRole="button"
            accessibilityLabel={`${nameOf(r.employee_id)} ${formatDateKeyShort(r.date_earned)}`}
            style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: i === 0 ? 0 : spacing.sm }]}
          >
            <Card padded={false}>
              <View style={[styles.row, { padding: spacing.base }]}>
                <View style={[styles.date, { backgroundColor: withAlpha(tone, 0.13) }]}>
                  <Text style={{ color: tone, fontFamily: fonts.bold, fontSize: fontSize.sm }}>
                    {String(r.date_earned || '').slice(8, 10)}
                  </Text>
                  <Text style={{ color: tone, fontFamily: fonts.medium, fontSize: 9 }}>
                    {formatDateKeyShort(r.date_earned).slice(3, 6).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 11 }}>
                  <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                    {nameOf(r.employee_id)}
                  </Text>
                  <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                    {compOffSourceLabel(r.source)}
                    {r.state === 'declared'
                      ? ' · working today, not yet sized'
                      : r.state === 'available'
                        ? ` · ${fmtDays(r.days_left)} of ${fmtDays(r.days)} left`
                        : ` · ${fmtDays(r.days)} day${Number(r.days) === 1 ? '' : 's'}`}
                    {r.state === 'consumed' ? ' · fully used' : ''}
                    {Number(r.hours_worked) > 0 ? ` · ${fmtDays(r.hours_worked)} h worked` : ''}
                    {r.state === 'expired' && Number(r.days_lapsed) > 0 ? ` · ${fmtDays(r.days_lapsed)} lapsed` : ''}
                    {r.state === 'available' && r.expiry_date ? ` · until ${formatDateKeyShort(r.expiry_date)}` : ''}
                    {!r.auto_created ? ' · manual' : ''}
                  </Text>
                </View>
                <Chip label={meta.label} tone={meta.tone} size="sm" />
                <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 8 }} />
              </View>
            </Card>
          </Pressable>
        );
      })}

      <Pressable
        onPress={() => navigation.navigate('CompOffForm', { id: null, employeeId })}
        accessibilityRole="button"
        accessibilityLabel="Add a credit"
        style={({ pressed }) => [
          styles.add,
          {
            borderColor: colors.border,
            backgroundColor: pressed ? withAlpha(colors.primary, 0.08) : 'transparent',
            marginTop: spacing.md,
          },
        ]}
      >
        <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
        <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
          Add a credit
        </Text>
      </Pressable>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  date: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
});
