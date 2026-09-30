/**
 * Where a notification goes when it is tapped -- from the bell list or from a
 * push. The server names a screen; this decides whether the app has it.
 *
 * Anything unknown (an older app, a screen this user's role does not mount)
 * falls back to the Notifications list rather than a navigation error.
 */
const STACK_SCREENS = new Set([
  'Leave', 'Wfh', 'Attendance', 'LateReason', 'AppManual', 'Notifications',
  // HR / admin screens. The server only points HR notifications here, and
  // each screen still asks the server before showing anything.
  'LeaveQueue', 'WfhQueue', 'CompOff', 'LateRecords', 'DayStatus',
  'AbsentToday', 'PayrollRuns',
]);

export function openNotificationTarget(navigation, target) {
  const screen = target?.screen || '';
  const params = target?.params || {};
  if (!navigation) return;
  if (screen === 'Home') {
    navigation.navigate('Main', { screen: 'Home' });
  } else if (STACK_SCREENS.has(screen)) {
    navigation.navigate(screen, params);
  } else {
    navigation.navigate('Notifications');
  }
}
