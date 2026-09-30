import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, useTabBarLift } from '../../components';
import { useSession } from '../../state/SessionContext';
import { GuideBanner } from './FormBits';
import { GUIDES } from './guides';
import {
  countAbsentToday,
  countPendingLeave,
  countPendingWfh,
  countDraftRuns,
} from '../../services/odoo';

/**
 * Config -- the admin menu, mirroring the Odoo menus this app covers.
 *
 * Sections are gated INDIVIDUALLY, not by one flag on the tab. An HR Manager,
 * a Leave Manager and a WFH Manager are three separate hats: attendance_groups
 * gives group_leave_manager and group_wfh_manager implied_ids = [base.group_user]
 * only, so neither implies hr.group_hr_manager and a user may hold any
 * combination. Gating the whole tab on one check -- as this screen used to --
 * meant a Leave Manager who was not also an HR Manager saw nothing at all.
 *
 * The tab itself is mounted when ANY section would render; see canManage in
 * SessionContext.
 *
 * This is the ADMIN menu: only users with Odoo Settings access (caps.admin)
 * get it. Everyone else with HR rights gets the much smaller HR tab instead
 * (HrHomeScreen: today's attendance and approvals, no configuration). See
 * MainTabs.
 */
const BALANCE_ROWS = [
  { key: 'CompOff', icon: 'sunny-outline', tone: 'primary', label: 'Compensatory Off', caption: 'Credits for days off worked' },
  { key: 'LeaveBalances', icon: 'wallet-outline', tone: 'accent', label: 'Leave Balances', caption: 'Paid and comp off, per employee' },
];

function sectionsFor(caps, counts) {
  const out = [];

  if (caps.attendance) {
    out.push({
      title: 'Attendance status',
      items: [
        { key: 'LateRecords', icon: 'alarm-outline', tone: 'warning', label: 'Late Records', caption: 'Every late check-in' },
        { key: 'DayStatus', icon: 'calendar-number-outline', tone: 'info', label: 'Day Status', caption: 'How each day was graded' },
        {
          key: 'AbsentToday',
          icon: 'person-remove-outline',
          tone: 'danger',
          label: 'Absent Today',
          caption: 'Expected in, never checked in',
          badge: counts.absent,
        },
        { key: 'MonthlySummary', icon: 'stats-chart-outline', tone: 'accent', label: 'Monthly Summary', caption: 'Late days per employee' },
      ],
    });
  }

  if (caps.leave) {
    out.push({
      title: 'Leave',
      items: [
        {
          key: 'LeaveQueue',
          icon: 'file-tray-full-outline',
          tone: 'warning',
          label: 'All Leave Requests',
          caption: 'Approve or reject',
          badge: counts.leave,
        },
        { key: 'ApprovedLeaves', icon: 'checkmark-done-outline', tone: 'success', label: 'Approved Leaves Report', caption: 'What was granted' },
        ...BALANCE_ROWS,
        { key: 'LeavePolicy', icon: 'shield-checkmark-outline', tone: 'info', label: 'Leave Policy', caption: 'Paid days, comp off' },
      ],
    });
  } else if (caps.attendance || caps.balances) {
    // HR Managers and HR Officers both write hr.comp.off.credit and read the
    // balance fields, even without the leave-manager hat.
    out.push({ title: 'Leave balances', items: BALANCE_ROWS });
  }

  if (caps.wfh) {
    out.push({
      title: 'Work from home',
      items: [
        {
          key: 'WfhQueue',
          icon: 'home-outline',
          tone: 'warning',
          label: 'All WFH Requests',
          caption: 'Approve or reject',
          badge: counts.wfh,
        },
      ],
    });
  }

  if (caps.attendance) {
    out.push({
      title: 'Configuration',
      items: [
        { key: 'RulesList', icon: 'time-outline', tone: 'primary', label: 'Office Hours & Working Days', caption: 'Grace, ladder, working days' },
        { key: 'Holidays', icon: 'flag-outline', tone: 'success', label: 'Public Holidays', caption: 'Excluded from working days' },
        // One row, not two. Odoo hangs the same action off both the Leave and
        // the WFH Configuration menus, but it is a single record carrying both
        // leave_* and wfh_* fields -- showing it twice would imply two policies.
        { key: 'AutoApproval', icon: 'flash-outline', tone: 'accent', label: 'Auto-Approval', caption: 'Leave and WFH, one policy' },
      ],
    });
  }

  if (caps.attendance && caps.admin) {
    out.push({
      title: 'Employee details',
      items: [
        { key: 'FieldSettings', icon: 'toggle-outline', tone: 'info', label: 'Field Settings', caption: 'What My Details shows' },
        { key: 'SalaryComponents', icon: 'cash-outline', tone: 'success', label: 'Salary Components', caption: 'Earnings and deductions' },
        { key: 'StatutoryIdTypes', icon: 'card-outline', tone: 'primary', label: 'Statutory ID Types', caption: 'PAN, Aadhaar, UAN' },
      ],
    });
  }

  if (caps.admin) {
    out.push({
      title: 'App',
      items: [
        { key: 'NotifySettings', icon: 'notifications-outline', tone: 'warning', label: 'Notifications', caption: 'What is sent, and to whom' },
      ],
    });
  }

  if (caps.payroll) {
    out.push({
      title: 'Payroll',
      items: [
        {
          key: 'PayrollRuns',
          icon: 'cash-outline',
          tone: 'success',
          label: 'Payroll Runs',
          caption: 'Generate, confirm, mark paid',
          badge: counts.draftRuns,
        },
        {
          key: 'Payslips',
          icon: 'document-text-outline',
          tone: 'info',
          label: 'Payslips',
          caption: 'Every payslip, all runs',
        },
      ],
    });
    out.push({
      title: 'Reports',
      items: [
        { key: 'GenerateReport', icon: 'bar-chart-outline', tone: 'accent', label: 'Generate Report', caption: 'A month, per employee' },
        { key: 'PastReports', icon: 'albums-outline', tone: 'primary', label: 'Past Reports', caption: 'What was generated before' },
      ],
    });
  }

  return out;
}

