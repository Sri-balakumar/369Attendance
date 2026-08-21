import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet, BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Skeleton, ConfirmDialog, useToast } from '../../components';
import { useSession } from '../../state/SessionContext';
import { getHomeData, toggleAttendance } from '../../services/odoo';
import { greeting, formatLongDate } from '../../utils/time';
import AttendanceCard from './AttendanceCard';
import StatTiles from './StatTiles';
import QuickActions from './QuickActions';
import RecentActivity from './RecentActivity';

export default function HomeScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, isDark, toggleTheme, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const showToast = useToast();
  const { user, signOut } = useSession();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await getHomeData(user?.uid);
      setData(result);
    } catch (e) {
      showToast(e?.message || 'Could not load your dashboard.', 'danger');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast, user?.uid]);

  useEffect(() => {
    load();
  }, [load]);

  // Home is the root of a reset stack, so Android's back button would otherwise
  // exit straight out mid-gesture without confirming. Swallow it here -- but
  // ONLY while Home is the focused screen.
  //
  // BackHandler runs its subscribers last-registered-first and stops at the
  // first one returning true. NavigationContainer registers its own goBack()
  // handler when the container mounts, which is before this component, and Home
  // stays mounted underneath anything pushed on top of it. An unconditional
  // handler here therefore wins the race on EVERY screen above Home and leaves
  // hardware back dead there. Re-subscribing on focus puts this last in the
  // array again, so the ordering self-heals on every pop.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }, [])
  );

  const [toggling, setToggling] = useState(false);

  /**
   * One button, because the server has one route: /hr_attendance/systray_check_in_out
   * toggles. It takes the employee from the session, and it runs through this
   * module's override that skips the late-reason constraint, so a late
   * check-in is never blocked mid-gesture.
   *
   * Afterwards the whole screen is reloaded rather than patched locally: the
   * check-in is what makes the module grade the day, and that grade (Present /
   * Late / Half Day) is only knowable from the server.
   */
  const onToggleAttendance = async () => {
    if (toggling) return;
    const wasCheckedIn = data?.today?.checkedIn;
    setToggling(true);
    try {
      const result = await toggleAttendance();
      showToast(
        result.state === 'checked_in'
          ? 'Checked in. Have a productive day!'
          : 'Checked out. Have a good evening!',
        'success'
      );
      await load(true);
    } catch (e) {
      // The commonest one is the module's own rule: once you have checked out,
      // you cannot check in again the same day.
      showToast(
        e?.message || (wasCheckedIn ? 'Could not check out.' : 'Could not check in.'),
        'danger'
      );
    } finally {
      setToggling(false);
    }
  };

  // Logout clears the user only — the server and database stay, so Login can
  // ask for username and password alone.
  const onLogout = async () => {
    setConfirmLogout(false);
    await signOut();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        <LinearGradient
          colors={colors.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.header, { paddingTop: insets.top + spacing.base }]}
        >
          <View style={styles.headerRow}>
            <View style={styles.identity}>
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: withAlpha(colors.onHeader, 0.2), borderColor: withAlpha(colors.onHeader, 0.32) },
                ]}
              >
                <Text style={{ color: colors.onHeader, fontFamily: fonts.bold, fontSize: fontSize.md }}>
                  {user?.initials || 'U'}
                </Text>
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ color: withAlpha(colors.onHeader, 0.8), fontFamily: fonts.regular, fontSize: fontSize.sm }}>
                  {greeting()},
                </Text>
                <Text numberOfLines={1} style={{ color: colors.onHeader, fontFamily: fonts.bold, fontSize: fontSize.lg }}>
                  {user?.name || 'Employee'}
                </Text>
              </View>
            </View>

            <View style={styles.headerActions}>
              <IconButton
                icon={isDark ? 'sunny-outline' : 'moon-outline'}
                label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                onPress={toggleTheme}
              />
              <IconButton
                icon="notifications-outline"
                label="Notifications"
                badge
                onPress={() => showToast('No new notifications.', 'info')}
              />
              <IconButton icon="log-out-outline" label="Log out" onPress={() => setConfirmLogout(true)} />
            </View>
          </View>

          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={13} color={withAlpha(colors.onHeader, 0.75)} />
            <Text
              style={{
                color: withAlpha(colors.onHeader, 0.85),
                fontFamily: fonts.medium,
                fontSize: fontSize.xxs,
                marginLeft: 6,
              }}
            >
              {formatLongDate()}
            </Text>
            <View style={[styles.dot, { backgroundColor: withAlpha(colors.onHeader, 0.4) }]} />
            <Text style={{ color: withAlpha(colors.onHeader, 0.85), fontFamily: fonts.medium, fontSize: fontSize.xxs }}>
              {user?.department || '—'}
            </Text>
          </View>
        </LinearGradient>

        <View style={{ paddingHorizontal: spacing.lg, marginTop: -spacing.xxl }}>
          {loading ? (
            <Card elevation="raised">
              <Skeleton width="55%" height={38} />
              <Skeleton width="40%" height={20} radius={999} style={{ marginTop: 10 }} />
              <Skeleton height={62} radius={16} style={{ marginTop: 16 }} />
              <Skeleton height={54} radius={16} style={{ marginTop: 16 }} />
            </Card>
          ) : (
            <AttendanceCard today={data?.today} onToggle={onToggleAttendance} />
          )}

          {!loading && data ? <StatTiles today={data.today} style={{ marginTop: spacing.md }} /> : null}

          {!loading && data ? (
            <MonthStrip month={data.month} style={{ marginTop: spacing.lg }} />
          ) : null}

          <QuickActions
            style={{ marginTop: spacing.xl }}
            onPress={(a) => {
              // navigate rather than push: it is idempotent, so a double tap
              // cannot stack two Leave screens.
              if (a.key === 'leave') navigation.navigate('Leave');
              else showToast(`${a.label} is coming in the next update.`, 'info');
            }}
          />

          <RecentActivity
            items={data?.recent || []}
            loading={loading}
            style={{ marginTop: spacing.xl }}
          />
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={confirmLogout}
        title="Log out?"
        message="You will need to enter your username and password again. The server and database stay saved."
        confirmLabel="Log out"
        icon="log-out-outline"
        onConfirm={onLogout}
        onCancel={() => setConfirmLogout(false)}
      />
    </View>
  );
}

