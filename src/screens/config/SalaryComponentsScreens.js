import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import {
  Card,
  Chip,
  AppTextInput,
  PrimaryButton,
  SwitchRow,
  SelectSheet,
  ConfirmDialog,
  useToast,
} from '../../components';
import {
  fetchSalaryComponents,
  saveSalaryComponent,
  deleteSalaryComponent,
  fetchCompanies,
} from '../../services/odoo';
import AdminScreen from './AdminScreen';
import { GUIDES } from './guides';
import { Caption, Picker } from './FormBits';
import { goBackOnce } from '../../navigation/back';

const TYPES = [
  { value: 'earning', label: 'Earning' },
  { value: 'deduction', label: 'Deduction' },
];

const COMPUTATIONS = [
  { value: 'fixed', label: 'Fixed amount' },
  { value: 'percent_of_component', label: 'Percentage of another component' },
  { value: 'percent_of_gross', label: 'Percentage of gross' },
];

const labelOf = (opts, v) => opts.find((o) => o.value === v)?.label || v || '—';

/** The pay structure: earnings that build the gross, deductions that reduce it. */
export function SalaryComponentsListScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setRows(await fetchSalaryComponents());
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the salary components.');
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
    <AdminScreen guide={GUIDES.salaryList}
      navigation={navigation}
      title="Salary Components"
      subtitle="Earnings and deductions"
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0}
      keepChildrenWhenEmpty
      emptyTitle="No components yet"
      emptyMessage="Add the earnings that make up the gross and the deductions taken off it."
      emptyIcon="cash-outline"
    >
      {rows.map((c, i) => {
        const earning = c.component_type === 'earning';
        const tone = earning ? colors.success : colors.danger;
        return (
          <Pressable
            key={c.id}
            onPress={() => navigation.navigate('SalaryComponentForm', { id: c.id })}
            android_ripple={{ color: withAlpha(tone, 0.12) }}
            accessibilityRole="button"
            accessibilityLabel={c.name}
            style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: i === 0 ? 0 : spacing.sm }]}
          >
            <Card padded={false}>
              <View style={[styles.row, { padding: spacing.base }]}>
                <View style={[styles.icon, { backgroundColor: withAlpha(tone, 0.13) }]}>
                  <Ionicons name={earning ? 'add-circle-outline' : 'remove-circle-outline'} size={17} color={tone} />
                </View>
                <View style={{ flex: 1, marginLeft: 11 }}>
                  <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                    {c.name}
                  </Text>
                  <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                    {c.code ? `${c.code} · ` : ''}
                    {labelOf(COMPUTATIONS, c.computation)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Chip label={earning ? 'Earning' : 'Deduction'} tone={earning ? 'success' : 'danger'} size="sm" />
                  <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs }}>
                    {c.computation === 'fixed'
                      ? Number(c.default_amount || 0).toLocaleString()
                      : `${c.percentage || 0}%`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 6 }} />
              </View>
            </Card>
          </Pressable>
        );
      })}

      <Pressable
        onPress={() => navigation.navigate('SalaryComponentForm', { id: null })}
        accessibilityRole="button"
        accessibilityLabel="Add a component"
        style={({ pressed }) => [
          styles.add,
          {
            borderColor: colors.border,
            backgroundColor: pressed ? withAlpha(colors.primary, 0.08) : 'transparent',
            marginTop: spacing.md,
          },
        ]}
      >
        <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
        <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
          Add a component
        </Text>
      </Pressable>
    </AdminScreen>
  );
}

