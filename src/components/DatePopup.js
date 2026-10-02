import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import * as haptics from '../utils/haptics';
import { todayKey, parseDateKey, formatDateRange } from '../utils/time';

// Sunday first, the same row rule as ExpenseApp's calendar: each row runs
// Sunday to Saturday, so the weekly off (Sunday here) opens every row.
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const CELL = 38;

/**
 * A small centred calendar popup -- the whole picker in one card over a dim
 * backdrop, instead of a calendar that takes over the screen or the sheet.
 *
 *   mode 'single'  one tap picks the day
 *   mode 'range'   tap a start, tap an end (an earlier second tap restarts)
 *
 * Nothing is committed until the confirm button, so Cancel really cancels.
 * Weekly offs and public holidays can be marked (`weeklyOff`, `holidays`) so
 * nobody books leave on a day they already have off.
 *
 * Opens with a short scale-and-fade; changing month slides the grid in the
 * direction of travel.
 */
export default function DatePopup({
  visible,
  mode = 'single',
  title,
  from,
  to,
  minDate,
  maxDate,
  weeklyOff = [],        // JS getDay() numbers: 0 = Sunday .. 6 = Saturday
  holidays = {},         // { 'YYYY-MM-DD': 'Holiday name' }
  confirmLabel,
  onConfirm,
  onCancel,
}) {
  const { colors, fonts, fontSize, radii, spacing, shadows, withAlpha } = useTheme();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 32, 7 * CELL + 2 * 16 + 12);

  const [draft, setDraft] = useState({ from: from || null, to: to || null });
  const [cursor, setCursor] = useState(() => monthOf(from));
  const appear = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current;

  // Re-seed from the field every time the popup opens, so a cancelled edit
  // does not linger into the next open.
  useEffect(() => {
    if (!visible) return;
    setDraft({ from: from || null, to: to || null });
    setCursor(monthOf(from));
    appear.setValue(0);
    Animated.spring(appear, {
      toValue: 1,
      damping: 18,
      stiffness: 220,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayKey();

  const cells = useMemo(() => {
    const { year, month } = cursor;
    // getDay(): 0 = Sunday, which is column 0, so the 1st's weekday is the
    // number of blanks before it. Blanks after only finish the last week.
    const lead = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const out = [];
    const total = Math.ceil((lead + days) / 7) * 7;
    for (let i = 0; i < total; i += 1) {
      const day = i - lead + 1;
      out.push(day >= 1 && day <= days ? todayKey(new Date(year, month, day)) : null);
    }
    return out;
  }, [cursor]);

  const shiftMonth = (delta) => {
    slide.setValue(delta * 24);
    setCursor(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
    Animated.timing(slide, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const pick = (key) => {
    haptics.tick();
    if (mode === 'single') {
      setDraft({ from: key, to: null });
      return;
    }
    setDraft((d) => {
      if (!d.from || d.to || key < d.from) return { from: key, to: null };
      return { from: d.from, to: key };
    });
  };

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  });

  const label = draft.from
    ? confirmLabel || `Use ${formatDateRange(draft.from, draft.to)}`
    : 'Pick a date';

  const hasMarkers = weeklyOff.length > 0 || Object.keys(holidays).length > 0;
  const holidayNameInView = cells.map((k) => (k && holidays[k]) || null).find(Boolean);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Close date picker" />
        <Animated.View
          accessibilityViewIsModal
          style={[
            {
              width: cardWidth,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radii.lg,
              padding: 16,
              opacity: appear,
              transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
            },
            shadows.raised,
          ]}
        >
          {title ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs, marginBottom: 8 }}>
              {title}
            </Text>
          ) : null}

          <View style={styles.navRow}>
            <NavButton icon="chevron-back" label="Previous month" onPress={() => shiftMonth(-1)} />
            <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.base }}>{monthLabel}</Text>
            <NavButton icon="chevron-forward" label="Next month" onPress={() => shiftMonth(1)} />
          </View>

          <View style={[styles.grid, { marginTop: 10 }]}>
            {WEEKDAYS.map((w, i) => (
              <View key={`w${i}`} style={styles.cell}>
                <Text style={{ color: colors.muted, fontFamily: fonts.semibold, fontSize: fontSize.xxs }}>{w}</Text>
              </View>
            ))}
          </View>

          <Animated.View style={[styles.grid, { transform: [{ translateX: slide }] }]}>
            {cells.map((key, i) => {
              if (!key) return <View key={`e${i}`} style={styles.cell} />;
              const d = parseDateKey(key);
              const disabled = (minDate && key < minDate) || (maxDate && key > maxDate);
              const isFrom = key === draft.from;
              const isTo = key === draft.to;
              const inRange = draft.from && draft.to && key > draft.from && key < draft.to;
              const isHoliday = Boolean(holidays[key]);
              const isOff = weeklyOff.includes(d.getDay());
              const selected = isFrom || isTo;

              let color = colors.text;
              if (disabled) color = colors.faint;
              else if (selected) color = colors.onPrimary;
              else if (isHoliday) color = colors.accent;
              else if (isOff) color = colors.muted;

              return (
                <Pressable
                  key={key}
                  disabled={Boolean(disabled)}
                  onPress={() => pick(key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: Boolean(disabled) }}
                  accessibilityLabel={`${d.toDateString()}${isHoliday ? `, ${holidays[key]}` : isOff ? ', weekly off' : ''}`}
                  style={styles.cell}
                >
                  {inRange ? (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(colors.primary, 0.16), marginVertical: 4 }]} />
                  ) : null}
                  <View
                    style={[
                      styles.dayInner,
                      {
                        borderRadius: radii.sm + 2,
                        backgroundColor: selected ? colors.primary : 'transparent',
                        borderWidth: key === today && !selected ? 1 : 0,
                        borderColor: colors.primary,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color,
                        fontFamily: selected || isHoliday ? fonts.bold : fonts.medium,
                        fontSize: fontSize.sm,
                        textDecorationLine: disabled ? 'line-through' : 'none',
                      }}
                    >
                      {d.getDate()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Animated.View>

          {hasMarkers ? (
            <View style={[styles.legend, { marginTop: 6 }]}>
              <Legend color={colors.accent} label={holidayNameInView ? `Holiday: ${holidayNameInView}` : 'Holiday'} />
              <Legend color={colors.faint} label="Weekly off" />
            </View>
          ) : null}

          <View style={[styles.footer, { marginTop: spacing.md }]}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.footBtn,
                { borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={!draft.from}
              onPress={() => onConfirm?.({ from: draft.from, to: mode === 'range' ? draft.to : null })}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.footBtn,
                {
                  flex: 1.4,
                  backgroundColor: draft.from ? colors.primary : colors.surfaceAlt,
                  borderRadius: radii.md,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                style={{ color: draft.from ? colors.onPrimary : colors.muted, fontFamily: fonts.bold, fontSize: fontSize.sm }}
              >
                {label}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function monthOf(key) {
  const d = parseDateKey(key) || new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}

function NavButton({ icon, label, onPress }) {
  const { colors, radii } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.navBtn,
        { borderColor: colors.border, borderRadius: radii.sm + 2, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' },
      ]}
    >
      <Ionicons name={icon} size={16} color={colors.text} />
    </Pressable>
  );
}

function Legend({ color, label }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
      <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xxs }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 32, height: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 7 * CELL, alignSelf: 'center' },
  cell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
  dayInner: { width: CELL - 4, height: CELL - 4, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  footer: { flexDirection: 'row', gap: 8 },
  footBtn: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
});
