import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip } from '../../components';
import { getAttendanceSettings } from '../../services/odoo';
import { formatHourFloat } from '../../utils/time';
import AdminScreen from './AdminScreen';
import { GUIDES } from './guides';

/**
 * Every attendance-rules row, company-wide first, then one per department.
 *
 * A list rather than the single company-wide record, mirroring the backend
 * action's `view_mode: list,form`. That is what makes the Scope fields safe to
 * edit: a screen that queried department_id = false would make a row it had
 * just re-scoped vanish, taking the company's only rules with it and silently
 * dropping every employee onto the hardcoded fallback. Here it simply moves
 * down the list.
 */
export default function RulesListScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing } = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setData(await getAttendanceSettings());
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the attendance rules.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // On focus, so returning from a save shows the new figures rather than the
  // ones the list was built with.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const configs = data?.configs || [];

  return (
    <AdminScreen guide={GUIDES.rulesList}
      navigation={navigation}
      title="Office hours"
      subtitle="Working days and the day-status ladder"
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && configs.length === 0}
      emptyTitle="No attendance rules yet"
      emptyMessage="Nothing is configured for your company, so everyone falls back to 08:00-17:00 with the day-status ladder switched off."
      emptyIcon="time-outline"
    >
      {!data?.canEdit ? (
        <View style={{ marginBottom: spacing.md }}>
          <Chip label="View only" tone="muted" size="sm" />
        </View>
      ) : null}

      {configs.map((c, i) => (
        <RuleCard
          key={c.id}
          config={c}
          style={{ marginTop: i === 0 ? 0 : spacing.md }}
          onPress={() => navigation.navigate('RulesForm', { id: c.id })}
        />
      ))}

      <Text
        style={{
          color: colors.muted,
          fontFamily: fonts.regular,
          fontSize: fontSize.xs,
          textAlign: 'center',
          marginTop: spacing.lg,
          lineHeight: 17,
        }}
      >
        A department row takes precedence over the company-wide one for its own
        people.
      </Text>
    </AdminScreen>
  );
}

function RuleCard({ config, onPress, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const isCompanyWide = !config.department_id;
  const tone = isCompanyWide ? colors.primary : colors.info;
  const scope = isCompanyWide
    ? 'Company-wide'
    : config.department_id[1] || 'Department';

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: withAlpha(tone, 0.12) }}
      accessibilityRole="button"
      accessibilityLabel={scope}
      style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }, style]}
    >
      <Card padded={false}>
        <View style={[styles.head, { borderBottomColor: colors.border, padding: spacing.base }]}>
          <View style={[styles.icon, { backgroundColor: withAlpha(tone, 0.13) }]}>
            <Ionicons name={isCompanyWide ? 'business-outline' : 'people-outline'} size={17} color={tone} />
          </View>
          <View style={{ flex: 1, marginLeft: 11 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.base }}>
              {scope}
            </Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
              {config.company_id ? config.company_id[1] : '—'}
            </Text>
          </View>
          {!config.late_tracking_enabled ? (
            <Chip label="Tracking off" tone="muted" size="sm" />
          ) : null}
          <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 8 }} />
        </View>

        <View style={{ paddingHorizontal: spacing.base, paddingVertical: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Fact icon="log-in-outline" text={`${formatHourFloat(config.office_start_hour)} – ${formatHourFloat(config.office_end_hour)}`} />
          <Fact icon="hourglass-outline" text={`${config.late_threshold_minutes} min grace`} />
          <Fact icon="briefcase-outline" text={`${config.daily_work_hours} h paid`} />
        </View>
      </Card>
    </Pressable>
  );
}

function Fact({ icon, text }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={13} color={colors.muted} />
      <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  icon: { width: 34, height: 34, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
