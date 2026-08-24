import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BottomTabBar } from '../components';
import { useSession } from '../state/SessionContext';
import HomeScreen from '../screens/home/HomeScreen';
import ConfigScreen from '../screens/config/ConfigScreen';
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
 * Leave, WFH, Attendance and Settings are deliberately NOT tabs -- they are
 * pushed by the root stack and cover the bar while they are up.
 */
export default function MainTabs() {
  const { canManage } = useSession();

  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <BottomTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      {canManage ? <Tab.Screen name="Config" component={ConfigScreen} /> : null}
      <Tab.Screen name="Profile" component={MyDetailsScreen} />
    </Tab.Navigator>
  );
}
