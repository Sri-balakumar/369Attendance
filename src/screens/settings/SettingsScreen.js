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
import { getAttendanceSettings, saveAttendanceConfig } from '../../services/odoo';
import { prettyHost } from '../../utils/url';
import AttendanceRulesSection from './AttendanceRulesSection';

/**
 * Settings.
 *
 * Two things that were previously nowhere in the app: which server and database
 * it is talking to, and the attendance rules everyone is judged by. The rules
 * are read-only for staff and editable for whoever the server says may write
 * them -- Odoo's ACL already draws that line, so the screen just follows it.
 *
 * Further sections (WFH, Leave, holidays, auto-approval) belong here too, but
 * attendance went first deliberately so the shape could be proven once.
 */
export default function SettingsScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const showToast = useToast();
  const { server, user } = useSession();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        setData(await getAttendanceSettings());
        setError('');
      } catch (e) {
        const message = e?.message || 'Could not load settings.';
        if (data) showToast(message, 'danger');
        else setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Returns true when the write landed, so the section can leave edit mode.
   *
   * The saved row is taken from the server's reply rather than patched locally:
   * daily_work_hours is a stored compute off the office hours, so only the
   * server knows what the record now says.
   */
  const onSave = async (id, values) => {
    if (saving) return false;
    setSaving(true);
    try {
      const saved = await saveAttendanceConfig(id, values);
      setData((d) => (d ? { ...d, config: saved || d.config } : d));
      showToast('Attendance rules updated.', 'success');
      return true;
    } catch (e) {
      showToast(e?.message || 'Could not save the changes.', 'danger');
      return false;
    } finally {
      setSaving(false);
    }
  };

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
              Settings
            </Text>
            <Text
              style={{ color: withAlpha(colors.onHeader, 0.8), fontFamily: fonts.regular, fontSize: fontSize.sm }}
            >
              Connection and attendance rules
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
        {/* Connection needs no server round trip -- the session already holds it,
            so it renders immediately even while the rules are still loading. */}
        <Card padded={false}>
          <View style={[styles.head, { borderBottomColor: colors.border }]}>
            <View style={[styles.headIcon, { backgroundColor: withAlpha(colors.info, 0.14) }]}>
              <Ionicons name="server-outline" size={16} color={colors.info} />
            </View>
            <Text
              style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.sm, marginLeft: 10 }}
            >
              Connection
            </Text>
          </View>
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
            <Row label="Server" value={server?.url ? prettyHost(server.url) : '—'} />
            <Row label="Database" value={server?.db || '—'} />
            <Row label="Signed in as" value={user?.name || '—'} />
            <Row label="Username" value={user?.username || '—'} last />
          </View>
        </Card>

        {loading ? (
          <Card style={{ marginTop: spacing.md }}>
            <Skeleton width="40%" height={15} />
            <Skeleton height={12} style={{ marginTop: 14 }} />
            <Skeleton width="70%" height={12} style={{ marginTop: 8 }} />
            <Skeleton width="55%" height={12} style={{ marginTop: 8 }} />
          </Card>
        ) : error ? (
          <ErrorCard message={error} onRetry={() => load()} />
        ) : !data?.config ? (
          <Card style={{ marginTop: spacing.md }}>
            <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm }}>
              No attendance rules are configured for your company yet.
            </Text>
          </Card>
        ) : (
          <AttendanceRulesSection
            config={data.config}
            overrides={data.overrides}
            canEdit={data.canEdit}
            saving={saving}
            onSave={onSave}
          />
        )}

        <Text
          style={{
            color: colors.muted,
            fontFamily: fonts.regular,
            fontSize: fontSize.xs,
            textAlign: 'center',
            marginTop: spacing.lg,
          }}
        >
          Work-from-home, leave and holiday settings will appear here as they are added.
        </Text>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, last }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : 1 }]}>
      <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm }}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          textAlign: 'right',
          color: colors.text,
          fontFamily: fonts.medium,
          fontSize: fontSize.sm,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function ErrorCard({ message, onRetry }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  return (
    <Card
      style={{
        marginTop: spacing.md,
        backgroundColor: withAlpha(colors.danger, 0.09),
        borderColor: withAlpha(colors.danger, 0.3),
      }}
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Ionicons name="alert-circle" size={18} color={colors.danger} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.danger, fontFamily: fonts.medium, fontSize: fontSize.sm }}>
            {message}
          </Text>
          <Pressable onPress={onRetry} hitSlop={8} style={{ marginTop: spacing.sm }}>
            <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
              Retry
            </Text>
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
  head: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  headIcon: { width: 30, height: 30, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12 },
});
