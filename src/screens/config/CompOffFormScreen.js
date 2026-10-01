import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import {
  Card,
  Chip,
  AppTextInput,
  DateField,
  PrimaryButton,
  SelectSheet,
  ConfirmDialog,
  useToast,
} from '../../components';
import {
  fetchCompOffCredit,
  createCompOffCredit,
  cancelCompOffCredit,
  restoreCompOffCredit,
  grantCompOffCredit,
  fetchCompOffRedemptions,
  fetchEmployeeOptions,
} from '../../services/odoo';
import { formatDateKeyShort, todayKey } from '../../utils/time';
import AdminScreen from './AdminScreen';
import { GUIDES } from './guides';
import { FactRow } from './Money';
import { nameOf } from './StatusRows';
import { Note } from './FormBits';
import { COMP_OFF_SOURCES, compOffStateMeta, compOffSourceLabel, fmtDays } from './compOffConstants';
import { goBackOnce } from '../../navigation/back';

const DAY_OPTIONS = [
  { value: 1, label: 'Full day (1)' },
  { value: 0.5, label: 'Half day (0.5)' },
];
const SOURCE_OPTIONS = Object.entries(COMP_OFF_SOURCES).map(([value, label]) => ({ value, label }));

/**
 * One comp-off credit.
 *
 * New: a manual credit, for a day the server missed (a check-in that never
 * happened on the device, say). Saved with auto_created=false so the next
 * check-in cannot resize or delete it.
 *
 * Existing: read-only facts plus Cancel and Restore. There is no edit --
 * Odoo's form is the same -- because the amount already spent is derived
 * from the leave requests, not stored here.
 */
