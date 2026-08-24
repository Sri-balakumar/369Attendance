import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import {
  Card,
  Chip,
  AppTextInput,
  PrimaryButton,
  SwitchRow,
  SelectSheet,
  ConfirmDialog,
  useToast,
} from '../../components';
import {
  fetchAttendanceConfigs,
  saveAttendanceConfig,
  canEditAttendanceConfig,
  fetchTimezoneOptions,
  fetchCompanies,
  fetchDepartments,
  recomputeAttendanceConfig,
} from '../../services/odoo';
import { formatHourFloat, parseHourFloat } from '../../utils/time';
import AdminScreen from './AdminScreen';

const DAYS = [
  { field: 'work_monday', letter: 'M', name: 'Monday' },
  { field: 'work_tuesday', letter: 'T', name: 'Tuesday' },
  { field: 'work_wednesday', letter: 'W', name: 'Wednesday' },
  { field: 'work_thursday', letter: 'T', name: 'Thursday' },
  { field: 'work_friday', letter: 'F', name: 'Friday' },
  { field: 'work_saturday', letter: 'S', name: 'Saturday' },
  { field: 'work_sunday', letter: 'S', name: 'Sunday' },
];

const NO_DEPARTMENT = '__none__';

/**
 * One attendance-rules record, every field the Odoo form exposes.
 *
 * Sections, order and labels follow views/late_config_views.xml deliberately,
 * down to hiding the reason switch and the grace field when late tracking is
 * off, so an admin who knows the web form recognises this one.
 *
 * The model carries NO @api.constrains and no _sql_constraints, so everything
 * validated below is validated here or nowhere.
 */
