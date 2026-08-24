import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

/** Filled when focused, outline when not -- the icon carries half the state. */
const ICONS = {
  Home: ['home', 'home-outline'],
  Config: ['options', 'options-outline'],
  Profile: ['person', 'person-outline'],
};
const LABELS = { Home: 'Home', Config: 'Config', Profile: 'Profile' };

/** Visual height of the pill. Screens need it to know what to scroll clear of. */
export const BAR_HEIGHT = 62;
const GAP = 14;

/** Zero inset still gets a lift, so the pill never sits flush to the edge. */
const liftFor = (insetBottom) => (insetBottom > 0 ? insetBottom : 10);

/**
 * Bottom padding a tab screen must reserve.
 *
 * The bar is absolutely positioned and OVERLAYS content rather than taking a
 * row in the layout, so nothing reserves this automatically -- a ScrollView
 * that ends at insets.bottom puts its last row underneath the pill.
 */
export function useTabBarLift() {
  const insets = useSafeAreaInsets();
  return liftFor(insets.bottom) + BAR_HEIGHT + GAP;
}

/**
 * A content-width floating tab bar: the amber ring wraps tightly around the
 * items rather than stretching, centred and lifted off the bottom. Dropping a
 * tab (Config, for non-admins) shrinks the pill and it stays centred.
 *
 * The active item is a SOLID amber fill with dark ink, not amber-tinted text.
 * Amber on white is about 2:1 -- the exact trap readableOn() exists to catch --
 * and a solid amber fill is already this app's "you are here / this is the
 * action" treatment everywhere else.
 */
export default function BottomTabBar({ state, navigation }) {
  const { colors, fonts, fontSize, radii, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  const activeKey = state.routes[state.index]?.key;

  return (
    <View style={[styles.wrap, { bottom: liftFor(insets.bottom) }]} pointerEvents="box-none">
      <LinearGradient
        colors={[colors.primaryAlt, colors.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.ring, shadows.float]}
      >
        <View style={[styles.bar, { backgroundColor: colors.surface }]}>
          {state.routes.map((route) => {
            const focused = route.key === activeKey;
            const [on, off] = ICONS[route.name] || ['ellipse', 'ellipse-outline'];
            const tint = focused ? colors.onPrimary : colors.muted;
            const label = LABELS[route.name] || route.name;

            // Emit first so any tabPress listener can still preventDefault.
            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            };

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                hitSlop={6}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={label}
                style={({ pressed }) => [
                  styles.item,
                  {
                    borderRadius: radii.pill,
                    backgroundColor: focused ? colors.primary : 'transparent',
                    opacity: pressed && !focused ? 0.6 : 1,
                  },
                ]}
              >
                <Ionicons name={focused ? on : off} size={22} color={tint} />
                <Text style={{ color: tint, fontFamily: fonts.bold, fontSize: fontSize.xs }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  ring: { borderRadius: 30, padding: 2 },
  bar: { flexDirection: 'row', borderRadius: 28, paddingHorizontal: 6, paddingVertical: 8 },
  item: { alignItems: 'center', gap: 3, paddingHorizontal: 18, paddingVertical: 4 },
});
