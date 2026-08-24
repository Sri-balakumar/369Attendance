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
  ConfirmDialog,
  useToast,
} from '../../components';
import {
  fetchPayrollRuns,
  fetchPayrollRun,
  createPayrollRun,
  fetchPayslips,
  fetchPayslipLines,
  generatePayrollRun,
  confirmPayrollRun,
  markPayrollRunPaid,
  reopenPayrollRun,
  fetchCompanies,
} from '../../services/odoo';
import { formatDateKeyShort } from '../../utils/time';
import AdminScreen from './AdminScreen';
import { Section, Caption, Note, Picker } from './FormBits';
import {
  MoneyRow,
  FactRow,
  formatMoney,
  formatDays,
  runStateMeta,
  monthLabel,
  MONTH_LABELS,
} from './Money';

/* ------------------------------------------------------------------ */
/*  Payroll runs                                                       */
/* ------------------------------------------------------------------ */

export function PayrollRunsScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const showToast = useToast();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [sheet, setSheet] = useState(null);
  const now = new Date();
  const [draft, setDraft] = useState({
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
    companyId: null,
  });

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setRows(await fetchPayrollRuns());
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the payroll runs.');
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

  useEffect(() => {
    fetchCompanies()
      .then((c) => {
        setCompanies(c);
        setDraft((d) => (d.companyId === null && c.length ? { ...d, companyId: c[0].value } : d));
      })
      .catch(() => setCompanies([]));
  }, []);

  const create = async () => {
    const year = Number(draft.year);
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      showToast('Give a four-digit year.', 'danger');
      return;
    }
    if (!draft.companyId) {
      showToast('Pick a company.', 'danger');
      return;
    }
    // One run per company per month is a UNIQUE constraint on the table, so
    // the duplicate would fail as a raw database error. Catching it here means
    // the message names the month instead.
    const clash = rows.find(
      (r) => String(r.month) === String(draft.month) &&
        Number(r.year) === year &&
        r.company_id?.[0] === draft.companyId
    );
    if (clash) {
      showToast(`A run already exists for ${monthLabel(draft.month)} ${year}.`, 'danger');
      return;
    }
    setBusy(true);
    try {
      const run = await createPayrollRun({ month: draft.month, year, companyId: draft.companyId });
      setCreating(false);
      showToast('Payroll run created. Generate the payslips next.', 'success');
      if (run) navigation.navigate('PayrollRun', { id: run.id });
      load();
    } catch (e) {
      showToast(e?.message || 'Could not create the run.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminScreen
      navigation={navigation}
      title="Payroll Runs"
      subtitle="One per company per month"
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0 && !creating}
      emptyTitle="No payroll runs yet"
      emptyMessage="A run gathers a month's payslips. Create one, generate the payslips, then confirm it."
      emptyIcon="cash-outline"
    >
      {creating ? (
        <Section title="New payroll run" icon="add-circle-outline" tone="primary">
          <Picker
            label="Month"
            value={monthLabel(draft.month)}
            icon="calendar-outline"
            onPress={() => setSheet('month')}
          />
          <AppTextInput
            label="Year"
            value={draft.year}
            onChangeText={(v) => setDraft((d) => ({ ...d, year: v.replace(/[^0-9]/g, '').slice(0, 4) }))}
            icon="today-outline"
            keyboardType="number-pad"
            style={{ marginTop: spacing.base }}
          />
          <Picker
            label="Company"
            value={companies.find((c) => c.value === draft.companyId)?.label || ''}
            icon="business-outline"
            onPress={() => setSheet('company')}
            style={{ marginTop: spacing.base }}
          />
          <Caption>
            The period and the reference are set by the server from the month
            and year.
          </Caption>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: spacing.base }}>
            <PrimaryButton label="Cancel" variant="ghost" onPress={() => setCreating(false)} style={{ flex: 1 }} />
            <PrimaryButton label="Create" loading={busy} onPress={create} style={{ flex: 1 }} />
          </View>
        </Section>
      ) : null}

      {rows.map((r, i) => {
        const meta = runStateMeta(r.state);
        const tone = colors[meta.tone] || colors.muted;
        return (
          <Pressable
            key={r.id}
            onPress={() => navigation.navigate('PayrollRun', { id: r.id })}
            android_ripple={{ color: withAlpha(tone, 0.12) }}
            accessibilityRole="button"
            accessibilityLabel={`${monthLabel(r.month)} ${r.year}, ${meta.label}`}
            style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: i === 0 ? 0 : spacing.sm }]}
          >
            <Card padded={false}>
              <View style={[styles.row, { padding: spacing.base }]}>
                <View style={[styles.icon, { backgroundColor: withAlpha(tone, 0.13) }]}>
                  <Ionicons name={meta.icon} size={17} color={tone} />
                </View>
                <View style={{ flex: 1, marginLeft: 11 }}>
                  <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                    {monthLabel(r.month)} {r.year}
                  </Text>
                  <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                    {r.name || '—'} · {r.employee_count || 0} employee
                    {r.employee_count === 1 ? '' : 's'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Chip label={meta.label} tone={meta.tone} size="sm" />
                  <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.sm }}>
                    {formatMoney(r.total_net)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 6 }} />
              </View>
            </Card>
          </Pressable>
        );
      })}

      {!creating ? (
        <Pressable
          onPress={() => setCreating(true)}
          accessibilityRole="button"
          accessibilityLabel="New payroll run"
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
            New payroll run
          </Text>
        </Pressable>
      ) : null}

      <SelectSheet
        visible={sheet === 'month'}
        title="Month"
        icon="calendar-outline"
        options={MONTH_LABELS.map((label, i) => ({ value: String(i + 1), label }))}
        value={draft.month}
        onSelect={(v) => setDraft((d) => ({ ...d, month: v }))}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'company'}
        title="Company"
        icon="business-outline"
        options={companies}
        value={draft.companyId}
        onSelect={(v) => setDraft((d) => ({ ...d, companyId: v }))}
        onClose={() => setSheet(null)}
      />
    </AdminScreen>
  );
}

