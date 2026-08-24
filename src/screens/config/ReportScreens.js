import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
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
import {
  generateEmployeeReport,
  fetchEmployeeReports,
  fetchEmployeeReport,
  fetchReportSummaryLines,
  fetchReportDetailLines,
  refreshEmployeeReport,
  fetchCompanies,
  fetchDepartments,
  fetchEmployeeOptions,
} from '../../services/odoo';
import { formatDateKeyShort } from '../../utils/time';
import AdminScreen from './AdminScreen';
import { Section, Caption, Note, Picker } from './FormBits';
import { MoneyRow, FactRow, formatMoney, formatDays, monthLabel, MONTH_LABELS } from './Money';

const ALL_DEPARTMENTS = '__all__';

const SCOPES = [
  { value: 'all', label: 'All employees' },
  { value: 'selected', label: 'Selected employees' },
];

/* ------------------------------------------------------------------ */
/*  Generate                                                           */
/* ------------------------------------------------------------------ */

export function GenerateReportScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing } = useTheme();
  const showToast = useToast();
  const now = new Date();

  const [busy, setBusy] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [d, setD] = useState({
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
    companyId: null,
    departmentId: null,
    employeeSelect: 'all',
    employeeIds: [],
  });

  useEffect(() => {
    fetchCompanies()
      .then((c) => {
        setCompanies(c);
        setD((prev) => (prev.companyId === null && c.length ? { ...prev, companyId: c[0].value } : prev));
      })
      .catch(() => setCompanies([]));
    fetchDepartments().then(setDepartments).catch(() => setDepartments([]));
    fetchEmployeeOptions().then(setEmployees).catch(() => setEmployees([]));
  }, []);

  const generate = async () => {
    const year = Number(d.year);
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      showToast('Give a four-digit year.', 'danger');
      return;
    }
    if (!d.companyId) {
      showToast('Pick a company.', 'danger');
      return;
    }
    // The server takes employee_select at face value, so an empty list with
    // 'selected' would report on nobody rather than on everybody.
    if (d.employeeSelect === 'selected' && !d.employeeIds.length) {
      showToast('Pick at least one employee, or switch to All.', 'danger');
      return;
    }
    setBusy(true);
    try {
      const report = await generateEmployeeReport({
        month: d.month,
        year,
        companyId: d.companyId,
        employeeSelect: d.employeeSelect,
        employeeIds: d.employeeIds,
        departmentId: d.departmentId,
      });
      showToast('Report generated.', 'success');
      navigation.replace('Report', { id: report.id });
    } catch (e) {
      showToast(e?.message || 'Could not generate the report.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminScreen navigation={navigation} title="Generate Report" subtitle="A month, per employee">
      <Section title="Period" icon="calendar-outline" tone="primary">
        <Picker
          label="Month"
          value={monthLabel(d.month)}
          icon="calendar-outline"
          onPress={() => setSheet('month')}
        />
        <AppTextInput
          label="Year"
          value={d.year}
          onChangeText={(v) => setD((p) => ({ ...p, year: v.replace(/[^0-9]/g, '').slice(0, 4) }))}
          icon="today-outline"
          keyboardType="number-pad"
          style={{ marginTop: spacing.base }}
        />
      </Section>

      <Section title="Scope" icon="people-outline" tone="info">
        <Picker
          label="Company"
          value={companies.find((c) => c.value === d.companyId)?.label || ''}
          icon="business-outline"
          onPress={() => setSheet('company')}
        />
        <Picker
          label="Department"
          value={
            d.departmentId
              ? departments.find((x) => x.value === d.departmentId)?.label || '—'
              : 'All departments'
          }
          icon="people-outline"
          onPress={() => setSheet('department')}
          style={{ marginTop: spacing.base }}
        />
        <Picker
          label="Employees"
          value={SCOPES.find((s) => s.value === d.employeeSelect)?.label || 'All employees'}
          icon="person-outline"
          onPress={() => setSheet('scope')}
          style={{ marginTop: spacing.base }}
        />
        {d.employeeSelect === 'selected' ? (
          <Picker
            label="Which employees"
            value={
              d.employeeIds.length
                ? `${d.employeeIds.length} selected`
                : 'Nobody picked yet'
            }
            icon="list-outline"
            onPress={() => setSheet('employees')}
            style={{ marginTop: spacing.base }}
          />
        ) : null}
        <Caption>
          Department and Employees narrow the same report. Picking employees
          explicitly ignores the department filter on the server.
        </Caption>
      </Section>

      <Note tone="info" icon="time-outline" style={{ marginTop: 0 }}>
        Generating recalculates the whole month for every employee in scope, so
        it takes a moment. The result is saved and appears under Past Reports.
      </Note>

      <PrimaryButton
        label="Generate"
        loading={busy}
        onPress={generate}
        style={{ marginTop: spacing.lg }}
      />
      <Text
        style={{
          color: colors.muted,
          fontFamily: fonts.regular,
          fontSize: fontSize.xs,
          textAlign: 'center',
          marginTop: spacing.md,
        }}
      >
        PDF and Excel exports are done in Odoo.
      </Text>

      <SelectSheet
        visible={sheet === 'month'}
        title="Month"
        icon="calendar-outline"
        options={MONTH_LABELS.map((label, i) => ({ value: String(i + 1), label }))}
        value={d.month}
        onSelect={(v) => setD((p) => ({ ...p, month: v }))}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'company'}
        title="Company"
        icon="business-outline"
        options={companies}
        value={d.companyId}
        onSelect={(v) => setD((p) => ({ ...p, companyId: v }))}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'department'}
        title="Department"
        icon="people-outline"
        searchable={departments.length > 12}
        options={[{ value: ALL_DEPARTMENTS, label: 'All departments' }, ...departments]}
        value={d.departmentId ?? ALL_DEPARTMENTS}
        onSelect={(v) => setD((p) => ({ ...p, departmentId: v === ALL_DEPARTMENTS ? null : v }))}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'scope'}
        title="Employees"
        icon="person-outline"
        options={SCOPES}
        value={d.employeeSelect}
        onSelect={(v) => setD((p) => ({ ...p, employeeSelect: v }))}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'employees'}
        title="Select employees"
        icon="person-outline"
        multiple
        searchable
        options={employees}
        value={d.employeeIds}
        onSelect={(ids) => setD((p) => ({ ...p, employeeIds: ids }))}
        onClose={() => setSheet(null)}
        emptyLabel="No employee matches that."
      />
    </AdminScreen>
  );
}

