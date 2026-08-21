import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Skeleton, PrimaryButton, ConfirmDialog, useToast } from '../../components';
import { useSession } from '../../state/SessionContext';
import { getLeaveData, fetchLeaveRequests, cancelLeaveRequest } from '../../services/odoo';
import { formatDateRange, formatDays } from '../../utils/time';
import LeaveBalanceStrip from './LeaveBalanceStrip';
import LeaveRequestCard from './LeaveRequestCard';
import LeaveApplySheet from './LeaveApplySheet';
import { STATE_FILTERS, LEAVE_LIST_LIMIT } from './constants';

/**
 * Leave.
 *
 * The app's first PUSHED route -- the four session screens only ever reset onto
 * each other. headerShown is false for the whole stack, so this draws its own
 * header to match Server/Login/Home rather than letting one stock native bar
 * appear as the only unthemed chrome in the app.
 */
export default function LeaveScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const showToast = useToast();
  const { user } = useSession();

  const [balance, setBalance] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState(null);

  // Three flags rather than Home's two: a filter change reloads only the list,
  // and must not blank the balance card sitting above it.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listLoading, setListLoading] = useState(false);

  const [error, setError] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(
    async (isRefresh = false, stateFilter = filter) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const result = await getLeaveData(user?.uid, { stateFilter });
        setBalance(result.balance);
        setYear(result.year);
        setRequests(result.requests);
        setError('');
      } catch (e) {
        const message = e?.message || 'Could not load your leave requests.';
        // A failed REFRESH must never destroy rows already on screen. Only a
        // first load with nothing to show earns the full-width error card.
        if (requests.length) showToast(message, 'danger');
        else setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter, requests.length, showToast, user?.uid]
  );

  useEffect(() => {
    load();
    // load() is deliberately not a dependency: it changes identity whenever the
    // filter or row count does, and this effect is only ever the first paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Filtering is done SERVER-side. The route caps the list at 50 rows ordered
   * from_date desc, so filtering an already-truncated list here would silently
   * hide older approved requests that had fallen off the end.
   *
   * Called straight from the handler rather than through a useEffect on
   * `filter`, which would need a skip-first-run ref and carries a stale-closure
   * hazard for no gain.
   */
  const onFilter = useCallback(
    async (next) => {
      setFilter(next);
      setListLoading(true);
      try {
        setRequests(await fetchLeaveRequests({ stateFilter: next }));
        setError('');
      } catch (e) {
        showToast(e?.message || 'Could not filter your requests.', 'danger');
      } finally {
        setListLoading(false);
      }
    },
    [showToast]
  );

  const onConfirmCancel = async () => {
    const target = cancelTarget;
    setCancelTarget(null);
    if (!target || cancelling) return;
    setCancelling(true);
    try {
      await cancelLeaveRequest(target.id);
      showToast('Leave request cancelled.', 'success');
      // Full re-read: the route returns no state, and cancelling an approved
      // leave also moves the balance and re-links the attendance day rows.
      await load(true);
    } catch (e) {
      showToast(e?.message || 'Could not cancel the request.', 'danger');
    } finally {
      setCancelling(false);
    }
  };

  const busy = loading || listLoading;
  const activeFilter = STATE_FILTERS.find((f) => f.value === filter);
  const approved = cancelTarget?.state === 'approved';

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
              Leave
            </Text>
            <Text
              style={{
                color: withAlpha(colors.onHeader, 0.8),
                fontFamily: fonts.regular,
                fontSize: fontSize.sm,
              }}
            >
              Apply, track and cancel
            </Text>
          </View>
        </View>

        <View style={[styles.filters, { marginTop: spacing.base }]}>
          {STATE_FILTERS.map((f) => {
            const active = f.value === filter;
            return (
              <Pressable
                key={f.label}
                onPress={() => (active ? null : onFilter(f.value))}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: withAlpha(colors.onHeader, active ? 0.26 : 0.1),
                    borderColor: withAlpha(colors.onHeader, active ? 0.45 : 0.18),
                  },
                ]}
              >
                <Text
                  style={{
                    color: colors.onHeader,
                    fontFamily: active ? fonts.semibold : fonts.regular,
                    fontSize: fontSize.xs,
                  }}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </LinearGradient>

      <FlatList
        data={busy ? [] : requests}
        keyExtractor={(item) => String(item.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 96 }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        renderItem={({ item }) => (
          <LeaveRequestCard item={item} onCancel={setCancelTarget} disabled={cancelling} />
        )}
        ListHeaderComponent={
          <LeaveBalanceStrip
            balance={balance}
            year={year}
            loading={loading}
            style={{ marginBottom: spacing.lg }}
          />
        }
        ListEmptyComponent={
          busy ? (
            <ListSkeleton />
          ) : error ? (
            <ErrorCard message={error} onRetry={() => load()} />
          ) : (
            <EmptyState
              filterLabel={filter ? activeFilter?.label : null}
              onShowAll={() => onFilter(null)}
            />
          )
        }
        ListFooterComponent={
          !busy && requests.length === LEAVE_LIST_LIMIT ? (
            <Text
              style={{
                color: colors.muted,
                fontFamily: fonts.regular,
                fontSize: fontSize.xs,
                textAlign: 'center',
                marginTop: spacing.lg,
              }}
            >
              Showing the {LEAVE_LIST_LIMIT} most recent requests.
            </Text>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
          />
        }
      />

      <View
        style={[
          styles.dock,
          {
            paddingBottom: insets.bottom + spacing.md,
            backgroundColor: colors.bg,
            borderTopColor: colors.border,
          },
        ]}
      >
        <PrimaryButton label="Apply for leave" icon="add" onPress={() => setApplyOpen(true)} />
      </View>

      <LeaveApplySheet
        visible={applyOpen}
        balance={balance}
        onClose={() => setApplyOpen(false)}
        onSubmitted={() => load(true)}
      />

      <ConfirmDialog
        visible={Boolean(cancelTarget)}
        title={approved ? 'Cancel approved leave?' : 'Cancel this request?'}
        message={
          approved
            ? 'This leave has already been approved. Cancelling it releases ' +
              formatDays(cancelTarget?.days) +
              ' back to your balance and updates your attendance for ' +
              formatDateRange(cancelTarget?.from, cancelTarget?.to) +
              '.'
            : 'Your ' +
              (cancelTarget?.typeLabel || 'leave') +
              ' for ' +
              formatDateRange(cancelTarget?.from, cancelTarget?.to) +
              ' will be withdrawn. You can apply again for the same dates afterwards.'
        }
        confirmLabel={approved ? 'Cancel it' : 'Cancel request'}
        // Overridden deliberately: the default is "Cancel", which sitting next
        // to a "Cancel request" confirm reads as the same action twice.
        cancelLabel="Keep it"
        tone="danger"
        icon="close-circle-outline"
        onConfirm={onConfirmCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </View>
  );
}

function ListSkeleton() {
  const { spacing } = useTheme();
  return (
    <View>
      {[0, 1, 2].map((i) => (
        <Card key={i} style={{ marginBottom: spacing.md }}>
          <Skeleton width="55%" height={16} />
          <Skeleton width="40%" height={12} style={{ marginTop: 8 }} />
          <Skeleton height={12} style={{ marginTop: 10 }} />
        </Card>
      ))}
    </View>
  );
}

/**
 * Home has no empty state, but a bare gap under the balance card reads as a
 * rendering fault rather than as "nothing here yet".
 */
function EmptyState({ filterLabel, onShowAll }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  return (
    <Card>
      <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
        <View style={[styles.emptyIcon, { backgroundColor: withAlpha(colors.primary, 0.12) }]}>
          <Ionicons name="calendar-outline" size={24} color={colors.primary} />
        </View>
        <Text
          style={{
            color: colors.text,
            fontFamily: fonts.semibold,
            fontSize: fontSize.base,
            marginTop: spacing.md,
          }}
        >
          {filterLabel ? 'No ' + filterLabel.toLowerCase() + ' requests' : 'No leave requests yet'}
        </Text>
        <Text
          style={{
            color: colors.muted,
            fontFamily: fonts.regular,
            fontSize: fontSize.sm,
            marginTop: 4,
            textAlign: 'center',
          }}
        >
          {filterLabel ? 'Nothing matches this filter.' : 'Apply below to submit your first request.'}
        </Text>
        {filterLabel ? (
          <Pressable onPress={onShowAll} hitSlop={8} style={{ marginTop: spacing.md }}>
            <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
              Show all
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

/** The inline error card from ServerScreen, which suits a list far better than
 *  Home's toast-only approach: a failed first load leaves nothing else on screen. */
function ErrorCard({ message, onRetry }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  return (
    <Card
      style={{
        backgroundColor: withAlpha(colors.danger, 0.09),
        borderColor: withAlpha(colors.danger, 0.3),
      }}
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Ionicons name="alert-circle" size={18} color={colors.danger} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.danger, fontFamily: fonts.medium, fontSize: fontSize.sm }}>
            {message}
          </Text>
          <Pressable onPress={onRetry} hitSlop={8} style={{ marginTop: spacing.sm }}>
            <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
              Retry
            </Text>
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
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill, borderWidth: 1 },
  emptyIcon: { width: 52, height: 52, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
});
