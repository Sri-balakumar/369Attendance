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
  fetchStatutoryIdTypes,
  saveStatutoryIdType,
  deleteStatutoryIdType,
  fetchCompanies,
} from '../../services/odoo';
import AdminScreen from './AdminScreen';
import { GUIDES } from './guides';
import { Caption, Picker } from './FormBits';
import { goBackOnce } from '../../navigation/back';

/** PAN, Aadhaar, UAN and friends -- the identifier types an employee can hold. */
export function StatutoryIdTypesListScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setRows(await fetchStatutoryIdTypes());
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the identifier types.');
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
    <AdminScreen guide={GUIDES.idTypesList}
      navigation={navigation}
      title="Statutory ID Types"
      subtitle="PAN, Aadhaar, UAN"
      loading={loading}
      error={error}
      onRetry={() => load()}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && !error && rows.length === 0}
      keepChildrenWhenEmpty
      emptyTitle="No identifier types"
      emptyMessage="Add the identifiers your employees are asked for. Each one can carry a validation pattern."
      emptyIcon="card-outline"
    >
      {rows.map((t, i) => (
        <Pressable
          key={t.id}
          onPress={() => navigation.navigate('StatutoryIdTypeForm', { id: t.id })}
          android_ripple={{ color: withAlpha(colors.primary, 0.12) }}
          accessibilityRole="button"
          accessibilityLabel={t.name}
          style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: i === 0 ? 0 : spacing.sm }]}
        >
          <Card padded={false}>
            <View style={[styles.row, { padding: spacing.base }]}>
              <View style={[styles.icon, { backgroundColor: withAlpha(colors.primary, 0.13) }]}>
                <Ionicons name="card-outline" size={17} color={colors.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 11 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                  {t.name}
                </Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                  {t.code || 'No code'}
                  {t.validation_regex ? ' · validated' : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                {t.is_required ? <Chip label="Required" tone="warning" size="sm" /> : null}
                {t.is_confidential ? <Chip label="Confidential" tone="muted" size="sm" /> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} style={{ marginLeft: 6 }} />
            </View>
          </Card>
        </Pressable>
      ))}

      <Pressable
        onPress={() => navigation.navigate('StatutoryIdTypeForm', { id: null })}
        accessibilityRole="button"
        accessibilityLabel="Add an identifier type"
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
          Add an identifier type
        </Text>
      </Pressable>
    </AdminScreen>
  );
}

export function StatutoryIdTypeFormScreen({ navigation, route }) {
  const id = route?.params?.id || null;
  const { colors, spacing } = useTheme();
  const showToast = useToast();

  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [errors, setErrors] = useState({});

  const [d, setD] = useState({
    name: '',
    code: '',
    validation_regex: '',
    validation_message: '',
    is_required: false,
    is_confidential: true,
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
    if (!id) return;
    fetchStatutoryIdTypes()
      .then((rows) => {
        const row = rows.find((r) => r.id === Number(id));
        if (!row) throw new Error('That identifier type no longer exists.');
        setD({
          name: row.name || '',
          code: row.code || '',
          validation_regex: row.validation_regex || '',
          validation_message: row.validation_message || '',
          is_required: Boolean(row.is_required),
          is_confidential: row.is_confidential !== false,
          sequence: String(row.sequence ?? '10'),
          company_id: row.company_id ? row.company_id[0] : null,
        });
        setError('');
      })
      .catch((e) => setError(e?.message || 'Could not load that identifier type.'))
      .finally(() => setLoading(false));
  }, [id]);

  const submit = async () => {
    const next = {};
    if (!d.name.trim()) next.name = 'Give the identifier a name.';
    if (!d.company_id) next.company_id = 'A company is required.';
    // Catch a broken pattern here rather than when an employee is stopped by
    // it: the server stores the string without ever compiling it.
    if (d.validation_regex.trim()) {
      try {
        new RegExp(d.validation_regex);
      } catch (e) {
        next.validation_regex = 'That is not a valid regular expression.';
      }
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      await saveStatutoryIdType(id, {
        name: d.name.trim(),
        code: d.code.trim(),
        validation_regex: d.validation_regex.trim(),
        validation_message: d.validation_message.trim(),
        is_required: Boolean(d.is_required),
        is_confidential: Boolean(d.is_confidential),
        sequence: Number(d.sequence) || 10,
        company_id: Number(d.company_id),
      });
      showToast(id ? 'Identifier type updated.' : 'Identifier type added.', 'success');
      goBackOnce(navigation);
    } catch (e) {
      showToast(e?.message || 'Could not save the identifier type.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await deleteStatutoryIdType(id);
      showToast('Identifier type removed.', 'success');
      goBackOnce(navigation);
    } catch (e) {
      showToast(e?.message || 'Could not remove the identifier type.', 'danger');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AdminScreen guide={GUIDES.idTypeForm}
      navigation={navigation}
      title={id ? 'Edit identifier' : 'Add identifier'}
      subtitle={id ? d.name || 'Statutory ID type' : 'PAN, Aadhaar, UAN…'}
      loading={loading}
      error={error}
    >
      <Card>
        <AppTextInput
          label="Name"
          value={d.name}
          onChangeText={(v) => set('name', v)}
          icon="card-outline"
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
          label="Company"
          value={companies.find((c) => c.value === d.company_id)?.label || ''}
          icon="business-outline"
          error={errors.company_id}
          onPress={() => setSheet(true)}
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
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <AppTextInput
          label="Validation pattern"
          value={d.validation_regex}
          onChangeText={(v) => set('validation_regex', v)}
          icon="checkmark-done-outline"
          error={errors.validation_regex}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <AppTextInput
          label="Message when it fails"
          value={d.validation_message}
          onChangeText={(v) => set('validation_message', v)}
          icon="chatbox-ellipses-outline"
          style={{ marginTop: spacing.base }}
        />
        <Caption>
          A regular expression the value must match, e.g. [A-Z]{'{5}'}[0-9]{'{4}'}[A-Z]
          for a PAN. Leave it empty to accept anything.
        </Caption>
      </Card>

      <Card padded={false} style={{ marginTop: spacing.md }}>
        <View style={{ paddingHorizontal: spacing.base }}>
          <SwitchRow
            label="Required"
            help="Every employee must have this identifier on file."
            value={d.is_required}
            onValueChange={(v) => set('is_required', v)}
          />
          <SwitchRow
            label="Confidential"
            help="Kept out of the surfaces that are not the employee's own."
            value={d.is_confidential}
            onValueChange={(v) => set('is_confidential', v)}
            last
          />
        </View>
      </Card>

      <PrimaryButton
        label={id ? 'Save changes' : 'Add identifier'}
        loading={saving}
        onPress={submit}
        style={{ marginTop: spacing.lg }}
      />
      {id ? (
        <PrimaryButton
          label="Remove identifier"
          variant="ghost"
          tone="danger"
          loading={deleting}
          onPress={() => setConfirmDelete(true)}
          style={{ marginTop: spacing.md }}
        />
      ) : null}

      <SelectSheet
        visible={sheet}
        title="Company"
        icon="business-outline"
        options={companies}
        value={d.company_id}
        onSelect={(v) => set('company_id', v)}
        onClose={() => setSheet(false)}
      />
      <ConfirmDialog
        visible={confirmDelete}
        title="Remove this identifier type?"
        message="Employees who already hold one keep the record, but nobody can be asked for it again."
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
