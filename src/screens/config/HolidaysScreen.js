import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip } from '../../components';
import { fetchPublicHolidays } from '../../services/odoo';
import { formatDateKeyShort } from '../../utils/time';
import AdminScreen from './AdminScreen';
import { GUIDES } from './guides';

/**
 * Public holidays for a year.
 *
 * Not a neutral list: holidays are excluded from the working-day count that
 * divides the monthly wage, so every row here raises everybody's daily rate --
 * which is exactly what makes the day paid.
 */
export default function HolidaysScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        setRows(await fetchPublicHolidays(year));
        setError('');
      } catch (e) {
        setError(e?.message || 'Could not load the public holidays.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [year]
  );

  // On focus, so a holiday added or deleted on the form shows up on return.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <AdminScreen guide={GUIDES.holidays}
      navigation={navigation}
      title="Public Holidays"
      subtitle="Excluded from working days"
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0}
      keepChildrenWhenEmpty
      emptyTitle={`No holidays in ${year}`}
      emptyMessage="Adding one raises everybody's daily rate for that month, because it leaves the working-day count. Nobody is ever marked Absent on a holiday."
      emptyIcon="flag-outline"
      headerExtra={
        <View style={styles.yearRow}>
          <YearBtn dir="back" onPress={() => setYear((y) => y - 1)} />
          <Text
            style={{
              flex: 1,
              textAlign: 'center',
              color: colors.onHeader,
              fontFamily: fonts.semibold,
              fontSize: fontSize.base,
            }}
          >
            {year}
          </Text>
          <YearBtn dir="fwd" onPress={() => setYear((y) => y + 1)} />
        </View>
      }
    >
      {rows.map((h, i) => (
        <Pressable
          key={h.id}
          onPress={() => navigation.navigate('HolidayForm', { id: h.id, year })}
          android_ripple={{ color: withAlpha(colors.success, 0.12) }}
          accessibilityRole="button"
          accessibilityLabel={h.name}
          style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: i === 0 ? 0 : spacing.sm }]}
        >
          <Card padded={false}>
            <View style={[styles.row, { padding: spacing.base }]}>
              <View style={[styles.date, { backgroundColor: withAlpha(colors.success, 0.13) }]}>
                <Text style={{ color: colors.success, fontFamily: fonts.bold, fontSize: fontSize.sm }}>
                  {String(h.date || '').slice(8, 10)}
                </Text>
                <Text style={{ color: colors.success, fontFamily: fonts.medium, fontSize: 9 }}>
                  {formatDateKeyShort(h.date).slice(3, 6).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, marginLeft: 11 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                  {h.name}
                </Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                  {h.day_name || formatDateKeyShort(h.date)}
                  {h.company_id ? ` · ${h.company_id[1]}` : ''}
                </Text>
              </View>
              {!h.affects_working_days ? <Chip label="Not counted" tone="muted" size="sm" /> : null}
              <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 8 }} />
            </View>
          </Card>
        </Pressable>
      ))}

      <Pressable
        onPress={() => navigation.navigate('HolidayForm', { id: null, year })}
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
    </AdminScreen>
  );
}

function YearBtn({ dir, onPress }) {
  const { colors, withAlpha } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={dir === 'back' ? 'Previous year' : 'Next year'}
      style={({ pressed }) => [
        styles.navBtn,
        {
          backgroundColor: withAlpha(colors.onHeader, pressed ? 0.28 : 0.16),
          borderColor: withAlpha(colors.onHeader, 0.22),
        },
      ]}
    >
      <Ionicons
        name={dir === 'back' ? 'chevron-back' : 'chevron-forward'}
        size={16}
        color={colors.onHeader}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  date: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 10 },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
