import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, useToast } from '../../components';
import {
  fetchNotifications,
  markNotificationsRead,
  markAllNotificationsRead,
} from '../../services/odoo';
import { openNotificationTarget } from '../../utils/notificationTarget';
import AdminScreen from '../config/AdminScreen';

const ICONS = {
  attendance: ['time-outline', 'primary'],
  leave: ['calendar-outline', 'success'],
  wfh: ['home-outline', 'info'],
  compoff: ['swap-horizontal-outline', 'accent'],
  payroll: ['cash-outline', 'success'],
  holiday: ['flag-outline', 'warning'],
  other: ['person-circle-outline', 'info'],
  system: ['warning-outline', 'danger'],
};

/** '2026-09-29 10:05:00' (UTC, from Odoo) -> "5 min ago" / "Yesterday" / "12 Sep". */
function when(utc) {
  if (!utc) return '';
  const d = new Date(`${String(utc).replace(' ', 'T')}Z`);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  if (hrs < 48) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * The bell: everything the server has told this person, newest first.
 *
 * The same rows a push carries, so a push that was missed (phone off, push not
 * set up yet, notifications refused) is still here. Tapping one marks it read
 * and opens what it is about.
 */
export default function NotificationsScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const showToast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setRows(await fetchNotifications(100));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const unread = rows.filter((r) => !r.read).length;

  const open = async (row) => {
    if (!row.read) {
      setRows((all) => all.map((r) => (r.id === row.id ? { ...r, read: true } : r)));
      markNotificationsRead([row.id]).catch(() => {});
    }
    if (row.screen) openNotificationTarget(navigation, row);
  };

  const readAll = async () => {
    setRows((all) => all.map((r) => ({ ...r, read: true })));
    try {
      await markAllNotificationsRead();
    } catch (e) {
      showToast(e?.message || 'Could not mark them read.', 'danger');
    }
  };

  return (
    <AdminScreen
      navigation={navigation}
      title="Notifications"
      subtitle={unread ? `${unread} unread` : 'All caught up'}
      loading={loading}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && rows.length === 0}
      emptyTitle="No notifications yet"
      emptyMessage="Approvals, reminders and attendance updates will appear here."
      emptyIcon="notifications-outline"
      headerExtra={
        unread ? (
          <Pressable
            onPress={readAll}
            accessibilityRole="button"
            accessibilityLabel="Mark all as read"
            style={({ pressed }) => [
              styles.readAll,
              {
                backgroundColor: withAlpha(colors.onHeader, pressed ? 0.28 : 0.16),
                borderColor: withAlpha(colors.onHeader, 0.22),
              },
            ]}
          >
            <Ionicons name="checkmark-done-outline" size={16} color={colors.onHeader} />
            <Text style={{ color: colors.onHeader, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
              Mark all read
            </Text>
          </Pressable>
        ) : null
      }
    >
      {rows.map((r, i) => {
        const [icon, tone] = ICONS[r.category] || ICONS.other;
        const tint = colors[tone] || colors.primary;
        return (
          <Pressable
            key={r.id}
            onPress={() => open(r)}
            android_ripple={{ color: withAlpha(colors.primary, 0.12) }}
            accessibilityRole="button"
            accessibilityLabel={`${r.read ? '' : 'Unread. '}${r.title}. ${r.body}`}
            style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: i === 0 ? 0 : spacing.sm }]}
          >
            <Card padded={false}>
              <View style={[styles.row, { padding: spacing.base }]}>
                <View style={[styles.icon, { backgroundColor: withAlpha(tint, 0.13) }]}>
                  <Ionicons name={icon} size={19} color={tint} />
                </View>
                <View style={{ flex: 1, marginLeft: 11 }}>
                  <View style={styles.titleRow}>
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        color: colors.text,
                        fontFamily: r.read ? fonts.medium : fonts.bold,
                        fontSize: fontSize.base,
                      }}
                    >
                      {r.title}
                    </Text>
                    <Text style={{ color: colors.faint, fontFamily: fonts.regular, fontSize: fontSize.xs, marginLeft: 8 }}>
                      {when(r.date)}
                    </Text>
                  </View>
                  {r.body ? (
                    <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm, marginTop: 3, lineHeight: 19 }}>
                      {r.body}
                    </Text>
                  ) : null}
                </View>
                {!r.read ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
              </View>
            </Card>
          </Pressable>
        );
      })}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 9, height: 9, borderRadius: 5, marginLeft: 8, marginTop: 6 },
  readAll: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.md,
    borderWidth: 1,
  },
});
