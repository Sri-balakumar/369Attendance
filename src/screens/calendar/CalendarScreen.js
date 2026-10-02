import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, MonthGrid, Skeleton, useTabBarLift } from '../../components';
import { fetchHolidayCalendar } from '../../services/odoo';
import { todayKey, parseDateKey } from '../../utils/time';
import { DEFAULT_RULE, isWeeklyOff, weeklyOffLabel } from '../../utils/workDays';
import { MonthNav } from '../config/AdminScreen';

const pad = (n) => String(n).padStart(2, '0');

/**
 * Calendar -- a tab for everybody: the month's public holidays and weekly
 * offs, including the some-weeks-off ones like a 2nd Saturday.
 *
 * Everyone sees the same company calendar; the weekly offs are the ones that
 * apply to the viewer (their department's rules when it has its own). Admin
 * and HR -- whoever the server lets write hr.public.holiday -- also get Add
 * and Edit here, which is how an HR user without the admin's Config tab
 * reaches holidays at all.
 *
 * A holiday notification opens this tab on the holiday's month
 * (params.month = 'YYYY-MM').
 */
export default function CalendarScreen({ navigation, route }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const lift = useTabBarLift();

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selected, setSelected] = useState(todayKey());
  const [years, setYears] = useState({});
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadYear = useCallback(async (year, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await fetchHolidayCalendar(year);
      setYears((prev) => ({ ...prev, [year]: data }));
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the calendar.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  // On focus, and whenever paging crosses into another year: a holiday added
  // on the form shows here on the way back.
  useFocusEffect(
    useCallback(() => {
      loadYear(cursor.year);
    }, [loadYear, cursor.year])
  );

  // Opened from a holiday notification: jump to that month, then clear the
  // param so a later visit to the tab starts where the user left it.
  const target = route?.params?.month;
  useEffect(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(target || '');
    if (!m) return;
    setCursor({ year: Number(m[1]), month: Number(m[2]) - 1 });
    setSelected(null);
    navigation.setParams({ month: undefined });
  }, [target, navigation]);

  const shiftMonth = (delta) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
    const today = todayKey();
    const inView = today.startsWith(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
    setSelected(inView ? today : null);
  };

  const data = years[cursor.year];
  const rule = data?.rule || DEFAULT_RULE;
  const canEdit = Boolean(data?.canEdit);
  const prefix = `${cursor.year}-${pad(cursor.month + 1)}`;

  const holidayMap = useMemo(() => {
    const out = {};
    (data?.holidays || []).forEach((h) => {
      out[String(h.date).slice(0, 10)] = h.name || 'Holiday';
    });
    return out;
  }, [data]);

  const monthHolidays = useMemo(
    () => (data?.holidays || []).filter((h) => String(h.date).startsWith(prefix)),
    [data, prefix]
  );

  // The month in three numbers. A holiday on a day that is off anyway counts
  // once, as the holiday, and takes nothing more off the working days.
  const counts = useMemo(() => {
    const days = new Date(cursor.year, cursor.month + 1, 0).getDate();
    let off = 0;
    let holidays = 0;
    for (let day = 1; day <= days; day += 1) {
      const key = `${prefix}-${pad(day)}`;
      if (holidayMap[key]) holidays += 1;
      else if (isWeeklyOff(key, rule)) off += 1;
    }
    return { working: days - off - holidays, off, holidays };
  }, [cursor, prefix, holidayMap, rule]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  });
  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleDateString([], { month: 'long' });

  const openHoliday = (h) => navigation.navigate('HolidayForm', { id: h.id, year: cursor.year });
  const addHoliday = (date) =>
    navigation.navigate('HolidayForm', {
      id: null,
      year: cursor.year,
      date: date && date.startsWith(prefix) ? date : `${prefix}-01`,
    });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />

      <LinearGradient
        colors={colors.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + spacing.base }]}
      >
        <View style={styles.headerRow}>
          <View
            style={[
              styles.headerIcon,
              { backgroundColor: withAlpha(colors.onHeader, 0.16), borderColor: withAlpha(colors.onHeader, 0.22) },
            ]}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.onHeader} />
          </View>
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={{ color: colors.onHeader, fontFamily: fonts.bold, fontSize: fontSize.lg }}>Calendar</Text>
            <Text
              numberOfLines={1}
              style={{ color: withAlpha(colors.onHeader, 0.8), fontFamily: fonts.regular, fontSize: fontSize.sm }}
            >
              {data?.weekOffSummary ? `Holidays · ${data.weekOffSummary}` : 'Holidays and weekly offs'}
            </Text>
          </View>
        </View>
        <MonthNav label={monthLabel} onPrev={() => shiftMonth(-1)} onNext={() => shiftMonth(1)} />
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: lift }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadYear(cursor.year, true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {error && !data ? (
          <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
            <Ionicons name="cloud-offline-outline" size={26} color={colors.muted} />
            <Text
              style={{ color: colors.text, fontFamily: fonts.medium, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.sm }}
            >
              {error}
            </Text>
            <Pressable onPress={() => loadYear(cursor.year)} accessibilityRole="button" hitSlop={8} style={{ marginTop: spacing.md }}>
              <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>Retry</Text>
            </Pressable>
          </Card>
        ) : (
          <Card style={{ paddingHorizontal: spacing.md }}>
            {data ? (
              <MonthGrid
                year={cursor.year}
                month={cursor.month}
                isOff={(key) => isWeeklyOff(key, rule)}
                holidays={holidayMap}
                selected={selected}
                onSelect={setSelected}
              />
            ) : (
              <Skeleton height={300} radius={radii.md} />
            )}
            <View style={[styles.legend, { marginTop: spacing.md }]}>
              <Legend color={colors.accent} label="Holiday" />
              <Legend color={colors.muted} fill={colors.surfaceAlt} label="Weekly off" />
              <Legend ring={colors.primary} label="Today" />
            </View>
          </Card>
        )}

        {data ? (
          <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs, marginTop: spacing.md, textAlign: 'center' }}>
            {counts.working} working {counts.working === 1 ? 'day' : 'days'} · {counts.off} weekly{' '}
            {counts.off === 1 ? 'off' : 'offs'} · {counts.holidays} {counts.holidays === 1 ? 'holiday' : 'holidays'}
          </Text>
        ) : null}

        {data && selected && selected.startsWith(prefix) ? (
          <SelectedDay
            dateKey={selected}
            holiday={monthHolidays.find((h) => String(h.date).startsWith(selected))}
            offLabel={weeklyOffLabel(selected, rule)}
            canEdit={canEdit}
            onEdit={openHoliday}
            onAdd={() => addHoliday(selected)}
          />
        ) : null}

        {data ? (
          <View style={{ marginTop: spacing.lg }}>
            <SectionTitle>{`Holidays in ${monthName}`}</SectionTitle>
            {monthHolidays.length ? (
              monthHolidays.map((h, i) => (
                <HolidayRow
                  key={h.id}
                  holiday={h}
                  style={{ marginTop: i === 0 ? 0 : spacing.sm }}
                  onPress={() => (canEdit ? openHoliday(h) : setSelected(String(h.date).slice(0, 10)))}
                  editable={canEdit}
                />
              ))
            ) : (
              <Card style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
                <Ionicons name="flag-outline" size={22} color={colors.faint} />
                <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm, marginTop: 6 }}>
                  No public holidays in {monthName}.
                </Text>
              </Card>
            )}

            {canEdit ? (
              <Pressable
                onPress={() => addHoliday(selected)}
                accessibilityRole="button"
                accessibilityLabel="Add a holiday"
                style={({ pressed }) => [
                  styles.add,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? withAlpha(colors.primary, 0.08) : 'transparent',
                    marginTop: spacing.md,
                  },
                ]}
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
                  Add a holiday
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** The tapped day, in words, with Add or Edit for whoever may. */
function SelectedDay({ dateKey, holiday, offLabel, canEdit, onEdit, onAdd }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const d = parseDateKey(dateKey);
  const tone = holiday ? colors.accent : offLabel ? colors.muted : colors.success;
  const icon = holiday ? 'flag' : offLabel ? 'moon-outline' : 'briefcase-outline';
  const status = holiday ? holiday.name : offLabel ? `Weekly off · ${offLabel}` : 'Working day';

  let action = null;
  if (canEdit && holiday) action = { label: 'Edit', onPress: () => onEdit(holiday) };
  else if (canEdit) action = { label: 'Make holiday', onPress: onAdd };

  return (
    <Card style={{ marginTop: spacing.md }} padded={false}>
      <View style={[styles.row, { padding: spacing.base }]}>
        <View style={[styles.badge, { backgroundColor: withAlpha(tone, 0.14) }]}>
          <Ionicons name={icon} size={18} color={tone} />
        </View>
        <View style={{ flex: 1, marginLeft: 11 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }} numberOfLines={1}>
            {d ? d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) : dateKey}
          </Text>
          <Text style={{ color: tone, fontFamily: fonts.medium, fontSize: fontSize.xs, marginTop: 2 }} numberOfLines={2}>
            {status}
          </Text>
        </View>
        {action ? (
          <Pressable
            onPress={action.onPress}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [
              styles.action,
              { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' },
            ]}
          >
            <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.xs }}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

/** Same look as a row on Config → Public Holidays. */
function HolidayRow({ holiday, onPress, editable, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const d = parseDateKey(holiday.date);
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: withAlpha(colors.accent, 0.12) }}
      accessibilityRole="button"
      accessibilityLabel={holiday.name}
      style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }, style]}
    >
      <Card padded={false}>
        <View style={[styles.row, { padding: spacing.base }]}>
          <View style={[styles.badge, { backgroundColor: withAlpha(colors.accent, 0.13) }]}>
            <Text style={{ color: colors.accent, fontFamily: fonts.bold, fontSize: fontSize.sm }}>
              {d ? d.getDate() : ''}
            </Text>
            <Text style={{ color: colors.accent, fontFamily: fonts.medium, fontSize: 9 }}>
              {d ? d.toLocaleDateString([], { month: 'short' }).toUpperCase() : ''}
            </Text>
          </View>
          <View style={{ flex: 1, marginLeft: 11 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
              {holiday.name}
            </Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
              {holiday.day_name || ''}
              {holiday.affects_working_days === false ? ' · already a day off' : ''}
            </Text>
          </View>
          {editable ? <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 8 }} /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

function Legend({ color, fill, ring, label }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <View style={styles.legendItem}>
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          backgroundColor: fill || (ring ? 'transparent' : color),
          borderWidth: ring || fill ? 1.5 : 0,
          borderColor: ring || color,
        }}
      />
      <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xxs }}>{label}</Text>
    </View>
  );
}

function SectionTitle({ children }) {
  const { colors, fonts, fontSize, spacing } = useTheme();
  return (
    <Text
      style={{
        color: colors.muted,
        fontFamily: fonts.semibold,
        fontSize: fontSize.xs,
        letterSpacing: 1,
        marginBottom: spacing.sm,
      }}
    >
      {String(children).toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 16, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center' },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginLeft: 8,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
});
