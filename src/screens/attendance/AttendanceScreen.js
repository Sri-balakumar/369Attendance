import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip, Skeleton, useToast } from '../../components';
import { useSession } from '../../state/SessionContext';
import { fetchAttendanceMonth } from '../../services/odoo';
import { formatDateKeyShort, formatTime, formatHours, parseDateKey } from '../../utils/time';
import { dayStatusMeta, SUMMARY_ORDER } from './constants';

/** Day-wise attendance history, one month at a time. */
export default function AttendanceScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const showToast = useToast();
  const { user } = useSession();

  // Held as integers, never a Date, for the same reason the calendar does it:
  // no timezone can reach a year/month pair.
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (isRefresh, at) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        setData(await fetchAttendanceMonth(user?.uid, at.year, at.month));
        setError('');
      } catch (e) {
        const message = e?.message || 'Could not load your attendance.';
        if (data) showToast(message, 'danger');
        else setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast, user?.uid]
  );

  useEffect(() => {
    load(false, cursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  const step = (delta) =>
    setCursor(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  // Never page past the current month: there is nothing recorded ahead of today.
  const atCurrentMonth =
    cursor.year === now.getFullYear() && cursor.month === now.getMonth();
  const monthLabel =
    data?.label || new Date(cursor.year, cursor.month, 1).toLocaleDateString([], {
      month: 'long',
      year: 'numeric',
    });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />

      <LinearGradient
        colors={colors.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + spacing.base }]}
      >
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [
              styles.backBtn,
              {
                backgroundColor: withAlpha(colors.onHeader, pressed ? 0.28 : 0.16),
                borderColor: withAlpha(colors.onHeader, 0.22),
              },
            ]}
          >
            <Ionicons name="chevron-back" size={20} color={colors.onHeader} />
          </Pressable>
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={{ color: colors.onHeader, fontFamily: fonts.bold, fontSize: fontSize.lg }}>
              My attendance
            </Text>
            <Text
              style={{ color: withAlpha(colors.onHeader, 0.8), fontFamily: fonts.regular, fontSize: fontSize.sm }}
            >
              Day-wise history
            </Text>
          </View>
        </View>

        <View style={[styles.monthRow, { marginTop: spacing.base }]}>
          <MonthNav icon="chevron-back" label="Previous month" onPress={() => step(-1)} />
          <Text style={{ color: colors.onHeader, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
            {monthLabel}
          </Text>
          <MonthNav
            icon="chevron-forward"
            label="Next month"
            onPress={() => step(1)}
            disabled={atCurrentMonth}
          />
        </View>
      </LinearGradient>

      <FlatList
        data={loading ? [] : data?.days || []}
        keyExtractor={(item) => String(item.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => <DayRow item={item} />}
        ListHeaderComponent={
          <SummaryStrip data={data} loading={loading} style={{ marginBottom: spacing.lg }} />
        }
        ListEmptyComponent={
          loading ? (
            <ListSkeleton />
          ) : error ? (
            <ErrorCard message={error} onRetry={() => load(false, cursor)} />
          ) : (
            <Card>
              <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
                <View style={[styles.emptyIcon, { backgroundColor: withAlpha(colors.info, 0.12) }]}>
                  <Ionicons name="calendar-clear-outline" size={24} color={colors.info} />
                </View>
                <Text
                  style={{
                    color: colors.text,
                    fontFamily: fonts.semibold,
                    fontSize: fontSize.base,
                    marginTop: spacing.md,
                  }}
                >
                  Nothing recorded
                </Text>
                <Text
                  style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm, marginTop: 4 }}
                >
                  No attendance for {monthLabel}.
                </Text>
              </View>
            </Card>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true, cursor)}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
          />
        }
      />
    </View>
  );
}

function MonthNav({ icon, label, onPress, disabled }) {
  const { colors, withAlpha } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.navBtn,
        {
          backgroundColor: withAlpha(colors.onHeader, pressed ? 0.28 : 0.14),
          opacity: disabled ? 0.3 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.onHeader} />
    </Pressable>
  );
}

