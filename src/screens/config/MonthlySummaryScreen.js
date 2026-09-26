import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import {
  Card,
  Chip,
  AppTextInput,
  PrimaryButton,
  SelectSheet,
  useToast,
} from '../../components';
import { generateLateSummary, fetchDepartments } from '../../services/odoo';
import AdminScreen from './AdminScreen';
import { GUIDES } from './guides';
import { MONTH_NAMES } from './useMonth';

const ALL_DEPARTMENTS = '__all__';

/**
 * The monthly late summary, which is a wizard on the server rather than a list.
 *
 * One screen with two states instead of two routes, mirroring the backend
 * action's `target: new` modal: pick a month, generate, read the result, and
 * Change goes back to the picker.
 */
export default function MonthlySummaryScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const showToast = useToast();
  const now = new Date();

  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(String(now.getFullYear()));
  const [departmentId, setDepartmentId] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [sheet, setSheet] = useState(null);

  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDepartments().then(setDepartments).catch(() => setDepartments([]));
  }, []);

  const monthOptions = useMemo(
    () => MONTH_NAMES.map((label, i) => ({ value: i + 1, label })),
    []
  );
  const departmentOptions = useMemo(
    () => [{ value: ALL_DEPARTMENTS, label: 'All departments' }, ...departments],
    [departments]
  );

  const generate = async () => {
    const y = Number(year);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      showToast('Give a four-digit year.', 'danger');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setRows(await generateLateSummary({ month, year: y, departmentId }));
    } catch (e) {
      setError(e?.message || 'Could not generate the summary.');
    } finally {
      setBusy(false);
    }
  };

  const totalDays = (rows || []).reduce((s, r) => s + (Number(r.total_late_days) || 0), 0);
  const showingResults = rows !== null && !error;

  return (
    <AdminScreen guide={GUIDES.monthlySummary}
      navigation={navigation}
      title="Monthly Summary"
      subtitle={showingResults ? `${MONTH_NAMES[month - 1]} ${year}` : 'Late days per employee'}
      error={error}
      onRetry={generate}
      empty={showingResults && rows.length === 0}
      emptyTitle="No chargeable late days"
      emptyMessage="Nobody was late in a way that counts this month. Arrivals after Late Window Ends, and any check-in that is not the day's first, are deliberately excluded."
    >
      {!showingResults ? (
        <>
          <Card>
            <Picker
              label="Month"
              value={MONTH_NAMES[month - 1]}
              icon="calendar-outline"
              onPress={() => setSheet('month')}
            />
            <AppTextInput
              label="Year"
              value={year}
              onChangeText={(v) => setYear(v.replace(/[^0-9]/g, '').slice(0, 4))}
              icon="today-outline"
              keyboardType="number-pad"
              style={{ marginTop: spacing.base }}
            />
            <Picker
              label="Department"
              value={
                departmentId
                  ? departments.find((d) => d.value === departmentId)?.label || '—'
                  : 'All departments'
              }
              icon="people-outline"
              onPress={() => setSheet('department')}
              style={{ marginTop: spacing.base }}
            />
          </Card>

          <PrimaryButton
            label="Generate"
            loading={busy}
            onPress={generate}
            style={{ marginTop: spacing.lg }}
          />

          {/* The wizard clears the shared line table before refilling it, so
              two people generating at once overwrite each other. Server-side
              design; saying so beats a mystery. */}
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.regular,
              fontSize: fontSize.xs,
              marginTop: spacing.md,
              textAlign: 'center',
              lineHeight: 17,
            }}
          >
            Generating replaces the last summary for everyone, including in Odoo.
          </Text>
        </>
      ) : (
        <>
          <View style={styles.summaryRow}>
            <Chip label={`${rows.length} employees`} tone="info" size="sm" />
            <Chip label={`${totalDays} late days`} tone="warning" size="sm" />
          </View>

          {rows.map((r, i) => (
            <Card key={r.id} padded={false} style={{ marginTop: i === 0 ? 0 : spacing.sm }}>
              <View style={[styles.row, { padding: spacing.base }]}>
                <View style={[styles.rank, { backgroundColor: withAlpha(colors.warning, 0.13) }]}>
                  <Text style={{ color: colors.warning, fontFamily: fonts.bold, fontSize: fontSize.sm }}>
                    {i + 1}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 11 }}>
                  <Text
                    numberOfLines={1}
                    style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}
                  >
                    {r.employee_name || '—'}
                  </Text>
                  <Text
                    style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}
                  >
                    {r.department_name || 'No department'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.base }}>
                    {r.total_late_days}d
                  </Text>
                  <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs }}>
                    {r.total_late_time_display || `${r.total_late_minutes}m`}
                  </Text>
                </View>
              </View>
            </Card>
          ))}

          <PrimaryButton
            label="Change month"
            variant="ghost"
            onPress={() => setRows(null)}
            style={{ marginTop: spacing.lg }}
          />
        </>
      )}

      <SelectSheet
        visible={sheet === 'month'}
        title="Month"
        icon="calendar-outline"
        options={monthOptions}
        value={month}
        onSelect={setMonth}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'department'}
        title="Department"
        icon="people-outline"
        searchable={departments.length > 12}
        options={departmentOptions}
        value={departmentId ?? ALL_DEPARTMENTS}
        onSelect={(v) => setDepartmentId(v === ALL_DEPARTMENTS ? null : v)}
        onClose={() => setSheet(null)}
      />
    </AdminScreen>
  );
}

function Picker({ label, value, icon, onPress, style }) {
  const { colors } = useTheme();
  return (
    <AppTextInput
      label={label}
      value={value}
      icon={icon}
      editable={false}
      onPress={onPress}
      style={style}
      rightSlot={<Ionicons name="chevron-down" size={17} color={colors.muted} />}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  rank: { width: 30, height: 30, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
});