/* ------------------------------------------------------------------ */
/*  One run                                                            */
/* ------------------------------------------------------------------ */

export function PayrollRunScreen({ navigation, route }) {
  const id = route?.params?.id;
  const { colors, fonts, fontSize, spacing } = useTheme();
  const showToast = useToast();

  const [run, setRun] = useState(null);
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmWhat, setConfirmWhat] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([fetchPayrollRun(id), fetchPayslips({ runId: id })]);
      if (!r) throw new Error('That payroll run no longer exists.');
      setRun(r);
      setSlips(s);
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the payroll run.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const act = async (label, fn, successText) => {
    setBusy(label);
    try {
      await fn(run.id);
      showToast(successText, 'success');
      await load();
    } catch (e) {
      // action_confirm's refusal lists every mismatched payslip with both
      // figures. It is long, and it is the most useful thing on the screen
      // when it happens, so it is shown whole rather than truncated.
      showToast(e?.message || 'The server refused that.', 'danger');
      await load();
    } finally {
      setBusy('');
    }
  };

  const mismatched = slips.filter((s) => s.wage_mismatch);
  const meta = run ? runStateMeta(run.state) : null;

  // Confirm is gated HERE, not by the server. action_confirm has no state
  // guard of its own -- in the web client only the button's invisible=
  // attribute stops it, so calling it on a paid run would quietly move that
  // run back to confirmed.
  const canGenerate = run?.state === 'draft';
  const canConfirm = run?.state === 'draft' && slips.length > 0;
  const canMarkPaid = run?.state === 'confirmed';
  const canReopen = run?.state === 'confirmed';

  return (
    <AdminScreen
      navigation={navigation}
      title={run ? `${monthLabel(run.month)} ${run.year}` : 'Payroll run'}
      subtitle={run?.name || 'Payroll'}
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        load();
      }}
    >
      {run ? (
        <>
          <Card padded={false}>
            <View style={[styles.head, { borderBottomColor: colors.border }]}>
              <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.sm }}>
                {run.company_id ? run.company_id[1] : 'Company'}
              </Text>
              <Chip label={meta.label} tone={meta.tone} size="sm" />
            </View>
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
              <FactRow
                label="Period"
                value={`${formatDateKeyShort(run.date_from)} – ${formatDateKeyShort(run.date_to)}`}
              />
              <FactRow label="Pay date" value={formatDateKeyShort(run.pay_date)} />
              <FactRow label="Employees" value={String(run.employee_count || 0)} />
              <MoneyRow label="Gross earnings" value={run.total_gross} />
              <MoneyRow label="Deductions" value={run.total_deductions} tone="danger" />
              <MoneyRow label="Net pay" value={run.total_net} strong last />
            </View>
          </Card>

          {mismatched.length ? (
            <Note tone="warning" icon="alert-circle-outline">
              {mismatched.length} payslip{mismatched.length === 1 ? '' : 's'} disagree with the
              employee's Monthly Wage. Attendance deductions are calculated from that wage, so this
              run cannot be confirmed until they match:
              {'\n'}
              {mismatched
                .map((s) => `  · ${s.employee_name}: ${formatMoney(s.gross_earnings)} vs ${formatMoney(s.monthly_wage)}`)
                .join('\n')}
            </Note>
          ) : null}

          <Pressable
            onPress={() => navigation.navigate('Payslips', { runId: run.id, title: `${monthLabel(run.month)} ${run.year}` })}
            accessibilityRole="button"
            style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: spacing.md }]}
          >
            <Card padded={false}>
              <View style={[styles.row, { padding: spacing.base }]}>
                <Ionicons name="document-text-outline" size={18} color={colors.primary} />
                <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base, marginLeft: 11 }}>
                  Payslips
                </Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.sm }}>
                  {slips.length}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 8 }} />
              </View>
            </Card>
          </Pressable>

          {canGenerate ? (
            <PrimaryButton
              label={slips.length ? 'Generate again' : 'Generate payslips'}
              loading={busy === 'generate'}
              onPress={() => setConfirmWhat('generate')}
              style={{ marginTop: spacing.lg }}
            />
          ) : null}
          {canConfirm ? (
            <PrimaryButton
              label="Confirm run"
              variant="solid"
              tone="info"
              loading={busy === 'confirm'}
              onPress={() => setConfirmWhat('confirm')}
              style={{ marginTop: spacing.md }}
            />
          ) : null}
          {canMarkPaid ? (
            <PrimaryButton
              label="Mark paid"
              variant="solid"
              tone="success"
              loading={busy === 'paid'}
              onPress={() => setConfirmWhat('paid')}
              style={{ marginTop: spacing.md }}
            />
          ) : null}
          {canReopen ? (
            <PrimaryButton
              label="Back to draft"
              variant="ghost"
              loading={busy === 'reopen'}
              onPress={() => setConfirmWhat('reopen')}
              style={{ marginTop: spacing.md }}
            />
          ) : null}

          {run.state === 'paid' ? (
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
              This run is marked paid and cannot be reopened — employees have
              been given these payslips.
            </Text>
          ) : null}

          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.regular,
              fontSize: fontSize.xs,
              textAlign: 'center',
              marginTop: spacing.md,
              lineHeight: 17,
            }}
          >
            Printing payslips as PDF is done in Odoo.
          </Text>

          <ConfirmDialog
            visible={confirmWhat === 'generate'}
            title={slips.length ? 'Generate again?' : 'Generate payslips?'}
            message="This recalculates every payslip in this run from current attendance and salary data. Anyone who has left the company loses their payslip here."
            confirmLabel="Generate"
            tone="primary"
            icon="refresh-outline"
            onConfirm={() => {
              setConfirmWhat(null);
              act('generate', generatePayrollRun, 'Payslips generated.');
            }}
            onCancel={() => setConfirmWhat(null)}
          />
          <ConfirmDialog
            visible={confirmWhat === 'confirm'}
            title="Confirm this run?"
            message="The payslips are locked to these figures. You can still reopen the run until it is marked paid."
            confirmLabel="Confirm"
            tone="info"
            icon="checkmark-circle-outline"
            onConfirm={() => {
              setConfirmWhat(null);
              act('confirm', confirmPayrollRun, 'Run confirmed.');
            }}
            onCancel={() => setConfirmWhat(null)}
          />
          <ConfirmDialog
            visible={confirmWhat === 'paid'}
            title="Mark this run paid?"
            message="This cannot be undone. A paid run can never be reopened, because the payslips have been given to employees."
            confirmLabel="Mark paid"
            icon="cash-outline"
            onConfirm={() => {
              setConfirmWhat(null);
              act('paid', markPayrollRunPaid, 'Run marked paid.');
            }}
            onCancel={() => setConfirmWhat(null)}
          />
          <ConfirmDialog
            visible={confirmWhat === 'reopen'}
            title="Back to draft?"
            message="The run becomes editable again and the payslips can be regenerated."
            confirmLabel="Reopen"
            tone="warning"
            icon="arrow-undo-outline"
            onConfirm={() => {
              setConfirmWhat(null);
              act('reopen', reopenPayrollRun, 'Run reopened.');
            }}
            onCancel={() => setConfirmWhat(null)}
          />
        </>
      ) : null}
    </AdminScreen>
  );
}

