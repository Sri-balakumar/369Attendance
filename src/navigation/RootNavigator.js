import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme';
import { useSession } from '../state/SessionContext';
import { navRef } from './navRef';
import { installNotificationHandler, dataOf } from '../push/registerDevice';
import { openNotificationTarget } from '../utils/notificationTarget';
import { markNotificationsRead } from '../services/odoo';
import SplashScreen from '../screens/SplashScreen';
import AuthScreen from '../screens/auth/AuthScreen';
import MainTabs from './MainTabs';
import LeaveScreen from '../screens/leave/LeaveScreen';
import WfhScreen from '../screens/wfh/WfhScreen';
import AttendanceScreen from '../screens/attendance/AttendanceScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import AppManualScreen from '../screens/settings/AppManualScreen';
import AppManualFormScreen from '../screens/settings/AppManualFormScreen';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import LateReasonScreen from '../screens/attendance/LateReasonScreen';
import NotifySettingsScreen from '../screens/config/NotifySettingsScreen';
import LateRecordsScreen from '../screens/config/LateRecordsScreen';
import DayStatusScreen from '../screens/config/DayStatusScreen';
import AbsentTodayScreen from '../screens/config/AbsentTodayScreen';
import MonthlySummaryScreen from '../screens/config/MonthlySummaryScreen';
import RulesListScreen from '../screens/config/RulesListScreen';
import RulesFormScreen from '../screens/config/RulesFormScreen';
import HolidaysScreen from '../screens/config/HolidaysScreen';
import HolidayFormScreen from '../screens/config/HolidayFormScreen';
import RequestQueueScreen from '../screens/config/RequestQueueScreen';
import RequestDetailScreen from '../screens/config/RequestDetailScreen';
import ApprovedLeavesScreen from '../screens/config/ApprovedLeavesScreen';
import CompOffScreen from '../screens/config/CompOffScreen';
import CompOffFormScreen from '../screens/config/CompOffFormScreen';
import LeaveBalancesScreen from '../screens/config/LeaveBalancesScreen';
import LeavePolicyScreen from '../screens/config/LeavePolicyScreen';
import AutoApprovalScreen from '../screens/config/AutoApprovalScreen';
import { FieldSettingsListScreen, FieldSettingsFormScreen } from '../screens/config/FieldSettingsScreens';
import { SalaryComponentsListScreen, SalaryComponentFormScreen } from '../screens/config/SalaryComponentsScreens';
import { StatutoryIdTypesListScreen, StatutoryIdTypeFormScreen } from '../screens/config/StatutoryIdTypesScreens';
import {
  PayrollRunsScreen,
  PayrollRunScreen,
  PayslipsScreen,
  PayslipScreen,
} from '../screens/config/PayrollScreens';
import {
  GenerateReportScreen,
  PastReportsScreen,
  ReportScreen,
  ReportDetailScreen,
} from '../screens/config/ReportScreens';

const Stack = createNativeStackNavigator();

/**
 * Every transition between the four SESSION screens is a navigation.reset(),
 * performed by the screens themselves — Splash routes by session, Server resets
 * to Login, Login resets to Main, Logout resets to Login, Change URL resets to
 * Server. None of those stack, so no back gesture can cross a session boundary.
 *
 * "Main" is the bottom-tab navigator (Home / Config / Profile), so it is the
 * reset root rather than Home itself. reset() does NOT bubble to a parent the
 * way navigate() does, which is why the id below exists: a tab screen wanting
 * to reset the SESSION has to ask for this navigator by name, or it would only
 * reset which tab is selected. See HomeScreen's logout.
 *
 * Feature screens above Main are different: Leave is pushed, and its back is a
 * real pop. That is why Home's hardwareBackPress handler is scoped to focus —
 * an unconditional one there wins the race on every screen stacked above it.
 */
installNotificationHandler();

/**
 * A tapped push opens what it is about. Held until somebody is signed in:
 * navigating while the app is still restoring lands on a screen that
 * immediately routes away to Login. Covers both a tap that launched the app
 * (getLastNotificationResponseAsync) and one while it was running.
 */
