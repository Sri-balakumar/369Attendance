import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import {
  Card,
  AppTextInput,
  DateField,
  PrimaryButton,
  SelectSheet,
  ConfirmDialog,
  useToast,
} from '../../components';
import {
  fetchPublicHolidays,
  savePublicHoliday,
  deletePublicHoliday,
  fetchCompanies,
} from '../../services/odoo';
import AdminScreen from './AdminScreen';
import { GUIDES } from './guides';
import { goBackOnce } from '../../navigation/back';

/**
 * Add, edit or remove one public holiday.
 *
 * The only destructive screen in the app, and the deletion is not neutral:
 * holidays sit outside the working-day count that divides the monthly wage, so
 * removing one LOWERS everybody's daily rate for that month and makes an
 * absence or half day there cost less. The confirm says so in those terms.
 */
export default function HolidayFormScreen({ navigation, route }) {
  const id = route?.params?.id || null;
  const year = route?.params?.year || new Date().getFullYear();
  // The Calendar tab opens Add on the day that was tapped.
  const presetDate = route?.params?.date || null;
  const { colors, fonts, fontSize, spacing } = useTheme();
  const showToast = useToast();

  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState('');
  const [date, setDate] = useState(presetDate || `${year}-01-01`);
  const [companyId, setCompanyId] = useState(null);
  // Read-only: the server works it out from the working days (a holiday on a
  // Sunday or a 2nd Saturday off changes nothing). There is nothing to set.
  const [affects, setAffects] = useState(true);
  const [companies, setCompanies] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    fetchCompanies()
      .then((c) => {
        setCompanies(c);
        // A new holiday needs a company, and there is usually exactly one.
        setCompanyId((prev) => (prev === null && !id && c.length ? c[0].value : prev));
      })
      .catch(() => setCompanies([]));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetchPublicHolidays(year)
      .then((rows) => {
        const row = rows.find((r) => r.id === Number(id));
        if (!row) throw new Error('That holiday no longer exists.');
        setName(row.name || '');
        setDate(row.date || '');
        setCompanyId(row.company_id ? row.company_id[0] : null);
        setAffects(row.affects_working_days !== false);
        setError('');
      })
      .catch((e) => setError(e?.message || 'Could not load that holiday.'))
      .finally(() => setLoading(false));
  }, [id, year]);

  const submit = async () => {
    const next = {};
    if (!name.trim()) next.name = 'Give the holiday a name.';
    if (!date) next.date = 'Pick the date.';
    if (!companyId) next.company = 'A company is required.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      await savePublicHoliday(id, {
        name: name.trim(),
        date,
        company_id: Number(companyId),
      });
      showToast(id ? 'Holiday updated.' : 'Holiday added.', 'success');
      goBackOnce(navigation);
    } catch (e) {
      showToast(e?.message || 'Could not save the holiday.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await deletePublicHoliday(id);
      showToast('Holiday removed.', 'success');
      goBackOnce(navigation);
    } catch (e) {
      showToast(e?.message || 'Could not remove the holiday.', 'danger');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AdminScreen guide={GUIDES.holidayForm}
      navigation={navigation}
      title={id ? 'Edit holiday' : 'Add holiday'}
      subtitle={id ? name || 'Public holiday' : `${year}`}
      loading={loading}
      error={error}
    >
      <Card>
        <AppTextInput
          label="Holiday name"
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
          }}
          icon="flag-outline"
          error={errors.name}
        />
        <DateField
          label="Date"
          value={date}
          onChange={(v) => {
            setDate(v);
            if (errors.date) setErrors((e) => ({ ...e, date: undefined }));
          }}
          error={errors.date}
          style={{ marginTop: spacing.base }}
        />
        <AppTextInput
          label="Company"
          value={companies.find((c) => c.value === companyId)?.label || ''}
          icon="business-outline"
          error={errors.company}
          editable={false}
          onPress={() => setSheet(true)}
          rightSlot={<Ionicons name="chevron-down" size={17} color={colors.muted} />}
          style={{ marginTop: spacing.base }}
        />
        {id && !affects ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: spacing.md }}>
            <Ionicons name="information-circle-outline" size={16} color={colors.muted} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, lineHeight: 17 }}>
              This date is already a weekly off, so it does not change the working-day count or anyone&apos;s pay.
            </Text>
          </View>
        ) : null}
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
        Nobody is ever marked Absent on a holiday, and a holiday can never be
        deducted.
      </Text>

      <PrimaryButton
        label={id ? 'Save changes' : 'Add holiday'}
        loading={saving}
        onPress={submit}
        style={{ marginTop: spacing.lg }}
      />

      {id ? (
        <PrimaryButton
          label="Remove holiday"
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
        value={companyId}
        onSelect={(v) => {
          setCompanyId(v);
          if (errors.company) setErrors((e) => ({ ...e, company: undefined }));
        }}
        onClose={() => setSheet(false)}
      />

      <ConfirmDialog
        visible={confirmDelete}
        title="Remove this holiday?"
        message={
          'This changes payroll. The day goes back into the working-day count, which lowers everyone’s daily rate for that month and makes an absence or half day then cost less.'
        }
        confirmLabel="Remove"
        icon="trash-outline"
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </AdminScreen>
  );
}