export function SalaryComponentFormScreen({ navigation, route }) {
  const id = route?.params?.id || null;
  const { colors, spacing } = useTheme();
  const showToast = useToast();

  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sheet, setSheet] = useState(null); // 'type' | 'computation' | 'base' | 'company'
  const [errors, setErrors] = useState({});

  const [others, setOthers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [d, setD] = useState({
    name: '',
    code: '',
    component_type: 'earning',
    computation: 'fixed',
    base_component_id: null,
    percentage: '',
    default_amount: '',
    sequence: '10',
    company_id: null,
  });

  const set = (k, v) => {
    setD((prev) => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  useEffect(() => {
    fetchCompanies()
      .then((c) => {
        setCompanies(c);
        setD((prev) => (prev.company_id === null && !id && c.length ? { ...prev, company_id: c[0].value } : prev));
      })
      .catch(() => setCompanies([]));
  }, [id]);

  useEffect(() => {
    fetchSalaryComponents()
      .then((rows) => {
        setOthers(
          rows.filter((r) => r.id !== Number(id)).map((r) => ({ value: r.id, label: r.name }))
        );
        if (!id) return;
        const row = rows.find((r) => r.id === Number(id));
        if (!row) throw new Error('That component no longer exists.');
        setD({
          name: row.name || '',
          code: row.code || '',
          component_type: row.component_type || 'earning',
          computation: row.computation || 'fixed',
          base_component_id: row.base_component_id ? row.base_component_id[0] : null,
          percentage: String(row.percentage ?? ''),
          default_amount: String(row.default_amount ?? ''),
          sequence: String(row.sequence ?? '10'),
          company_id: row.company_id ? row.company_id[0] : null,
        });
        setError('');
      })
      .catch((e) => setError(e?.message || 'Could not load that component.'))
      .finally(() => setLoading(false));
  }, [id]);

  const submit = async () => {
    const next = {};
    if (!d.name.trim()) next.name = 'Give the component a name.';
    if (!d.company_id) next.company_id = 'A company is required.';
    if (d.computation === 'fixed') {
      const amt = Number(d.default_amount);
      if (!Number.isFinite(amt) || amt < 0) next.default_amount = 'An amount, 0 or more.';
    } else {
      const pct = Number(d.percentage);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) next.percentage = 'A percentage between 0 and 100.';
      if (d.computation === 'percent_of_component' && !d.base_component_id) {
        next.base_component_id = 'Pick the component this is a percentage of.';
      }
    }
    // The model's own help says so: gross is the sum of the earnings, so an
    // earning derived from the gross would take part in defining itself.
    if (d.computation === 'percent_of_gross' && d.component_type === 'earning') {
      next.computation = 'Only a deduction can be a percentage of gross.';
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      await saveSalaryComponent(id, {
        name: d.name.trim(),
        code: d.code.trim(),
        component_type: d.component_type,
        computation: d.computation,
        base_component_id: d.computation === 'percent_of_component' ? Number(d.base_component_id) : false,
        percentage: d.computation === 'fixed' ? 0 : Number(d.percentage),
        default_amount: d.computation === 'fixed' ? Number(d.default_amount) : 0,
        sequence: Number(d.sequence) || 10,
        company_id: Number(d.company_id),
      });
      showToast(id ? 'Component updated.' : 'Component added.', 'success');
      goBackOnce(navigation);
    } catch (e) {
      showToast(e?.message || 'Could not save the component.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await deleteSalaryComponent(id);
      showToast('Component removed.', 'success');
      goBackOnce(navigation);
    } catch (e) {
      showToast(e?.message || 'Could not remove the component.', 'danger');
    } finally {
      setDeleting(false);
    }
  };

  const isFixed = d.computation === 'fixed';

  return (
    <AdminScreen guide={GUIDES.salaryForm}
      navigation={navigation}
      title={id ? 'Edit component' : 'Add component'}
      subtitle={id ? d.name || 'Salary component' : 'Earning or deduction'}
      loading={loading}
      error={error}
    >
      <Card>
        <AppTextInput
          label="Name"
          value={d.name}
          onChangeText={(v) => set('name', v)}
          icon="pricetag-outline"
          error={errors.name}
        />
        <AppTextInput
          label="Code"
          value={d.code}
          onChangeText={(v) => set('code', v.toUpperCase())}
          icon="code-outline"
          autoCapitalize="characters"
          style={{ marginTop: spacing.base }}
        />
        <Picker
          label="Type"
          value={labelOf(TYPES, d.component_type)}
          icon="swap-vertical-outline"
          onPress={() => setSheet('type')}
          style={{ marginTop: spacing.base }}
        />
        <Picker
          label="Computation"
          value={labelOf(COMPUTATIONS, d.computation)}
          icon="calculator-outline"
          error={errors.computation}
          onPress={() => setSheet('computation')}
          style={{ marginTop: spacing.base }}
        />

        {isFixed ? (
          <AppTextInput
            label="Default amount"
            value={d.default_amount}
            onChangeText={(v) => set('default_amount', v.replace(/[^0-9.]/g, ''))}
            icon="cash-outline"
            error={errors.default_amount}
            keyboardType="decimal-pad"
            style={{ marginTop: spacing.base }}
          />
        ) : (
          <>
            <AppTextInput
              label="Percentage"
              value={d.percentage}
              onChangeText={(v) => set('percentage', v.replace(/[^0-9.]/g, ''))}
              icon="pie-chart-outline"
              error={errors.percentage}
              keyboardType="decimal-pad"
              style={{ marginTop: spacing.base }}
            />
            {d.computation === 'percent_of_component' ? (
              <Picker
                label="Percentage of"
                value={others.find((o) => o.value === d.base_component_id)?.label || 'Pick a component'}
                icon="git-merge-outline"
                error={errors.base_component_id}
                onPress={() => setSheet('base')}
                style={{ marginTop: spacing.base }}
              />
            ) : null}
          </>
        )}

        <Picker
          label="Company"
          value={companies.find((c) => c.value === d.company_id)?.label || ''}
          icon="business-outline"
          error={errors.company_id}
          onPress={() => setSheet('company')}
          style={{ marginTop: spacing.base }}
        />
        <AppTextInput
          label="Sequence"
          value={d.sequence}
          onChangeText={(v) => set('sequence', v.replace(/[^0-9]/g, ''))}
          icon="reorder-three-outline"
          keyboardType="number-pad"
          style={{ marginTop: spacing.base }}
        />
        <Caption>
          Earnings add up to the gross; deductions come off it to give the net.
          Sequence sets the order they are listed in.
        </Caption>
      </Card>

      <PrimaryButton
        label={id ? 'Save changes' : 'Add component'}
        loading={saving}
        onPress={submit}
        style={{ marginTop: spacing.lg }}
      />
      {id ? (
        <PrimaryButton
          label="Remove component"
          variant="ghost"
          tone="danger"
          loading={deleting}
          onPress={() => setConfirmDelete(true)}
          style={{ marginTop: spacing.md }}
        />
      ) : null}

      <SelectSheet
        visible={sheet === 'type'}
        title="Type"
        icon="swap-vertical-outline"
        options={TYPES}
        value={d.component_type}
        onSelect={(v) => set('component_type', v)}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'computation'}
        title="Computation"
        icon="calculator-outline"
        options={COMPUTATIONS}
        value={d.computation}
        onSelect={(v) => set('computation', v)}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'base'}
        title="Percentage of"
        icon="git-merge-outline"
        searchable={others.length > 12}
        options={others}
        value={d.base_component_id}
        onSelect={(v) => set('base_component_id', v)}
        onClose={() => setSheet(null)}
        emptyLabel="No other component to base this on yet."
      />
      <SelectSheet
        visible={sheet === 'company'}
        title="Company"
        icon="business-outline"
        options={companies}
        value={d.company_id}
        onSelect={(v) => set('company_id', v)}
        onClose={() => setSheet(null)}
      />

      <ConfirmDialog
        visible={confirmDelete}
        title="Remove this component?"
        message="Any employee whose pay structure uses it loses that line. Existing payslips already generated are not changed."
        confirmLabel="Remove"
        icon="trash-outline"
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
      <View style={{ height: spacing.lg }} />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 34, height: 34, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
});