function PushTapHandler() {
  const { user } = useSession();
  useEffect(() => {
    if (!user || Platform.OS === 'web') return undefined;
    const open = (response) => {
      const data = dataOf(response);
      if (!data) return;
      if (data.notificationId) markNotificationsRead([data.notificationId]).catch(() => {});
      const go = () => openNotificationTarget(navRef, data);
      // The navigator may not be mounted yet on a cold start.
      if (navRef.isReady()) go();
      else setTimeout(go, 800);
    };
    let cancelled = false;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!cancelled && response) open(response);
      })
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [user]);
  return null;
}

export default function RootNavigator() {
  const { colors, isDark } = useTheme();

  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  return (
    <NavigationContainer ref={navRef} theme={navTheme}>
      <PushTapHandler />
      <Stack.Navigator
        id="RootStack"
        initialRouteName="Splash"
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Splash" component={SplashScreen} />
        {/* Both login steps are one screen, so the hero art can pan between
            them; the step is picked by which name was navigated to. */}
        <Stack.Screen name="Server" component={AuthScreen} initialParams={{ step: 0 }} />
        <Stack.Screen name="Login" component={AuthScreen} initialParams={{ step: 1 }} />
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Leave" component={LeaveScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Wfh" component={WfhScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="AppManual" component={AppManualScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="AppManualForm" component={AppManualFormScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="LateReason" component={LateReasonScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="NotifySettings" component={NotifySettingsScreen} options={{ animation: 'slide_from_right' }} />

        {/* The Attendance Status admin menu, reached from the Config tab.
            Pushed rather than nested in the tabs, so the floating bar is
            covered while any of them is open. Every one is behind the same
            gate: the tab itself is not mounted unless the server says this
            user may write the attendance config. */}
        <Stack.Screen name="LateRecords" component={LateRecordsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="DayStatus" component={DayStatusScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="AbsentToday" component={AbsentTodayScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="MonthlySummary" component={MonthlySummaryScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="RulesList" component={RulesListScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="RulesForm" component={RulesFormScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Holidays" component={HolidaysScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="HolidayForm" component={HolidayFormScreen} options={{ animation: 'slide_from_right' }} />

        {/* Leave and WFH manager surfaces. The two queues are ONE screen --
            they differ only in vocabulary -- so the route carries the kind.
            The employee's own requests are elsewhere: LeaveScreen and
            WfhScreen already cover "my requests". */}
        <Stack.Screen
          name="LeaveQueue"
          component={RequestQueueScreen}
          initialParams={{ kind: 'leave' }}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="WfhQueue"
          component={RequestQueueScreen}
          initialParams={{ kind: 'wfh' }}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen name="RequestDetail" component={RequestDetailScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ApprovedLeaves" component={ApprovedLeavesScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="LeavePolicy" component={LeavePolicyScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="CompOff" component={CompOffScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="CompOffForm" component={CompOffFormScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="LeaveBalances" component={LeaveBalancesScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="AutoApproval" component={AutoApprovalScreen} options={{ animation: 'slide_from_right' }} />

        {/* Employee Details */}
        <Stack.Screen name="FieldSettings" component={FieldSettingsListScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="FieldSettingsForm" component={FieldSettingsFormScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="SalaryComponents" component={SalaryComponentsListScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="SalaryComponentForm" component={SalaryComponentFormScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="StatutoryIdTypes" component={StatutoryIdTypesListScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="StatutoryIdTypeForm" component={StatutoryIdTypeFormScreen} options={{ animation: 'slide_from_right' }} />

        {/* Payroll. The PDF stays in Odoo -- report_action() hands back an
            action object, and the download URL needs a session the system
            browser does not have -- so PayslipScreen renders the same
            breakdown natively instead. */}
        <Stack.Screen name="PayrollRuns" component={PayrollRunsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="PayrollRun" component={PayrollRunScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Payslips" component={PayslipsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Payslip" component={PayslipScreen} options={{ animation: 'slide_from_right' }} />

        {/* Employee Report */}
        <Stack.Screen name="GenerateReport" component={GenerateReportScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="PastReports" component={PastReportsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Report" component={ReportScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ReportDetail" component={ReportDetailScreen} options={{ animation: 'slide_from_right' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
