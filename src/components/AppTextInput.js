import React, { useRef, useState, useEffect, useCallback, forwardRef } from 'react';
import { View, Text, TextInput, Pressable, Animated, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

/**
 * Floating-label input. The label rides up on focus or once there is a value,
 * and the border picks up the brand colour while focused / the danger colour
 * when `error` is set.
 */
const AppTextInput = forwardRef(function AppTextInput(
  { label, value, onChangeText, icon, error, rightSlot, secure, style, onPress, ...rest },
  ref
) {
  const { colors, radii, fonts, fontSize, spacing, withAlpha } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(Boolean(secure));
  const float = useRef(new Animated.Value(value ? 1 : 0)).current;

  // Kept alongside any forwarded ref so tapping the field can focus the input.
  const innerRef = useRef(null);
  const attachRef = useCallback(
    (node) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref]
  );
  const focusInput = useCallback(() => innerRef.current?.focus(), []);

  const lifted = focused || Boolean(value);

  useEffect(() => {
    Animated.timing(float, {
      toValue: lifted ? 1 : 0,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }, [lifted, float]);

  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;

  return (
    <View style={style}>
      <Pressable
        // Defaults to focusing the input. A read-only field that opens a picker
        // instead passes its own onPress -- editable={false} TextInputs do not
        // reliably fire press events of their own on iOS.
        onPress={onPress || focusInput}
        accessible={false}
        style={[
          styles.field,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor,
            borderRadius: radii.md,
            paddingHorizontal: spacing.base,
            // Focus ring, drawn as a soft outer glow rather than a hard 2px jump.
            ...(focused && !error
              ? { shadowColor: colors.primary, shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } }
              : null),
          },
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={19}
            color={error ? colors.danger : focused ? colors.primary : colors.faint}
            style={{ marginRight: spacing.md }}
          />
        ) : null}

        <View style={styles.inputWrap}>
          <Animated.Text
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              // Belt and braces: the prop is not reliably honoured on Text on
              // Android, and this label overlaps the input it labels.
              pointerEvents: 'none',
              fontFamily: fonts.medium,
              color: error ? colors.danger : focused ? colors.primary : colors.muted,
              fontSize: float.interpolate({ inputRange: [0, 1], outputRange: [fontSize.base, 11] }),
              top: float.interpolate({ inputRange: [0, 1], outputRange: [17, 6] }),
            }}
          >
            {label}
          </Animated.Text>
          <TextInput
            ref={attachRef}
            value={value}
            onChangeText={onChangeText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            secureTextEntry={hidden}
            placeholderTextColor={colors.faint}
            selectionColor={colors.primary}
            style={{
              width: '100%',
              color: colors.text,
              fontFamily: fonts.medium,
              fontSize: fontSize.base,
              paddingTop: 22,
              paddingBottom: 8,
              // Android draws its own vertical padding on TextInput.
              paddingHorizontal: 0,
              // The field already draws its own focus ring; the browser's default
              // outline sits on top of it in the web build.
              ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
            }}
            {...rest}
          />
        </View>

        {secure ? (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10}>
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.muted} />
          </Pressable>
        ) : (
          rightSlot
        )}
      </Pressable>

      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={13} color={colors.danger} />
          <Text style={{ color: colors.danger, fontFamily: fonts.medium, fontSize: fontSize.xxs, marginLeft: 5 }}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    minHeight: 62,
  },
  inputWrap: { flex: 1, justifyContent: 'center' },
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginLeft: 4 },
});

export default AppTextInput;
