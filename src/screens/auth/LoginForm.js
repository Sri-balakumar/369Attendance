import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, useWindowDimensions, Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { ConfirmDialog } from '../../components';
import { useSession } from '../../state/SessionContext';
import { authenticate } from '../../services/odoo';
import { prettyHost } from '../../utils/url';
import AuthField, { AuthButton, AuthHeading, useAuthColors } from './AuthField';

/** "369application" -> "36", "sales_test" -> "ST": two letters for the avatar. */
function initials(name) {
  const parts = String(name || '').split(/[\s_\-.]+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : String(name || '?').slice(0, 2);
  return two.toUpperCase();
}

/**
 * Step two: where users land on almost every launch, since the server is asked
 * for only once. It carries the server context itself -- a card showing where
 * it will sign in -- and "Change server", the only way back to step one
 * (`onServerChanged` pans back there).
 */
export default function LoginForm({ navigation, onServerChanged }) {
  const { fonts, isDark, colors } = useTheme();
  const c = useAuthColors();
  const insets = useSafeAreaInsets();
  // Tablets get wider margins, so the fields are wide without hugging the edges.
  const gutter = useWindowDimensions().width >= 600 ? 48 : 24;
  const { server, signIn, changeServer } = useSession();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    } catch (e) {
      setFormError(e?.message || 'Sign in failed.');
      runShake();
    } finally {
      setLoading(false);
    }
  };

  // Change server drops BOTH stored keys — the server and the user — because a
  // different server means a different session entirely.
  const onChangeUrl = async () => {
    setConfirmChange(false);
    setUsername('');
    setPassword('');
    setErrors({});
    setFormError('');
    await changeServer();
    onServerChanged?.();
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: gutter, paddingTop: 18, paddingBottom: insets.bottom + 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Where this sign-in goes, in the place the design shows the employee. */}
        <View style={[styles.serverCard, { backgroundColor: isDark ? colors.surface : '#EFF4FE' }]}>
          <View style={[styles.avatar, { backgroundColor: c.blue }]}>
            <Text style={{ color: '#fff', fontFamily: fonts.bold, fontSize: 15 }}>{initials(server?.db)}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text numberOfLines={1} style={{ color: c.text, fontFamily: fonts.bold, fontSize: 16 }}>
              {server?.db || 'Not connected'}
            </Text>
            <Text numberOfLines={1} style={{ color: c.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 }}>
              {prettyHost(server?.url) || '—'} · Odoo
            </Text>
          </View>
          <Ionicons name="checkmark-circle" size={20} color={c.success} />
        </View>

        <View style={{ marginTop: 22 }}>
          <AuthHeading title="Sign in" subtitle="Enter your username and password." />
        </View>

        <Animated.View style={{ transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-9, 9] }) }] }}>
          <AuthField
            label="Username"
            icon="person-outline"
            value={username}
            onChangeText={(t) => {
              setUsername(t);
              if (errors.username) setErrors((e) => ({ ...e, username: undefined }));
            }}
            placeholder="Your username"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            error={errors.username}
            style={{ marginTop: 20 }}
          />

          <AuthField
            ref={passwordRef}
            label="Password"
            icon="lock-closed-outline"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
            }}
            placeholder="Your password"
            secure
            autoCapitalize="none"
            autoComplete="password"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            error={errors.password}
            style={{ marginTop: 16 }}
          />
        </Animated.View>

        {formError ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle" size={16} color={c.danger} />
            <Text style={{ flex: 1, color: c.danger, fontFamily: fonts.medium, fontSize: 13, marginLeft: 6 }}>{formError}</Text>
          </View>
        ) : null}

        {/* Pushes the button to the foot of the screen, as in the design. */}
        <View style={{ flex: 1, minHeight: 28 }} />

        <AuthButton label="Sign In" onPress={onSubmit} loading={loading} />

        <Pressable
          onPress={() => setConfirmChange(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Change server"
          style={{ alignSelf: 'center', marginTop: 14, paddingVertical: 4 }}
        >
          <Text style={{ color: c.muted, fontFamily: fonts.medium, fontSize: 15 }}>← Change server</Text>
        </Pressable>
      </ScrollView>

      <ConfirmDialog
        visible={confirmChange}
        title="Change server?"
        message="You'll be signed out and asked for the server URL and database again."
        confirmLabel="Change server"
        icon="swap-horizontal"
        onConfirm={onChangeUrl}
        onCancel={() => setConfirmChange(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  serverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
});