export default function CompOffFormScreen({ navigation, route }) {
  const id = route?.params?.id || null;
  const presetEmployee = route?.params?.employeeId || null;
  const { colors, fonts, fontSize, spacing } = useTheme();
  const showToast = useToast();

  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  const [employeeId, setEmployeeId] = useState(presetEmployee);
  const [employees, setEmployees] = useState([]);
  const [date, setDate] = useState(todayKey());
  const [days, setDays] = useState(1);
  const [source, setSource] = useState('weekly_off');
  const [note, setNote] = useState('');
  const [sheet, setSheet] = useState(null);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (id) return;
    fetchEmployeeOptions().then(setEmployees).catch(() => setEmployees([]));
  }, [id]);

  const [usage, setUsage] = useState([]);

  const loadRow = () => {
    if (!id) return;
    setLoading(true);
    fetchCompOffCredit(id)
      .then((r) => {
        if (!r) throw new Error('That credit no longer exists.');
        setRow(r);
        setError('');
        // Which leave spent it. Kept after a reject or cancel, so the full
        // history of the credit reads back here.
        fetchCompOffRedemptions({ creditId: id }).then(setUsage).catch(() => setUsage([]));
      })
      .catch((e) => setError(e?.message || 'Could not load that credit.'))
      .finally(() => setLoading(false));
  };
  useEffect(loadRow, [id]);

  const submit = async () => {
    const next = {};
    if (!employeeId) next.employee = 'Pick an employee.';
    if (!date) next.date = 'Pick the day that was worked.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy('save');
    try {
      await createCompOffCredit({
        employee_id: Number(employeeId),
        date_earned: date,
        days: Number(days),
        source,
        note: note.trim() || false,
      });
      showToast('Credit added.', 'success');
      goBackOnce(navigation);
    } catch (e) {
      // The UNIQUE(employee_id, date_earned) constraint is the usual failure.
      showToast(e?.message || 'Could not add the credit.', 'danger');
    } finally {
      setBusy('');
    }
  };

  const onCancel = async () => {
    setConfirmCancel(false);
    setBusy('cancel');
    try {
      await cancelCompOffCredit(id);
      showToast('Credit cancelled.', 'success');
      loadRow();
    } catch (e) {
      showToast(e?.message || 'Could not cancel the credit.', 'danger');
    } finally {
      setBusy('');
    }
  };

  const onGrant = async () => {
    setBusy('grant');
    try {
      await grantCompOffCredit(id);
      showToast('Credit granted.', 'success');
      loadRow();
    } catch (e) {
      showToast(e?.message || 'Could not grant the credit.', 'danger');
    } finally {
      setBusy('');
    }
  };

  const onRestore = async () => {
    setBusy('restore');
    try {
      await restoreCompOffCredit(id);
      showToast('Credit restored.', 'success');
      loadRow();
    } catch (e) {
      showToast(e?.message || 'Could not restore the credit.', 'danger');
    } finally {
      setBusy('');
    }
  };

  const meta = row ? compOffStateMeta(row.state) : null;
  const pastExpiry = row?.expiry_date && row.expiry_date < todayKey();

  return (
    <AdminScreen guide={id ? GUIDES.compOffExisting : GUIDES.compOffNew}
      navigation={navigation}
      title={id ? 'Comp-off credit' : 'Add credit'}
      subtitle={row ? nameOf(row.employee_id) : 'A day off that was worked'}
      loading={loading}
      error={error}
      onRetry={loadRow}
    >
      {row ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.lg }}>
                {formatDateKeyShort(row.date_earned)}
              </Text>
              <Chip label={meta.label} tone={meta.tone} />
            </View>
            <FactRow label="Employee" value={nameOf(row.employee_id)} />
            <FactRow label="Source" value={compOffSourceLabel(row.source)} />
            <FactRow label="Credited" value={`${fmtDays(row.days)} day${Number(row.days) === 1 ? '' : 's'}`} />
            <FactRow label="Used" value={fmtDays(row.days_used)} />
            <FactRow label="Left" value={fmtDays(row.days_left)} tone={Number(row.days_left) > 0 ? 'success' : undefined} />
            {Number(row.days_lapsed) > 0 ? <FactRow label="Lapsed" value={fmtDays(row.days_lapsed)} tone="warning" /> : null}
            <FactRow label="Expires" value={row.expiry_date ? formatDateKeyShort(row.expiry_date) : 'Never'} />
            {row.holiday_name ? <FactRow label="Holiday" value={row.holiday_name} /> : null}
            {Number(row.hours_worked) > 0 ? <FactRow label="Hours worked" value={`${fmtDays(row.hours_worked)} h`} /> : null}
            <FactRow
              label="Created"
              value={
                row.auto_created
                  ? `Declared${Array.isArray(row.declared_by) ? ` by ${row.declared_by[1]}` : ''}`
                  : `By hand${Array.isArray(row.declared_by) ? `, ${row.declared_by[1]}` : ''}`
              }
            />
            {row.note ? <FactRow label="Note" value={row.note} last /> : null}
          </Card>

          {usage.length ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.base, marginBottom: spacing.sm }}>
                Used by
              </Text>
              {usage.map((u, i) => (
                <FactRow
                  key={u.id}
                  label={
                    u.leaveFrom
                      ? u.leaveTo && u.leaveTo !== u.leaveFrom
                        ? `${formatDateKeyShort(u.leaveFrom)} – ${formatDateKeyShort(u.leaveTo)}`
                        : formatDateKeyShort(u.leaveFrom)
                      : u.requestName
                  }
                  value={`${fmtDays(u.days)} day · ${u.requestState}${u.active ? '' : ' (released)'}`}
                  tone={u.requestState === 'approved' ? 'success' : u.active ? undefined : 'muted'}
                  last={i === usage.length - 1}
                />
              ))}
            </Card>
          ) : null}

          {row.state === 'declared' ? (
            <PrimaryButton
              label="Grant as earned"
              loading={busy === 'grant'}
              onPress={onGrant}
              style={{ marginTop: spacing.lg }}
            />
          ) : null}
          {row.state !== 'cancelled' && row.state !== 'consumed' ? (
            <PrimaryButton
              label="Cancel credit"
              variant="ghost"
              tone="danger"
              loading={busy === 'cancel'}
              onPress={() => setConfirmCancel(true)}
              style={{ marginTop: spacing.lg }}
            />
          ) : null}
          {row.state === 'expired' || row.state === 'cancelled' ? (
            <>
              <PrimaryButton
                label="Restore"
                loading={busy === 'restore'}
                onPress={onRestore}
                style={{ marginTop: spacing.md }}
              />
              {pastExpiry ? (
                <Note tone="warning" icon="time-outline" style={{ marginTop: spacing.md }}>
                  Its expiry date has passed. Restoring gives it a fresh expiry window from today.
                </Note>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
        <>
          <Card>
            <AppTextInput
              label="Employee"
              value={employees.find((e) => e.value === employeeId)?.label || ''}
              icon="person-outline"
              error={errors.employee}
              editable={false}
              onPress={() => setSheet('employee')}
              rightSlot={<Ionicons name="chevron-down" size={17} color={colors.muted} />}
            />
            <DateField
              label="Day worked"
              value={date}
              onChange={(v) => {
                setDate(v);
                if (errors.date) setErrors((e) => ({ ...e, date: undefined }));
              }}
              maxDate={todayKey()}
              error={errors.date}
              style={{ marginTop: spacing.base }}
            />
            <AppTextInput
              label="Credit"
              value={DAY_OPTIONS.find((d) => d.value === days)?.label || ''}
              icon="contrast-outline"
              editable={false}
              onPress={() => setSheet('days')}
              rightSlot={<Ionicons name="chevron-down" size={17} color={colors.muted} />}
              style={{ marginTop: spacing.base }}
            />
            <AppTextInput
              label="Source"
              value={compOffSourceLabel(source)}
              icon="flag-outline"
              editable={false}
              onPress={() => setSheet('source')}
              rightSlot={<Ionicons name="chevron-down" size={17} color={colors.muted} />}
              style={{ marginTop: spacing.base }}
            />
            <AppTextInput
              label="Note (optional)"
              value={note}
              onChangeText={setNote}
              icon="create-outline"
              style={{ marginTop: spacing.base }}
            />
          </Card>

          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.regular,
              fontSize: fontSize.xs,
              marginTop: spacing.md,
              lineHeight: 17,
            }}
          >
            Use this for a day off the system did not catch. A manual credit is never resized
            or withdrawn by later check-ins. One credit per employee per day.
          </Text>

          <PrimaryButton
            label="Add credit"
            loading={busy === 'save'}
            onPress={submit}
            style={{ marginTop: spacing.lg }}
          />
        </>
      )}

      <SelectSheet
        visible={sheet === 'employee'}
        title="Employee"
        icon="person-outline"
        options={employees}
        value={employeeId}
        onSelect={(v) => {
          setEmployeeId(v);
          if (errors.employee) setErrors((e) => ({ ...e, employee: undefined }));
        }}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'days'}
        title="Credit"
        icon="contrast-outline"
        options={DAY_OPTIONS}
        value={days}
        onSelect={setDays}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'source'}
        title="Source"
        icon="flag-outline"
        options={SOURCE_OPTIONS}
        value={source}
        onSelect={setSource}
        onClose={() => setSheet(null)}
      />

      <ConfirmDialog
        visible={confirmCancel}
        title="Cancel this credit?"
        message="The unspent part stops counting towards the employee's comp-off balance. If any of it is already used by a leave, the server will refuse until that leave is cancelled or rejected."
        confirmLabel="Cancel credit"
        icon="close-circle-outline"
        onConfirm={onCancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </AdminScreen>
  );
}