/* ------------------------------------------------------------------ */
/*  Past reports                                                       */
/* ------------------------------------------------------------------ */

export function PastReportsScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setRows(await fetchEmployeeReports());
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the reports.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <AdminScreen
      navigation={navigation}
      title="Past Reports"
      subtitle="Generated employee reports"
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0}
      emptyTitle="No reports yet"
      emptyMessage="Generate one and it is saved here for later."
      emptyIcon="bar-chart-outline"
    >
      {rows.map((r, i) => (
        <Pressable
          key={r.id}
          onPress={() => navigation.navigate('Report', { id: r.id })}
          android_ripple={{ color: withAlpha(colors.accent, 0.12) }}
          accessibilityRole="button"
          accessibilityLabel={r.name || `${monthLabel(r.month)} ${r.year}`}
          style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: i === 0 ? 0 : spacing.sm }]}
        >
          <Card padded={false}>
            <View style={[styles.row, { padding: spacing.base }]}>
              <View style={[styles.icon, { backgroundColor: withAlpha(colors.accent, 0.13) }]}>
                <Ionicons name="bar-chart-outline" size={17} color={colors.accent} />
              </View>
              <View style={{ flex: 1, marginLeft: 11 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                  {monthLabel(r.month)} {r.year}
                </Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                  {r.department_id ? r.department_id[1] : 'All departments'}
                  {r.company_id ? ` · ${r.company_id[1]}` : ''}
                </Text>
              </View>
              <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.sm }}>
                {formatMoney(r.grand_final_amount)}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 8 }} />
            </View>
          </Card>
        </Pressable>
      ))}
      <View style={{ height: spacing.md }} />
    </AdminScreen>
  );
}

/* ------------------------------------------------------------------ */
/*  One report                                                         */
/* ------------------------------------------------------------------ */

