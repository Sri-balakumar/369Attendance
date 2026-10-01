import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Chip, AppTextInput, PrimaryButton, SelectSheet, SwitchRow, useToast } from '../../components';
import { useTheme } from '../../theme';
import { useSession } from '../../state/SessionContext';
import {
  fetchWaConfig,
  saveWaConfig,
  sendWaTest,
  fetchWaGroups,
  chooseWaGroup,
  addWaRecipient,
  removeWaRecipient,
} from '../../services/odoo';
import { formatDateKeyShort, formatHourFloat, parseHourFloat } from '../../utils/time';
import { goBackOnce } from '../../navigation/back';
import AdminScreen from './AdminScreen';
import { GUIDES } from './guides';
import { Section, Caption, Note, Picker } from './FormBits';

// The addon's default words, for Reset.
const DEFAULT_WORDS = 'checked in at';

// hr.attendance.wa.config.wa_state -> what the status card says.
const LINK_STATE = {
  connected: ['Connected', 'success'],
  waiting_qr: ['Scan QR in Odoo', 'warning'],
  disconnected: ['Disconnected', 'danger'],
  none: ['Not set up', 'warning'],
  unavailable: ['Not available', 'danger'],
  error: ['Error', 'danger'],
};

const toDraft = (c) => ({
  enabled: Boolean(c.enabled),
  message_text: c.message_text || DEFAULT_WORDS,
  summary_enabled: Boolean(c.summary_enabled),
  summary_time: formatHourFloat(c.summary_time ?? 18.5),
});

/**
 * Admin: the WhatsApp roll call -- the first check-in of each day posted to
 * one group -- and the daily summary sent privately to a few numbers.
 *
 * The same record as Attendances > Attendance Status > Configuration >
 * WhatsApp Group in Odoo. Choosing the group, Send test and the summary
 * numbers act at once (as their Odoo buttons do); the switches, the message
 * and the summary time wait for Save, like every other form on this tab.
 * Connecting the WhatsApp number itself (the QR) stays in Odoo: it is scanned
 * with the phone this app is probably running on.
 */
