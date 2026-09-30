import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip, useToast } from '../../components';
import { fetchManualBundle } from '../../services/odoo';
import { openManualPdf } from '../../utils/openManual';
import AdminScreen from '../config/AdminScreen';

export const AUDIENCES = [
  { value: 'all', label: 'Everyone' },
  { value: 'admin', label: 'Admin' },
  { value: 'hr', label: 'HR' },
  { value: 'employee', label: 'Employee' },
];
const AUDIENCE_TONE = { all: 'muted', admin: 'danger', hr: 'info', employee: 'success' };
const audienceLabel = (v) => AUDIENCES.find((a) => a.value === v)?.label || 'Everyone';

/**
 * App Manual -- the PDFs uploaded under Attendance > Help > Mobile App.
 *
 * Open to everyone. The server decides which manuals each person receives
 * (admins all of them; HR and employees their own plus the Everyone ones), so
 * this screen draws what it is given. Admins also get add / edit here, the
 * same shelf they can manage from the backend.
 */
export default function AppManualScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const showToast = useToast();
  const [bundle, setBundle] = useState({ available: true, canEdit: false, manuals: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openingId, setOpeningId] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setBundle(await fetchManualBundle());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // On focus, so a manual added or replaced on the form shows up on return.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const open = async (m) => {
    if (openingId) return;
    setOpeningId(m.id);
    try {
      await openManualPdf(m.id);
    } catch (e) {
      showToast(e?.message || 'Could not open the manual.', 'danger');
    } finally {
      setOpeningId(null);
    }
  };

  const { available, canEdit, manuals } = bundle;

  return (
    <AdminScreen
      navigation={navigation}
      title="App Manual"
      subtitle={canEdit ? 'Admin · HR · Employee guides' : 'How to use the app'}
      loading={loading}
      refreshing={refreshing}
      onRefresh={() => load(true)}
      empty={!loading && manuals.length === 0}
      keepChildrenWhenEmpty={canEdit}
      emptyTitle={available ? 'No manuals yet' : 'Manuals are not set up'}
      emptyMessage={
        available
          ? canEdit
            ? 'Add the Admin, HR and Employee PDFs here or under Attendance > Help > Mobile App in Odoo.'
            : 'Your administrator has not uploaded a manual for you yet.'
          : 'The server’s Attendance module needs upgrading before manuals can be shown here.'
      }
      emptyIcon="book-outline"
    >
      {manuals.map((m, i) => (
        <Pressable
          key={m.id}
          onPress={() => open(m)}
          android_ripple={{ color: withAlpha(colors.primary, 0.12) }}
          accessibilityRole="button"
          accessibilityLabel={`Open ${m.name}`}
          style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: i === 0 ? 0 : spacing.sm }]}
        >
          <Card padded={false}>
            <View style={[styles.row, { padding: spacing.base }]}>
              <View style={[styles.icon, { backgroundColor: withAlpha(colors.danger, 0.12) }]}>
                <Ionicons name="document-text-outline" size={20} color={colors.danger} />
              </View>
              <View style={{ flex: 1, marginLeft: 11 }}>
                <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                  {m.name}
                </Text>
                <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
                  {m.description || m.filename}
                </Text>
                {canEdit ? (
                  <View style={{ flexDirection: 'row', marginTop: 6 }}>
                    <Chip label={audienceLabel(m.audience)} tone={AUDIENCE_TONE[m.audience] || 'muted'} size="sm" />
                  </View>
                ) : null}
              </View>
              {openingId === m.id ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />
              ) : (
                <Ionicons name="open-outline" size={18} color={colors.faint} style={{ marginLeft: 8 }} />
              )}
              {canEdit ? (
                <Pressable
                  onPress={() => navigation.navigate('AppManualForm', { manual: m })}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${m.name}`}
                  style={({ pressed }) => [
                    styles.edit,
                    { borderColor: colors.border, backgroundColor: pressed ? withAlpha(colors.primary, 0.1) : 'transparent' },
                  ]}
                >
                  <Ionicons name="create-outline" size={17} color={colors.primary} />
                </Pressable>
              ) : null}
            </View>
          </Card>
        </Pressable>
      ))}

      {canEdit && available ? (
        <Pressable
          onPress={() => navigation.navigate('AppManualForm', { manual: null })}
          accessibilityRole="button"
          accessibilityLabel="Add a manual"
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
            Add a manual
          </Text>
        </Pressable>
      ) : null}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  edit: {
    width: 34,
    height: 34,
    marginLeft: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