export function ReportScreen({ navigation, route }) {
  const id = route?.params?.id;
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const showToast = useToast();

  const [report, setReport] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([fetchEmployeeReport(id), fetchReportSummaryLines(id)]);
      if (!r) throw new Error('That report no longer exists.');
      setReport(r);
      setLines(l);
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the report.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setBusy(true);
    try {
      await refreshEmployeeReport(id);
      await load();
      showToast('Report recalculated.', 'success');
    } catch (e) {
      showToast(e?.message || 'Could not recalculate.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminScreen
      navigation={navigation}
      title={report ? `${monthLabel(report.month)} ${report.year}` : 'Report'}
      subtitle={report?.department_id ? report.department_id[1] : 'All departments'}
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        load();
      }}
    >
      {report ? (
        <>
          <Card padded={false}>
            <View style={[styles.head, { borderBottomColor: colors.border }]}>
              <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.sm }}>
                Grand totals
              </Text>
              <Chip label={`${lines.length} employees`} tone="info" size="sm" />
            </View>
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
              <FactRow
                label="Period"
                value={`${formatDateKeyShort(report.date_from)} – ${formatDateKeyShort(report.date_to)}`}
              />
              <MoneyRow label="Wage" value={report.grand_wage} />
              <MoneyRow label="Leave deduction" value={report.grand_leave_deduction} tone="warning" />
              <MoneyRow label="Total deduction" value={report.grand_total_deduction} tone="danger" />
              <MoneyRow label="Final amount" value={report.grand_final_amount} strong last />
            </View>
          </Card>

          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.semibold,
              fontSize: fontSize.xs,
              letterSpacing: 1,
              marginTop: spacing.lg,
              marginBottom: spacing.sm,
            }}
          >
            PER EMPLOYEE
          </Text>

          {lines.map((l, i) => (
            <Pressable
              key={l.id}
              onPress={() =>
                navigation.navigate('ReportDetail', {
                  reportId: report.id,
                  employeeId: Array.isArray(l.employee_id) ? l.employee_id[0] : null,
                  employeeName: l.employee_name,
                })
              }
              android_ripple={{ color: withAlpha(colors.primary, 0.12) }}
              accessibilityRole="button"
              accessibilityLabel={l.employee_name}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: i === 0 ? 0 : spacing.sm }]}
            >
              <Card padded={false}>
                <View style={[styles.row, { padding: spacing.base }]}>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                      {l.employee_name || '—'}
                    </Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                      {formatDays(l.total_present_days)}/{formatDays(l.total_working_days)} days
                      {l.late_days ? ` · ${l.late_days} late` : ''}
                      {Number(l.unpaid_leave_days) ? ` · ${formatDays(l.unpaid_leave_days)} unpaid` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.base }}>
                      {formatMoney(l.final_amount)}
                    </Text>
                    {Number(l.total_deduction) > 0 ? (
                      <Text style={{ color: colors.danger, fontFamily: fonts.medium, fontSize: fontSize.xs }}>
                        −{formatMoney(l.total_deduction)}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 8 }} />
                </View>
              </Card>
            </Pressable>
          ))}

          <PrimaryButton
            label="Recalculate"
            variant="ghost"
            loading={busy}
            onPress={refresh}
            style={{ marginTop: spacing.lg }}
          />
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.regular,
              fontSize: fontSize.xs,
              textAlign: 'center',
              marginTop: spacing.md,
            }}
          >
            PDF and Excel exports are done in Odoo.
          </Text>
          <View style={{ height: spacing.lg }} />
        </>
      ) : null}
    </AdminScreen>
  );
}

/* ------------------------------------------------------------------ */
/*  One employee's day-by-day lines                                    */
/* ------------------------------------------------------------------ */

/**
 * The detail lines replace three act_window drill-downs on the summary line
 * (day details, late records, leave records). Their fields vary with what the
 * report captured, so this renders whatever came back rather than assuming a
 * fixed shape -- the ids and relational columns are dropped, the rest is shown
 * in the order the server sent it.
 */
const HIDDEN = new Set(['id', 'report_id', 'employee_id', 'currency_id', 'company_id',
  'employee_name', 'department_name', 'display_name', '__last_update', 'create_uid',
  'create_date', 'write_uid', 'write_date']);

const humanise = (key) =>
  key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function ReportDetailScreen({ navigation, route }) {
  const { reportId, employeeId, employeeName } = route?.params || {};
  const { colors, fonts, fontSize, spacing } = useTheme();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchReportDetailLines(reportId, employeeId)
      .then((r) => {
        setRows(r);
        setError('');
      })
      .catch((e) => setError(e?.message || 'Could not load the detail lines.'))
      .finally(() => setLoading(false));
  }, [reportId, employeeId]);

  return (
    <AdminScreen
      navigation={navigation}
      title={employeeName || 'Detail'}
      subtitle="Day by day"
      loading={loading}
      error={error}
      empty={!loading && !error && rows.length === 0}
      emptyTitle="No detail lines"
      emptyMessage="This report did not capture a day-by-day breakdown for this employee."
      emptyIcon="calendar-outline"
    >
      <Text
        style={{
          color: colors.muted,
          fontFamily: fonts.medium,
          fontSize: fontSize.xs,
          marginBottom: spacing.md,
        }}
      >
        {rows.length} {rows.length === 1 ? 'line' : 'lines'}
      </Text>

      {rows.map((row, i) => {
        const keys = Object.keys(row).filter(
          (k) => !HIDDEN.has(k) && row[k] !== false && row[k] !== null && row[k] !== ''
        );
        return (
          <Card key={row.id} style={{ marginTop: i === 0 ? 0 : spacing.sm }}>
            {keys.map((k, j) => (
              <FactRow
                key={k}
                label={humanise(k)}
                value={Array.isArray(row[k]) ? row[k][1] : String(row[k])}
                last={j === keys.length - 1}
              />
            ))}
          </Card>
        );
      })}
      <View style={{ height: spacing.md }} />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  icon: { width: 34, height: 34, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
});
