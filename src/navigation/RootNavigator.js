import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme';
import SplashScreen from '../screens/SplashScreen';
import ServerScreen from '../screens/ServerScreen';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/home/HomeScreen';
import LeaveScreen from '../screens/leave/LeaveScreen';

const Stack = createNativeStackNavigator();

/**
 * Every transition between the four SESSION screens is a navigation.reset(),
 * performed by the screens themselves — Splash routes by session, Server resets
 * to Login, Login resets to Home, Logout resets to Login, Change URL resets to
 * Server. None of those stack, so no back gesture can cross a session boundary.
 *
 * Feature screens above Home are different: Leave is pushed, and its back is a
 * real pop. That is why Home's hardwareBackPress handler is scoped to focus —
 * an unconditional one there wins the race on every screen stacked above it.
 */
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
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Server" component={ServerScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Login" component={LoginScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Leave" component={LeaveScreen} options={{ animation: 'slide_from_right' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
