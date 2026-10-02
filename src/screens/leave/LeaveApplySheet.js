import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { AppTextInput, PrimaryButton, DatePopup, FadeIn, MailPreviewModal, useToast } from '../../components';
import {
  createLeaveRequest,
  previewCompOffRedemption,
  previewPaidSplit,
  fetchSubmitNotice,
  previewLeaveMail,
} from '../../services/odoo';
import { useSession } from '../../state/SessionContext';
import useWorkCalendar from '../../hooks/useWorkCalendar';
import { formatDateRange, formatDateKeyShort, daysBetween, formatDays } from '../../utils/time';
import { LEAVE_TYPES } from './constants';

const SOURCE_LABEL = { weekly_off: 'Weekly off', public_holiday: 'Public holiday' };

/**
 * Apply for leave.
 *
 * One bottom sheet. Dates are picked in a small centred popup (DatePopup)
 * rather than a calendar that takes the whole sheet over, and the popup marks
 * weekly offs and public holidays so nobody books leave on a day already off.
 *
 * Compensatory off appears as a type only while the employee actually has
 * some to spend. Choosing it asks the server which earned days would pay for
 * the dates (/comp_off/preview, the same allocation submit makes) and lists
 * them read-only: the employee only picks the dates and gives a reason.
 */
export default function LeaveApplySheet({ visible, balance, compOff, onClose, onSubmitted }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const showToast = useToast();
  const slide = useRef(new Animated.Value(0)).current;

  const [leaveType, setLeaveType] = useState('casual');
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const { user } = useSession();
  // Whether HR is emailed on submit. When it is, the sheet shows that email
  // filling in live as the form is completed, so nothing about the alert is a
  // surprise. Best effort: a failure just hides the preview.
  const [notice, setNotice] = useState({ enabled: false, recipients: 0 });
  const [showMail, setShowMail] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Back, the backdrop and X close only this sheet -- and not while Submit is
  // running, so a refusal still has a sheet to land on.
  const dismiss = submitting ? () => {} : onClose;
  const [picking, setPicking] = useState(false);
  // Weekly offs and holidays for the date popup's markers.
  const calendar = useWorkCalendar(visible);
  const [preview, setPreview] = useState({ loading: false, data: null, error: '' });
  const [paidSplit, setPaidSplit] = useState({ loading: false, data: null, failed: false });

  const compOffAvailable = Boolean(compOff?.enabled && compOff.balance > 0);
  const types = LEAVE_TYPES.filter((t) => t.value !== 'comp_off' || compOffAvailable);
  const isCompOff = leaveType === 'comp_off';
  const isHalf = isCompOff && halfDay;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: visible ? 260 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  // Reset on open. Without this, a failed submit's error text is still sitting
  // there the next time the sheet is pulled up.
  useEffect(() => {
    if (!visible) return;
    setLeaveType('casual');
    setFrom(null);
    setTo(null);
    setHalfDay(false);
    setReason('');
    setErrors({});
    setFormError('');
    setPreview({ loading: false, data: null, error: '' });
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    setShowMail(false);
    fetchSubmitNotice()
      .then((n) => alive && setNotice(n))
      .catch(() => alive && setNotice({ enabled: false, recipients: 0 }));
    return () => {
      alive = false;
    };
  }, [visible]);

  // Which earned days would pay for these dates. Re-asked whenever the dates
  // or the half-day switch change, so what is shown is what submit will do.
  useEffect(() => {
    if (!visible || !isCompOff || !from) {
      setPreview({ loading: false, data: null, error: '' });
      return undefined;
    }
    let alive = true;
    setPreview((p) => ({ ...p, loading: true, error: '' }));
    previewCompOffRedemption({ fromDate: from, toDate: isHalf ? null : to, isHalfDay: isHalf })
      .then((data) => alive && setPreview({ loading: false, data, error: '' }))
      .catch((e) => alive && setPreview({ loading: false, data: null, error: e?.message || '' }));
    return () => {
      alive = false;
    };
  }, [visible, isCompOff, from, to, isHalf]);

  // How much of this leave the server would pay and how much is LOP. Same
  // re-ask-on-change pattern as the comp-off preview above. `failed` means an
  // older server without the route: fall back to the local estimate.
  useEffect(() => {
    if (!visible || isCompOff || !from) {
      setPaidSplit({ loading: false, data: null, failed: false });
      return undefined;
    }
    let alive = true;
    setPaidSplit((p) => ({ ...p, loading: true }));
    previewPaidSplit({ fromDate: from, toDate: isHalf ? null : to, isHalfDay: isHalf, leaveType })
      .then((data) => alive && setPaidSplit({ loading: false, data, failed: false }))
      .catch(() => alive && setPaidSplit({ loading: false, data: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [visible, isCompOff, from, to, isHalf, leaveType]);

  const pickType = (value) => {
    setLeaveType(value);
    if (value !== 'comp_off') setHalfDay(false);
  };

  const toggleHalf = (v) => {
    setHalfDay(v);
    if (v) setTo(null); // half a day is one date
  };

  const validate = () => {
    const next = {};
    if (!from) next.dates = 'Pick at least a start date.';
    else if (to && to < from) next.dates = 'The end date cannot be before the start date.';
    if (!reason.trim()) next.reason = 'Give a reason for your leave.';
    return next;
  };

  const compOffDays = preview.data?.days;
  const shortfall = isCompOff ? preview.data?.shortfall || 0 : 0;
  const zeroDays = isCompOff && preview.data && compOffDays === 0;

  const onSubmit = async () => {
    if (submitting) return;
    const next = validate();
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;
    if (isCompOff && (shortfall > 0 || zeroDays)) return;

    setSubmitting(true);
    try {
      await createLeaveRequest({
        leaveType,
        fromDate: from,
        toDate: isHalf ? null : to,
        reason: reason.trim(),
        isHalfDay: isHalf,
      });
      onClose();
      showToast('Leave request submitted.', 'success');
      // Full re-read rather than pushing the row locally: the final state, the
      // computed number_of_days and the balance are all the server's to say.
      await onSubmitted?.();
    } catch (e) {
      const mapped = mapServerError(e?.message);
      setErrors(mapped.field ? { [mapped.field]: mapped.short } : {});
      setFormError(mapped.banner || mapped.short);
    } finally {
      setSubmitting(false);
    }
  };

  // Comp off: the server's working-day count. Others: calendar days, which
  // over-counts a span across a Sunday -- warning early is the right way to
  // err for the paid-leave banner below.
  const requested = isCompOff && compOffDays !== undefined && compOffDays !== null
    ? compOffDays
    : from
      ? (isHalf ? 0.5 : daysBetween(from, to || from))
      : 0;
  const overQuota = !isCompOff && balance?.hasQuota && requested > balance.remaining;
  const excess = overQuota ? requested - balance.remaining : 0;

  // The red LOP warning. Once dates are picked, the server's own split decides
  // it; before that, the balance says whether the quota is already gone.
  const split = !isCompOff ? paidSplit.data : null;
  const lop = (() => {
    if (isCompOff) return null;
    const monthOnly = (n) =>
      `Your paid leave for this month (${formatDays(n)}) is already used. Any additional leave ` +
      'applied this month will be treated as Unpaid Leave / Loss of Pay (LOP).';
    const exhausted =
      'Your paid leave balance has already been exhausted. Any additional leave applied will ' +
      'be treated as Unpaid Leave / Loss of Pay (LOP).';
    const deducted = (on) => (on ? ' and deducted from your salary' : '');
    if (split && split.unpaidDays > 0) {
      if (!split.hasQuota) {
        return 'Paid leave is not set up for your company, so this leave will be Unpaid Leave / ' +
          `Loss of Pay (LOP)${deducted(split.deductionEnabled)}.`;
      }
      if (split.paidDays <= 0) return split.limitedBy === 'month' ? monthOnly(split.perMonth) : exhausted;
      return `Only ${formatDays(split.paidDays)} of these ${formatDays(split.workingDays)} is paid ` +
        `leave. The other ${formatDays(split.unpaidDays)} will be Unpaid Leave / Loss of Pay ` +
        `(LOP)${deducted(split.deductionEnabled)}.`;
    }
    if (split) return null; // fully paid
    if (from && paidSplit.failed && overQuota) {
      return `Only ${formatDays(balance.remaining)} of paid leave remain in ${balance.year}. ` +
        `The extra ${formatDays(excess)} will be Unpaid Leave / Loss of Pay (LOP)` +
        `${deducted(balance.unpaidDeductionEnabled)}.`;
    }
    if (!from && balance?.isQuotaExhausted) {
      return balance.remainingThisMonth === 0 && balance.remaining > 0
        ? monthOnly(balance.perMonth)
        : exhausted;
    }
    return null;
  })();
  const lopDays = split ? split.unpaidDays : 0;
  const keptForLater = isCompOff && preview.data ? Math.max(0, preview.data.balance - preview.data.covered) : 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={dismiss} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: radii.lg,
              borderTopRightRadius: radii.lg,
              paddingBottom: insets.bottom + spacing.base,
              transform: [
                { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) },
              ],
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />

          <View style={[styles.header, { paddingHorizontal: spacing.lg }]}>
            <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.md }}>
              Apply for leave
            </Text>
            <Pressable onPress={dismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
          >
            {/* Red, at the top, and non-blocking: unpaid leave is a legitimate
                request, but nobody should find out it is LOP from their payslip. */}
            {lop ? (
              <Banner tone={colors.danger} icon="alert-circle">
                {lop}
              </Banner>
            ) : null}

            <Text style={[styles.fieldLabel, { color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs }]}>
              Leave type
            </Text>
            {/* A handful of fixed options, so they are all shown at once rather
                than hidden behind another picker sheet. Comp off joins them only
                while there is some to spend. */}
            <View style={styles.typeRow}>
              {types.map((t) => {
                const active = t.value === leaveType;
                const isCompChip = t.value === 'comp_off';
                return (
                  <Pressable
                    key={t.value}
                    onPress={() => pickType(t.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.typeChip,
                      {
                        backgroundColor: active ? withAlpha(colors.primary, 0.14) : colors.surfaceAlt,
                        borderColor: active ? colors.primary : colors.border,
                        transform: [{ scale: pressed ? 0.96 : 1 }],
                      },
                    ]}
                  >
                    <Ionicons name={t.icon} size={14} color={active ? colors.accent : colors.muted} />
                    <Text
                      style={{
                        color: active ? colors.text : colors.muted,
                        fontFamily: active ? fonts.semibold : fonts.regular,
                        fontSize: fontSize.xs,
                      }}
                    >
                      {isCompChip ? 'Comp-off' : t.label.replace(' Leave', '')}
                    </Text>
                    {isCompChip ? (
                      <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                        <Text style={{ color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 11 }}>
                          {trimNumber(compOff.balance)}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            {isCompOff ? (
              <FadeIn key="comp-off-panel" style={{ marginTop: spacing.base }}>
                <View style={[styles.panel, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
                  <Text style={{ color: colors.muted, fontFamily: fonts.semibold, fontSize: fontSize.xs }}>
                    {from ? 'Paid from your earned days, oldest first' : 'Pick a date to see which earned days it uses'}
                  </Text>
                  {preview.loading ? (
                    <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 8 }}>
                      Checking your earned days…
                    </Text>
                  ) : null}
                  {!preview.loading && preview.data
                    ? preview.data.allocation.map((a) => (
                        <FadeIn key={`${a.creditId}-${a.days}`} style={styles.allocRow}>
                          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
                              {formatDateKeyShort(a.dateEarned)}
                            </Text>
                            <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs }}>
                              {a.holidayName || SOURCE_LABEL[a.source] || 'Day off worked'}
                            </Text>
                          </View>
                          <Text style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
                            {a.days === 0.5 ? '½ day' : formatDays(a.days)}
                          </Text>
                        </FadeIn>
                      ))
                    : null}
                  {!preview.loading && preview.data && keptForLater > 0 && shortfall === 0 ? (
                    <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 8 }}>
                      {`${keptForLater === 0.5 ? '½ day' : formatDays(keptForLater)} kept for later.`}
                    </Text>
                  ) : null}
                  {preview.error ? (
                    <Text style={{ color: colors.danger, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 8 }}>
                      {preview.error}
                    </Text>
                  ) : null}
                </View>

                <View style={[styles.halfRow, { borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>Half day</Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs }}>
                      Spend ½ day of comp-off on one date
                    </Text>
                  </View>
                  <Switch
                    value={halfDay}
                    onValueChange={toggleHalf}
                    trackColor={{ true: colors.primary, false: colors.border }}
                    thumbColor={colors.surface}
                    accessibilityLabel="Half day"
                  />
                </View>
              </FadeIn>
            ) : null}

            <AppTextInput
              label={isHalf ? 'Date' : 'Dates'}
              value={from ? formatDateRange(from, isHalf ? null : to) : ''}
              editable={false}
              icon="calendar-outline"
              error={errors.dates}
              onPress={() => setPicking(true)}
              rightSlot={<Ionicons name="chevron-down" size={18} color={colors.muted} />}
              style={{ marginTop: spacing.base }}
            />

            {from ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 6 }}>
                {isCompOff && compOffDays === undefined ? '…' : formatDays(requested)}
              </Text>
            ) : null}

            <AppTextInput
              label="Reason"
              value={reason}
              onChangeText={(v) => {
                setReason(v);
                if (errors.reason) setErrors((e) => ({ ...e, reason: undefined }));
              }}
              icon="document-text-outline"
              error={errors.reason}
              multiline
              numberOfLines={4}
              maxLength={500}
              textAlignVertical="top"
              style={{ marginTop: spacing.base }}
            />

            {notice.enabled ? (
              <Pressable
                onPress={() => setShowMail(true)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.previewBtn,
                  { borderColor: colors.primary, opacity: pressed ? 0.8 : 1, marginTop: spacing.base },
                ]}
              >
                <Ionicons name="mail-outline" size={17} color={colors.accent} />
                <Text style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
                  Preview email to HR
                </Text>
              </Pressable>
            ) : null}

            {/* Refused outright by action_submit, so this is a blocker, not the
                advisory the paid-leave banner above is. */}
            {isCompOff && shortfall > 0 ? (
              <Banner tone={colors.danger} icon="alert-circle-outline">
                {'This needs ' +
                  formatDays(compOffDays) +
                  ' but you have ' +
                  formatDays(preview.data?.balance) +
                  ' of comp-off. Pick fewer days or turn on Half day.'}
              </Banner>
            ) : null}
            {zeroDays ? (
              <Banner tone={colors.danger} icon="alert-circle-outline">
                Those dates are already days off, so there is nothing to take.
              </Banner>
            ) : null}

            {formError ? (
              <Banner tone={colors.danger} icon="alert-circle">
                {formError}
              </Banner>
            ) : null}

            <PrimaryButton
              label={
                isCompOff && compOffDays
                  ? `Submit · uses ${compOffDays === 0.5 ? '½ day' : formatDays(compOffDays)}`
                  : lopDays > 0
                    ? `Submit · ${formatDays(lopDays)} unpaid (LOP)`
                    : 'Submit request'
              }
              loading={submitting}
              disabled={isCompOff && (shortfall > 0 || zeroDays || preview.loading)}
              onPress={onSubmit}
              style={{ marginTop: spacing.lg }}
            />
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

      <MailPreviewModal
        visible={showMail}
        onClose={() => setShowMail(false)}
        load={() =>
          previewLeaveMail({
            leaveType,
            fromDate: from,
            toDate: isHalf ? null : to,
            isHalfDay: isHalf,
            reason,
          })
        }
      />

      <DatePopup
        visible={picking}
        mode={isHalf ? 'single' : 'range'}
        title={isHalf ? 'Pick the date' : 'Tap the first day, then the last'}
        from={from}
        to={isHalf ? null : to}
        isWeeklyOff={calendar.isWeeklyOff}
        holidays={calendar.holidays}
        onCancel={() => setPicking(false)}
        onConfirm={({ from: f, to: t }) => {
          setFrom(f);
          setTo(isHalf ? null : t);
          setErrors((e) => ({ ...e, dates: undefined }));
          setPicking(false);
        }}
      />
    </Modal>
  );
}

