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
import { getWfhData, fetchWfhRequests, cancelWfhRequest } from '../../services/odoo';
import { formatDateKeyShort } from '../../utils/time';
import WfhRequestCard from './WfhRequestCard';
import WfhApplySheet from './WfhApplySheet';
import { WFH_STATE_FILTERS, WFH_LIST_LIMIT } from './constants';

/** Work from home. Mirrors the Leave screen; the differences are noted inline. */
export default function WfhScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const showToast = useToast();
  const { user } = useSession();

  const [today, setToday] = useState(null);
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState(null);
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
        const result = await getWfhData(user?.uid, { stateFilter });
        setToday(result.today);
        setRequests(result.requests);
        setError('');
      } catch (e) {
        const message = e?.message || 'Could not load your WFH requests.';
        // A failed refresh keeps whatever is already on screen.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server-side, via `state` -- the WFH API's spelling, not leave's state_filter.
  const onFilter = useCallback(
    async (next) => {
      setFilter(next);
      setListLoading(true);
      try {
        setRequests(await fetchWfhRequests({ stateFilter: next }));
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
      await cancelWfhRequest(target.id);
      showToast('WFH request cancelled.', 'success');
      await load(true);
    } catch (e) {
      showToast(e?.message || 'Could not cancel the request.', 'danger');
    } finally {
      setCancelling(false);
    }
  };

  const busy = loading || listLoading;
  const activeFilter = WFH_STATE_FILTERS.find((f) => f.value === filter);

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
              Work from home
            </Text>
            <Text
              style={{ color: withAlpha(colors.onHeader, 0.8), fontFamily: fonts.regular, fontSize: fontSize.sm }}
            >
              Request a day, track approvals
            </Text>
          </View>
        </View>

        <View style={[styles.filters, { marginTop: spacing.base }]}>
          {WFH_STATE_FILTERS.map((f) => {
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
          <WfhRequestCard item={item} onCancel={setCancelTarget} disabled={cancelling} />
        )}
        ListHeaderComponent={<TodayBanner today={today} loading={loading} />}
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
          !busy && requests.length === WFH_LIST_LIMIT ? (
            <Text
              style={{
                color: colors.muted,
                fontFamily: fonts.regular,
                fontSize: fontSize.xs,
                textAlign: 'center',
                marginTop: spacing.lg,
              }}
            >
              Showing the {WFH_LIST_LIMIT} most recent requests.
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
        <PrimaryButton label="Request a WFH day" icon="add" onPress={() => setApplyOpen(true)} />
      </View>

      <WfhApplySheet
        visible={applyOpen}
        onClose={() => setApplyOpen(false)}
        onSubmitted={() => load(true)}
      />

      <ConfirmDialog
        visible={Boolean(cancelTarget)}
        title="Cancel this request?"
        message={
          'Your work-from-home request for ' +
          formatDateKeyShort(cancelTarget?.date) +
          ' will be withdrawn. You can request the same day again afterwards.'
        }
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        tone="danger"
        icon="close-circle-outline"
        onConfirm={onConfirmCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </View>
  );
}

/**
 * Today's status.
 *
 * Deliberately NOT a check-in control. The module is explicit that there is one
 * attendance button and this only tells the employee that today is approved and
 * their location will not be checked -- the actual check-in stays on Home.
 */
function TodayBanner({ today, loading }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();

  if (loading) {
    return (
      <Card style={{ marginBottom: spacing.lg }}>
        <Skeleton width="50%" height={15} />
        <Skeleton width="72%" height={12} style={{ marginTop: 9 }} />
      </Card>
    );
  }
  if (!today?.hasWfhToday) return null;

  return (
    <Card
      style={{
        marginBottom: spacing.lg,
        backgroundColor: withAlpha(colors.success, 0.09),
        borderColor: withAlpha(colors.success, 0.3),
      }}
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Ionicons name="home" size={18} color={colors.success} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.success, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
            You are working from home today
          </Text>
          <Text
            style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 3 }}
          >
            Check in from the home screen as usual. Your location will not be checked.
          </Text>
        </View>
      </View>
    </Card>
  );
}

function ListSkeleton() {
  const { spacing } = useTheme();
  return (
    <View>
      {[0, 1, 2].map((i) => (
        <Card key={i} style={{ marginBottom: spacing.md }}>
          <Skeleton width="45%" height={16} />
          <Skeleton height={12} style={{ marginTop: 10 }} />
        </Card>
      ))}
    </View>
  );
}

function EmptyState({ filterLabel, onShowAll }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  return (
    <Card>
      <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
        <View style={[styles.emptyIcon, { backgroundColor: withAlpha(colors.accent, 0.12) }]}>
          <Ionicons name="home-outline" size={24} color={colors.accent} />
        </View>
        <Text
          style={{
            color: colors.text,
            fontFamily: fonts.semibold,
            fontSize: fontSize.base,
            marginTop: spacing.md,
          }}
        >
          {filterLabel ? 'No ' + filterLabel.toLowerCase() + ' requests' : 'No WFH requests yet'}
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
          {filterLabel ? 'Nothing matches this filter.' : 'Request a day below to get started.'}
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
