import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Skeleton, ConfirmDialog, useToast, useTabBarLift } from '../../components';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { useSession } from '../../state/SessionContext';
import { getMyDetails, getProfileExtras } from '../../services/odoo';
import { formatDateKeyShort, formatHourFloat } from '../../utils/time';
import { prettyHost } from '../../utils/url';

/**
 * My Details -- what the employee owns about themselves.
 *
 * Every section is gated by Field Settings, and the flags come back in the same
 * read as the values (they are read-only mirrors on res.users), so a section
 * that an admin has not enabled is simply absent rather than shown empty.
 *
 * Above those, for everyone: a profile card with their role, their work
 * details, this month and their balances, and their attendance setup. HR and
 * admins also get their live queues, and admins the system details.
 *
 * Nothing salary-bearing appears here at any point. That is not only a UI
 * choice: the fields are outside the self-service allow-list on res.users, so
 * this screen could not show them even if it tried.
 */
export default function MyDetailsScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const lift = useTabBarLift();
  const showToast = useToast();
  const { user, server, caps, canManage, signOut } = useSession();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const role = caps.admin ? 'Admin' : canManage ? 'HR' : 'Employee';

  const [details, setDetails] = useState(null);
  const [extras, setExtras] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        // The extras never fail the page: each part settles on its own.
        const [mine, more] = await Promise.all([
          getMyDetails(user?.uid),
          getProfileExtras({ uid: user?.uid, caps }).catch(() => null),
        ]);
        setDetails(mine);
        setExtras(more);
        setError('');
      } catch (e) {
        const message = e?.message || 'Could not load your details.';
        if (details) showToast(message, 'danger');
        else setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast, user?.uid, caps]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The queue counts go stale while HR works through them in other tabs.
  const refreshExtras = useCallback(() => {
    if (!user?.uid) return;
    getProfileExtras({ uid: user.uid, caps })
      .then(setExtras)
      .catch(() => {});
  }, [user?.uid, caps]);
  useFocusEffect(refreshExtras);

  // The same logout as Home's header button: drop the user, keep the server.
  const onLogout = async () => {
    setConfirmLogout(false);
    await signOut();
    navigation.getParent('RootStack')?.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  const w = extras?.work || {};
  const subtitle = [w.jobTitle, w.department].filter(Boolean).join(' · ');

  const s = details?.sections || {};
  const p = details?.personal || {};
  const anySection =
    s.personal || s.qualifications || s.previousEmployment || s.statutory;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />

      <LinearGradient
        colors={colors.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + spacing.base }]}
      >
        {/* A profile card rather than a title: this is a tab root, so there is
            no back chevron to keep room for. */}
        <View style={styles.headerRow}>
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: withAlpha(colors.onHeader, 0.2),
                borderColor: withAlpha(colors.onHeader, 0.32),
              },
            ]}
          >
            <Text style={{ color: colors.onHeader, fontFamily: fonts.bold, fontSize: fontSize.lg }}>
              {user?.initials || initialsOf(details?.name || user?.name)}
            </Text>
          </View>
          <View style={{ marginLeft: 14, flex: 1 }}>
            <Text numberOfLines={1} style={{ color: colors.onHeader, fontFamily: fonts.bold, fontSize: fontSize.lg }}>
              {details?.name || user?.name || 'My profile'}
            </Text>
            {subtitle ? (
              <Text
                numberOfLines={1}
                style={{ color: withAlpha(colors.onHeader, 0.82), fontFamily: fonts.regular, fontSize: fontSize.sm, marginTop: 2 }}
              >
                {subtitle}
              </Text>
            ) : null}
            <View style={[styles.roleBadge, { backgroundColor: withAlpha(colors.onHeader, 0.18), borderColor: withAlpha(colors.onHeader, 0.3) }]}>
              <Ionicons
                name={role === 'Admin' ? 'shield-checkmark' : role === 'HR' ? 'people' : 'person'}
                size={12}
                color={colors.onHeader}
              />
              <Text style={{ color: colors.onHeader, fontFamily: fonts.semibold, fontSize: fontSize.xs }}>{role}</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: lift }}
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
        {loading ? (
          <>
            <Card>
              <Skeleton width="45%" height={15} />
              <Skeleton height={12} style={{ marginTop: 12 }} />
              <Skeleton width="70%" height={12} style={{ marginTop: 8 }} />
            </Card>
            <Card style={{ marginTop: spacing.md }}>
              <Skeleton width="35%" height={15} />
              <Skeleton height={12} style={{ marginTop: 12 }} />
            </Card>
          </>
        ) : error ? (
          <ErrorCard message={error} onRetry={() => load()} />
        ) : (
          <>
            {extras ? (
              <>
                <InfoSection
                  title="Work"
                  icon="briefcase-outline"
                  first
                  items={[
                    ['Employee ID', w.employeeId],
                    ['Job title', w.jobTitle],
                    ['Department', w.department],
                    ['Manager', w.manager],
                    ['Coach', w.coach],
                    ['Work email', w.workEmail],
                    ['Work phone', w.workPhone],
                    ['Mobile', w.mobile],
                    ['Work location', w.workLocation],
                    ['Working hours', w.workingHours],
                    ['Company', w.company],
                  ]}
                />

                {extras.month || extras.leave || extras.compOff ? (
                  <Section title={extras.month?.label || 'This month'} icon="calendar-outline" style={{ marginTop: spacing.md }}>
                    {extras.month ? (
                      <View style={styles.tiles}>
                        <Tile label="Present" value={extras.month.present} tone="success" />
                        <Tile label="Late" value={extras.month.late} tone="warning" />
                        <Tile label="Absent" value={extras.month.absent} tone="danger" />
                        <Tile label="Leave" value={extras.month.leave} tone="info" />
                      </View>
                    ) : null}
                    <InfoRows
                      items={[
                        ['Leave balance', leaveText(extras.leave)],
                        ['Comp off', extras.compOff?.enabled ? `${fmtDays(extras.compOff.balance)} available` : ''],
                      ]}
                    />
                  </Section>
                ) : null}

                <InfoSection
                  title="Attendance setup"
                  icon="time-outline"
                  items={[
                    ['Office hours', extras.setup ? `${to12(extras.setup.startHour)} – ${to12(extras.setup.endHour)}` : ''],
                    ['Grace time', extras.setup?.graceMinutes ? `${extras.setup.graceMinutes} min` : ''],
                    ['Working days', extras.setup ? dayRange(extras.setup.workingDays) : ''],
                    ['Device', deviceText(extras.device)],
                  ]}
                />

                {extras.queue ? (
                  <Section title="Your queue" icon="file-tray-full-outline" style={{ marginTop: spacing.md }}>
                    {[
                      ['Leave requests', extras.queue.leave, 'LeaveQueue', { state: 'pending' }],
                      ['Cancellation requests', extras.queue.cancels, 'LeaveQueue', { state: 'cancel_requested' }],
                      ['WFH requests', extras.queue.wfh, 'WfhQueue', { state: 'pending' }],
                      ['Absent today', extras.queue.absent, 'AbsentToday', undefined],
                    ]
                      .filter(([, count]) => count !== undefined)
                      .map(([label, count, screen, params], i, all) => (
                        <QueueRow
                          key={label}
                          label={label}
                          count={count}
                          last={i === all.length - 1}
                          onPress={() => navigation?.navigate(screen, params)}
                        />
                      ))}
                  </Section>
                ) : null}

                {caps.admin ? (
                  <InfoSection
                    title="System"
                    icon="server-outline"
                    items={[
                      ['Server', server?.url ? prettyHost(server.url) : ''],
                      ['Database', server?.db],
                      ['App', [Constants.expoConfig?.name, Constants.expoConfig?.version].filter(Boolean).join(' ')],
                    ]}
                  />
                ) : null}
              </>
            ) : null}

            <Section title="Account" icon="person-outline" style={extras ? { marginTop: spacing.md } : undefined}>
              <Row label="Name" value={details?.name} />
              <Row label="Username" value={details?.login} last />
            </Section>

            {s.personal ? (
              <Section title="Personal" icon="heart-outline" style={{ marginTop: spacing.md }}>
                <Row label="Blood group" value={p.bloodGroup} />
                <Row label="Emergency contact relation" value={p.emergencyRelation} />
                <Row label="Father's name" value={p.fatherName} />
                <Row label="Mother's name" value={p.motherName} last={!p.emergency2} />
                {p.emergency2 ? (
                  <>
                    <Row label="Second contact" value={p.emergency2.name} />
                    <Row label="Second contact phone" value={p.emergency2.phone} />
                    <Row label="Second contact relation" value={p.emergency2.relation} last />
                  </>
                ) : null}
              </Section>
            ) : null}

            {s.qualifications ? (
              <Section title="Qualifications" icon="school-outline" style={{ marginTop: spacing.md }}>
                {details.qualifications.length ? (
                  details.qualifications.map((q, i) => (
                    <Row
                      key={q.id}
                      label={[q.name, q.specialization].filter(Boolean).join(' · ') || 'Qualification'}
                      value={[q.institution, q.year, q.grade].filter(Boolean).join(' · ')}
                      last={i === details.qualifications.length - 1}
                    />
                  ))
                ) : (
                  <Empty text="Nothing recorded yet." />
                )}
              </Section>
            ) : null}

            {s.previousEmployment ? (
              <Section title="Previous employment" icon="briefcase-outline" style={{ marginTop: spacing.md }}>
                {details.previousEmployment.length ? (
                  details.previousEmployment.map((e, i) => (
                    <Row
                      key={e.id}
                      label={[e.company, e.jobTitle].filter(Boolean).join(' · ') || 'Employer'}
                      value={[
                        e.from ? formatDateKeyShort(e.from) : '',
                        e.to ? formatDateKeyShort(e.to) : '',
                      ]
                        .filter(Boolean)
                        .join(' – ') + (e.duration ? ` · ${e.duration}` : '')}
                      last={i === details.previousEmployment.length - 1}
                    />
                  ))
                ) : (
                  <Empty text="Nothing recorded yet." />
                )}
              </Section>
            ) : null}

            {!anySection ? (
              <Card style={{ marginTop: spacing.md }}>
                <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
                  <View style={[styles.emptyIcon, { backgroundColor: withAlpha(colors.muted, 0.12) }]}>
                    <Ionicons name="lock-closed-outline" size={22} color={colors.muted} />
                  </View>
                  <Text
                    style={{
                      color: colors.text,
                      fontFamily: fonts.semibold,
                      fontSize: fontSize.base,
                      marginTop: spacing.md,
                    }}
                  >
                    Nothing to show yet
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
                    Your HR team has not enabled any detail sections.
                  </Text>
                </View>
              </Card>
            ) : null}

            <Text
              style={{
                color: colors.muted,
                fontFamily: fonts.regular,
                fontSize: fontSize.xs,
                textAlign: 'center',
                marginTop: spacing.lg,
              }}
            >
              To change these, open My Profile in Odoo. Contact HR for anything not shown here.
            </Text>
          </>
        )}

        {/* Outside the loading / error branches on purpose: a profile that
            failed to load must still offer a way out. */}
        <Pressable
          onPress={() => setConfirmLogout(true)}
          accessibilityRole="button"
          accessibilityLabel="Log out"
          style={({ pressed }) => [
            styles.logout,
            {
              marginTop: spacing.lg,
              borderColor: withAlpha(colors.danger, 0.4),
              backgroundColor: pressed ? withAlpha(colors.danger, 0.1) : 'transparent',
            },
          ]}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontFamily: fonts.semibold, fontSize: fontSize.base }}>Log out</Text>
        </Pressable>
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

