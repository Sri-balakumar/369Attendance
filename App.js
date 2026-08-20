import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { ThemeProvider } from './src/theme';
import { ToastProvider } from './src/components';
import { SessionProvider } from './src/state/SessionContext';
import RootNavigator from './src/navigation/RootNavigator';

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Deliberately NOT gated on fontsLoaded: the splash animation should start
  // straight away. ThemeProvider hands out the platform font until Inter
  // resolves and then swaps, so nothing renders blank in the meantime.
  return (
    <SafeAreaProvider>
      <ThemeProvider fontsLoaded={fontsLoaded}>
        <SessionProvider>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
