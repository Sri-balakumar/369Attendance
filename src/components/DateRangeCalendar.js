import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { radii } from '../theme/tokens';
import { todayKey, parseDateKey } from '../utils/time';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ROWS = 6;

/**
 * A month-grid range picker. A pure VIEW -- no Modal, no sheet chrome, so the
 * caller decides how to present it.
 *
 * Everything here is deliberately timezone-proof. The visible month is held as
 * two integers rather than a Date, and every cell key is built from local
 * getters via todayKey(), never toISOString().slice(0, 10) -- which converts to
 * UTC first and so lands on the wrong calendar day for half the world.
 *
 * Selection is two taps in one grid rather than two separate single-date
 * pickers: a single picker lets someone choose an end before a start and then
 * scolds them for it, when the UI could simply have made it impossible.
 *
 *   tap 1              -> from = day, to = null
 *   tap 2, day >= from -> to = day
 *   tap 2, day <  from -> restart at day
 *   tap on a complete range -> restart at day
 */
export default function DateRangeCalendar({
  from,
  to,
  onChange,
  minDate,
  maxDate,
  initialMonth,
  style,
}) {
  const { colors, fonts, fontSize, spacing, withAlpha, onColor } = useTheme();

  const [cursor, setCursor] = useState(() => {
    const d = parseDateKey(from || initialMonth) || new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const today = todayKey();

  // Date keys are 'YYYY-MM-DD', which compares correctly with < and > as plain
  // strings. No comparator helper is needed here or anywhere else.
  const cells = useMemo(() => {
    const { year, month } = cursor;
    const lead = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const out = [];
    for (let i = 0; i < ROWS * 7; i += 1) {
      const day = i - lead + 1;
      out.push(day >= 1 && day <= days ? todayKey(new Date(year, month, day)) : null);
    }
    return out;
  }, [cursor]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  });

  const step = (delta) =>
    setCursor(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const onTapDay = (key) => {
    if (!from || to || key < from) onChange?.({ from: key, to: null });
    else onChange?.({ from, to: key });
  };

  const disabledKey = (key) => (minDate && key < minDate) || (maxDate && key > maxDate);

  // Disable the arrow only when the whole adjacent month is out of bounds.
  const prevBlocked =
    minDate && todayKey(new Date(cursor.year, cursor.month, 0)) < minDate;
  const nextBlocked =
    maxDate && todayKey(new Date(cursor.year, cursor.month + 1, 1)) > maxDate;

  return (
    <View style={style}>
      <View style={styles.navRow}>
        <NavButton icon="chevron-back" onPress={() => step(-1)} disabled={prevBlocked} label="Previous month" />
        <Text style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
          {monthLabel}
        </Text>
        <NavButton icon="chevron-forward" onPress={() => step(1)} disabled={nextBlocked} label="Next month" />
      </View>

      <View style={[styles.weekRow, { marginTop: spacing.md }]}>
        {WEEKDAYS.map((d, i) => (
          <View key={i} style={styles.cell}>
            <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs }}>
              {d}
            </Text>
          </View>
        ))}
      </View>

      {/* Always six rows, padded with blanks. Real months need four, five or
          six, and letting the grid change height as you page reads as a
          rendering glitch rather than as a shorter month. */}
      <View style={styles.grid}>
        {cells.map((key, i) => {
          if (!key) return <View key={i} style={styles.cell} />;

          const isFrom = key === from;
          const isTo = to && key === to;
          const isEnd = isFrom || isTo;
          const inRange = from && to && key > from && key < to;
          const isToday = key === today;
          const blocked = disabledKey(key);

          return (
            <Pressable
              key={i}
              onPress={() => onTapDay(key)}
              disabled={blocked}
              accessibilityRole="button"
              accessibilityState={{ selected: Boolean(isEnd), disabled: Boolean(blocked) }}
              style={styles.cell}
            >
              {/* The band sits behind the label and fills the whole cell so
                  consecutive days butt together with no seam. */}
              {inRange ? (
                <View style={[styles.band, { backgroundColor: withAlpha(colors.primary, 0.12) }]} />
              ) : null}

              <View
                style={[
                  styles.pill,
                  isEnd ? { backgroundColor: colors.primary } : null,
                  !isEnd && isToday
                    ? { borderWidth: 1, borderColor: withAlpha(colors.primary, 0.55) }
                    : null,
                ]}
              >
                <Text
                  style={{
                    color: blocked
                      ? withAlpha(colors.muted, 0.45)
                      : isEnd
                        ? onColor(colors.primary)
                        : colors.text,
                    fontFamily: isEnd || isToday ? fonts.semibold : fonts.regular,
                    fontSize: fontSize.sm,
                  }}
                >
                  {Number(key.slice(8, 10))}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function NavButton({ icon, onPress, disabled, label }) {
  const { colors, withAlpha } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.navBtn,
        {
          backgroundColor: withAlpha(colors.muted, pressed ? 0.18 : 0.09),
          opacity: disabled ? 0.35 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
    </Pressable>
  );
}

/**
 * Module scope may hold layout primitives and `radii` imported straight from
 * the tokens file -- and nothing else. Colours, fonts and font sizes come from
 * useTheme() at the usage site, because a theme value referenced here would be
 * a module-scope ReferenceError that `expo export` compiles happily and that
 * only crashes at launch. That has shipped twice.
 *
 * The 100/7 percentage width avoids onLayout measurement entirely, so the grid
 * is correct on first paint with no reflow flash.
 */
const styles = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRow: { flexDirection: 'row' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  band: { ...StyleSheet.absoluteFillObject },
  pill: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
