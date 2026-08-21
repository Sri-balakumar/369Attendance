import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { radii } from '../theme/tokens';
import { AppTextInput, PrimaryButton, Skeleton, SelectSheet } from '../components';
import { useSession } from '../state/SessionContext';
import { fetchDatabases } from '../services/odoo';
import { looksLikeUrl, normalizeUrl } from '../utils/url';

/**
 * Step one of two, and the user sees it exactly once: entering a URL fetches
 * the database list on a debounce, and Continue stores both and resets to
 * Login. The only way back here is "Change URL" on the Login screen.
 */
export default function ServerScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, radii, shadows, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const { saveServer } = useSession();

  const [url, setUrl] = useState('');
  const [db, setDb] = useState('');
  const [databases, setDatabases] = useState([]);
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [dbError, setDbError] = useState('');
  const [manualDb, setManualDb] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Guards against a slow earlier request overwriting a newer one's result.
  const requestId = useRef(0);

  const load = useCallback(async (raw) => {
    const id = ++requestId.current;
    setLoadingDbs(true);
    setDbError('');
    try {
      const list = await fetchDatabases(normalizeUrl(raw));
      if (id !== requestId.current) return;
      setDatabases(list);
      if (list.length === 0) {
        setDbError('No databases found on this server.');
        setDb('');
      } else if (list.length === 1) {
        setDb(list[0]);
      } else {
        setDb((prev) => (prev && list.includes(prev) ? prev : ''));
      }
    } catch (e) {
      if (id !== requestId.current) return;
      setDatabases([]);
      setDb('');
      setDbError(e?.message || 'Could not fetch databases.');
    } finally {
      if (id === requestId.current) setLoadingDbs(false);
    }
  }, []);

  // Debounced auto-fetch: the user never presses a "connect" button.
  useEffect(() => {
    const trimmed = url.trim();
    if (!looksLikeUrl(trimmed)) {
      requestId.current++; // cancels whatever is in flight
      setDatabases([]);
      setDb('');
      setDbError('');
      setLoadingDbs(false);
      return undefined;
    }
    const t = setTimeout(() => load(trimmed), 600);
    return () => clearTimeout(t);
  }, [url, load]);

  const canContinue = looksLikeUrl(url) && Boolean(db.trim()) && !loadingDbs;

  const onContinue = async () => {
    if (!canContinue) return;
    setSubmitting(true);
    await saveServer({ url: normalizeUrl(url), db: db.trim() });
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  const showHint = !loadingDbs && !dbError && databases.length === 0 && !manualDb;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />

      <LinearGradient
        colors={colors.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + spacing.xl }]}
      >
        <View
          style={[
            styles.headerIcon,
            { backgroundColor: withAlpha(colors.onHeader, 0.18), borderColor: withAlpha(colors.onHeader, 0.3) },
          ]}
        >
          <Ionicons name="cloud-outline" size={26} color={colors.onHeader} />
        </View>
        <Text
          style={{
            color: colors.onHeader,
            fontFamily: fonts.bold,
            fontSize: fontSize.xl,
            marginTop: spacing.base,
          }}
        >
          Connect to your server
        </Text>
        <Text
          style={{
            color: withAlpha(colors.onHeader, 0.78),
            fontFamily: fonts.regular,
            fontSize: fontSize.base,
            marginTop: 6,
          }}
        >
          Enter your Odoo server address to continue
        </Text>
      </LinearGradient>

      <KeyboardAvoidingView
        style={{ flex: 1, marginTop: -spacing.xl }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.lg,
                padding: spacing.lg,
              },
              shadows.raised,
            ]}
          >
            <Text
              style={[
                styles.stepLabel,
                { color: colors.muted, fontFamily: fonts.semibold, fontSize: fontSize.xs },
              ]}
            >
              STEP 1 OF 2
            </Text>

            <AppTextInput
              label="Server URL"
              value={url}
              onChangeText={setUrl}
              icon="globe-outline"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              style={{ marginTop: spacing.md }}
            />

            {/* Database area — one of: loading / error / single / list / hint */}
            <View style={{ marginTop: spacing.base }}>
              {loadingDbs ? (
                <View>
                  <View style={styles.loadingRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text
                      style={{
                        color: colors.muted,
                        fontFamily: fonts.medium,
                        fontSize: fontSize.sm,
                        marginLeft: 9,
                      }}
                    >
                      Fetching databases…
                    </Text>
                  </View>
                  <Skeleton height={62} radius={radii.md} style={{ marginTop: spacing.md }} />
                  <Skeleton height={12} width="45%" style={{ marginTop: spacing.md }} />
                </View>
              ) : dbError ? (
                <View
                  style={[
                    styles.errorCard,
                    {
                      backgroundColor: withAlpha(colors.danger, 0.09),
                      borderColor: withAlpha(colors.danger, 0.3),
                      borderRadius: radii.md,
                      padding: spacing.base,
                    },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <Ionicons name="alert-circle" size={19} color={colors.danger} />
                    <Text
                      style={{
                        flex: 1,
                        color: colors.text,
                        fontFamily: fonts.medium,
                        fontSize: fontSize.sm,
                        marginLeft: 9,
                        lineHeight: 19,
                      }}
                    >
                      {dbError}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md }}>
                    <Pressable onPress={() => load(url.trim())} hitSlop={8} style={styles.linkBtn}>
                      <Ionicons name="refresh" size={15} color={colors.danger} />
                      <Text style={{ color: colors.danger, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
                        Retry
                      </Text>
                    </Pressable>
                    {!manualDb ? (
                      <Pressable onPress={() => setManualDb(true)} hitSlop={8} style={styles.linkBtn}>
                        <Ionicons name="create-outline" size={15} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
                          Enter database manually
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : databases.length === 1 && !manualDb ? (
                <View
                  style={[
                    styles.singleDb,
                    {
                      backgroundColor: withAlpha(colors.success, 0.1),
                      borderColor: withAlpha(colors.success, 0.3),
                      borderRadius: radii.md,
                      padding: spacing.base,
                    },
                  ]}
                >
                  <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text
                      style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}
                    >
                      {databases[0]}
                    </Text>
                    <Text
                      style={{
                        color: colors.muted,
                        fontFamily: fonts.regular,
                        fontSize: fontSize.xxs,
                        marginTop: 2,
                      }}
                    >
                      1 database found · selected automatically
                    </Text>
                  </View>
                </View>
              ) : databases.length > 1 && !manualDb ? (
                <Pressable onPress={() => setSheetOpen(true)}>
                  <View
                    style={[
                      styles.selectField,
                      {
                        backgroundColor: colors.surfaceAlt,
                        borderColor: db ? colors.primary : colors.border,
                        borderRadius: radii.md,
                        paddingHorizontal: spacing.base,
                      },
                    ]}
                  >
                    <Ionicons name="server-outline" size={19} color={db ? colors.primary : colors.faint} />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs }}>
                        Database
                      </Text>
                      <Text
                        style={{
                          color: db ? colors.text : colors.faint,
                          fontFamily: fonts.medium,
                          fontSize: fontSize.base,
                          marginTop: 2,
                        }}
                      >
                        {db || 'Select a database'}
                      </Text>
                    </View>
                    <View
                      style={{
                        backgroundColor: withAlpha(colors.primary, 0.12),
                        borderRadius: radii.pill,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        marginRight: 8,
                      }}
                    >
                      <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.xs }}>
                        {databases.length}
                      </Text>
                    </View>
                    <Ionicons name="chevron-down" size={19} color={colors.muted} />
                  </View>
                </Pressable>
              ) : null}

              {manualDb ? (
                <AppTextInput
                  label="Database name"
                  value={db}
                  onChangeText={setDb}
                  icon="server-outline"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ marginTop: databases.length || dbError ? spacing.md : 0 }}
                />
              ) : null}

              {showHint ? (
                <View
                  style={[
                    styles.hintRow,
                    { borderColor: colors.border, borderRadius: radii.md, padding: spacing.base },
                  ]}
                >
                  <Ionicons name="information-circle-outline" size={18} color={colors.faint} />
                  <Text
                    style={{
                      flex: 1,
                      color: colors.muted,
                      fontFamily: fonts.regular,
                      fontSize: fontSize.sm,
                      marginLeft: 9,
                      lineHeight: 18,
                    }}
                  >
                    Databases load automatically once the address looks complete.
                  </Text>
                </View>
              ) : null}
            </View>

            <PrimaryButton
              label="Continue"
              icon="arrow-forward"
              onPress={onContinue}
              disabled={!canContinue}
              loading={submitting}
              style={{ marginTop: spacing.lg }}
            />
          </View>

          <View style={styles.footer}>
            <Ionicons name="lock-closed-outline" size={13} color={colors.faint} />
            <Text
              style={{ color: colors.faint, fontFamily: fonts.regular, fontSize: fontSize.xxs, marginLeft: 6 }}
            >
              Your server address is stored on this device only.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <SelectSheet
        visible={sheetOpen}
        title="Select database"
        options={databases}
        value={db}
        onSelect={setDb}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingBottom: 44,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  headerIcon: {
    width: 54,
    height: 54,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { borderWidth: 1 },
  // letterSpacing only: `fontSize` is a theme value and this object is
  // module level, where nothing from useTheme() is in scope. The size is
  // applied at the usage site, which already merges an inline style.
  stepLabel: { letterSpacing: 1.2 },
  loadingRow: { flexDirection: 'row', alignItems: 'center' },
  errorCard: { borderWidth: 1 },
  singleDb: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  selectField: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, minHeight: 62 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  hintRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderStyle: 'dashed' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
});