/** The month at a glance. Counts only -- no money figure appears anywhere. */
function SummaryStrip({ data, loading, style }) {
  const { colors, fonts, fontSize, spacing } = useTheme();

  if (loading) {
    return (
      <Card style={style}>
        <Skeleton width="40%" height={15} />
        <Skeleton height={40} radius={10} style={{ marginTop: 12 }} />
      </Card>
    );
  }
  if (!data) return null;

  return (
    <Card style={style}>
      <View style={styles.summaryRow}>
        {SUMMARY_ORDER.map((key, i) => {
          const meta = dayStatusMeta(key);
          return (
            <React.Fragment key={key}>
              {i > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
              <View
                style={styles.summaryCell}
                accessible
                accessibilityRole="text"
                accessibilityLabel={`${data.totals[key] || 0} ${meta.label}`}
              >
                <Text style={{ color: colors[meta.tone] || colors.primary, fontFamily: fonts.bold, fontSize: fontSize.md }}>
                  {data.totals[key] || 0}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}
                >
                  {meta.label}
                </Text>
              </View>
            </React.Fragment>
          );
        })}
      </View>
      <Text
        style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: spacing.md }}
      >
        {formatHours(data.totalHours)} worked across {data.days.length} recorded{' '}
        {data.days.length === 1 ? 'day' : 'days'}.
      </Text>
    </Card>
  );
}

function DayRow({ item }) {
  const { colors, fonts, fontSize, withAlpha } = useTheme();
  const meta = dayStatusMeta(item.status);
  const tone = colors[meta.tone] || colors.primary;
  const d = parseDateKey(item.date);

  return (
    <Card padded={false}>
      <View style={styles.dayRow}>
        <View style={[styles.dateBadge, { backgroundColor: withAlpha(tone, 0.12) }]}>
          <Text style={{ color: tone, fontFamily: fonts.bold, fontSize: fontSize.base }}>
            {d ? d.getDate() : '--'}
          </Text>
          <Text style={{ color: tone, fontFamily: fonts.medium, fontSize: fontSize.xs }}>
            {d ? d.toLocaleDateString([], { weekday: 'short' }) : ''}
          </Text>
        </View>

        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={styles.dayTop}>
            <Text style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
              {formatDateKeyShort(item.date)}
            </Text>
            {item.isWfh ? <Chip label="WFH" tone="primary" icon="home" size="sm" /> : null}
          </View>
          <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 3 }}>
            {item.checkIn ? `${formatTime(item.checkIn)} – ${item.checkOut ? formatTime(item.checkOut) : '--:--'}` : '—'}
            {item.hours ? ` · ${formatHours(item.hours)}` : ''}
          </Text>
          {/* status_display carries the actual start time when someone was
              late, including when the lateness cost nothing. */}
          {item.lateDisplay ? (
            <Text style={{ color: colors.warning, fontFamily: fonts.medium, fontSize: fontSize.xs, marginTop: 2 }}>
              {item.lateDisplay}
            </Text>
          ) : null}
        </View>

        <Chip label={meta.label} tone={meta.tone} size="sm" />
      </View>
    </Card>
  );
}

function ListSkeleton() {
  const { spacing } = useTheme();
  return (
    <View>
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} style={{ marginBottom: spacing.sm }}>
          <Skeleton width="50%" height={14} />
          <Skeleton width="35%" height={11} style={{ marginTop: 8 }} />
        </Card>
      ))}
    </View>
  );
}

function ErrorCard({ message, onRetry }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  return (
    <Card style={{ backgroundColor: withAlpha(colors.danger, 0.09), borderColor: withAlpha(colors.danger, 0.3) }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Ionicons name="alert-circle" size={18} color={colors.danger} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.danger, fontFamily: fonts.medium, fontSize: fontSize.sm }}>{message}</Text>
          <Pressable onPress={onRetry} hitSlop={8} style={{ marginTop: spacing.sm }}>
            <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>Retry</Text>
          </Pressable>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 34, height: 34, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryCell: { flex: 1, alignItems: 'center' },
  divider: { width: 1, alignSelf: 'stretch' },
  dayRow: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  dateBadge: { width: 46, height: 46, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  dayTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  emptyIcon: { width: 52, height: 52, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
});
