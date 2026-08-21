import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

/**
 * In-app confirm, used instead of Alert.alert for the two destructive session
 * actions (Logout, Change URL). Alert.alert renders the OS dialog, which is
 * unthemed, ignores dark mode, and is a no-op on web — this matches the rest of
 * the app and behaves the same on every platform.
 */
export default function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  icon = 'alert-circle-outline',
  onConfirm,
  onCancel,
}) {
  const { colors, radii, fonts, fontSize, spacing, shadows, withAlpha, onColor } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  const accent = colors[tone] || colors.danger;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 200 : 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Dismiss dialog" />
        <Animated.View
          style={[
            styles.dialog,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.lg,
              padding: spacing.lg,
              opacity: anim,
              transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
            },
            shadows.raised,
          ]}
        >
          <View
            style={[
              styles.icon,
              { backgroundColor: withAlpha(accent, 0.13), borderRadius: radii.md },
            ]}
          >
            <Ionicons name={icon} size={26} color={accent} />
          </View>

          <Text
            style={{
              color: colors.text,
              fontFamily: fonts.bold,
              fontSize: fontSize.md,
              marginTop: spacing.base,
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.regular,
              fontSize: fontSize.sm,
              lineHeight: 20,
              marginTop: 6,
            }}
          >
            {message}
          </Text>

          <View style={[styles.actions, { marginTop: spacing.lg }]}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              style={({ pressed }) => [
                styles.btn,
                {
                  backgroundColor: pressed ? colors.border : colors.surfaceAlt,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Text style={{ color: colors.muted, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                {cancelLabel}
              </Text>
            </Pressable>

            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: pressed ? withAlpha(accent, 0.85) : accent, borderRadius: radii.md },
              ]}
            >
              <Text style={{ color: onColor(accent), fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  dialog: { width: '100%', maxWidth: 380, borderWidth: 1 },
  icon: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' },
});
