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
import { createWfhRequest } from '../../services/odoo';
import { formatDateKeyShort, todayKey } from '../../utils/time';

/**
 * Request a WFH day.
 *
 * Same one-Modal, two-body arrangement as the leave sheet, but simpler: the
 * server takes a single request_date, so the calendar is used in single-date
 * mode -- `to` is never set and never sent.
 */
export default function WfhApplySheet({ visible, onClose, onSubmitted }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const showToast = useToast();
  const slide = useRef(new Animated.Value(0)).current;

  const [mode, setMode] = useState('form');
  const [date, setDate] = useState(null);
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

  useEffect(() => {
    if (!visible) return;
    setMode('form');
    setDate(null);
    setReason('');
    setErrors({});
    setFormError('');
  }, [visible]);

  const onSubmit = async () => {
    if (submitting) return;
    const next = {};
    if (!date) next.date = 'Pick the day you want to work from home.';
    if (!reason.trim()) next.reason = 'Give a reason for the request.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;

    setSubmitting(true);
    try {
      await createWfhRequest({ date, reason: reason.trim() });
      onClose();
      showToast('WFH request submitted.', 'success');
      await onSubmitted?.();
    } catch (e) {
      const m = String(e?.message || '');
      // The server's duplicate message names the date and the existing state,
      // which is genuinely useful, so it goes to the banner intact and the
      // field only gets a short marker.
      if (/already exists for/i.test(m)) {
        setErrors({ date: 'You already have a request for this day.' });
        setFormError(m);
      } else {
        setFormError(m || 'Could not submit the request.');
      }
    } finally {
      setSubmitting(false);
    }
  };

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
                {mode === 'dates' ? 'Pick a day' : 'Work from home'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>

          {mode === 'dates' ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
            >
              {/* Single-date mode: `to` is deliberately never set, because the
                  route takes one request_date and nothing else. minDate is
                  today -- unlike leave, a WFH day needs approving before it is
                  worked, so a back-dated request has nothing to approve. */}
              <DateRangeCalendar
                from={date}
                to={null}
                minDate={todayKey()}
                onChange={({ from: f }) => {
                  setDate(f);
                  setErrors((e) => ({ ...e, date: undefined }));
                }}
              />
              <PrimaryButton
                label={date ? 'Use ' + formatDateKeyShort(date) : 'Pick a day'}
                disabled={!date}
                onPress={() => setMode('form')}
                style={{ marginTop: spacing.base }}
              />
            </ScrollView>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
            >
              <AppTextInput
                label="Day"
                value={date ? formatDateKeyShort(date) : ''}
                editable={false}
                icon="calendar-outline"
                error={errors.date}
                onPress={() => setMode('dates')}
                rightSlot={<Ionicons name="chevron-forward" size={18} color={colors.muted} />}
              />

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
                  <Text style={{ flex: 1, color: colors.danger, fontFamily: fonts.medium, fontSize: fontSize.xs }}>
                    {formError}
                  </Text>
                </View>
              ) : null}

              <Text
                style={{
                  color: colors.muted,
                  fontFamily: fonts.regular,
                  fontSize: fontSize.xs,
                  marginTop: spacing.base,
                }}
              >
                Once approved, check in as usual on the day — there is no separate
                WFH button, and your location is not checked.
              </Text>

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

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  // Spans the modal and pushes the sheet down, so the sheet's percentage
  // maxHeight has a definite height to resolve against. See the leave sheet.
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
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
  },
});
