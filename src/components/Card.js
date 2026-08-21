import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme';

export default function Card({ children, style, elevation = 'card', padded = true }) {
  const { colors, radii, spacing, shadows } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: padded ? spacing.lg : 0,
        },
        shadows[elevation],
        style,
      ]}
    >
      {children}
    </View>
  );
}
