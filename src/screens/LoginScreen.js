import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Switch,
  Animated,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { radii } from '../theme/tokens';
import { AppTextInput, PrimaryButton, ConfirmDialog, useToast } from '../components';
import { useSession } from '../state/SessionContext';
import { authenticate } from '../services/odoo';
import { prettyHost } from '../utils/url';

/**
 * The screen users land on for almost every launch, since the server is asked
 * for only once. It therefore carries the server context itself: a chip showing
 * where it will sign in, and a Change URL button — the only route back to the
 * Server screen.
 */
export default function LoginScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, radii, shadows, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const showToast = useToast();
  const { server, signIn, changeServer } = useSession();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [confirmChange, setConfirmChange] = useState(false);

  const shake = useRef(new Animated.Value(0)).current;
  const passwordRef = useRef(null);

  const runShake = () => {
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const onSubmit = async () => {
    const next = {};
    if (!username.trim()) next.username = 'Username is required';
    if (!password) next.password = 'Password is required';
    setErrors(next);
    setFormError('');

    if (Object.keys(next).length) {
      runShake();
      return;
    }

    setLoading(true);
    try {
      const user = await authenticate({
        url: server?.url,
        db: server?.db,
        login: username.trim(),
        password,
      });
      await signIn(user);
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } catch (e) {
      setFormError(e?.message || 'Sign in failed.');
      runShake();
    } finally {
      setLoading(false);
    }
  };

  // Change URL drops BOTH stored keys — the server and the user — because a
  // different server means a different session entirely. This is the only route
  // back to the Server screen.
  const onChangeUrl = async () => {
    setConfirmChange(false);
    await changeServer();
    navigation.reset({ index: 0, routes: [{ name: 'Server' }] });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />

      <LinearGradient
        colors={colors.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + spacing.base }]}
      >
        {/* Server context + the only way back to the URL screen */}
        <View
          style={[
            styles.serverBar,
            {
              backgroundColor: withAlpha(colors.onHeader, 0.15),
              borderColor: withAlpha(colors.onHeader, 0.25),
              borderRadius: radii.pill,
            },
          ]}
        >
          <Ionicons name="ellipse" size={8} color={colors.success} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text numberOfLines={1} style={{ color: colors.onHeader, fontFamily: fonts.semibold, fontSize: fontSize.xxs }}>
              {prettyHost(server?.url) || 'Not connected'}
              <Text style={{ color: withAlpha(colors.onHeader, 0.6) }}>{'  ·  '}</Text>
              {server?.db || '—'}
            </Text>
          </View>
          <Pressable
            onPress={() => setConfirmChange(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Change URL"
            style={styles.changeBtn}
          >
            <Ionicons name="swap-horizontal" size={14} color={colors.onHeader} />
            <Text style={{ color: colors.onHeader, fontFamily: fonts.semibold, fontSize: fontSize.xxs }}>Change URL</Text>
          </Pressable>
        </View>

        <View style={{ alignItems: 'center', marginTop: spacing.xl }}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: withAlpha(colors.onHeader, 0.18), borderColor: withAlpha(colors.onHeader, 0.32) },
            ]}
          >
            <Ionicons name="person-outline" size={32} color={colors.onHeader} />
          </View>
          <Text
            style={{
              color: colors.onHeader,
              fontFamily: fonts.bold,
              fontSize: fontSize.xl,
              marginTop: spacing.base,
            }}
          >
            Welcome back
          </Text>
          <Text
            style={{
              color: withAlpha(colors.onHeader, 0.78),
              fontFamily: fonts.regular,
              fontSize: fontSize.base,
              marginTop: 5,
            }}
          >
            Sign in to continue
          </Text>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView
        style={{ flex: 1, marginTop: -spacing.xl }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.lg,
                padding: spacing.lg,
                transform: [
                  { translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-9, 9] }) },
                ],
              },
              shadows.raised,
            ]}
          >
            <Text
              style={[
                styles.stepLabel,
                { color: colors.muted, fontFamily: fonts.semibold, fontSize: fontSize.xs },
              ]}
            >
              STEP 2 OF 2
            </Text>

            <AppTextInput
              label="Username"
              value={username}
              onChangeText={(t) => {
                setUsername(t);
                if (errors.username) setErrors((e) => ({ ...e, username: undefined }));
              }}
              icon="person-outline"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              error={errors.username}
              style={{ marginTop: spacing.md }}
            />

            <AppTextInput
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
              }}
              icon="lock-closed-outline"
              secure
              autoCapitalize="none"
              autoComplete="password"
              returnKeyType="go"
              onSubmitEditing={onSubmit}
              error={errors.password}
              style={{ marginTop: spacing.base }}
            />

            <View style={styles.optionsRow}>
              <Pressable style={styles.rememberRow} onPress={() => setRemember((r) => !r)}>
                <Switch
                  value={remember}
                  onValueChange={setRemember}
                  trackColor={{ false: colors.border, true: withAlpha(colors.primary, 0.5) }}
                  thumbColor={remember ? colors.primary : colors.surface}
                  style={Platform.OS === 'ios' ? { transform: [{ scale: 0.82 }] } : undefined}
                />
                <Text
                  style={{
                    color: colors.muted,
                    fontFamily: fonts.medium,
                    fontSize: fontSize.sm,
                    marginLeft: Platform.OS === 'ios' ? 4 : 8,
                  }}
                >
                  Remember me
                </Text>
              </Pressable>
              <Pressable
                onPress={() => showToast('Contact your HR administrator to reset your password.', 'info')}
                hitSlop={8}
              >
                <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
                  Forgot password?
                </Text>
              </Pressable>
            </View>

            {formError ? (
              <View
                style={[
                  styles.formError,
                  {
                    backgroundColor: withAlpha(colors.danger, 0.09),
                    borderColor: withAlpha(colors.danger, 0.28),
                    borderRadius: radii.md,
                    padding: spacing.md,
                  },
                ]}
              >
                <Ionicons name="alert-circle" size={17} color={colors.danger} />
                <Text
                  style={{
                    flex: 1,
                    color: colors.danger,
                    fontFamily: fonts.medium,
                    fontSize: fontSize.sm,
                    marginLeft: 8,
                  }}
                >
                  {formError}
                </Text>
              </View>
            ) : null}

            <PrimaryButton
              label="Sign In"
              icon="log-in-outline"
              onPress={onSubmit}
              loading={loading}
              style={{ marginTop: spacing.lg }}
            />
          </Animated.View>

          <View style={styles.footer}>
            <Ionicons name="shield-checkmark-outline" size={13} color={colors.faint} />
            <Text style={{ color: colors.faint, fontFamily: fonts.regular, fontSize: fontSize.xxs, marginLeft: 6 }}>
              You stay signed in until you log out.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={confirmChange}
        title="Change server?"
        message="You'll be signed out and asked for the server URL and database again."
        confirmLabel="Change server"
        icon="swap-horizontal"
        onConfirm={onChangeUrl}
        onCancel={() => setConfirmChange(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 44,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  serverBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingVertical: 9,
    paddingLeft: 14,
    paddingRight: 8,
  },
  changeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { borderWidth: 1 },
  // letterSpacing only: `fontSize` is a theme value and this object is
  // module level, where nothing from useTheme() is in scope. The size is
  // applied at the usage site, which already merges an inline style.
  stepLabel: { letterSpacing: 1.2 },
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  rememberRow: { flexDirection: 'row', alignItems: 'center' },
  formError: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, marginTop: 14 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
});