export default function ConfigScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const lift = useTabBarLift();
  const { caps } = useSession();
  const [counts, setCounts] = useState({ absent: 0, leave: 0, wfh: 0, draftRuns: 0 });

  // Refetch on focus rather than on mount: the tab stays mounted behind Home,
  // so a mount-only count would be as old as the session, and these numbers
  // are the reason a manager opens this tab at all. Each counter swallows its
  // own failure -- a badge must never take the menu down with it.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [absent, leave, wfh, draftRuns] = await Promise.all([
          caps.attendance ? countAbsentToday() : Promise.resolve(0),
          caps.leave ? countPendingLeave() : Promise.resolve(0),
          caps.wfh ? countPendingWfh() : Promise.resolve(0),
          caps.payroll ? countDraftRuns() : Promise.resolve(0),
        ]);
        if (!cancelled) setCounts({ absent, leave, wfh, draftRuns });
      })();
      return () => {
        cancelled = true;
      };
    }, [caps.attendance, caps.leave, caps.wfh, caps.payroll])
  );

  const sections = useMemo(() => sectionsFor(caps, counts), [caps, counts]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />

      {/* No back chevron: this is a tab root. */}
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
              {
                backgroundColor: withAlpha(colors.onHeader, 0.16),
                borderColor: withAlpha(colors.onHeader, 0.22),
              },
            ]}
          >
            <Ionicons name="options-outline" size={20} color={colors.onHeader} />
          </View>
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={{ color: colors.onHeader, fontFamily: fonts.bold, fontSize: fontSize.lg }}>
              Config
            </Text>
            <Text
              style={{
                color: withAlpha(colors.onHeader, 0.8),
                fontFamily: fonts.regular,
                fontSize: fontSize.sm,
              }}
            >
              {sections.length ? 'Administration' : 'Nothing assigned to you'}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: lift }}
      >
        <GuideBanner {...GUIDES.hub} />
        {sections.map((section, si) => (
          <View key={section.title} style={{ marginTop: si === 0 ? 0 : spacing.lg }}>
            <Text
              style={{
                color: colors.muted,
                fontFamily: fonts.semibold,
                fontSize: fontSize.xs,
                letterSpacing: 1,
                marginBottom: spacing.sm,
              }}
            >
              {section.title.toUpperCase()}
            </Text>
            <Card padded={false}>
              {section.items.map((item, i) => (
                <MenuRow
                  key={item.key}
                  item={item}
                  last={i === section.items.length - 1}
                  onPress={() => navigation.navigate(item.key, item.params)}
                />
              ))}
            </Card>
          </View>
        ))}

        {/* Reachable only in a race: the capability probes answer after the
            tab is mounted, so this shows for a beat rather than an empty page. */}
        {!sections.length ? (
          <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
            <Ionicons name="lock-closed-outline" size={26} color={colors.muted} />
            <Text
              style={{
                color: colors.muted,
                fontFamily: fonts.regular,
                fontSize: fontSize.sm,
                marginTop: spacing.md,
                textAlign: 'center',
                lineHeight: 19,
              }}
            >
              Checking what you can administer…
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function MenuRow({ item, last, onPress }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const tone = colors[item.tone] || colors.primary;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: withAlpha(tone, 0.12) }}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      style={({ pressed }) => [
        styles.row,
        {
          paddingHorizontal: spacing.base,
          borderBottomColor: colors.border,
          borderBottomWidth: last ? 0 : 1,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: withAlpha(tone, 0.13) }]}>
        <Ionicons name={item.icon} size={18} color={tone} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
          {item.label}
        </Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
          {item.caption}
        </Text>
      </View>

      {/* Badged only when there is actually something waiting. A grey 0 beside
          "Absent Today" reads as a broken counter rather than as good news. */}
      {item.badge ? (
        <View style={[styles.badge, { backgroundColor: colors.danger }]}>
          <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: fontSize.xs }}>
            {item.badge}
          </Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 8 }} />
    </Pressable>
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
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
