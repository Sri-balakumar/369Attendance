import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

/**
 * Vibration on tap and on the result of an action.
 *
 * Every call is fire-and-forget: a phone without a vibration motor, a web
 * build, or the person's own "off" in Settings all end in silence, never an
 * error on the screen that asked. The setting is read once at start-up and
 * held in memory, so a tap never waits on storage.
 */

const KEY = 'attendly.haptics';

let enabled = true;

export async function loadHapticsSetting() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw != null) enabled = raw !== 'off';
  } catch (e) {
    // Keep the default.
  }
  return enabled;
}

export function isHapticsEnabled() {
  return enabled;
}

export async function setHapticsEnabled(next) {
  enabled = Boolean(next);
  try {
    await AsyncStorage.setItem(KEY, enabled ? 'on' : 'off');
  } catch (e) {
    // Still applies for this run.
  }
}

const fire = (name, run) => {
  if (!enabled || Platform.OS === 'web') return;
  if (__DEV__) console.log(`[haptics] ${name}`);
  run().catch(() => {});
};

/** A button that starts something: Check In, Submit, Approve, Sign In. */
export const press = () => fire('press', () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

/** A light click for picking: a tab, a date, a switch. */
export const tick = () => fire('tick', () => Haptics.selectionAsync());

export const success = () =>
  fire('success', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

export const error = () =>
  fire('error', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));

export const warning = () =>
  fire('warning', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
