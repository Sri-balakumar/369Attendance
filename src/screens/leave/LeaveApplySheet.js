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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { AppTextInput, PrimaryButton, DateRangeCalendar, useToast } from '../../components';
import { createLeaveRequest } from '../../services/odoo';
import { formatDateRange, daysBetween, formatDays } from '../../utils/time';
import { LEAVE_TYPES } from './constants';

/**
 * Apply for leave.
 *
 * ONE Modal whose body swaps between the form and the calendar, rather than a
 * calendar Modal stacked on a form Modal. That sidesteps nested-Modal ordering
 * entirely, draws one backdrop instead of two, and gives Android's back button
 * a single onRequestClose to walk: dates -> form, then form -> closed.
 *
 * Modal mechanics are lifted from SelectSheet so the two sheets feel identical.
 */
export default function LeaveApplySheet({ visible, balance, onClose, onSubmitted }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const showToast = useToast();
  const slide = useRef(new Animated.Value(0)).current;

  const [mode, setMode] = useState('form'); // 'form' | 'dates'
  const [leaveType, setLeaveType] = useState('casual');
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    setMode('form');
    setLeaveType('casual');
    setFrom(null);
    setTo(null);
    setReason('');
    setErrors({});
    setFormError('');
  }, [visible]);

  const validate = () => {
    const next = {};
    if (!from) next.dates = 'Pick at least a start date.';
    // Unreachable through the calendar's own two-tap rule, but it is free and
    // it documents the server's matching constraint.
    else if (to && to < from) next.dates = 'The end date cannot be before the start date.';
    if (!reason.trim()) next.reason = 'Give a reason for your leave.';
    return next;
  };

  const onSubmit = async () => {
    if (submitting) return;
    const next = validate();
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;

    setSubmitting(true);
    try {
      await createLeaveRequest({ leaveType, fromDate: from, toDate: to, reason: reason.trim() });
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

  const requested = from ? daysBetween(from, to || from) : 0;
  const overQuota = balance?.hasQuota && requested > balance.remaining;
  const excess = overQuota ? requested - balance.remaining : 0;

  const back = () => (mode === 'dates' ? setMode('form') : onClose());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={back} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose} />

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
            <View style={styles.headerLeft}>
              {mode === 'dates' ? (
                <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to form">
                  <Ionicons name="chevron-back" size={22} color={colors.muted} />
                </Pressable>
              ) : null}
              <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.md }}>
                {mode === 'dates' ? 'Select dates' : 'Apply for leave'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>

          {mode === 'dates' ? (
            // Scrolls for the same reason the form does. The sheet is capped at
            // 88% of the viewport, and six rows of calendar plus the nav row,
            // the weekday row and the confirm button do not fit on a short one
            // -- landscape, a small device, Android split-screen. Without this
            // the month header and its arrows are pushed above the sheet with
            // no way to reach them, so the month cannot be changed at all.
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
            >
              {/* minDate is left unset on purpose: the server has no past-date
                  constraint, and back-dated sick leave is the ordinary case. */}
              <DateRangeCalendar
                from={from}
                to={to}
                onChange={({ from: f, to: t }) => {
                  setFrom(f);
                  setTo(t);
                  setErrors((e) => ({ ...e, dates: undefined }));
                }}
              />
              <PrimaryButton
                label={
                  from
                    ? 'Use ' + formatDateRange(from, to) + ' · ' + formatDays(daysBetween(from, to || from))
                    : 'Pick a date'
                }
                disabled={!from}
                onPress={() => setMode('form')}
                style={{ marginTop: spacing.base }}
              />
            </ScrollView>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
            >
              <Text style={[styles.fieldLabel, { color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs }]}>
                Leave type
              </Text>
              {/* Six fixed options, so they are all shown at once rather than
                  hidden behind another picker sheet. */}
              <View style={styles.typeRow}>
                {LEAVE_TYPES.map((t) => {
                  const active = t.value === leaveType;
                  return (
                    <Pressable
                      key={t.value}
                      onPress={() => setLeaveType(t.value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.typeChip,
                        {
                          backgroundColor: active ? withAlpha(colors.primary, 0.14) : colors.surfaceAlt,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={t.icon}
                        size={14}
                        color={active ? colors.primary : colors.muted}
                      />
                      <Text
                        style={{
                          color: active ? colors.primary : colors.muted,
                          fontFamily: active ? fonts.semibold : fonts.regular,
                          fontSize: fontSize.xs,
                        }}
                      >
                        {t.label.replace(' Leave', '')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <AppTextInput
                label="Dates"
                value={from ? formatDateRange(from, to) : ''}
                editable={false}
                icon="calendar-outline"
                error={errors.dates}
                onPress={() => setMode('dates')}
                rightSlot={<Ionicons name="chevron-forward" size={18} color={colors.muted} />}
                style={{ marginTop: spacing.base }}
              />

              {from ? (
                <Text
                  style={{
                    color: colors.muted,
                    fontFamily: fonts.regular,
                    fontSize: fontSize.xs,
                    marginTop: 6,
                  }}
                >
                  {formatDays(requested)}
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

              {/* The server never blocks an over-quota request -- there is no
                  balance check on create at all -- so this banner is the only
                  place a person finds out before the fact. Non-blocking by
                  design: unpaid leave is a legitimate thing to ask for. */}
              {overQuota ? (
                <View
                  style={[
                    styles.banner,
                    {
                      backgroundColor: withAlpha(colors.warning, 0.1),
                      borderColor: withAlpha(colors.warning, 0.35),
                      marginTop: spacing.base,
                    },
                  ]}
                >
                  <Ionicons name="alert-circle-outline" size={17} color={colors.warning} />
                  <Text
                    style={{
                      flex: 1,
                      color: colors.warning,
                      fontFamily: fonts.medium,
                      fontSize: fontSize.xs,
                    }}
                  >
                    {'This is ' +
                      formatDays(requested) +
                      ' but only ' +
                      formatDays(balance.remaining) +
                      ' of paid leave remain in ' +
                      balance.year +
                      '. The extra ' +
                      formatDays(excess) +
                      ' will be unpaid' +
                      (balance.unpaidDeductionEnabled ? ' and deducted from your salary.' : '.')}
                  </Text>
                </View>
              ) : null}

              {formError ? (
                <View
                  style={[
                    styles.banner,
                    {
                      backgroundColor: withAlpha(colors.danger, 0.09),
                      borderColor: withAlpha(colors.danger, 0.3),
                      marginTop: spacing.base,
                    },
                  ]}
                >
                  <Ionicons name="alert-circle" size={17} color={colors.danger} />
                  <Text
                    style={{
                      flex: 1,
                      color: colors.danger,
                      fontFamily: fonts.medium,
                      fontSize: fontSize.xs,
                    }}
                  >
                    {formError}
                  </Text>
                </View>
              ) : null}

              <PrimaryButton
                label="Submit request"
                loading={submitting}
                onPress={onSubmit}
                style={{ marginTop: spacing.lg }}
              />
            </ScrollView>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * The service throws one display-ready string with no code, so the four known
 * server messages are recognised by their text and pushed back onto the field
 * that caused them. Anything else -- including "No employee record is linked to
 * this user" and any raw ORM error -- goes to the banner unchanged.
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
  return { field: null, short: '', banner: m };
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  // Spans the whole modal and pushes the sheet to the bottom, rather than being
  // pinned to the bottom with no height of its own.
  //
  // That distinction is the whole ballgame: a percentage maxHeight resolves
  // against the PARENT's height, so with an auto-height wrapper the sheet's
  // 88% meant nothing. It grew to fit its content, ran off the top of the
  // screen, and the ScrollView inside never became scrollable because it was
  // never bounded -- so the calendar's month header and arrows were simply
  // unreachable. SelectSheet avoids this by sitting directly in the Modal.
  sheetWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%' },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
  },
});