function IconButton({ icon, onPress, badge, label }) {
  const { fontSize, colors, withAlpha } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconBtn,
        {
          backgroundColor: withAlpha(colors.onHeader, pressed ? 0.28 : 0.16),
          borderColor: withAlpha(colors.onHeader, 0.22),
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.onHeader} />
      {badge ? <View style={[styles.badgeDot, { backgroundColor: colors.warning }]} /> : null}
    </Pressable>
  );
}

/** This month at a glance — four counts, no chrome. */
function MonthStrip({ month, style }) {
  const { fontSize, colors, fonts, radii, spacing, shadows } = useTheme();
  const cells = [
    { label: 'Present', value: month.present, tone: colors.success },
    { label: 'Late', value: month.late, tone: colors.warning },
    { label: 'Absent', value: month.absent, tone: colors.danger },
    { label: 'Leave', value: month.leave, tone: colors.accent },
  ];
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: radii.lg,
          padding: spacing.base,
        },
        shadows.card,
        style,
      ]}
    >
      <Text style={{ color: colors.muted, fontFamily: fonts.semibold, fontSize: fontSize.xs, letterSpacing: 1 }}>
        {month.label.toUpperCase()}
      </Text>
      <View style={styles.monthRow}>
        {cells.map((c, i) => (
          <React.Fragment key={c.label}>
            {i > 0 ? <View style={{ width: 1, height: 26, backgroundColor: colors.border }} /> : null}
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: c.tone, fontFamily: fonts.bold, fontSize: fontSize.lg }}>{c.value}</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs, marginTop: 1 }}>
                {c.label}
              </Text>
            </View>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 56,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  identity: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute',
    top: 7,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: radii.sm,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  dot: { width: 3, height: 3, borderRadius: 2, marginHorizontal: 8 },
  monthRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
});
