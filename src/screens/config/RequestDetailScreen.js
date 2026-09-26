import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip, PrimaryButton, ConfirmDialog, PromptDialog, useToast } from '../../components';
import {
  fetchLeaveQueue,
  fetchWfhQueue,
  approveLeave,
  rejectLeave,
  approveWfh,
  rejectWfh,
  approveLeaveCancellation,
  rejectLeaveCancellation,
  cancelApprovedLeave,
} from '../../services/odoo';
import { formatDateKeyShort, odooUtcToIso } from '../../utils/time';
import AdminScreen from './AdminScreen';
import { GUIDES } from './guides';
import { leaveStateMeta, wfhStateMeta, leaveTypeLabel } from './requestConstants';

/** Odoo UTC datetime -> a short local 'DD Mon, HH:MM'. */
function stamp(value) {
  const iso = odooUtcToIso(value);
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * One request, and the decision.
 *
 * Approve and reject go through the module's own /leave/* and /wfh/* routes
 * rather than call_kw: those check the manager group and only then sudo past
 * the record rule, which is what lets a manager act on somebody else's row.
 *
 * Only a PENDING request offers the buttons. Both models raise a UserError on
 * anything else, and that error is surfaced rather than swallowed -- it is
 * exactly what the second manager should see when someone else got there
 * first, and the list is reloaded on the way back so it reads true.
 */
export default function RequestDetailScreen({ navigation, route }) {
  const kind = route?.params?.kind === 'wfh' ? 'wfh' : 'leave';
  const id = route?.params?.id;
  const isWfh = kind === 'wfh';
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const showToast = useToast();

  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [promptReject, setPromptReject] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [promptKeep, setPromptKeep] = useState(false);

  const load = useCallback(async () => {
    try {
      const fetch = isWfh ? fetchWfhQueue : fetchLeaveQueue;
      const rows = await fetch({ state: null });
      const hit = rows.find((r) => r.id === Number(id));
      if (!hit) throw new Error('That request no longer exists.');
      setRow(hit);
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the request.');
    } finally {
      setLoading(false);
    }
  }, [isWfh, id]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (fn, successText) => {
    setBusy(true);
    try {
      await fn();
      showToast(successText, 'success');
      navigation.goBack();
    } catch (e) {
      // Commonly "Only pending requests can be approved." -- someone else
      // decided it first. Show the server's own words and refresh.
      showToast(e?.message || 'The server refused that.', 'danger');
      setLoading(true);
      load();
    } finally {
      setBusy(false);
    }
  };

  const meta = row ? (isWfh ? wfhStateMeta(row.state) : leaveStateMeta(row.state)) : null;
  const pending = row?.state === 'pending';
  // Approved leave: HR decides an employee's cancellation request, or cancels
  // it directly. Only on a server that knows cancel_requested (19.0.10.3.0+).
  const cancelAware = row && Object.prototype.hasOwnProperty.call(row, 'cancel_requested');
  const cancelAsk = !isWfh && cancelAware && row.state === 'approved' && row.cancel_requested;
  const canDirectCancel = !isWfh && cancelAware && row.state === 'approved' && !row.cancel_requested;

  return (
    <AdminScreen guide={GUIDES.requestDetail}
      navigation={navigation}
      title={row?.employee_name || 'Request'}
      subtitle={isWfh ? 'Work from home' : 'Leave request'}
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        load();
      }}
    >
      {row ? (
        <>
          <Card padded={false}>
            <View style={[styles.head, { borderBottomColor: colors.border }]}>
              <View style={[styles.icon, { backgroundColor: withAlpha(colors[meta.tone] || colors.muted, 0.13) }]}>
                <Ionicons name={meta.icon} size={17} color={colors[meta.tone] || colors.muted} />
              </View>
              <Text
                style={{ flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.sm, marginLeft: 10 }}
              >
                {isWfh ? 'Work from home' : leaveTypeLabel(row.leave_type)}
              </Text>
              <Chip label={meta.label} tone={meta.tone} size="sm" />
            </View>

            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
              {isWfh ? (
                <Row label="Date" value={formatDateKeyShort(row.request_date)} />
              ) : (
                <>
                  <Row
                    label="Dates"
                    value={
                      row.to_date && row.to_date !== row.from_date
                        ? `${formatDateKeyShort(row.from_date)} – ${formatDateKeyShort(row.to_date)}`
                        : formatDateKeyShort(row.from_date)
                    }
                  />
                  <Row
                    label="Days"
                    value={row.is_half_day ? 'Half day' : `${row.number_of_days}`}
                  />
                  <Row label="Paid / unpaid" value={`${row.paid_days} / ${row.unpaid_days}`} />
                  {row.leave_type === 'comp_off' && row.comp_off_earned_dates ? (
                    <Row label="Earned on" value={row.comp_off_earned_dates} />
                  ) : null}
                  {row.leave_type === 'comp_off' ? (
                    <Row
                      label="Comp-off balance"
                      value={`${row.comp_off_balance ?? 0}`}
                      tone={Number(row.comp_off_balance) < Number(row.number_of_days) ? 'danger' : undefined}
                    />
                  ) : null}
                  {Number(row.deduction_amount) > 0 ? (
                    <Row label="Deduction" value={String(row.deduction_amount)} tone="danger" />
                  ) : null}
                </>
              )}
              <Row label="Submitted" value={stamp(row.submitted_on)} />
              {row.state !== 'pending' ? (
                <Row
                  label={row.state === 'approved' ? 'Approved by' : 'Decided by'}
                  value={
                    row.auto_approved
                      ? 'Auto-approved'
                      : Array.isArray(row.approved_by)
                        ? row.approved_by[1]
                        : '—'
                  }
                />
              ) : null}
              {isWfh && row.checkin_time ? (
                <Row
                  label="Worked"
                  value={`${stamp(row.checkin_time)}${row.worked_hours_display ? ` · ${row.worked_hours_display}` : ''}`}
                  last
                />
              ) : null}
            </View>
          </Card>

          <Card style={{ marginTop: spacing.md }}>
            <Text style={{ color: colors.muted, fontFamily: fonts.semibold, fontSize: fontSize.xs, letterSpacing: 0.6 }}>
              REASON
            </Text>
            <Text
              style={{
                color: colors.text,
                fontFamily: fonts.regular,
                fontSize: fontSize.sm,
                marginTop: 6,
                lineHeight: 20,
              }}
            >
              {row.reason || 'No reason given.'}
            </Text>
          </Card>

          {row.state === 'rejected' && row.rejection_reason ? (
            <Card
              style={{
                marginTop: spacing.md,
                backgroundColor: withAlpha(colors.danger, 0.08),
                borderColor: withAlpha(colors.danger, 0.28),
              }}
            >
              <Text style={{ color: colors.danger, fontFamily: fonts.semibold, fontSize: fontSize.xs, letterSpacing: 0.6 }}>
                REJECTED BECAUSE
              </Text>
              <Text
                style={{
                  color: colors.danger,
                  fontFamily: fonts.regular,
                  fontSize: fontSize.sm,
                  marginTop: 6,
                  lineHeight: 20,
                }}
              >
                {row.rejection_reason}
              </Text>
            </Card>
          ) : null}

          {cancelAsk ? (
            <Card
              style={{
                marginTop: spacing.md,
                backgroundColor: withAlpha(colors.warning, 0.1),
                borderColor: withAlpha(colors.warning, 0.32),
              }}
            >
              <Text style={{ color: colors.warning, fontFamily: fonts.semibold, fontSize: fontSize.xs, letterSpacing: 0.6 }}>
                CANCELLATION REQUESTED
              </Text>
              <Text style={{ color: colors.text, fontFamily: fonts.regular, fontSize: fontSize.sm, marginTop: 6, lineHeight: 20 }}>
                {row.cancel_reason || 'No reason given.'}
              </Text>
              {row.cancel_requested_on ? (
                <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 6 }}>
                  Asked {stamp(row.cancel_requested_on)}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {cancelAsk ? (
            <View style={styles.actions}>
              <PrimaryButton
                label="Keep leave"
                variant="outline"
                tone="danger"
                onPress={() => setPromptKeep(true)}
                disabled={busy}
                style={{ flex: 1 }}
              />
              <PrimaryButton
                label="Approve cancellation"
                variant="solid"
                tone="warning"
                loading={busy}
                onPress={() => setConfirmCancel(true)}
                style={{ flex: 1 }}
              />
            </View>
          ) : canDirectCancel ? (
            <PrimaryButton
              label="Cancel this leave"
              variant="outline"
              tone="danger"
              loading={busy}
              onPress={() => setConfirmCancel(true)}
              style={{ marginTop: spacing.lg }}
            />
          ) : pending ? (
            <View style={styles.actions}>
              <PrimaryButton
                label="Reject"
                variant="outline"
                tone="danger"
                onPress={() => setPromptReject(true)}
                disabled={busy}
                style={{ flex: 1 }}
              />
              <PrimaryButton
                label="Approve"
                variant="solid"
                tone="success"
                loading={busy}
                onPress={() => setConfirmApprove(true)}
                style={{ flex: 1 }}
              />
            </View>
          ) : (
            <Text
              style={{
                color: colors.muted,
                fontFamily: fonts.regular,
                fontSize: fontSize.xs,
                textAlign: 'center',
                marginTop: spacing.lg,
              }}
            >
              Already {meta.label.toLowerCase()} — only a pending request can be decided.
            </Text>
          )}

          <ConfirmDialog
            visible={confirmApprove}
            title="Approve this request?"
            message={
              isWfh
                ? `${row.employee_name} will be able to check in from home on ${formatDateKeyShort(row.request_date)}.`
                : `${row.employee_name} will be marked on leave, and those days leave the attendance grading.`
            }
            confirmLabel="Approve"
            tone="success"
            icon="checkmark-circle-outline"
            onConfirm={() => {
              setConfirmApprove(false);
              decide(
                () => (isWfh ? approveWfh(row.id) : approveLeave(row.id)),
                'Request approved.'
              );
            }}
            onCancel={() => setConfirmApprove(false)}
          />

          <PromptDialog
            visible={promptReject}
            title="Reject this request?"
            message="The employee sees this reason, so make it useful."
            label="Reason for rejection"
            confirmLabel="Reject"
            icon="close-circle-outline"
            // The WFH route refuses an empty reason outright; leave's accepts
            // one but the employee is then told nothing. Required for both.
            required
            loading={busy}
            onConfirm={(reason) => {
              setPromptReject(false);
              decide(
                () => (isWfh ? rejectWfh(row.id, reason) : rejectLeave(row.id, reason)),
                'Request rejected.'
              );
            }}
            onCancel={() => setPromptReject(false)}
          />

          <ConfirmDialog
            visible={confirmCancel}
            title={cancelAsk ? 'Approve the cancellation?' : 'Cancel this approved leave?'}
            message={`${row.employee_name}'s leave is cancelled and its days go back to the balance. Refused if that month's payroll is already confirmed or paid.`}
            confirmLabel={cancelAsk ? 'Approve cancellation' : 'Cancel leave'}
            cancelLabel="Back"
            tone="warning"
            icon="return-down-back-outline"
            onConfirm={() => {
              setConfirmCancel(false);
              decide(
                () => (cancelAsk ? approveLeaveCancellation(row.id) : cancelApprovedLeave(row.id)),
                'Leave cancelled.'
              );
            }}
            onCancel={() => setConfirmCancel(false)}
          />

          <PromptDialog
            visible={promptKeep}
            title="Keep this leave?"
            message="The leave stays approved. The employee sees your reason."
            label="Why it stays"
            confirmLabel="Keep leave"
            icon="close-circle-outline"
            required
            loading={busy}
            onConfirm={(reason) => {
              setPromptKeep(false);
              decide(() => rejectLeaveCancellation(row.id, reason), 'Cancellation declined; leave kept.');
            }}
            onCancel={() => setPromptKeep(false)}
          />
        </>
      ) : null}
    </AdminScreen>
  );
}

function Row({ label, value, tone, last }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <View style={[styles.detailRow, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : 1 }]}>
      <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm }}>
        {label}
      </Text>
      <Text
        style={{
          flex: 1,
          textAlign: 'right',
          color: tone ? colors[tone] : colors.text,
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
  icon: { width: 30, height: 30, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
});
