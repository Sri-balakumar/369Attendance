// Phone push, ported from Showroom_check's src/push/registerDevice.js.
//
// Every signed-in user registers (Showroom only registers managers): here
// employees are told about their own approvals, marks and payslips too.
//
// Nothing in this file may fail a sign-in. A phone that cannot register -- a
// simulator, a refused permission, a build with no EAS projectId yet -- falls
// back to the bell list inside the app, quietly.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { registerPushDevice, unregisterPushDevice } from '../services/odoo';

// Must match CHANNEL_ID in the addon's models/notify_push.py, or Android 8+
// files the message under a channel that does not exist and never shows it.
export const CHANNEL_ID = 'attendance';

function getProjectId() {
  return Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId || null;
}

/** Show a banner even while the app is open, not only in the background. */
export function installNotificationHandler() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Ask permission, get the Expo token, hand it to Odoo. Returns the token or null. */
export async function registerForPush() {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Attendance',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain !== false) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return null;

    // Without `eas init` there is no projectId, and remote push cannot work.
    // The bell still does.
    const projectId = getProjectId();
    if (!projectId) {
      console.log('[push] no EAS projectId -- push is off until `eas init`');
      return null;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return null;

    await registerPushDevice(token, Platform.OS, Device.deviceName || Device.modelName || '', projectId);
    return token;
  } catch (e) {
    console.log('[push] could not register:', e?.message || e);
    return null;
  }
}

/** Sign-out: stop this phone being told about the previous user. */
export async function unregisterFromPush(token) {
  if (!token) return;
  try {
    await unregisterPushDevice(token);
  } catch (e) {
    console.log('[push] could not unregister:', e?.message || e);
  }
}

/** The data a tapped notification carries: { screen, params, notificationId }. */
export function dataOf(response) {
  return response?.notification?.request?.content?.data || null;
}