/* ------------------------------------------------------------------ */
/*  Payslips                                                           */
/* ------------------------------------------------------------------ */

export function PayslipsScreen({ navigation, route }) {
  const runId = route?.params?.runId || null;
  const heading = route?.params?.title;
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setRows(await fetchPayslips({ runId }));
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the payslips.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminScreen
      navigation={navigation}
      title="Payslips"
      subtitle={heading || 'Every payslip'}
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0}
      emptyTitle="No payslips"
      emptyMessage={
        runId
          ? 'Generate the payslips from the run to fill this in.'
          : 'No payroll run has produced any payslips yet.'
      }
      emptyIcon="document-text-outline"
    >
      {rows.map((s, i) => (
        <Pressable
          key={s.id}
          onPress={() => navigation.navigate('Payslip', { id: s.id })}
          android_ripple={{ color: withAlpha(colors.primary, 0.12) }}
          accessibilityRole="button"
          accessibilityLabel={s.employee_name}
          style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: i === 0 ? 0 : spacing.sm }]}
        >
          <Card padded={false}>
            <View style={[styles.row, { padding: spacing.base }]}>
              <View
                style={[
                  styles.icon,
                  { backgroundColor: withAlpha(s.wage_mismatch ? colors.warning : colors.success, 0.13) },
                ]}
              >
                <Ionicons
                  name={s.wage_mismatch ? 'alert-circle-outline' : 'document-text-outline'}
                  size={17}
                  color={s.wage_mismatch ? colors.warning : colors.success}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 11 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                  {s.employee_name || '—'}
                </Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                  {s.department_name || 'No department'} · {formatDays(s.paid_days)} paid days
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.base }}>
                  {formatMoney(s.net_pay_rounded || s.net_pay)}
                </Text>
                {s.wage_mismatch ? <Chip label="Mismatch" tone="warning" size="sm" /> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 6 }} />
            </View>
          </Card>
        </Pressable>
      ))}
      <View style={{ height: spacing.md }} />
    </AdminScreen>
  );
}

