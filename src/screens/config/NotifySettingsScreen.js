import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card, Chip, PrimaryButton, SwitchRow, useToast } from '../../components';
import { useTheme } from '../../theme';
import { fetchNotifyEvents, isMissingBackend, saveNotifyEvent, sendTestNotification } from '../../services/odoo';
import AdminScreen from './AdminScreen';
import { Section } from './FormBits';

const CATEGORY_LABELS = {
  attendance: 'Attendance',
  leave: 'Leave',
  wfh: 'Work From Home',
  compoff: 'Comp Off',
  payroll: 'Payroll',
  holiday: 'Holidays',
  other: 'Profile & Devices',
  system: 'System',
};
const ORDER = Object.keys(CATEGORY_LABELS);
const NEEDS_UPGRADE = "The server's Attendance module needs upgrading first.";
const failText = (e, fallback) => (isMissingBackend(e) ? NEEDS_UPGRADE : e?.message || fallback);
const AUDIENCE = {
  employee: ['Employee', 'info'],
  hr: ['HR', 'warning'],
  admin: ['Admin', 'danger'],
};

/**
 * Admin: every notification the app sends, with its two switches.
 *
 * "On" stops a notification completely; "Phone push" off keeps it under the
 * bell without buzzing the phone. The same list as Attendance > Configuration
 * > Notifications > Notification Types in Odoo.
 */
export default function NotifySettingsScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing } = useTheme();
  const showToast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await fetchNotifyEvents());
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the notification settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const flip = async (row, field) => {
    const next = !row[field];
    setRows((all) => all.map((r) => (r.id === row.id ? { ...r, [field]: next } : r)));
    try {
      await saveNotifyEvent(row.id, { [field]: next });
    } catch (e) {
      setRows((all) => all.map((r) => (r.id === row.id ? { ...r, [field]: !next } : r)));
      showToast(failText(e, 'Could not save.'), 'danger');
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await sendTestNotification();
      showToast('Test sent. Check the bell (and your phone, if push is set up).', 'success');
    } catch (e) {
      showToast(failText(e, 'Could not send the test.'), 'danger');
    } finally {
      setTesting(false);
    }
  };

  const groups = ORDER.map((cat) => [cat, rows.filter((r) => r.category === cat)]).filter(
    ([, list]) => list.length
  );

  return (
    <AdminScreen
      navigation={navigation}
      title="Notifications"
      subtitle="What is sent, and to whom"
      loading={loading}
      error={error}
      onRetry={load}
      empty={!loading && !error && rows.length === 0}
      emptyTitle="Not available"
      emptyMessage="The server's Attendance module needs upgrading before notifications can be configured."
      emptyIcon="notifications-off-outline"
    >
      <PrimaryButton label="Send me a test notification" variant="outline" loading={testing} onPress={test} />

      {groups.map(([cat, list]) => (
        <Section key={cat} title={CATEGORY_LABELS[cat]} style={{ marginTop: spacing.lg }}>
          <Card>
            {list.map((r, i) => {
              const [who, tone] = AUDIENCE[r.audience] || AUDIENCE.employee;
              return (
                <View key={r.id} style={{ marginTop: i === 0 ? 0 : spacing.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
                      {r.name}
                    </Text>
                    <Chip label={who} tone={tone} size="sm" />
                  </View>
                  <SwitchRow label="On" help={r.description || undefined} value={r.enabled} onValueChange={() => flip(r, 'enabled')} />
                  <SwitchRow
                    label="Phone push"
                    value={r.enabled && r.push}
                    disabled={!r.enabled}
                    onValueChange={() => flip(r, 'push')}
                    last={i === list.length - 1}
                  />
                </View>
              );
            })}
          </Card>
        </Section>
      ))}
    </AdminScreen>
  );
}
