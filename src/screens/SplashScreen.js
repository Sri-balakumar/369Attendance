import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Dimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useSession, routeFor } from '../state/SessionContext';

const { width } = Dimensions.get('window');

/**
 * Routes by the session rules, not by a fixed next screen:
 *   no server        -> Server
 *   server, no user  -> Login
 *   server + user    -> Home
 * Always a reset, so nothing stale sits underneath.
 */
export default function SplashScreen({ navigation }) {
  const { colors, fonts, fontSize, withAlpha } = useTheme();
  const { server, user, hydrated } = useSession();

  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.82)).current;
  const textFade = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 8, bounciness: 8 }),
      Animated.timing(textFade, {
        toValue: 1,
        duration: 500,
        delay: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [fade, scale, textFade, ring]);

  // Hold the splash for its animation, but never route before the stored
  // session has been read — otherwise a signed-in user flashes the Login screen.
  useEffect(() => {
    if (!hydrated) return undefined;
    const t = setTimeout(() => {
      navigation.reset({ index: 0, routes: [{ name: routeFor({ server, user }) }] });
    }, 1600);
    return () => clearTimeout(t);
  }, [hydrated, server, user, navigation]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient
        colors={colors.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Two oversized soft circles give the flat gradient some depth. */}
      <View style={[styles.blob, { top: -width * 0.35, right: -width * 0.3, width: width * 0.9, height: width * 0.9, borderRadius: width, backgroundColor: withAlpha(colors.onHeader, 0.07) }]} />
      <View style={[styles.blob, { bottom: -width * 0.4, left: -width * 0.25, width: width * 0.85, height: width * 0.85, borderRadius: width, backgroundColor: withAlpha(colors.onHeader, 0.05) }]} />

      <View style={styles.center}>
        <View style={styles.badgeWrap}>
          <Animated.View
            style={[
              styles.pulseRing,
              {
                borderColor: withAlpha(colors.onHeader, 0.5),
                opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.badge,
              {
                backgroundColor: withAlpha(colors.onHeader, 0.18),
                borderColor: withAlpha(colors.onHeader, 0.35),
                opacity: fade,
                transform: [{ scale }],
              },
            ]}
          >
            <Ionicons name="finger-print" size={52} color={colors.onHeader} />
          </Animated.View>
        </View>

        <Animated.View style={{ opacity: textFade, alignItems: 'center' }}>
          <Text style={[styles.wordmark, { color: colors.onHeader, fontFamily: fonts.bold, fontSize: fontSize.display }]}>
            369 Attendance
          </Text>
          <Text
            style={{
              color: withAlpha(colors.onHeader, 0.75),
              fontFamily: fonts.medium,
              fontSize: fontSize.base,
              marginTop: 8,
              letterSpacing: 0.2,
            }}
          >
            Attendance, leave & WFH in one place
          </Text>
        </Animated.View>
      </View>

      <Animated.Text
        style={{
          opacity: textFade,
          color: withAlpha(colors.onHeader, 0.6),
          fontFamily: fonts.medium,
          fontSize: fontSize.xxs,
          textAlign: 'center',
          marginBottom: 34,
          letterSpacing: 0.4,
        }}
      >
        by Alphalize Technologies
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between' },
  blob: { position: 'absolute' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badgeWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 30 },
  pulseRing: { position: 'absolute', width: 118, height: 118, borderRadius: 59, borderWidth: 1.5 },
  badge: {
    width: 118,
    height: 118,
    borderRadius: 40,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { letterSpacing: -0.5 },
});
