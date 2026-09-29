import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BottomTabBar } from '../components';
import { useSession } from '../state/SessionContext';
import HomeScreen from '../screens/home/HomeScreen';
import ConfigScreen from '../screens/config/ConfigScreen';
import HrHomeScreen from '../screens/config/HrHomeScreen';
import MyDetailsScreen from '../screens/profile/MyDetailsScreen';

const Tab = createBottomTabNavigator();

/**
 * The three signed-in tab roots. Home is first, which also makes it where
 * Android's back button lands from the others (backBehavior defaults to
 * firstRoute) -- and Home's own handler then swallows the next press.
 *
 * Config is only MOUNTED when the server says this user may write the rules,
 * rather than being rendered and hidden: an unmounted screen cannot be reached
 * by a deep link or a stray navigate() either. canManage starts false, so the
 * tab appears a beat after login instead of flashing and vanishing.
 *
 * The middle tab depends on the hat. An admin (Odoo Settings access) gets
 * Config, the full admin menu. Anyone else with HR rights gets HR: today's
 * attendance and the approval queues, and no configuration at all.
 *
 * Leave, WFH, Attendance and Settings are deliberately NOT tabs -- they are
 * pushed by the root stack and cover the bar while they are up.
 */
export default function MainTabs() {
  const { canManage, caps } = useSession();

  return (
    <Tab.Navigator
      // 'shift' slides and fades between tabs, so switching reads as a
      // move sideways rather than a hard cut.
      screenOptions={{ headerShown: false, animation: 'shift' }}
      tabBar={(props) => <BottomTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      {canManage && caps.admin ? <Tab.Screen name="Config" component={ConfigScreen} /> : null}
      {canManage && !caps.admin ? <Tab.Screen name="HR" component={HrHomeScreen} /> : null}
      <Tab.Screen name="Profile" component={MyDetailsScreen} />
    </Tab.Navigator>
  );
}
