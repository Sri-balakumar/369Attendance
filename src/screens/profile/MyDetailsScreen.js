import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Skeleton, useToast } from '../../components';
import { useSession } from '../../state/SessionContext';
import { getMyDetails } from '../../services/odoo';
import { formatDateKeyShort } from '../../utils/time';

/**
 * My Details -- what the employee owns about themselves.
 *
 * Every section is gated by Field Settings, and the flags come back in the same
 * read as the values (they are read-only mirrors on res.users), so a section
 * that an admin has not enabled is simply absent rather than shown empty.
 *
 * Nothing salary-bearing appears here at any point. That is not only a UI
 * choice: the fields are outside the self-service allow-list on res.users, so
 * this screen could not show them even if it tried.
 */
export default function MyDetailsScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const showToast = useToast();
  const { user } = useSession();

  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        setDetails(await getMyDetails(user?.uid));
        setError('');
      } catch (e) {
        const message = e?.message || 'Could not load your details.';
        if (details) showToast(message, 'danger');
        else setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast, user?.uid]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = details?.sections || {};
  const p = details?.personal || {};
  const anySection =
    s.personal || s.qualifications || s.previousEmployment || s.statutory;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />

      <LinearGradient
        colors={colors.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + spacing.base }]}
      >
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [
              styles.backBtn,
              {
                backgroundColor: withAlpha(colors.onHeader, pressed ? 0.28 : 0.16),
                borderColor: withAlpha(colors.onHeader, 0.22),
              },
            ]}
          >
            <Ionicons name="chevron-back" size={20} color={colors.onHeader} />
          </Pressable>
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={{ color: colors.onHeader, fontFamily: fonts.bold, fontSize: fontSize.lg }}>
              My details
            </Text>
            <Text
              style={{ color: withAlpha(colors.onHeader, 0.8), fontFamily: fonts.regular, fontSize: fontSize.sm }}
            >
              {details?.name || 'Your profile'}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        {loading ? (
          <>
            <Card>
              <Skeleton width="45%" height={15} />
              <Skeleton height={12} style={{ marginTop: 12 }} />
              <Skeleton width="70%" height={12} style={{ marginTop: 8 }} />
            </Card>
            <Card style={{ marginTop: spacing.md }}>
              <Skeleton width="35%" height={15} />
              <Skeleton height={12} style={{ marginTop: 12 }} />
            </Card>
          </>
        ) : error ? (
          <ErrorCard message={error} onRetry={() => load()} />
        ) : (
          <>
            <Section title="Account" icon="person-outline">
              <Row label="Name" value={details?.name} />
              <Row label="Username" value={details?.login} last />
            </Section>

            {s.personal ? (
              <Section title="Personal" icon="heart-outline" style={{ marginTop: spacing.md }}>
                <Row label="Blood group" value={p.bloodGroup} />
                <Row label="Emergency contact relation" value={p.emergencyRelation} />
                <Row label="Father's name" value={p.fatherName} />
                <Row label="Mother's name" value={p.motherName} last={!p.emergency2} />
                {p.emergency2 ? (
                  <>
                    <Row label="Second contact" value={p.emergency2.name} />
                    <Row label="Second contact phone" value={p.emergency2.phone} />
                    <Row label="Second contact relation" value={p.emergency2.relation} last />
                  </>
                ) : null}
              </Section>
            ) : null}

            {s.qualifications ? (
              <Section title="Qualifications" icon="school-outline" style={{ marginTop: spacing.md }}>
                {details.qualifications.length ? (
                  details.qualifications.map((q, i) => (
                    <Row
                      key={q.id}
                      label={[q.name, q.specialization].filter(Boolean).join(' · ') || 'Qualification'}
                      value={[q.institution, q.year, q.grade].filter(Boolean).join(' · ')}
                      last={i === details.qualifications.length - 1}
                    />
                  ))
                ) : (
                  <Empty text="Nothing recorded yet." />
                )}
              </Section>
            ) : null}

            {s.previousEmployment ? (
              <Section title="Previous employment" icon="briefcase-outline" style={{ marginTop: spacing.md }}>
                {details.previousEmployment.length ? (
                  details.previousEmployment.map((e, i) => (
                    <Row
                      key={e.id}
                      label={[e.company, e.jobTitle].filter(Boolean).join(' · ') || 'Employer'}
                      value={[
                        e.from ? formatDateKeyShort(e.from) : '',
                        e.to ? formatDateKeyShort(e.to) : '',
                      ]
                        .filter(Boolean)
                        .join(' – ') + (e.duration ? ` · ${e.duration}` : '')}
                      last={i === details.previousEmployment.length - 1}
                    />
                  ))
                ) : (
                  <Empty text="Nothing recorded yet." />
                )}
              </Section>
            ) : null}

            {!anySection ? (
              <Card style={{ marginTop: spacing.md }}>
                <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
                  <View style={[styles.emptyIcon, { backgroundColor: withAlpha(colors.muted, 0.12) }]}>
                    <Ionicons name="lock-closed-outline" size={22} color={colors.muted} />
                  </View>
                  <Text
                    style={{
                      color: colors.text,
                      fontFamily: fonts.semibold,
                      fontSize: fontSize.base,
                      marginTop: spacing.md,
                    }}
                  >
                    Nothing to show yet
                  </Text>
                  <Text
                    style={{
                      color: colors.muted,
                      fontFamily: fonts.regular,
                      fontSize: fontSize.sm,
                      marginTop: 4,
                      textAlign: 'center',
                    }}
                  >
                    Your HR team has not enabled any detail sections.
                  </Text>
                </View>
              </Card>
            ) : null}

            <Text
              style={{
                color: colors.muted,
                fontFamily: fonts.regular,
                fontSize: fontSize.xs,
                textAlign: 'center',
                marginTop: spacing.lg,
              }}
            >
              To change these, open My Profile in Odoo. Contact HR for anything not shown here.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({ title, icon, children, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  return (
    <Card style={style} padded={false}>
      <View style={[styles.sectionHead, { borderBottomColor: colors.border }]}>
        <View style={[styles.sectionIcon, { backgroundColor: withAlpha(colors.primary, 0.12) }]}>
          <Ionicons name={icon} size={16} color={colors.primary} />
        </View>
        <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.sm, marginLeft: 10 }}>
          {title}
        </Text>
      </View>
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: 4 }}>{children}</View>
    </Card>
  );
}

