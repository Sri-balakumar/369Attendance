import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import AppTextInput from './AppTextInput';

/**
 * ConfirmDialog with one text field.
 *
 * Rejecting a leave or WFH request wants a reason, and the reason is the only
 * thing the requester ever sees about the decision. ConfirmDialog has nowhere
 * to type, so this sits beside it rather than growing that component a second
 * shape; everything else -- modal mechanics, sizing, button treatment -- is
 * deliberately identical so the two read as one control.
 */
export default function PromptDialog({
  visible,
  title,
  message,
  label = 'Reason',
  placeholder,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  icon = 'create-outline',
  required = false,
  loading = false,
  onConfirm,
  onCancel,
}) {
  const { colors, radii, fonts, fontSize, spacing, shadows, withAlpha, onColor } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  const accent = colors[tone] || colors.danger;
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 200 : 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  // A reason left over from the last rejection would silently be attached to
  // the next one, which is the sort of mistake nobody catches until it is on
  // an employee's screen.
  useEffect(() => {
    if (!visible) {
      setValue('');
      setError('');
    }
  }, [visible]);

  const submit = () => {
    if (required && !value.trim()) {
      setError('Give a reason — the employee sees this.');
      return;
    }
    onConfirm(value.trim());
  };

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
          <View style={[styles.icon, { backgroundColor: withAlpha(accent, 0.13), borderRadius: radii.md }]}>
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
          {message ? (
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
          ) : null}

          <AppTextInput
            label={label}
            value={value}
            onChangeText={(v) => {
              setValue(v);
              if (error) setError('');
            }}
            placeholder={placeholder}
            error={error}
            multiline
            numberOfLines={3}
            style={{ marginTop: spacing.base }}
          />

          <View style={[styles.actions, { marginTop: spacing.lg }]}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: pressed ? colors.border : colors.surfaceAlt, borderRadius: radii.md },
              ]}
            >
              <Text style={{ color: colors.muted, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                {cancelLabel}
              </Text>
            </Pressable>

            <Pressable
              onPress={loading ? undefined : submit}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              style={({ pressed }) => [
                styles.btn,
                {
                  backgroundColor: pressed ? withAlpha(accent, 0.85) : accent,
                  borderRadius: radii.md,
                  opacity: loading ? 0.6 : 1,
                },
              ]}
            >
              <Text style={{ color: onColor(accent), fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                {loading ? 'Working…' : confirmLabel}
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