const initialsOf = (name) =>
  String(name || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

/** 9.5 -> "9:30 AM". */
function to12(hour) {
  const [h, m] = formatHourFloat(hour).split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** 1 -> "1 day", 2.5 -> "2.5 days". */
const fmtDays = (n) => `${Number(n) || 0} ${Number(n) === 1 ? 'day' : 'days'}`;

function leaveText(leave) {
  if (!leave) return '';
  if (!leave.hasQuota) return 'No quota set';
  const parts = [`${fmtDays(leave.remaining)} left`, `${fmtDays(leave.totalUsed)} used`];
  if (leave.pendingDays) parts.push(`${fmtDays(leave.pendingDays)} pending`);
  return parts.join(' · ');
}

function deviceText(device) {
  if (!device) return 'Not registered';
  return [
    device.name,
    device.active ? 'Active' : 'Blocked',
    device.lastUsed ? `used ${formatDateKeyShort(device.lastUsed.slice(0, 10))}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** ['Mon','Tue',...,'Sat'] -> "Mon – Sat" when consecutive, else "Mon, Wed, Fri". */
function dayRange(days) {
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  if (!days?.length) return '';
  const idx = days.map((d) => order.indexOf(d)).sort((a, b) => a - b);
  const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  return consecutive && idx.length > 2 ? `${order[idx[0]]} – ${order[idx[idx.length - 1]]}` : days.join(', ');
}

/** A section of label/value pairs that simply leaves out the empty ones --
 *  unlike the Field Settings rows below, nothing here is the employee's to
 *  fill in, so a blank is noise rather than a prompt. */
function InfoSection({ title, icon, items, first }) {
  const { spacing } = useTheme();
  if (!items.some(([, v]) => v)) return null;
  return (
    <Section title={title} icon={icon} style={first ? undefined : { marginTop: spacing.md }}>
      <InfoRows items={items} />
    </Section>
  );
}

function InfoRows({ items }) {
  const shown = items.filter(([, v]) => v);
  return shown.map(([label, value], i) => (
    <Row key={label} label={label} value={value} last={i === shown.length - 1} />
  ));
}

function Tile({ label, value, tone }) {
  const { colors, fonts, fontSize, withAlpha } = useTheme();
  const c = colors[tone] || colors.primary;
  return (
    <View style={[styles.tile, { backgroundColor: withAlpha(c, 0.1) }]}>
      <Text style={{ color: c, fontFamily: fonts.bold, fontSize: fontSize.lg }}>{Number(value) || 0}</Text>
      <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function QueueRow({ label, count, last, onPress }) {
  const { colors, fonts, fontSize, withAlpha } = useTheme();
  const busy = Number(count) > 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${count}`}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : 1, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: fontSize.sm }}>{label}</Text>
      <View style={[styles.count, { backgroundColor: busy ? withAlpha(colors.warning, 0.16) : withAlpha(colors.muted, 0.12) }]}>
        <Text style={{ color: busy ? colors.warning : colors.muted, fontFamily: fonts.bold, fontSize: fontSize.xs }}>
          {count}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.faint} />
    </Pressable>
  );
}