/** A field the admin enabled but nobody has filled in still gets a row, so the
 *  gap is visible and fillable rather than silently missing. */
function Row({ label, value, last }) {
  const { colors, fonts, fontSize } = useTheme();
  const shown = value === '' || value === null || value === undefined ? '—' : value;
  return (
    <View style={[styles.row, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : 1 }]}>
      <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm }}>
        {label}
      </Text>
      <Text
        style={{
          flex: 1,
          textAlign: 'right',
          color: shown === '—' ? colors.muted : colors.text,
          fontFamily: fonts.medium,
          fontSize: fontSize.sm,
        }}
      >
        {shown}
      </Text>
    </View>
  );
}

function Empty({ text }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <Text
      style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm, paddingVertical: 14 }}
    >
      {text}
    </Text>
  );
}

function ErrorCard({ message, onRetry }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  return (
    <Card style={{ backgroundColor: withAlpha(colors.danger, 0.09), borderColor: withAlpha(colors.danger, 0.3) }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Ionicons name="alert-circle" size={18} color={colors.danger} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.danger, fontFamily: fonts.medium, fontSize: fontSize.sm }}>{message}</Text>
          <Pressable onPress={onRetry} hitSlop={8} style={{ marginTop: spacing.sm }}>
            <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>Retry</Text>
          </Pressable>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  sectionIcon: { width: 30, height: 30, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12 },
  emptyIcon: { width: 48, height: 48, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
});
