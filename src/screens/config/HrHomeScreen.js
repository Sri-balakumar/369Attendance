import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, useTabBarLift } from '../../components';
import { useSession } from '../../state/SessionContext';
import { fetchTodayStatuses, countLeaveApprovals, countPendingWfh } from '../../services/odoo';
import { formatLongDate } from '../../utils/time';
import { GuideBanner } from './FormBits';
import { GUIDES } from './guides';
import { DayStatusRow } from './StatusRows';
import { MenuRow } from './ConfigScreen';

/**
 * HR -- the tab HR users get instead of Config.
 *
 * Deliberately small: who is in today, and what is waiting for a decision.
 * No rules, no setup, no payroll; those stay on the admin's Config tab. The
 * point is a screen HR can run the day from without learning the whole app.
 *
 * Each half is gated on its own permission, same as Config: the board needs
 * HR Officer or up (day_status_rule_hr), the leave rows need Leave Manager,
 * the WFH row needs WFH Manager.
 */

// "Present" counts everyone who turned up, however the day was graded.
const TILES = [
  { key: 'present', label: 'Present', tone: 'success', icon: 'checkmark-circle-outline', match: (s) => ['present', 'late', 'half_day'].includes(s) },
  { key: 'late', label: 'Late', tone: 'warning', icon: 'alarm-outline', match: (s) => s === 'late' },
  { key: 'leave', label: 'On leave', tone: 'info', icon: 'airplane-outline', match: (s) => s === 'leave' },
  { key: 'absent', label: 'Absent', tone: 'danger', icon: 'person-remove-outline', match: (s) => s === 'absent' },
];

export default function HrHomeScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const lift = useTabBarLift();
  const { caps } = useSession();

  const canSeeToday = caps.attendance || caps.balances;
  const [rows, setRows] = useState([]);
  const [todayError, setTodayError] = useState('');
  const [tile, setTile] = useState('present');
  const [counts, setCounts] = useState({ pending: 0, cancels: 0, wfh: 0 });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      const [today, leave, wfh] = await Promise.all([
        canSeeToday
          ? fetchTodayStatuses().then(
              (r) => ({ rows: r, error: '' }),
              (e) => ({ rows: [], error: e?.message || 'Could not load today.' })
            )
          : Promise.resolve({ rows: [], error: '' }),
        caps.leave ? countLeaveApprovals() : Promise.resolve({ pending: 0, cancels: 0 }),
        caps.wfh ? countPendingWfh() : Promise.resolve(0),
      ]);
      setRows(today.rows);
      setTodayError(today.error);
      setCounts({ pending: leave.pending, cancels: leave.cancels, wfh });
      setRefreshing(false);
    },
    [canSeeToday, caps.leave, caps.wfh]
  );

  // On focus: a decision made in a queue should show here on the way back.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const byTile = useMemo(() => {
    const out = {};
    TILES.forEach((t) => {
      out[t.key] = rows.filter((r) => t.match(r.status));
    });
    return out;
  }, [rows]);

  const approvals = [];
  if (caps.leave) {
    approvals.push(
      { key: 'LeaveQueue', params: { state: 'pending' }, icon: 'file-tray-full-outline', tone: 'warning', label: 'Leave requests', caption: 'Approve or reject', badge: counts.pending },
      { key: 'LeaveQueue', params: { state: 'cancel_requested' }, icon: 'return-down-back-outline', tone: 'danger', label: 'Cancellation requests', caption: 'Approved leave someone wants to cancel', badge: counts.cancels },
    );
  }
  if (caps.wfh) {
    approvals.push({ key: 'WfhQueue', params: { state: 'pending' }, icon: 'home-outline', tone: 'info', label: 'Work from home requests', caption: 'Approve or reject', badge: counts.wfh });
  }

  const active = TILES.find((t) => t.key === tile) || TILES[0];
  const list = byTile[active.key] || [];

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
          <View
            style={[
              styles.headerIcon,
              { backgroundColor: withAlpha(colors.onHeader, 0.16), borderColor: withAlpha(colors.onHeader, 0.22) },
            ]}
          >
            <Ionicons name="people-outline" size={20} color={colors.onHeader} />
          </View>
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={{ color: colors.onHeader, fontFamily: fonts.bold, fontSize: fontSize.lg }}>HR</Text>
            <Text style={{ color: withAlpha(colors.onHeader, 0.8), fontFamily: fonts.regular, fontSize: fontSize.sm }}>
              {formatLongDate()}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: lift }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        <GuideBanner {...GUIDES.hrHome} defaultOpen={false} />

        {approvals.length ? (
          <View style={{ marginBottom: spacing.lg }}>
            <SectionTitle>Approvals</SectionTitle>
            <Card padded={false}>
              {approvals.map((item, i) => (
                <MenuRow
                  key={item.label}
                  item={item}
                  last={i === approvals.length - 1}
                  onPress={() => navigation.navigate(item.key, item.params)}
                />
              ))}
            </Card>
          </View>
        ) : null}

        {canSeeToday ? (
          <View>
            <SectionTitle>Today</SectionTitle>
            <View style={styles.tiles}>
              {TILES.map((t) => {
                const on = t.key === active.key;
                const tone = colors[t.tone] || colors.primary;
                const n = byTile[t.key]?.length || 0;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => setTile(t.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${t.label}: ${n}`}
                    style={({ pressed }) => [
                      styles.tile,
                      {
                        backgroundColor: on ? withAlpha(tone, 0.12) : colors.surface,
                        borderColor: on ? tone : colors.border,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Ionicons name={t.icon} size={18} color={tone} />
                    <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 24, marginTop: 6 }}>{n}</Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs }}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {todayError ? (
              <Text style={{ color: colors.danger, fontFamily: fonts.medium, fontSize: fontSize.sm, marginTop: spacing.md }}>
                {todayError}
              </Text>
            ) : list.length ? (
              list.map((r, i) => (
                <DayStatusRow key={r.id} row={r} showMoney={false} style={{ marginTop: i === 0 ? spacing.md : spacing.sm }} />
              ))
            ) : (
              <Card style={{ marginTop: spacing.md, alignItems: 'center', paddingVertical: spacing.lg }}>
                <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm, textAlign: 'center' }}>
                  {active.key === 'absent'
                    ? 'Nobody is marked absent yet. Absent appears once the late window ends.'
                    : `Nobody ${active.key === 'present' ? 'has checked in yet' : `is ${active.label.toLowerCase()}`} today.`}
                </Text>
              </Card>
            )}
          </View>
        ) : null}

        {!approvals.length && !canSeeToday ? (
          <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
            <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm, textAlign: 'center' }}>
              Checking what you can see…
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SectionTitle({ children }) {
  const { colors, fonts, fontSize, spacing } = useTheme();
  return (
    <Text
      style={{
        color: colors.muted,
        fontFamily: fonts.semibold,
        fontSize: fontSize.xs,
        letterSpacing: 1,
        marginBottom: spacing.sm,
      }}
    >
      {String(children).toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 130,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
});
