import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { radii } from '../theme/tokens';
import * as haptics from '../utils/haptics';
import { todayKey, parseDateKey } from '../utils/time';

// Sunday first, the same row rule as DatePopup, so the two calendars in the
// app line up week for week.
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * One month as an inline grid -- the Calendar tab's, not a picker.
 *
 *   isOff(key)   true on a weekly off (Sundays, a 2nd Saturday ...)
 *   holidays     { 'YYYY-MM-DD': 'Holiday name' }
 *   selected     the day whose details the screen is showing
 *
 * Holidays read in accent with a dot under the number, weekly offs are muted
 * on a tinted cell, and today keeps the amber ring every calendar here uses.
 * Cells are a seventh of the width, capped so a tablet does not get
 * saucer-sized days.
 */
export default function MonthGrid({ year, month, isOff = () => false, holidays = {}, selected, onSelect }) {
  const { colors, fonts, fontSize, withAlpha } = useTheme();
  const today = todayKey();

  const cells = useMemo(() => {
    const lead = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const out = [];
    const total = Math.ceil((lead + days) / 7) * 7;
    for (let i = 0; i < total; i += 1) {
      const day = i - lead + 1;
      out.push(day >= 1 && day <= days ? todayKey(new Date(year, month, day)) : null);
    }
    return out;
  }, [year, month]);

  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {WEEKDAYS.map((w, i) => (
          <View key={`w${i}`} style={styles.head}>
            <Text style={{ color: colors.muted, fontFamily: fonts.semibold, fontSize: fontSize.xxs }}>{w}</Text>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((key, i) => {
          if (!key) return <View key={`e${i}`} style={styles.cell} />;
          const d = parseDateKey(key);
          const holiday = holidays[key];
          const off = !holiday && isOff(key);
          const isSelected = key === selected;
          const isToday = key === today;

          let color = colors.text;
          if (isSelected) color = colors.onPrimary;
          else if (holiday) color = colors.accent;
          else if (off) color = colors.muted;

          let fill = 'transparent';
          if (isSelected) fill = colors.primary;
          else if (holiday) fill = withAlpha(colors.accent, 0.12);
          else if (off) fill = colors.surfaceAlt;

          return (
            <Pressable
              key={key}
              onPress={() => {
                haptics.tick();
                onSelect?.(key);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${d.toDateString()}${holiday ? `, ${holiday}` : off ? ', weekly off' : ''}`}
              style={styles.cell}
            >
              <View
                style={[
                  styles.inner,
                  {
                    backgroundColor: fill,
                    borderWidth: isToday && !isSelected ? 1.5 : 0,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <Text
                  style={{
                    color,
                    fontFamily: isSelected || holiday ? fonts.bold : fonts.medium,
                    fontSize: fontSize.sm,
                  }}
                >
                  {d.getDate()}
                </Text>
                {holiday ? (
                  <View
                    style={[styles.dot, { backgroundColor: isSelected ? colors.onPrimary : colors.accent }]}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  head: { width: `${100 / 7}%`, height: 28, alignItems: 'center', justifyContent: 'center' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 3 },
  inner: { flex: 1, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
});
