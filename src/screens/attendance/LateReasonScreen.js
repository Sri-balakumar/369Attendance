import React, { useState } from 'react';
import { Text } from 'react-native';
import { useTheme } from '../../theme';
import { Card, AppTextInput, PrimaryButton, useToast } from '../../components';
import { submitLateReason } from '../../services/odoo';
import AdminScreen from '../config/AdminScreen';

/**
 * Explain a late check-in.
 *
 * Reached from the "You checked in late" notification. The app's check-in
 * skips the backend's reason-required rule so it never blocks anyone at the
 * door; this is where the reason arrives afterwards, and HR is told.
 */
export default function LateReasonScreen({ navigation, route }) {
  const attendanceId = route?.params?.attendanceId;
  const { colors, fonts, fontSize, spacing } = useTheme();
  const showToast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      setError('Write a short reason.');
      return;
    }
    setSaving(true);
    try {
      await submitLateReason(attendanceId, reason.trim());
      showToast('Reason sent to HR.', 'success');
      navigation.goBack();
    } catch (e) {
      showToast(e?.message || 'Could not send the reason.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminScreen
      navigation={navigation}
      title="Late reason"
      subtitle="Tell HR why you were late"
      error={attendanceId ? '' : 'This notification no longer points to a check-in.'}
    >
      <Card>
        <AppTextInput
          label="Reason"
          value={reason}
          onChangeText={(v) => {
            setReason(v);
            if (error) setError('');
          }}
          icon="chatbubble-ellipses-outline"
          multiline
          numberOfLines={4}
          error={error}
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
        Late arrivals are recorded but cost nothing on their own. The reason
        is saved on your attendance and HR is notified.
      </Text>
      <PrimaryButton label="Send reason" loading={saving} onPress={submit} style={{ marginTop: spacing.lg }} />
    </AdminScreen>
  );
}