/* ------------------------------------------------------------------ */
/*  One payslip -- the PDF, rendered natively                          */
/* ------------------------------------------------------------------ */

export function PayslipScreen({ navigation, route }) {
  const id = route?.params?.id;
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();

  const [slip, setSlip] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const all = await fetchPayslips({});
      const hit = all.find((s) => s.id === Number(id));
      if (!hit) throw new Error('That payslip no longer exists.');
      setSlip(hit);
      setLines(await fetchPayslipLines(id));
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the payslip.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const earnings = lines.filter((l) => l.category === 'earning');
  const deductions = lines.filter((l) => l.category === 'deduction');
  const rounded = Number(slip?.net_pay_rounded) || 0;
  const exact = Number(slip?.net_pay) || 0;

  return (
    <AdminScreen
      navigation={navigation}
      title={slip?.employee_name || 'Payslip'}
      subtitle={slip ? `${monthLabel(slip.date_from ? String(new Date(slip.date_from).getMonth() + 1) : '')} ${slip.date_from ? new Date(slip.date_from).getFullYear() : ''}` : 'Payslip'}
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        load();
      }}
    >
      {slip ? (
        <>
          <Card padded={false}>
            <View style={[styles.head, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.base }}>
                  {slip.employee_name}
                </Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                  {slip.job_title || '—'} · {slip.department_name || 'No department'}
                </Text>
              </View>
            </View>
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
              <FactRow
                label="Period"
                value={`${formatDateKeyShort(slip.date_from)} – ${formatDateKeyShort(slip.date_to)}`}
              />
              <FactRow label="Pay date" value={formatDateKeyShort(slip.pay_date)} last />
            </View>
          </Card>

          {slip.wage_mismatch ? (
            <Note tone="warning" icon="alert-circle-outline">
              Earnings of {formatMoney(slip.gross_earnings)} disagree with the Monthly Wage of{' '}
              {formatMoney(slip.monthly_wage)}. Attendance deductions are calculated from the wage,
              so the run cannot be confirmed while this stands.
            </Note>
          ) : null}

          <Section title="Earnings" icon="add-circle-outline" tone="success">
            {earnings.length ? (
              earnings.map((l, i) => (
                <MoneyRow key={l.id} label={l.name} value={l.amount} last={i === earnings.length - 1} />
              ))
            ) : (
              <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm }}>
                No earning lines.
              </Text>
            )}
            <View style={{ marginTop: 4 }}>
              <MoneyRow label="Gross earnings" value={slip.gross_earnings} strong last />
            </View>
          </Section>

          <Section title="Deductions" icon="remove-circle-outline" tone="danger">
            {deductions.length ? (
              deductions.map((l, i) => (
                <MoneyRow
                  key={l.id}
                  label={l.name}
                  value={l.amount}
                  tone="danger"
                  last={i === deductions.length - 1}
                />
              ))
            ) : (
              <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm }}>
                Nothing deducted.
              </Text>
            )}
            <View style={{ marginTop: 4 }}>
              <MoneyRow label="Total deductions" value={slip.total_deductions} tone="danger" strong last />
            </View>
          </Section>

          <Card style={{ backgroundColor: withAlpha(colors.success, 0.09), borderColor: withAlpha(colors.success, 0.3) }}>
            <Text style={{ color: colors.muted, fontFamily: fonts.semibold, fontSize: fontSize.xs, letterSpacing: 0.6 }}>
              NET PAY
            </Text>
            <Text style={{ color: colors.success, fontFamily: fonts.bold, fontSize: fontSize.xl, marginTop: 4 }}>
              {formatMoney(rounded || exact)}
            </Text>
            {/* Two different fields. Only worth showing both when they differ. */}
            {rounded && Math.abs(rounded - exact) > 0.005 ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                Exact {formatMoney(exact)}, rounded for payment
              </Text>
            ) : null}
            {slip.net_in_words ? (
              <Text
                style={{
                  color: colors.text,
                  fontFamily: fonts.medium,
                  fontSize: fontSize.xs,
                  marginTop: 8,
                  lineHeight: 18,
                }}
              >
                {slip.net_in_words}
              </Text>
            ) : null}
          </Card>

          <Section title="Attendance" icon="calendar-outline" tone="info" style={{ marginTop: spacing.md }}>
            <FactRow label="Working days" value={formatDays(slip.working_days)} />
            <FactRow label="Present" value={formatDays(slip.present_days)} tone="success" />
            <FactRow label="Half days" value={formatDays(slip.half_days)} tone="info" />
            <FactRow label="Absent" value={formatDays(slip.absent_days)} tone="danger" />
            <FactRow label="Paid leave" value={formatDays(slip.leave_days_paid)} />
            <FactRow label="Unpaid leave" value={formatDays(slip.leave_days_unpaid)} tone="warning" />
            <FactRow label="Loss of pay days" value={formatDays(slip.lop_days)} tone="danger" />
            <FactRow label="Paid days" value={formatDays(slip.paid_days)} last />
          </Section>

          <Section title="Leave balance" icon="albums-outline" tone="accent">
            <FactRow label="Opening" value={formatDays(slip.leave_opening)} />
            <FactRow label="Taken" value={formatDays(slip.leave_taken)} />
            <FactRow label="Closing" value={formatDays(slip.leave_closing)} last />
          </Section>

          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.regular,
              fontSize: fontSize.xs,
              textAlign: 'center',
              marginTop: spacing.sm,
              lineHeight: 17,
            }}
          >
            This is the same breakdown the PDF prints. Printing it is done in Odoo.
          </Text>
          <View style={{ height: spacing.lg }} />
        </>
      ) : null}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  icon: { width: 34, height: 34, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
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
