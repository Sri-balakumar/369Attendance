import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../theme';
import {
  AppTextInput,
  PrimaryButton,
  SwitchRow,
  SelectSheet,
  useToast,
} from '../../components';
import { fetchAutoApproveConfig, saveAutoApproveConfig, fetchCompanies } from '../../services/odoo';
import AdminScreen from './AdminScreen';
import { GUIDES } from './guides';
import { Section, Caption, Note, Picker } from './FormBits';

const UNITS = [
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
];

const unitLabel = (v) => UNITS.find((u) => u.value === v)?.label || v || '—';

/**
 * Auto-approval for leave and WFH.
 *
 * ONE screen because it is one record: hr.request.auto.approve.config carries
 * both the leave_* and the wfh_* fields on the same row. Odoo hangs the same
 * action off both the Leave and the WFH Configuration menus, which reads like
 * two policies; it is not.
 *
 * The row that reaches this screen is gated on the model's ACL (HR manager),
 * not on the menuitems' groups. Those are set to the leave/WFH manager groups
 * in the addon, which lets a Leave Manager open it in Odoo and then fail on
 * save -- a server-side mismatch this screen deliberately does not reproduce.
 */
export default function AutoApprovalScreen({ navigation }) {
  const { spacing } = useTheme();
  const showToast = useToast();

  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState(null); // 'leave' | 'wfh'
  const [companies, setCompanies] = useState([]);

  const toDraft = (c) => ({
    leave_auto_approve: Boolean(c.leave_auto_approve),
    leave_delay_number: String(c.leave_delay_number ?? ''),
    leave_delay_unit: c.leave_delay_unit || 'hours',
    wfh_auto_approve: Boolean(c.wfh_auto_approve),
    wfh_delay_number: String(c.wfh_delay_number ?? ''),
    wfh_delay_unit: c.wfh_delay_unit || 'hours',
  });

  /**
   * No row is a legitimate state, not an error: the model treats a missing
   * config as everything switched off. So an absent row opens the form with
   * both switches off, and saving creates it.
   */
  const load = async () => {
    try {
      const [row, cos] = await Promise.all([
        fetchAutoApproveConfig(),
        fetchCompanies().catch(() => []),
      ]);
      setCompanies(cos);
      setConfig(row);
      setDraft(
        row
          ? toDraft(row)
          : {
              leave_auto_approve: false,
              leave_delay_number: '0',
              leave_delay_unit: 'hours',
              wfh_auto_approve: false,
              wfh_delay_number: '0',
              wfh_delay_unit: 'hours',
            }
      );
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the auto-approval policy.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k, v) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = async () => {
    const next = {};
    const ln = Number(draft.leave_delay_number);
    const wn = Number(draft.wfh_delay_number);
    if (draft.leave_auto_approve && (!Number.isFinite(ln) || ln < 0)) {
      next.leave_delay_number = 'How long to wait, 0 or more.';
    }
    if (draft.wfh_auto_approve && (!Number.isFinite(wn) || wn < 0)) {
      next.wfh_delay_number = 'How long to wait, 0 or more.';
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    // Saving a switched-on feature with a zero wait silently does nothing.
    // Better to say so than to let somebody believe it is armed.
    const deadLeave = draft.leave_auto_approve && ln === 0;
    const deadWfh = draft.wfh_auto_approve && wn === 0;

    setSaving(true);
    try {
      const saved = await saveAutoApproveConfig(config?.id || null, {
        ...(config ? null : { company_id: companies[0]?.value }),
        leave_auto_approve: Boolean(draft.leave_auto_approve),
        leave_delay_number: Math.round(Number.isFinite(ln) ? ln : 0),
        leave_delay_unit: draft.leave_delay_unit,
        wfh_auto_approve: Boolean(draft.wfh_auto_approve),
        wfh_delay_number: Math.round(Number.isFinite(wn) ? wn : 0),
        wfh_delay_unit: draft.wfh_delay_unit,
      });
      if (saved) {
        setConfig(saved);
        setDraft(toDraft(saved));
      }
      showToast(
        deadLeave || deadWfh
          ? `Saved, but a wait of zero leaves ${deadLeave && deadWfh ? 'both' : deadLeave ? 'leave' : 'WFH'} auto-approval switched off.`
          : 'Auto-approval updated.',
        deadLeave || deadWfh ? 'warning' : 'success'
      );
      navigation.goBack();
    } catch (e) {
      showToast(e?.message || 'Could not save the policy.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const anyOn = draft.leave_auto_approve || draft.wfh_auto_approve;

  return (
    <AdminScreen guide={GUIDES.autoApproval}
      navigation={navigation}
      title="Auto-Approval"
      subtitle="Leave and work from home"
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        load();
      }}
    >
      {anyOn ? (
        <Note tone="warning" icon="flash-outline" style={{ marginTop: 0, marginBottom: 12 }}>
          Requests left undecided for the delay below are approved by the server
          without anyone looking at them.
        </Note>
      ) : null}

      <Section title="Leave" icon="calendar-outline" tone="accent">
        <SwitchRow
          label="Auto-approve leave"
          help="Approve a pending leave request automatically once it has waited this long."
          value={draft.leave_auto_approve}
          onValueChange={(v) => set('leave_auto_approve', v)}
          last
        />
        {draft.leave_auto_approve ? (
          <View style={{ marginTop: spacing.md }}>
            <AppTextInput
              label="Wait"
              value={draft.leave_delay_number}
              onChangeText={(v) => set('leave_delay_number', v.replace(/[^0-9]/g, ''))}
              icon="hourglass-outline"
              error={errors.leave_delay_number}
              keyboardType="number-pad"
            />
            <Picker
              label="Unit"
              value={unitLabel(draft.leave_delay_unit)}
              icon="time-outline"
              onPress={() => setSheet('leave')}
              style={{ marginTop: spacing.base }}
            />
            <Caption>
              A wait of zero switches auto-approval OFF for leave, whatever the
              toggle says: the sweep treats it as not configured rather than as
              approve-instantly, because instant approval is the same as having
              no approval step.
            </Caption>
          </View>
        ) : null}
      </Section>

      <Section title="Work from home" icon="home-outline" tone="info">
        <SwitchRow
          label="Auto-approve WFH"
          help="Same, for work-from-home requests. Independent of the leave setting above."
          value={draft.wfh_auto_approve}
          onValueChange={(v) => set('wfh_auto_approve', v)}
          last
        />
        {draft.wfh_auto_approve ? (
          <View style={{ marginTop: spacing.md }}>
            <AppTextInput
              label="Wait"
              value={draft.wfh_delay_number}
              onChangeText={(v) => set('wfh_delay_number', v.replace(/[^0-9]/g, ''))}
              icon="hourglass-outline"
              error={errors.wfh_delay_number}
              keyboardType="number-pad"
            />
            <Picker
              label="Unit"
              value={unitLabel(draft.wfh_delay_unit)}
              icon="time-outline"
              onPress={() => setSheet('wfh')}
              style={{ marginTop: spacing.base }}
            />
            <Caption>
              A wait of zero switches auto-approval OFF for WFH, the same way.
            </Caption>
          </View>
        ) : null}
      </Section>

      <PrimaryButton label="Save" loading={saving} onPress={submit} />
      <PrimaryButton
        label="Cancel"
        variant="ghost"
        onPress={() => navigation.goBack()}
        style={{ marginTop: spacing.md }}
      />
      <Text style={{ height: spacing.lg }} />

      <SelectSheet
        visible={sheet !== null}
        title="Delay unit"
        icon="time-outline"
        options={UNITS}
        value={sheet === 'wfh' ? draft.wfh_delay_unit : draft.leave_delay_unit}
        onSelect={(v) => set(sheet === 'wfh' ? 'wfh_delay_unit' : 'leave_delay_unit', v)}
        onClose={() => setSheet(null)}
      />
    </AdminScreen>
  );
}
