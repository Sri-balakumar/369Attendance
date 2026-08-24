import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip } from '../../components';
import { fetchLeaveQueue, fetchWfhQueue } from '../../services/odoo';
import { formatDateKeyShort } from '../../utils/time';
import AdminScreen from './AdminScreen';
import {
  LEAVE_FILTERS,
  WFH_FILTERS,
  leaveStateMeta,
  wfhStateMeta,
  leaveTypeLabel,
} from './requestConstants';

/**
 * The manager approval queues, for leave and for WFH.
 *
 * One screen for both, because they differ only in vocabulary and in which
 * two lines of the card get filled in -- the shape (filter chips, list, tap
 * through to a decision) is identical, and the app already has two nearly
 * identical employee-facing screens for the same reason.
 *
 * Deliberately NOT the employee's own list: LeaveScreen and WfhScreen already
 * cover "my requests". This is everybody's, and only a manager reaches it.
 */
export default function RequestQueueScreen({ navigation, route }) {
  const kind = route?.params?.kind === 'wfh' ? 'wfh' : 'leave';
  const isWfh = kind === 'wfh';
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();

  const filters = isWfh ? WFH_FILTERS : LEAVE_FILTERS;
  const [state, setState] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        const fetch = isWfh ? fetchWfhQueue : fetchLeaveQueue;
        setRows(await fetch({ state }));
        setError('');
      } catch (e) {
        setError(e?.message || 'Could not load the requests.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isWfh, state]
  );

  // On focus, so a decision made on the detail screen is reflected on return.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const label = filters.find((f) => f.key === state)?.label || 'All';

  return (
    <AdminScreen
      navigation={navigation}
      title={isWfh ? 'All WFH Requests' : 'All Leave Requests'}
      subtitle="Everyone's requests"
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0}
      emptyTitle={state === 'pending' ? 'Nothing waiting' : `No ${label.toLowerCase()} requests`}
      emptyMessage={
        state === 'pending'
          ? 'Every request has been decided. New ones appear here as they are submitted.'
          : 'Nothing matches that filter this time.'
      }
      headerExtra={
        <View style={styles.filters}>
          {filters.map((f) => {
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
                    backgroundColor: active
                      ? colors.onHeader
                      : withAlpha(colors.onHeader, 0.16),
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
      <Text
        style={{
          color: colors.muted,
          fontFamily: fonts.medium,
          fontSize: fontSize.xs,
          marginBottom: spacing.md,
        }}
      >
        {rows.length} {rows.length === 1 ? 'request' : 'requests'}
      </Text>

      {rows.map((r, i) => (
        <RequestCard
          key={r.id}
          row={r}
          isWfh={isWfh}
          style={{ marginTop: i === 0 ? 0 : spacing.sm }}
          onPress={() => navigation.navigate('RequestDetail', { kind, id: r.id })}
        />
      ))}

      <View style={{ height: spacing.md }} />
    </AdminScreen>
  );
}

function RequestCard({ row, isWfh, onPress, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const meta = isWfh ? wfhStateMeta(row.state) : leaveStateMeta(row.state);
  const tone = colors[meta.tone] || colors.muted;

  const when = isWfh
    ? formatDateKeyShort(row.request_date)
    : row.to_date && row.to_date !== row.from_date
      ? `${formatDateKeyShort(row.from_date)} – ${formatDateKeyShort(row.to_date)}`
      : formatDateKeyShort(row.from_date);

  const what = isWfh
    ? 'Work from home'
    : `${leaveTypeLabel(row.leave_type)} · ${row.is_half_day ? 'half day' : `${row.number_of_days} day${row.number_of_days === 1 ? '' : 's'}`}`;

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: withAlpha(tone, 0.12) }}
      accessibilityRole="button"
      accessibilityLabel={`${row.employee_name || 'Request'}, ${meta.label}`}
      style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }, style]}
    >
      <Card padded={false}>
        <View style={[styles.row, { padding: spacing.base }]}>
          <View style={[styles.icon, { backgroundColor: withAlpha(tone, 0.13) }]}>
            <Ionicons name={meta.icon} size={17} color={tone} />
          </View>
          <View style={{ flex: 1, marginLeft: 11 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
              {row.employee_name || '—'}
            </Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
              {what}
            </Text>
            <Text style={{ color: colors.faint, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 1 }}>
              {when}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Chip label={meta.label} tone={meta.tone} size="sm" />
            {row.auto_approved ? (
              <Text style={{ color: colors.faint, fontFamily: fonts.regular, fontSize: fontSize.xs }}>
                auto
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 6 }} />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 34, height: 34, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
});
