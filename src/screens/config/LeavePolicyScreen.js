import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../theme';
import { Card, AppTextInput, PrimaryButton, SwitchRow, MailPreviewModal, useToast } from '../../components';
import { fetchLeaveConfig, saveLeaveConfig, previewLeaveMail } from '../../services/odoo';
import AdminScreen from './AdminScreen';
import { GUIDES } from './guides';
import { Section, Caption, Note } from './FormBits';

/** The company's leave policy -- one record, hr.leave.config. */
export default function LeavePolicyScreen({ navigation }) {
  const { spacing } = useTheme();
  const showToast = useToast();

  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const toDraft = (c) => ({
    paid_leave_enabled: Boolean(c.paid_leave_enabled),
    paid_leave_days_per_year: String(c.paid_leave_days_per_year ?? ''),
    paid_leave_days_per_month: String(c.paid_leave_days_per_month ?? ''),
    unpaid_leave_deduction_enabled: Boolean(c.unpaid_leave_deduction_enabled),
    carry_forward_enabled: Boolean(c.carry_forward_enabled),
    max_carry_forward_days: String(c.max_carry_forward_days ?? ''),
    comp_off_enabled: Boolean(c.comp_off_enabled),
    comp_off_expiry_days: String(c.comp_off_expiry_days ?? ''),
    comp_off_carry_forward_enabled: Boolean(c.comp_off_carry_forward_enabled),
    comp_off_max_carry_forward_days: String(c.comp_off_max_carry_forward_days ?? ''),
    notify_on_submit: Boolean(c.notify_on_submit),
    notify_emails: String(c.notify_emails || ''),
  });

  const [showMail, setShowMail] = useState(false);

  const load = async () => {
    try {
      const row = await fetchLeaveConfig();
      if (!row) throw new Error('Could not load the leave policy.');
      setConfig(row);
      setDraft(toDraft(row));
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the leave policy.');
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
    const perYear = Number(draft.paid_leave_days_per_year);
    const perMonth = Number(draft.paid_leave_days_per_month);
    const compExpiry = Number(draft.comp_off_expiry_days);
    const compCarry = Number(draft.comp_off_max_carry_forward_days);

    if (!Number.isFinite(perYear) || perYear < 0) next.paid_leave_days_per_year = 'Days per year, 0 or more.';
    if (!Number.isFinite(perMonth) || perMonth < 0) next.paid_leave_days_per_month = 'Days per month, 0 or more.';
    if (!Number.isFinite(compExpiry) || compExpiry < 0) next.comp_off_expiry_days = 'Days, 0 or more (0 never expires).';
    if (!Number.isFinite(compCarry) || compCarry < 0) next.comp_off_max_carry_forward_days = 'Days, 0 or more.';
    // Not a hard rule on the server, but a monthly accrual that cannot reach
    // the yearly quota is almost always a typo in one of the two.
    if (Number.isFinite(perYear) && Number.isFinite(perMonth) && perMonth * 12 < perYear) {
      next.paid_leave_days_per_month = `At ${perMonth}/month nobody reaches ${perYear} days in a year.`;
    }

    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      const saved = await saveLeaveConfig(config.id, {
        paid_leave_enabled: Boolean(draft.paid_leave_enabled),
        paid_leave_days_per_year: Math.round(perYear),
        paid_leave_days_per_month: perMonth,
        unpaid_leave_deduction_enabled: Boolean(draft.unpaid_leave_deduction_enabled),
        comp_off_enabled: Boolean(draft.comp_off_enabled),
        comp_off_expiry_days: Math.round(compExpiry),
        comp_off_carry_forward_enabled: Boolean(draft.comp_off_carry_forward_enabled),
        comp_off_max_carry_forward_days: Math.round(compCarry),
        notify_on_submit: Boolean(draft.notify_on_submit),
        notify_emails: draft.notify_emails.trim() || false,
      });
      if (saved) {
        setConfig(saved);
        setDraft(toDraft(saved));
      }
      showToast(config.id ? 'Leave policy updated.' : 'Leave policy created.', 'success');
      navigation.goBack();
    } catch (e) {
      showToast(e?.message || 'Could not save the leave policy.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminScreen guide={GUIDES.leavePolicy}
      navigation={navigation}
      title="Leave Policy"
      subtitle={config?.company_id ? config.company_id[1] : 'Paid days and comp off'}
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        load();
      }}
    >
      {config && !config.id ? (
        <Note tone="warning" icon="alert-circle-outline" style={{ marginBottom: spacing.md }}>
          No leave policy is saved yet, so every leave is paid as UNPAID and deducted. These are
          the suggested defaults. Check them and tap Save to create the policy.
        </Note>
      ) : null}

      <Section title="Paid leave" icon="wallet-outline" tone="success">
        <SwitchRow
          label="Paid leave"
          help="Off means every leave day is unpaid, whatever the quota below says."
          value={draft.paid_leave_enabled}
          onValueChange={(v) => set('paid_leave_enabled', v)}
          last
        />
        <View style={{ marginTop: spacing.md }}>
          <AppTextInput
            label="Paid days per year"
            value={draft.paid_leave_days_per_year}
            onChangeText={(v) => set('paid_leave_days_per_year', v.replace(/[^0-9]/g, ''))}
            icon="calendar-outline"
            error={errors.paid_leave_days_per_year}
            keyboardType="number-pad"
          />
          <AppTextInput
            label="Accrual per month"
            value={draft.paid_leave_days_per_month}
            onChangeText={(v) => set('paid_leave_days_per_month', v.replace(/[^0-9.]/g, ''))}
            icon="trending-up-outline"
            error={errors.paid_leave_days_per_month}
            keyboardType="decimal-pad"
            style={{ marginTop: spacing.base }}
          />
          <Caption>
            The balance strip on the employee's Leave screen reads from these two.
          </Caption>
        </View>
      </Section>

      <Section title="Unpaid leave" icon="remove-circle-outline" tone="warning">
        <SwitchRow
          label="Deduct unpaid leave"
          help="Charge unpaid days against the monthly wage. Off records them without any deduction."
          value={draft.unpaid_leave_deduction_enabled}
          onValueChange={(v) => set('unpaid_leave_deduction_enabled', v)}
          last
        />
      </Section>

      {/* No paid-leave carry forward section: the server stores the switch but
          nothing applies it, so offering it would promise days that never
          arrive. Paid leave resets each year. Comp-off carry forward is real
          and stays below. */}
      <Section title="Compensatory off" icon="swap-horizontal-outline" tone="info">
        <SwitchRow
          label="Compensatory off"
          help="Working a weekly off or a public holiday earns a day back. A full day worked earns 1, a short day 0.5."
          value={draft.comp_off_enabled}
          onValueChange={(v) => set('comp_off_enabled', v)}
          last={!draft.comp_off_enabled}
        />
        {draft.comp_off_enabled ? (
          <>
            <View style={{ marginTop: spacing.md }}>
              <AppTextInput
                label="Expires after (days, 0 = never)"
                value={draft.comp_off_expiry_days}
                onChangeText={(v) => set('comp_off_expiry_days', v.replace(/[^0-9]/g, ''))}
                icon="hourglass-outline"
                error={errors.comp_off_expiry_days}
                keyboardType="number-pad"
              />
            </View>
            <SwitchRow
              label="Carry forward"
              help="Let unused comp offs roll into next year, up to the cap below. Paid leave does not carry forward."
              value={draft.comp_off_carry_forward_enabled}
              onValueChange={(v) => set('comp_off_carry_forward_enabled', v)}
              last={!draft.comp_off_carry_forward_enabled}
            />
            {draft.comp_off_carry_forward_enabled ? (
              <View style={{ marginTop: spacing.md }}>
                <AppTextInput
                  label="Maximum comp offs carried"
                  value={draft.comp_off_max_carry_forward_days}
                  onChangeText={(v) => set('comp_off_max_carry_forward_days', v.replace(/[^0-9]/g, ''))}
                  icon="albums-outline"
                  error={errors.comp_off_max_carry_forward_days}
                  keyboardType="number-pad"
                />
              </View>
            ) : null}
          </>
        ) : null}
      </Section>

      {config && 'notify_on_submit' in config ? (
      <Section title="Notifications" icon="mail-outline" tone="warning">
        <SwitchRow
          label="Email HR on submission"
          help="The moment anyone submits a leave request, an email goes to the addresses below. Needs an outgoing mail server configured in Odoo."
          value={draft.notify_on_submit}
          onValueChange={(v) => set('notify_on_submit', v)}
          last={!draft.notify_on_submit}
        />
        {draft.notify_on_submit ? (
          <View style={{ marginTop: spacing.md }}>
            <AppTextInput
              label="Recipients (comma-separated)"
              value={draft.notify_emails}
              onChangeText={(v) => set('notify_emails', v)}
              icon="mail-outline"
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="hr@example.com, manager@example.com"
            />
            <PrimaryButton
              label="Preview email"
              icon="mail-outline"
              variant="outline"
              onPress={() => setShowMail(true)}
              style={{ marginTop: spacing.md }}
            />
            <Caption>Shows a sample request. Save first if you changed the recipients.</Caption>
          </View>
        ) : null}
        <MailPreviewModal
          visible={showMail}
          onClose={() => setShowMail(false)}
          title="Email preview (sample)"
          load={() => previewLeaveMail({ sample: true })}
        />
      </Section>
      ) : null}

      <PrimaryButton label="Save" loading={saving} onPress={submit} style={{ marginTop: spacing.sm }} />
      <PrimaryButton
        label="Cancel"
        variant="ghost"
        onPress={() => navigation.goBack()}
        style={{ marginTop: spacing.md }}
      />
      <Text style={{ height: spacing.lg }} />
    </AdminScreen>
  );
}