function Banner({ tone, icon, children }) {
  const { fonts, fontSize, spacing, withAlpha } = useTheme();
  return (
    <FadeIn
      style={[
        styles.banner,
        {
          backgroundColor: withAlpha(tone, 0.09),
          borderColor: withAlpha(tone, 0.3),
          marginTop: spacing.base,
        },
      ]}
    >
      <Ionicons name={icon} size={17} color={tone} />
      <Text style={{ flex: 1, color: tone, fontFamily: fonts.medium, fontSize: fontSize.xs }}>{children}</Text>
    </FadeIn>
  );
}

function trimNumber(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

/**
 * The service throws one display-ready string with no code, so the known
 * server messages are recognised by their text and pushed back onto the field
 * that caused them. Anything else -- including "No employee record is linked
 * to this user" and any raw ORM error -- goes to the banner unchanged.
 */
export function mapServerError(message) {
  const m = String(message || '');
  if (/^From date is required/i.test(m)) return { field: 'dates', short: m, banner: '' };
  if (/^Reason is required/i.test(m)) return { field: 'reason', short: m, banner: '' };
  if (/To Date cannot be before From Date/i.test(m)) return { field: 'dates', short: m, banner: '' };
  // The overlap message carries the offending request's display_name, e.g.
  // "... Existing request: Casual Leave - Arun Kumar - 2026-08-21" -- far too
  // long for the 12px error row, so it goes to BOTH: a short marker on the
  // field so it reads as wrong, the detail in the roomier banner.
  if (/already exists for overlapping dates/i.test(m)) {
    return { field: 'dates', short: 'These dates overlap an existing request.', banner: m };
  }
  if (/compensatory off day\(s\), but/i.test(m)) {
    return { field: 'dates', short: 'Not enough comp-off for these dates.', banner: m };
  }
  if (/already non-working days/i.test(m)) {
    return { field: 'dates', short: 'Those dates are already days off.', banner: m };
  }
  return { field: null, short: '', banner: m };
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  // Spans the whole modal and pushes the sheet to the bottom, rather than being
  // pinned to the bottom with no height of its own: a percentage maxHeight
  // resolves against the PARENT's height, so with an auto-height wrapper the
  // sheet's 88% meant nothing and the ScrollView inside never became
  // scrollable. SelectSheet avoids this by sitting directly in the Modal.
  sheetWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%' },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  fieldLabel: { marginBottom: 8 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999 },
  panel: { borderWidth: 1, borderRadius: radii.md, padding: 12 },
  allocRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  halfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderWidth: 1.5,
    borderRadius: radii.md,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  mailToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  // The email "paper": fixed light colours in both themes, as a mail client
  // would show it. Text sizes follow the real template (14px body).
  mailPaper: {
    marginTop: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 14,
  },
  mailSubject: { color: '#111827', fontSize: 14, fontWeight: '700' },
  mailRule: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 10 },
  mailText: { color: '#111827', fontSize: 13, marginBottom: 6 },
  mailRow: { flexDirection: 'row', paddingVertical: 4, gap: 10 },
  mailLabel: { width: 78, color: '#6B7280', fontSize: 13 },
  mailValue: { flex: 1, color: '#111827', fontSize: 13 },
  mailButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#F59E0B',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginTop: 10,
  },
  mailFoot: { color: '#6B7280', fontSize: 11, marginTop: 10 },
});
