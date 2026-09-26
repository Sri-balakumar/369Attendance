import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { formatDateKeyShort, todayKey } from '../utils/time';
import AppTextInput from './AppTextInput';
import DateRangeCalendar from './DateRangeCalendar';

/**
 * A single-date field: shows the date as "25 Sep 2026", opens a calendar sheet
 * on tap, hands back a 'YYYY-MM-DD' key. Nobody types a date.
 *
 * Wraps DateRangeCalendar rather than a second grid: passing from = to = value
 * puts the picker in its "complete range" state, where the next tap restarts
 * the range at that day -- which is exactly a single pick. Same sheet chrome as
 * SelectSheet, so a date and a list feel like the same control.
 */
export default function DateField({
  label,
  value,
  onChange,
  icon = 'calendar-outline',
  error,
  minDate,
  maxDate,
  disabled,
  style,
}) {
  const { colors, radii, fonts, fontSize, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 1 : 0,
      duration: open ? 260 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, slide]);

  const close = () => setOpen(false);

  return (
    <>
      <AppTextInput
        label={label}
        value={value ? formatDateKeyShort(value) : ''}
        icon={icon}
        error={error}
        editable={false}
        onPress={disabled ? undefined : () => setOpen(true)}
        rightSlot={<Ionicons name="chevron-down" size={17} color={colors.muted} />}
        style={style}
      />

      <Modal visible={open} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={close} />
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
            <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.md }}>{label}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
              <Pressable
                onPress={() => {
                  onChange(todayKey());
                  close();
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Today"
              >
                <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                  Today
                </Text>
              </Pressable>
              <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
          </View>
          <DateRangeCalendar
            from={value || null}
            to={value || null}
            minDate={minDate}
            maxDate={maxDate}
            onChange={({ from }) => {
              onChange(from);
              close();
            }}
            style={{ paddingHorizontal: spacing.lg }}
          />
        </Animated.View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
});
