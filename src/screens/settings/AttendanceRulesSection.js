import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip, AppTextInput, PrimaryButton } from '../../components';
import { formatHourFloat, parseHourFloat } from '../../utils/time';

const DAYS = [
  { field: 'work_monday', letter: 'M', name: 'Monday' },
  { field: 'work_tuesday', letter: 'T', name: 'Tuesday' },
  { field: 'work_wednesday', letter: 'W', name: 'Wednesday' },
  { field: 'work_thursday', letter: 'T', name: 'Thursday' },
  { field: 'work_friday', letter: 'F', name: 'Friday' },
  { field: 'work_saturday', letter: 'S', name: 'Saturday' },
  { field: 'work_sunday', letter: 'S', name: 'Sunday' },
];

/** A ladder threshold of exactly 0 means the rule is switched off, not midnight. */
const ladder = (v) => (Number(v) > 0 ? formatHourFloat(v) : 'Off');

/**
 * The attendance rules, read-only for everyone and editable for whoever the
 * server says may write them.
 *
 * Grouped the way the backend form groups them, so whoever maintains both can
 * recognise one from the other.
 */
export default function AttendanceRulesSection({ config, overrides, canEdit, saving, onSave }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});

  // Reset the draft whenever the underlying record changes or editing starts,
  // so a cancelled edit never leaks into the next one.
  useEffect(() => {
    if (!config) return;
    setDraft({
      office_start_hour: formatHourFloat(config.office_start_hour),
      office_end_hour: formatHourFloat(config.office_end_hour),
      late_threshold_minutes: String(config.late_threshold_minutes ?? ''),
      late_until_hour: formatHourFloat(config.late_until_hour),
      half_day_after_hour: formatHourFloat(config.half_day_after_hour),
    });
    setErrors({});
  }, [config, editing]);

  if (!config) return null;

  const set = (k, v) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = () => {
    const next = {};
    const start = parseHourFloat(draft.office_start_hour);
    const end = parseHourFloat(draft.office_end_hour);
    const grace = Number(draft.late_threshold_minutes);
    const lateUntil = parseHourFloat(draft.late_until_hour);
    const halfAfter = parseHourFloat(draft.half_day_after_hour);

    if (start === null) next.office_start_hour = 'Use HH:MM, e.g. 09:30.';
    if (end === null) next.office_end_hour = 'Use HH:MM, e.g. 18:30.';
    if (start !== null && end !== null && end <= start) {
      next.office_end_hour = 'The office cannot end before it starts.';
    }
    if (!Number.isFinite(grace) || grace < 0) {
      next.late_threshold_minutes = 'Give a number of minutes, 0 or more.';
    }
    // A ladder threshold outside the office window can never fire, so it is
    // almost certainly a typo rather than an intent.
    if (lateUntil === null) next.late_until_hour = 'Use HH:MM, or 00:00 to switch it off.';
    else if (lateUntil > 0 && start !== null && end !== null && (lateUntil < start || lateUntil > end)) {
      next.late_until_hour = 'Outside office hours, so it would never apply.';
    }
    if (halfAfter === null) next.half_day_after_hour = 'Use HH:MM, or 00:00 to switch it off.';
    else if (halfAfter > 0 && start !== null && end !== null && (halfAfter < start || halfAfter > end)) {
      next.half_day_after_hour = 'Outside office hours, so it would never apply.';
    }

    setErrors(next);
    if (Object.keys(next).length) return;

    onSave(config.id, {
      office_start_hour: start,
      office_end_hour: end,
      late_threshold_minutes: Math.round(grace),
      late_until_hour: lateUntil,
      half_day_after_hour: halfAfter,
    }).then((ok) => {
      if (ok) setEditing(false);
    });
  };

  const hoursChanged =
    parseHourFloat(draft.office_start_hour) !== config.office_start_hour ||
    parseHourFloat(draft.office_end_hour) !== config.office_end_hour;

  return (
    <Card style={{ marginTop: spacing.md }} padded={false}>
      <View style={[styles.head, { borderBottomColor: colors.border }]}>
        <View style={[styles.headIcon, { backgroundColor: withAlpha(colors.primary, 0.12) }]}>
          <Ionicons name="time-outline" size={16} color={colors.primary} />
        </View>
        <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.sm, marginLeft: 10 }}>
          Attendance rules
        </Text>
        {canEdit && !editing ? (
          <Pressable onPress={() => setEditing(true)} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
              Edit
            </Text>
          </Pressable>
        ) : null}
        {!canEdit ? <Chip label="View only" tone="muted" size="sm" /> : null}
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        {editing ? (
          <>
            <AppTextInput
              label="Office start"
              value={draft.office_start_hour}
              onChangeText={(v) => set('office_start_hour', v)}
              icon="log-in-outline"
              error={errors.office_start_hour}
              keyboardType="numbers-and-punctuation"
              style={{ marginTop: spacing.md }}
            />
            <AppTextInput
              label="Office end"
              value={draft.office_end_hour}
              onChangeText={(v) => set('office_end_hour', v)}
              icon="log-out-outline"
              error={errors.office_end_hour}
              keyboardType="numbers-and-punctuation"
              style={{ marginTop: spacing.base }}
            />

            {/* daily_work_hours is a stored compute off the office hours. It is
                currently 8 while the window is 9 -- someone set it by hand --
                and saving new hours will overwrite that. Say so here rather
                than letting the figure quietly change. */}
            {hoursChanged ? (
              <View
                style={[
                  styles.note,
                  {
                    backgroundColor: withAlpha(colors.warning, 0.1),
                    borderColor: withAlpha(colors.warning, 0.35),
                    marginTop: spacing.base,
                  },
                ]}
              >
                <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
                <Text style={{ flex: 1, color: colors.warning, fontFamily: fonts.medium, fontSize: fontSize.xs }}>
                  Changing the office hours recalculates Daily paid hours, which is currently{' '}
                  {config.daily_work_hours}. Any figure set by hand will be replaced.
                </Text>
              </View>
            ) : null}

            <AppTextInput
              label="Grace before late (minutes)"
              value={draft.late_threshold_minutes}
              onChangeText={(v) => set('late_threshold_minutes', v.replace(/[^0-9]/g, ''))}
              icon="hourglass-outline"
              error={errors.late_threshold_minutes}
              keyboardType="number-pad"
              style={{ marginTop: spacing.base }}
            />
            <AppTextInput
              label="Late window ends"
              value={draft.late_until_hour}
              onChangeText={(v) => set('late_until_hour', v)}
              icon="alarm-outline"
              error={errors.late_until_hour}
              keyboardType="numbers-and-punctuation"
              style={{ marginTop: spacing.base }}
            />
            <AppTextInput
              label="Half day after"
              value={draft.half_day_after_hour}
              onChangeText={(v) => set('half_day_after_hour', v)}
              icon="contrast-outline"
              error={errors.half_day_after_hour}
              keyboardType="numbers-and-punctuation"
              style={{ marginTop: spacing.base }}
            />
            <Text
              style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 8 }}
            >
              Set a threshold to 00:00 to switch that rule off.
            </Text>

            <View style={styles.actions}>
              <PrimaryButton
                label="Cancel"
                variant="ghost"
                onPress={() => setEditing(false)}
                style={{ flex: 1 }}
              />
              <PrimaryButton label="Save" loading={saving} onPress={submit} style={{ flex: 1 }} />
            </View>
          </>
        ) : (
          <>
            <Row label="Office hours" value={`${formatHourFloat(config.office_start_hour)} – ${formatHourFloat(config.office_end_hour)}`} />
            <Row label="Daily paid hours" value={`${config.daily_work_hours}`} />
            <Row label="Grace before late" value={`${config.late_threshold_minutes} min`} />
            <Row label="Late window ends" value={ladder(config.late_until_hour)} />
            <Row label="Half day after" value={ladder(config.half_day_after_hour)} />
            <Row
              label="Half day below ratio"
              value={Number(config.half_day_min_hours_ratio) > 0 ? String(config.half_day_min_hours_ratio) : 'Off'}
            />
            <Row label="Late tracking" value={config.late_tracking_enabled ? 'On' : 'Off'} />
            <Row label="Late reason required" value={config.late_reason_required ? 'Yes' : 'No'} />
            <Row label="Office timezone" value={config.timezone || 'Each employee’s own'} />
            <WorkingDays config={config} />
            <Row label="Applies to" value={config.company_id ? config.company_id[1] : '—'} last />
          </>
        )}
      </View>

      {overrides?.length ? (
        <View style={[styles.overrides, { borderTopColor: colors.border, paddingHorizontal: spacing.lg }]}>
          <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs }}>
            {overrides.length} department override{overrides.length === 1 ? '' : 's'} take precedence over the
            above for their people. Edit those in Odoo.
          </Text>
          {overrides.map((o) => (
            <Text
              key={o.id}
              style={{ color: colors.text, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 6 }}
            >
              {o.department_id?.[1] || 'Department'} · {formatHourFloat(o.office_start_hour)} –{' '}
              {formatHourFloat(o.office_end_hour)} · {o.late_threshold_minutes} min grace
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function WorkingDays({ config }) {
  const { colors, fonts, fontSize, withAlpha } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
      <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm }}>
        Working days
      </Text>
      <View style={styles.days}>
        {DAYS.map((d, i) => {
          const on = Boolean(config[d.field]);
          return (
            <View
              key={i}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${d.name} ${on ? 'is a working day' : 'is not a working day'}`}
              style={[
                styles.day,
                {
                  backgroundColor: on ? withAlpha(colors.success, 0.16) : colors.surfaceAlt,
                  borderColor: on ? withAlpha(colors.success, 0.4) : colors.border,
                },
              ]}
            >
              <Text
                style={{
                  color: on ? colors.success : colors.muted,
                  fontFamily: on ? fonts.semibold : fonts.regular,
                  fontSize: fontSize.xs,
                }}
              >
                {d.letter}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Row({ label, value, last }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : 1 }]}>
      <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm }}>
        {label}
      </Text>
      <Text
        style={{
          flex: 1,
          textAlign: 'right',
          color: colors.text,
          fontFamily: fonts.medium,
          fontSize: fontSize.sm,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  headIcon: { width: 30, height: 30, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12 },
  days: { flexDirection: 'row', gap: 4 },
  day: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
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
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  overrides: { borderTopWidth: 1, paddingVertical: 14 },
});