export default function WhatsAppGroupScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing } = useTheme();
  const showToast = useToast();
  const { user } = useSession();

  const [available, setAvailable] = useState(true);
  const [config, setConfig] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [groups, setGroups] = useState({ open: false, loading: false, list: [], error: '' });
  const [newName, setNewName] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [adding, setAdding] = useState(false);

  // `keepDraft`: re-read what the server holds (status, group, numbers)
  // without throwing away edits that are still waiting for Save.
  const load = useCallback(async (keepDraft = false) => {
    try {
      const res = await fetchWaConfig();
      setAvailable(res.available);
      if (res.available) {
        setConfig(res.config);
        setRecipients(res.recipients);
        if (!keepDraft) setDraft(toDraft(res.config));
      }
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the WhatsApp settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k, v) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const openGroups = async () => {
    setGroups({ open: false, loading: true, list: [], error: '' });
    try {
      const res = await fetchWaGroups(config.id);
      setGroups({ open: res.groups.length > 0, loading: false, list: res.groups, error: res.error });
      if (!res.groups.length) {
        showToast(res.error ? 'Could not load the groups.' : 'This WhatsApp number is in no groups.', 'warning');
      }
    } catch (e) {
      setGroups({ open: false, loading: false, list: [], error: e?.message || 'Could not load the groups.' });
    }
  };

  const pickGroup = async (jid) => {
    const group = groups.list.find((g) => g.jid === jid);
    setGroups((g) => ({ ...g, open: false }));
    if (!group || jid === config.group_jid) return;
    try {
      await chooseWaGroup(config.id, group.jid, group.name);
      showToast(`Group set to “${group.name}”. Send a test to check it.`, 'success');
      await load(true);
    } catch (e) {
      showToast(e?.message || 'Could not change the group.', 'danger');
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      showToast(await sendWaTest(config.id), 'success');
    } catch (e) {
      showToast(e?.message || 'The test message could not be sent.', 'danger');
    } finally {
      setTesting(false);
    }
  };

  const addNumber = async () => {
    if (!newNumber.trim()) {
      setErrors((e) => ({ ...e, newNumber: 'Type the WhatsApp number.' }));
      return;
    }
    setAdding(true);
    try {
      await addWaRecipient(config.id, newName.trim(), newNumber.trim());
      setNewName('');
      setNewNumber('');
      showToast('Number added.', 'success');
      await load(true);
    } catch (e) {
      // The server's own words, e.g. "'12345' is not a full WhatsApp number".
      setErrors((err) => ({ ...err, newNumber: e?.message || 'Could not add the number.' }));
    } finally {
      setAdding(false);
    }
  };

  const removeNumber = async (r) => {
    try {
      await removeWaRecipient(r.id);
      showToast(`${r.name || r.number} removed.`, 'success');
      await load(true);
    } catch (e) {
      showToast(e?.message || 'Could not remove the number.', 'danger');
    }
  };

  const submit = async () => {
    const time = parseHourFloat(draft.summary_time);
    if (draft.summary_enabled && time === null) {
      setErrors((e) => ({ ...e, summary_time: 'A time like 18:30.' }));
      return;
    }
    setSaving(true);
    try {
      await saveWaConfig(config.id, {
        enabled: Boolean(draft.enabled && config.group_jid),
        message_text: draft.message_text.trim() || DEFAULT_WORDS,
        summary_enabled: Boolean(draft.summary_enabled),
        ...(time === null ? null : { summary_time: time }),
      });
      showToast('WhatsApp settings saved.', 'success');
      goBackOnce(navigation);
    } catch (e) {
      showToast(e?.message || 'Could not save the WhatsApp settings.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const hasGroup = Boolean(config?.group_jid);
  const [linkLabel, linkTone] = LINK_STATE[config?.wa_state] || ['Unknown', 'muted'];
  const words = (draft?.message_text || '').split(/\s+/).filter(Boolean).join(' ') || DEFAULT_WORDS;
  const example = `@${user?.name || 'Sneha'} ${words} 9:30 AM`;

  return (
    <AdminScreen
      guide={GUIDES.whatsAppGroup}
      navigation={navigation}
      title="WhatsApp Group"
      subtitle="Check-ins posted to a group"
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        load();
      }}
      empty={!loading && !error && !available}
      emptyTitle="Not installed"
      emptyMessage="The WhatsApp roll call isn't installed on this server."
      emptyIcon="logo-whatsapp"
    >
      {config && draft ? (
        <>
          {/* What is live right now, from the server -- not the unsaved edits below. */}
          <Card padded={false} style={{ marginBottom: spacing.md }}>
            <StatusRow label="WhatsApp" value={<Chip label={linkLabel} tone={linkTone} size="sm" />} />
            <StatusRow label="Group" value={config.group_name || config.group_jid || 'Not chosen'} />
            <StatusRow
              label="Roll call"
              value={<Chip label={config.enabled ? 'On' : 'Off'} tone={config.enabled ? 'success' : 'muted'} size="sm" />}
            />
            <StatusRow
              label="Daily summary"
              value={config.summary_enabled ? `On, at ${formatHourFloat(config.summary_time)}` : 'Off'}
              last
            />
          </Card>

          {config.wa_state !== 'connected' ? (
            <Note tone="warning" icon="link-outline" style={{ marginTop: 0, marginBottom: spacing.md }}>
              {(config.odoo_status ? `${config.odoo_status}. ` : '') +
                'Connect the WhatsApp number in Odoo (WhatsApp Group › Connect WhatsApp): its QR code is scanned with a phone, so it is not done here.'}
            </Note>
          ) : null}

          <Section title="Roll call" icon="logo-whatsapp" tone="success">
            <Picker
              label="Group"
              value={groups.loading ? 'Loading groups…' : config.group_name || config.group_jid || ''}
              icon="people-outline"
              onPress={groups.loading ? undefined : openGroups}
            />
            {groups.error ? (
              <Note tone="danger" icon="alert-circle-outline">
                {groups.error}
              </Note>
            ) : null}
            <PrimaryButton
              label="Send test message"
              icon="paper-plane-outline"
              variant="outline"
              tone="success"
              loading={testing}
              disabled={!hasGroup}
              onPress={test}
              style={{ marginTop: spacing.md }}
            />
            <Caption>Posts one line to the group, using the saved message.</Caption>
            <SwitchRow
              label="Post check-ins to the group"
              help={hasGroup ? 'Each person’s first check-in of the day, once.' : 'Choose a group first.'}
              value={draft.enabled && hasGroup}
              disabled={!hasGroup}
              onValueChange={(v) => set('enabled', v)}
              style={{ marginTop: spacing.sm }}
              last
            />
          </Section>

          <Section title="Message" icon="chatbubble-ellipses-outline" tone="info">
            <AppTextInput
              label="Words after the name"
              value={draft.message_text}
              onChangeText={(v) => set('message_text', v)}
              icon="create-outline"
              maxLength={80}
            />
            <Caption>{`Example: ${example}`}</Caption>
            <PrimaryButton
              label="Reset to default"
              variant="ghost"
              disabled={words === DEFAULT_WORDS}
              onPress={() => set('message_text', DEFAULT_WORDS)}
              style={{ marginTop: spacing.md }}
            />
          </Section>

          <Section title="Daily summary" icon="document-text-outline" tone="accent">
            <SwitchRow
              label="Send a daily summary"
              help="Who is present, on leave and absent today, sent privately to the numbers below."
              value={draft.summary_enabled}
              onValueChange={(v) => set('summary_enabled', v)}
              last
            />
            {draft.summary_enabled ? (
              <AppTextInput
                label="Send at (HH:MM)"
                value={draft.summary_time}
                onChangeText={(v) => set('summary_time', v.replace(/[^0-9:]/g, '').slice(0, 5))}
                icon="time-outline"
                error={errors.summary_time}
                keyboardType="numbers-and-punctuation"
                style={{ marginTop: spacing.md }}
              />
            ) : null}

            <Text
              style={{
                color: colors.muted,
                fontFamily: fonts.semibold,
                fontSize: fontSize.xs,
                marginTop: spacing.lg,
                marginBottom: spacing.xs,
              }}
            >
              SEND TO
            </Text>
            {recipients.length ? (
              recipients.map((r, i) => (
                <View
                  key={r.id}
                  style={[styles.recipient, { borderBottomColor: colors.border, borderBottomWidth: i === recipients.length - 1 ? 0 : 1 }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: fontSize.sm }}>
                      {r.name || r.number}
                    </Text>
                    {r.name ? (
                      <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs }}>{r.number}</Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => removeNumber(r)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${r.name || r.number}`}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                </View>
              ))
            ) : (
              <Caption>No numbers yet.</Caption>
            )}
            {draft.summary_enabled && !recipients.length ? (
              <Note tone="warning" icon="alert-circle-outline">
                Add at least one number, or nobody receives the summary.
              </Note>
            ) : null}

            <AppTextInput
              label="Name (optional)"
              value={newName}
              onChangeText={setNewName}
              icon="person-outline"
              style={{ marginTop: spacing.md }}
            />
            <AppTextInput
              label="WhatsApp number"
              value={newNumber}
              onChangeText={(v) => {
                setNewNumber(v);
                if (errors.newNumber) setErrors((e) => ({ ...e, newNumber: undefined }));
              }}
              icon="call-outline"
              keyboardType="phone-pad"
              error={errors.newNumber}
              style={{ marginTop: spacing.base }}
            />
            <PrimaryButton
              label="Add number"
              icon="add"
              variant="outline"
              loading={adding}
              onPress={addNumber}
              style={{ marginTop: spacing.md }}
            />

            {config.summary_last_date ? (
              <Caption>{`Last sent ${formatDateKeyShort(config.summary_last_date)}.`}</Caption>
            ) : null}
            {config.summary_last_error ? (
              <Note tone="danger" icon="alert-circle-outline">
                {`Last problem: ${config.summary_last_error}`}
              </Note>
            ) : null}
          </Section>

          <PrimaryButton label="Save" loading={saving} onPress={submit} />
          <PrimaryButton
            label="Cancel"
            variant="ghost"
            onPress={() => goBackOnce(navigation)}
            style={{ marginTop: spacing.md }}
          />
          <View style={{ height: spacing.lg }} />

          <SelectSheet
            visible={groups.open}
            title="Choose the group"
            icon="people-outline"
            searchable
            options={groups.list.map((g) => ({
              value: g.jid,
              label: g.members ? `${g.name} · ${g.members} member${g.members === 1 ? '' : 's'}` : g.name,
            }))}
            value={config.group_jid}
            onSelect={pickGroup}
            onClose={() => setGroups((g) => ({ ...g, open: false }))}
          />
        </>
      ) : null}
    </AdminScreen>
  );
}

function StatusRow({ label, value, last }) {
  const { colors, fonts, fontSize, spacing } = useTheme();
  return (
    <View
      style={[
        styles.status,
        { paddingHorizontal: spacing.base, borderBottomColor: colors.border, borderBottomWidth: last ? 0 : 1 },
      ]}
    >
      <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm }}>{label}</Text>
      {typeof value === 'string' ? (
        <Text
          numberOfLines={1}
          style={{ flexShrink: 1, color: colors.text, fontFamily: fonts.medium, fontSize: fontSize.sm, textAlign: 'right' }}
        >
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  recipient: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
});
