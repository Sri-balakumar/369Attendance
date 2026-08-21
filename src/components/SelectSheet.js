import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, Pressable, FlatList, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

/** Bottom-sheet list picker. Used for the database list on the Server screen. */
export default function SelectSheet({ visible, title, options = [], value, onSelect, onClose }) {
  const { colors, radii, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: visible ? 260 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose} />
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderTopLeftRadius: radii.lg,
            borderTopRightRadius: radii.lg,
            paddingBottom: insets.bottom + spacing.base,
            transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }],
          },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        <View style={[styles.header, { paddingHorizontal: spacing.lg }]}>
          <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.md }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.muted} />
          </Pressable>
        </View>

        <FlatList
          data={options}
          keyExtractor={(item) => String(item)}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
          renderItem={({ item }) => {
            const active = item === value;
            return (
              <Pressable
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
                android_ripple={{ color: withAlpha(colors.primary, 0.1) }}
                style={styles.row}
              >
                <View
                  style={[
                    styles.rowIcon,
                    {
                      backgroundColor: withAlpha(colors.primary, active ? 0.16 : 0.08),
                      borderRadius: radii.sm,
                    },
                  ]}
                >
                  <Ionicons name="server-outline" size={17} color={colors.primary} />
                </View>
                <Text
                  style={{
                    flex: 1,
                    color: colors.text,
                    fontFamily: active ? fonts.semibold : fonts.medium,
                    fontSize: fontSize.base,
                  }}
                >
                  {item}
                </Text>
                {active ? <Ionicons name="checkmark-circle" size={21} color={colors.primary} /> : null}
              </Pressable>
            );
          }}
        />
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '70%' },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  rowIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
