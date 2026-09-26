import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

/**
 * Fades its children up into place once, on mount.
 *
 * `delay` staggers a column of sections so a screen assembles top to bottom
 * instead of popping in all at once. Native-driver opacity and translate only,
 * so it costs nothing on the JS thread after the first frame.
 */
export default function FadeIn({ children, delay = 0, distance = 12, duration = 320, style }) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [v, delay, duration]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