function Section({ title, icon, children, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  return (
    <Card style={style} padded={false}>
      <View style={[styles.sectionHead, { borderBottomColor: colors.border }]}>
        <View style={[styles.sectionIcon, { backgroundColor: withAlpha(colors.primary, 0.12) }]}>
          <Ionicons name={icon} size={16} color={colors.primary} />
        </View>
        <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.sm, marginLeft: 10 }}>
          {title}
        </Text>
      </View>
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: 4 }}>{children}</View>
    </Card>
  );
}

/** A field the admin enabled but nobody has filled in still gets a row, so the
 *  gap is visible and fillable rather than silently missing. */
function Row({ label, value, last }) {
  const { colors, fonts, fontSize } = useTheme();
  const shown = value === '' || value === null || value === undefined ? '—' : value;
  return (
    <View style={[styles.row, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : 1 }]}>
      <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm }}>
        {label}
      </Text>
      <Text
        style={{
          flex: 1,
          textAlign: 'right',
          color: shown === '—' ? colors.muted : colors.text,
          fontFamily: fonts.medium,
          fontSize: fontSize.sm,
        }}
      >
        {shown}
      </Text>
    </View>
  );
}

function Empty({ text }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <Text
      style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm, paddingVertical: 14 }}
    >
      {text}
    </Text>
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
    paddingBottom: 22,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  tiles: { flexDirection: 'row', gap: 8, paddingTop: 12, paddingBottom: 4 },
  tile: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radii.md },
  count: { minWidth: 28, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignItems: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  sectionIcon: { width: 30, height: 30, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12 },
  emptyIcon: { width: 48, height: 48, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
});
