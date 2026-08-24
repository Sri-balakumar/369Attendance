import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip, PrimaryButton, SwitchRow, useToast } from '../../components';
import { fetchDetailsConfigs, saveDetailsConfig } from '../../services/odoo';
import AdminScreen from './AdminScreen';
import { Section, Note } from './FormBits';

/**
 * The five sections and the fields inside each, exactly as the model groups
 * them. Section switches come first because unticking one hides everything
 * under it regardless of the individual flags.
 */
const GROUPS = [
  {
    title: 'Salary',
    icon: 'cash-outline',
    tone: 'success',
    master: 'show_salary_section',
    fields: [
      ['show_salary_effective_date', 'Salary effective from'],
      ['show_annual_ctc', 'Annual CTC'],
      ['show_payment_mode', 'Salary payment mode'],
    ],
  },
  {
    title: 'Statutory',
    icon: 'card-outline',
    tone: 'primary',
    master: 'show_statutory_section',
    fields: [
      ['show_tax_regime', 'Income tax regime'],
      ['show_professional_tax_state', 'Professional tax state'],
    ],
  },
  {
    title: 'Bank',
    icon: 'business-outline',
    tone: 'info',
    master: 'show_bank_section',
    fields: [
      ['show_bank_ifsc', 'IFSC code'],
      ['show_bank_branch', 'Branch'],
      ['show_bank_account_category', 'Account category'],
    ],
  },
  {
    title: 'Personal',
    icon: 'heart-outline',
    tone: 'accent',
    master: 'show_personal_section',
    fields: [
      ['show_blood_group', 'Blood group'],
      ['show_father_name', "Father's name"],
      ['show_mother_name', "Mother's name"],
      ['show_emergency_relation', 'Emergency contact relationship'],
      ['show_second_emergency_contact', 'Second emergency contact'],
    ],
  },
  {
    title: 'Employment',
    icon: 'briefcase-outline',
    tone: 'warning',
    master: 'show_employment_section',
    fields: [
      ['show_confirmation_date', 'Confirmation date'],
      ['show_notice_period', 'Notice period'],
      ['show_previous_employment', 'Previous employment'],
    ],
  },
];

const ALL_FLAGS = GROUPS.flatMap((g) => [g.master, ...g.fields.map(([f]) => f)]);

const scopeLabel = (row) =>
  row.config_scope === 'employee'
    ? (Array.isArray(row.employee_id) ? row.employee_id[1] : 'One employee')
    : 'Everyone (defaults)';

/**
 * The list. There is one "Everyone" record plus one per exception, and an
 * exception REPLACES the defaults for that person rather than merging with
 * them -- so they are siblings, and a flat list is the honest shape.
 */
export function FieldSettingsListScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setRows(await fetchDetailsConfigs());
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the field settings.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <AdminScreen
      navigation={navigation}
      title="Field Settings"
      subtitle="What My Details shows"
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0}
      emptyTitle="Nothing configured"
      emptyMessage="No field settings exist yet, so My Details falls back to whatever the module defaults to."
      emptyIcon="toggle-outline"
    >
      {rows.map((r, i) => {
        const isGlobal = r.config_scope !== 'employee';
        const tone = isGlobal ? colors.primary : colors.info;
        const on = ALL_FLAGS.filter((f) => r[f]).length;
        return (
          <Pressable
            key={r.id}
            onPress={() => navigation.navigate('FieldSettingsForm', { id: r.id })}
            android_ripple={{ color: withAlpha(tone, 0.12) }}
            accessibilityRole="button"
            style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: i === 0 ? 0 : spacing.sm }]}
          >
            <Card padded={false}>
              <View style={[styles.row, { padding: spacing.base }]}>
                <View style={[styles.icon, { backgroundColor: withAlpha(tone, 0.13) }]}>
                  <Ionicons name={isGlobal ? 'people-outline' : 'person-outline'} size={17} color={tone} />
                </View>
                <View style={{ flex: 1, marginLeft: 11 }}>
                  <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                    {scopeLabel(r)}
                  </Text>
                  <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                    {on} of {ALL_FLAGS.length} shown
                  </Text>
                </View>
                {!isGlobal ? <Chip label="Exception" tone="info" size="sm" /> : null}
                <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 8 }} />
              </View>
            </Card>
          </Pressable>
        );
      })}

      <Text
        style={{
          color: colors.muted,
          fontFamily: fonts.regular,
          fontSize: fontSize.xs,
          textAlign: 'center',
          marginTop: spacing.lg,
          lineHeight: 17,
        }}
      >
        An exception replaces the defaults for that person — it is not merged
        with them.
      </Text>
    </AdminScreen>
  );
}

/** One record's switches. */
export function FieldSettingsFormScreen({ navigation, route }) {
  const id = route?.params?.id;
  const { spacing } = useTheme();
  const showToast = useToast();

  const [row, setRow] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await fetchDetailsConfigs();
      const hit = rows.find((r) => r.id === Number(id));
      if (!hit) throw new Error('Those field settings no longer exist.');
      setRow(hit);
      setDraft(ALL_FLAGS.reduce((acc, f) => ({ ...acc, [f]: Boolean(hit[f]) }), {}));
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the field settings.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try {
      const saved = await saveDetailsConfig(row.id, draft);
      if (saved) setRow(saved);
      showToast('Field settings updated.', 'success');
      navigation.goBack();
    } catch (e) {
      showToast(e?.message || 'Could not save the field settings.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminScreen
      navigation={navigation}
      title={row ? scopeLabel(row) : 'Field Settings'}
      subtitle="What My Details shows"
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        load();
      }}
    >
      {/* My Details never renders salary, whatever this says -- the fields are
          outside the self-service allow-list on res.users, so the screen could
          not show them even if asked. Better said here than discovered. */}
      {draft.show_salary_section ? (
        <Note tone="info" icon="information-circle-outline" style={{ marginTop: 0, marginBottom: 12 }}>
          The app's My Details screen never shows salary, whatever this section
          is set to. These flags govern the Odoo side.
        </Note>
      ) : null}

      {GROUPS.map((g) => (
        <Section key={g.title} title={g.title} icon={g.icon} tone={g.tone}>
          <SwitchRow
            label={`Show the ${g.title.toLowerCase()} section`}
            value={draft[g.master]}
            onValueChange={(v) => set(g.master, v)}
            last={!draft[g.master]}
          />
          {draft[g.master]
            ? g.fields.map(([field, label], i) => (
                <SwitchRow
                  key={field}
                  label={label}
                  value={draft[field]}
                  onValueChange={(v) => set(field, v)}
                  last={i === g.fields.length - 1}
                />
              ))
            : null}
        </Section>
      ))}

      <PrimaryButton label="Save" loading={saving} onPress={submit} />
      <PrimaryButton
        label="Cancel"
        variant="ghost"
        onPress={() => navigation.goBack()}
        style={{ marginTop: spacing.md }}
      />
      <View style={{ height: spacing.lg }} />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 34, height: 34, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
});
