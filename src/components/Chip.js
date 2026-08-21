import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

/** Small pill. `tone` names a colour on the palette (success/warning/...). */
export default function Chip({ label, tone = 'primary', icon, style, size = 'md' }) {
  const { colors, radii, fonts, fontSize, withAlpha } = useTheme();
  const color = colors[tone] || colors.primary;
  const small = size === 'sm';
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 5,
          backgroundColor: withAlpha(color, colors.mode === 'dark' ? 0.22 : 0.12),
          paddingHorizontal: small ? 8 : 11,
          paddingVertical: small ? 3 : 5,
          borderRadius: radii.pill,
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={small ? 11 : 13} color={color} /> : null}
      <Text
        style={{
          color,
          fontFamily: fonts.semibold,
          fontSize: small ? fontSize.xs : fontSize.xxs,
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
