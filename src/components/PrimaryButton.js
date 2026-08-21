import React, { useRef } from 'react';
import { Pressable, Text, ActivityIndicator, Animated, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

/**
 * Gradient call-to-action. Press scales it very slightly — enough to feel
 * responsive on a phone without looking animated on a screenshot.
 */
export default function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  icon,
  variant = 'gradient', // 'gradient' | 'solid' | 'outline' | 'ghost'
  tone,
  style,
  textStyle,
}) {
  const { colors, radii, fonts, fontSize, shadows, withAlpha, onColor } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const inert = disabled || loading;
  const accent = tone ? colors[tone] || colors.primary : colors.primary;
  // `gradient` fills with the slate header ramp, so its label is white.
  // `solid` fills with the tone -- amber by default, red for danger -- so
  // its label is whatever is readable on that fill, not a fixed colour.

  const spring = (to) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 4 }).start();

  const content = (
    <>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'gradient' ? colors.onHeader : variant === 'solid' ? onColor(accent) : accent}
        />
      ) : (
        <>
          {icon ? (
            <Ionicons
              name={icon}
              size={18}
              color={variant === 'gradient' ? colors.onHeader : variant === 'solid' ? onColor(accent) : accent}
              style={{ marginRight: 8 }}
            />
          ) : null}
          <Text
            style={[
              {
                color: variant === 'gradient' ? colors.onHeader : variant === 'solid' ? onColor(accent) : accent,
                fontFamily: fonts.semibold,
                fontSize: fontSize.base,
                letterSpacing: 0.3,
              },
              textStyle,
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </>
  );

  const inner = {
    height: 54,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  };

  return (
    <Animated.View style={[{ transform: [{ scale }], opacity: disabled ? 0.5 : 1 }, style]}>
      <Pressable
        onPress={inert ? undefined : onPress}
        onPressIn={() => !inert && spring(0.97)}
        onPressOut={() => spring(1)}
        disabled={inert}
        android_ripple={
          variant === 'gradient' ? null : { color: withAlpha(accent, 0.15), borderless: false }
        }
      >
        {variant === 'gradient' ? (
          <LinearGradient
            colors={disabled ? [colors.faint, colors.muted] : colors.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[inner, disabled ? null : shadows.float]}
          >
            {content}
          </LinearGradient>
        ) : (
          <View
            style={[
              inner,
              variant === 'solid' && { backgroundColor: accent },
              variant === 'outline' && {
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                borderColor: withAlpha(accent, 0.4),
              },
              variant === 'ghost' && { backgroundColor: withAlpha(accent, 0.1) },
            ]}
          >
            {content}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
