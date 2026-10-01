import { StackActions } from '@react-navigation/native';

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

/**
 * Never stacks a second copy. React Navigation 7's navigate() pushes another
 * Main on top of the real one, after which back walks through duplicates; so
 * Home pops back down to the Main already there, and every other target goes
 * back to its screen if it is open (`pop: true`) rather than adding one.
 */
export function openNotificationTarget(navigation, target) {
  const screen = target?.screen || '';
  const params = target?.params || {};
  if (!navigation) return;
  if (screen === 'Home') {
    navigation.dispatch(StackActions.popTo('Main', { screen: 'Home' }));
  } else if (STACK_SCREENS.has(screen)) {
    navigation.navigate(screen, params, { pop: true });
  } else {
    navigation.navigate('Notifications', undefined, { pop: true });
  }
}