export default function RulesFormScreen({ navigation, route }) {
  const id = route?.params?.id;
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const showToast = useToast();

  const [config, setConfig] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [confirmRecompute, setConfirmRecompute] = useState(false);

  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});

  const [timezones, setTimezones] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [sheet, setSheet] = useState(null); // 'timezone' | 'company' | 'department'

  const toDraft = (c) => ({
    late_tracking_enabled: Boolean(c.late_tracking_enabled),
    late_reason_required: Boolean(c.late_reason_required),
    company_id: c.company_id ? c.company_id[0] : null,
    department_id: c.department_id ? c.department_id[0] : null,
    timezone: c.timezone || null,
    late_threshold_minutes: String(c.late_threshold_minutes ?? ''),
    office_start_hour: formatHourFloat(c.office_start_hour),
    office_end_hour: formatHourFloat(c.office_end_hour),
    daily_work_hours: String(c.daily_work_hours ?? ''),
    late_until_hour: formatHourFloat(c.late_until_hour),
    half_day_after_hour: formatHourFloat(c.half_day_after_hour),
    half_day_min_hours_ratio: String(c.half_day_min_hours_ratio ?? ''),
    kra_workday_creates_attendance: Boolean(c.kra_workday_creates_attendance),
    ...DAYS.reduce((acc, d) => ({ ...acc, [d.field]: Boolean(c[d.field]) }), {}),
  });

  const load = useCallback(async () => {
    try {
      const [rows, allowed] = await Promise.all([
        fetchAttendanceConfigs(),
        canEditAttendanceConfig(),
      ]);
      const row = rows.find((r) => r.id === Number(id));
      if (!row) throw new Error('These rules no longer exist. Pull back and refresh the list.');
      setConfig(row);
      setDraft(toDraft(row));
      setCanEdit(allowed);
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load these rules.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // The pickers are only paid for once the form is open, and the timezone list
  // is ~600 rows -- fetchTimezoneOptions memoises it for the session.
  useEffect(() => {
    fetchTimezoneOptions().then(setTimezones).catch(() => setTimezones([]));
    fetchCompanies().then(setCompanies).catch(() => setCompanies([]));
    fetchDepartments().then(setDepartments).catch(() => setDepartments([]));
  }, []);

  const set = (k, v) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  /**
   * Office hours drive Daily Paid Hours, so editing them recalculates it here
   * the way the web form's onchange does -- visibly, in the field, where it
   * can then be typed over.
   *
   * Verified against the server: writing both in one call keeps the explicit
   * value, so whatever ends up in this box is what gets stored.
   */
  const setHour = (k, v) => {
    setDraft((d) => {
      const next = { ...d, [k]: v };
      const start = parseHourFloat(k === 'office_start_hour' ? v : d.office_start_hour);
      const end = parseHourFloat(k === 'office_end_hour' ? v : d.office_end_hour);
      if (start !== null && end !== null) {
        next.daily_work_hours = String(Math.max(0, Number((end - start).toFixed(2))));
      }
      return next;
    });
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const workingDayCount = DAYS.filter((d) => draft[d.field]).length;

  const submit = async () => {
    const next = {};
    const start = parseHourFloat(draft.office_start_hour);
    const end = parseHourFloat(draft.office_end_hour);
    const grace = Number(draft.late_threshold_minutes);
    const lateUntil = parseHourFloat(draft.late_until_hour);
    const halfAfter = parseHourFloat(draft.half_day_after_hour);
    const ratio = Number(draft.half_day_min_hours_ratio);
    const paid = Number(draft.daily_work_hours);

    if (start === null) next.office_start_hour = 'Use HH:MM, e.g. 09:30.';
    if (end === null) next.office_end_hour = 'Use HH:MM, e.g. 18:30.';
    if (start !== null && end !== null && end <= start) {
      next.office_end_hour = 'The office cannot end before it starts.';
    }
    if (!Number.isFinite(grace) || grace < 0) {
      next.late_threshold_minutes = 'Give a number of minutes, 0 or more.';
    }
    if (lateUntil === null) next.late_until_hour = 'Use HH:MM, or 00:00 to switch it off.';
    else if (lateUntil > 0 && start !== null && end !== null && (lateUntil < start || lateUntil > end)) {
      next.late_until_hour = 'Outside office hours, so it would never apply.';
    }
    if (halfAfter === null) next.half_day_after_hour = 'Use HH:MM, or 00:00 to switch it off.';
    else if (halfAfter > 0 && start !== null && end !== null && (halfAfter < start || halfAfter > end)) {
      next.half_day_after_hour = 'Outside office hours, so it would never apply.';
    }
    // A fraction, not a percentage. 50 would silently disable the rule instead
    // of catching half-length days.
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      next.half_day_min_hours_ratio = 'A fraction between 0 and 1 — 0.5 is half a day. 0 switches it off.';
    }
    if (!Number.isFinite(paid) || paid < 0) {
      next.daily_work_hours = 'Give the paid hours per day, 0 or more.';
    }
    if (!draft.company_id) next.company_id = 'A company is required.';

    setErrors(next);
    if (Object.keys(next).length) {
      showToast('Some fields need fixing before this can be saved.', 'danger');
      return;
    }

    // Not cosmetic: get_working_days_in_month returns 0 with no weekdays
    // ticked, and every daily rate in payroll divides by it.
    if (workingDayCount === 0) {
      showToast('Pick at least one working day — zero would break every daily rate.', 'danger');
      return;
    }

    setSaving(true);
    try {
      const values = {
        late_tracking_enabled: Boolean(draft.late_tracking_enabled),
        late_reason_required: Boolean(draft.late_reason_required),
        company_id: Number(draft.company_id),
        department_id: draft.department_id ? Number(draft.department_id) : false,
        timezone: draft.timezone || false,
        late_threshold_minutes: Math.round(grace),
        office_start_hour: start,
        office_end_hour: end,
        daily_work_hours: paid,
        late_until_hour: lateUntil,
        half_day_after_hour: halfAfter,
        half_day_min_hours_ratio: ratio,
        kra_workday_creates_attendance: Boolean(draft.kra_workday_creates_attendance),
        ...DAYS.reduce((acc, d) => ({ ...acc, [d.field]: Boolean(draft[d.field]) }), {}),
      };
      const saved = await saveAttendanceConfig(config.id, values);
      if (saved) {
        setConfig(saved);
        setDraft(toDraft(saved));
      }
      showToast('Attendance rules updated.', 'success');
      navigation.goBack();
    } catch (e) {
      showToast(e?.message || 'Could not save the changes.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const onRecompute = async () => {
    setConfirmRecompute(false);
    setRecomputing(true);
    try {
      await recomputeAttendanceConfig(config.id);
      showToast('Late and leave figures recomputed for the last 3 months.', 'success');
    } catch (e) {
      showToast(e?.message || 'Could not recompute.', 'danger');
    } finally {
      setRecomputing(false);
    }
  };

  const tracking = Boolean(draft.late_tracking_enabled);
  const readOnly = !canEdit;

  const departmentOptions = useMemo(
    () => [{ value: NO_DEPARTMENT, label: 'Company-wide (no department)' }, ...departments],
    [departments]
  );

  const scopeLabel = config?.department_id ? config.department_id[1] : 'Company-wide';

  return (
    <AdminScreen
      navigation={navigation}
      title={loading ? 'Attendance rules' : scopeLabel}
      subtitle="Office hours, ladder and working days"
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        load();
      }}
    >
      {readOnly ? (
        <View style={{ marginBottom: spacing.md }}>
          <Chip label="View only — you cannot edit these" tone="muted" size="sm" />
        </View>
      ) : null}

      {/* --- Late Tracking --- */}
      <Section title="Late tracking" icon="alarm-outline" tone="warning">
        <SwitchRow
          label="Late tracking"
          help="Off means check-ins are still recorded but nothing is flagged late, no reason is asked and no figures are kept."
          value={draft.late_tracking_enabled}
          onValueChange={(v) => set('late_tracking_enabled', v)}
          disabled={readOnly}
          last={!tracking}
        />
        {tracking ? (
          <SwitchRow
            label="Require late reason"
            help="Ask the employee why they were late. Off hides the Enter Late Reason button."
            value={draft.late_reason_required}
            onValueChange={(v) => set('late_reason_required', v)}
            disabled={readOnly}
            last
          />
        ) : null}
      </Section>

      {!tracking ? (
        <Note tone="warning" icon="information-circle-outline">
          Late tracking is off for this scope. Switch it back on and use Recompute
          below to restore the figures it stopped keeping.
        </Note>
      ) : null}

      {/* --- Scope --- */}
      <Section title="Scope" icon="business-outline" tone="info">
        <Picker
          label="Company"
          value={labelFor(companies, draft.company_id) || (config?.company_id ? config.company_id[1] : '')}
          icon="business-outline"
          error={errors.company_id}
          disabled={readOnly}
          onPress={() => setSheet('company')}
        />
        <Picker
          label="Department"
          value={
            draft.department_id
              ? labelFor(departments, draft.department_id) || '—'
              : 'Company-wide (no department)'
          }
          icon="people-outline"
          disabled={readOnly}
          onPress={() => setSheet('department')}
          style={{ marginTop: spacing.base }}
        />
        <Picker
          label="Office timezone"
          value={draft.timezone || "Each employee's own"}
          icon="globe-outline"
          disabled={readOnly}
          onPress={() => setSheet('timezone')}
          style={{ marginTop: spacing.base }}
        />
        <Caption>
          Check-ins are converted to this timezone before being compared to the
          start time, so where the server lives does not matter.
        </Caption>
      </Section>

      {/* --- Late Settings --- */}
      {tracking ? (
        <Section title="Late settings" icon="hourglass-outline" tone="warning">
          <AppTextInput
            label="Grace minutes"
            value={draft.late_threshold_minutes}
            onChangeText={(v) => set('late_threshold_minutes', v.replace(/[^0-9]/g, ''))}
            icon="hourglass-outline"
            error={errors.late_threshold_minutes}
            keyboardType="number-pad"
            editable={!readOnly}
          />
          <Caption>
            Minutes after Office Start before a check-in counts as late. 15 on a
            09:30 start means anyone in by 09:45 is on time.
          </Caption>
        </Section>
      ) : null}

      {/* --- Office Hours --- */}
      <Section title="Office hours" icon="time-outline" tone="primary">
        <AppTextInput
          label="Office start"
          value={draft.office_start_hour}
          onChangeText={(v) => setHour('office_start_hour', v)}
          icon="log-in-outline"
          error={errors.office_start_hour}
          keyboardType="numbers-and-punctuation"
          editable={!readOnly}
        />
        <AppTextInput
          label="Office end"
          value={draft.office_end_hour}
          onChangeText={(v) => setHour('office_end_hour', v)}
          icon="log-out-outline"
          error={errors.office_end_hour}
          keyboardType="numbers-and-punctuation"
          editable={!readOnly}
          style={{ marginTop: spacing.base }}
        />
        <AppTextInput
          label="Daily paid hours"
          value={draft.daily_work_hours}
          onChangeText={(v) => set('daily_work_hours', v.replace(/[^0-9.]/g, ''))}
          icon="briefcase-outline"
          error={errors.daily_work_hours}
          keyboardType="decimal-pad"
          editable={!readOnly}
          style={{ marginTop: spacing.base }}
        />
        <Caption>
          Recalculated from the office hours as you change them, and meant to be
          overridden: 09:30–18:30 spans 9 hours while only 8 are paid if lunch is
          unpaid. This is the baseline for the half-day hours test.
        </Caption>
      </Section>

      {/* --- Day Status Ladder --- */}
      <Section title="Day status ladder" icon="layers-outline" tone="accent">
        <AppTextInput
          label="Late window ends"
          value={draft.late_until_hour}
          onChangeText={(v) => set('late_until_hour', v)}
          icon="alarm-outline"
          error={errors.late_until_hour}
          keyboardType="numbers-and-punctuation"
          editable={!readOnly}
        />
        <AppTextInput
          label="Half day after"
          value={draft.half_day_after_hour}
          onChangeText={(v) => set('half_day_after_hour', v)}
          icon="contrast-outline"
          error={errors.half_day_after_hour}
          keyboardType="numbers-and-punctuation"
          editable={!readOnly}
          style={{ marginTop: spacing.base }}
        />
        <AppTextInput
          label="Half day below ratio"
          value={draft.half_day_min_hours_ratio}
          onChangeText={(v) => set('half_day_min_hours_ratio', v.replace(/[^0-9.]/g, ''))}
          icon="pie-chart-outline"
          error={errors.half_day_min_hours_ratio}
          keyboardType="decimal-pad"
          editable={!readOnly}
          style={{ marginTop: spacing.base }}
        />
        <Caption>Set any threshold to 00:00 (or the ratio to 0) to switch that rule off.</Caption>

        <View style={{ marginTop: spacing.md }}>
          <SwitchRow
            label="KRA workday creates attendance"
            help="Start Workday in the KRA board creates the check-in here. No effect unless that bridge module is installed."
            value={draft.kra_workday_creates_attendance}
            onValueChange={(v) => set('kra_workday_creates_attendance', v)}
            disabled={readOnly}
            last
          />
        </View>
      </Section>

      {tracking ? <GradingNote /> : null}

      {/* --- Working Days --- */}
      <Section title="Working days" icon="calendar-outline" tone="success">
        <View style={styles.days}>
          {DAYS.map((d) => {
            const on = Boolean(draft[d.field]);
            return (
              <Pressable
                key={d.field}
                onPress={readOnly ? undefined : () => set(d.field, !on)}
                accessibilityRole="switch"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${d.name} ${on ? 'is a working day' : 'is not a working day'}`}
                style={[
                  styles.day,
                  {
                    backgroundColor: on ? withAlpha(colors.success, 0.16) : colors.surfaceAlt,
                    borderColor: on ? withAlpha(colors.success, 0.45) : colors.border,
                    opacity: readOnly ? 0.6 : 1,
                  },
                ]}
              >
                <Text
                  style={{
                    color: on ? colors.success : colors.muted,
                    fontFamily: on ? fonts.bold : fonts.regular,
                    fontSize: fontSize.sm,
                  }}
                >
                  {d.letter}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Caption>
          Unchecked days are never stamped Absent and are excluded from the
          working-day count that divides the monthly wage — which is exactly what
          makes them paid.
        </Caption>
        {workingDayCount === 0 ? (
          <Note tone="danger" icon="alert-circle-outline">
            Pick at least one working day. Zero makes the monthly working-day count
            zero, and every daily rate in payroll divides by it.
          </Note>
        ) : null}
      </Section>

      {!readOnly ? (
        <>
          <View style={styles.actions}>
            <PrimaryButton
              label="Cancel"
              variant="ghost"
              onPress={() => navigation.goBack()}
              style={{ flex: 1 }}
            />
            <PrimaryButton label="Save" loading={saving} onPress={submit} style={{ flex: 1 }} />
          </View>

          <PrimaryButton
            label="Recompute last 3 months"
            variant="ghost"
            loading={recomputing}
            onPress={() => setConfirmRecompute(true)}
            style={{ marginTop: spacing.md }}
          />
          <Caption>
            Saving already recomputes when a rule changes. This is for after
            switching late tracking back on.
          </Caption>
        </>
      ) : null}

      <SelectSheet
        visible={sheet === 'timezone'}
        title="Office timezone"
        icon="globe-outline"
        searchable
        options={timezones}
        value={draft.timezone}
        onSelect={(v) => set('timezone', v)}
        onClose={() => setSheet(null)}
        emptyLabel="No timezone matches that."
      />
      <SelectSheet
        visible={sheet === 'company'}
        title="Company"
        icon="business-outline"
        options={companies}
        value={draft.company_id}
        onSelect={(v) => set('company_id', v)}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'department'}
        title="Department"
        icon="people-outline"
        searchable={departments.length > 12}
        options={departmentOptions}
        value={draft.department_id ?? NO_DEPARTMENT}
        onSelect={(v) => set('department_id', v === NO_DEPARTMENT ? null : v)}
        onClose={() => setSheet(null)}
      />

      <ConfirmDialog
        visible={confirmRecompute}
        title="Recompute 3 months?"
        message="This re-grades every attendance and leave record for the last three months in this scope. It can take a while on a busy database."
        confirmLabel="Recompute"
        tone="info"
        icon="refresh-outline"
        onConfirm={onRecompute}
        onCancel={() => setConfirmRecompute(false)}
      />
    </AdminScreen>
  );
}

function labelFor(options, value) {
  const hit = options.find((o) => o.value === value);
  return hit ? hit.label : '';
}

function Section({ title, icon, tone, children }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const color = colors[tone] || colors.primary;
  return (
    <Card padded={false} style={{ marginBottom: spacing.md }}>
      <View style={[styles.head, { borderBottomColor: colors.border }]}>
        <View style={[styles.headIcon, { backgroundColor: withAlpha(color, 0.13) }]}>
          <Ionicons name={icon} size={16} color={color} />
        </View>
        <Text
          style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.sm, marginLeft: 10 }}
        >
          {title}
        </Text>
      </View>
      <View style={{ paddingHorizontal: spacing.base, paddingVertical: spacing.md }}>{children}</View>
    </Card>
  );
}

/** A read-only field that opens a sheet. AppTextInput supports exactly this. */
function Picker({ label, value, icon, error, disabled, onPress, style }) {
  const { colors } = useTheme();
  return (
    <AppTextInput
      label={label}
      value={value}
      icon={icon}
      error={error}
      editable={false}
      onPress={disabled ? undefined : onPress}
      style={[{ opacity: disabled ? 0.6 : 1 }, style]}
      rightSlot={<Ionicons name="chevron-down" size={17} color={colors.muted} />}
    />
  );
}

function Caption({ children }) {
  const { colors, fonts, fontSize, spacing } = useTheme();
  return (
    <Text
      style={{
        color: colors.muted,
        fontFamily: fonts.regular,
        fontSize: fontSize.xs,
        marginTop: spacing.sm,
        lineHeight: 17,
      }}
    >
      {children}
    </Text>
  );
}

function Note({ tone, icon, children }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const color = colors[tone] || colors.warning;
  return (
    <View
      style={[
        styles.note,
        {
          backgroundColor: withAlpha(color, 0.1),
          borderColor: withAlpha(color, 0.35),
          marginBottom: spacing.md,
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text style={{ flex: 1, color, fontFamily: fonts.medium, fontSize: fontSize.xs, lineHeight: 17 }}>
        {children}
      </Text>
    </View>
  );
}

/** The backend form's "How a day is graded" panel, collapsed by default. */
function GradingNote() {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const [open, setOpen] = useState(false);
  const lines = [
    'In by Office Start + Grace → Present, nothing owed.',
    'Between that and Late Window Ends → Late. Recorded, but not charged.',
    'After Late Window Ends → Present again, nothing owed.',
    'After Half Day After → Half Day, charged half a day.',
    'Worked under Half Day Below Ratio of paid hours → Half Day, decided on check-out.',
    'Never checked in on a working day → Absent, stamped by the cron.',
  ];
  return (
    <Card style={{ marginBottom: spacing.md }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Ionicons name="help-circle-outline" size={17} color={colors.info} />
        <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
          How a day is graded
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={17} color={colors.muted} />
      </Pressable>
      {open ? (
        <View style={{ marginTop: spacing.md }}>
          {lines.map((l) => (
            <View key={l} style={{ flexDirection: 'row', gap: 8, marginTop: 7 }}>
              <View style={[styles.bullet, { backgroundColor: withAlpha(colors.info, 0.55) }]} />
              <Text
                style={{
                  flex: 1,
                  color: colors.muted,
                  fontFamily: fonts.regular,
                  fontSize: fontSize.xs,
                  lineHeight: 17,
                }}
              >
                {l}
              </Text>
            </View>
          ))}
          <Text
            style={{
              color: colors.text,
              fontFamily: fonts.medium,
              fontSize: fontSize.xs,
              marginTop: spacing.md,
              lineHeight: 17,
            }}
          >
            A half day is the only deduction. Lateness costs nothing, and an absent
            day is handled by not being earned.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  headIcon: { width: 30, height: 30, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  days: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  day: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 11,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: 12,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  bullet: { width: 5, height: 5, borderRadius: 3, marginTop: 6 },
});
