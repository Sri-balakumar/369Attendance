import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, useWindowDimensions, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { SelectSheet } from '../../components';
import { useSession } from '../../state/SessionContext';
import { fetchDatabases } from '../../services/odoo';
import { looksLikeUrl, normalizeUrl } from '../../utils/url';
import AuthField, { AuthButton, AuthHeading, useAuthColors } from './AuthField';
import useKeyboardScrollToEnd from './useKeyboardScrollToEnd';

/**
 * Step one of two: entering a URL fetches the database list on a debounce,
 * and Continue stores both and hands over to step two (`onDone`). The only way
 * back here is "Change server" on the sign-in step.
 */
export default function ServerForm({ onDone }) {
  const { fonts } = useTheme();
  const c = useAuthColors();
  const insets = useSafeAreaInsets();
  // Tablets get wider margins, so the fields are wide without hugging the edges.
  const gutter = useWindowDimensions().width >= 600 ? 48 : 24;
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
  // Keeps Continue in view above the keyboard.
  const keyboardScroll = useKeyboardScrollToEnd();

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
    try {
      await saveServer({ url: normalizeUrl(url), db: db.trim() });
      onDone?.();
    } finally {
      setSubmitting(false);
    }
  };

  // The database field is one of: waiting for a URL / loading / picked
  // automatically / a list to choose from / typed by hand.
  let dbField;
  if (manualDb) {
    dbField = (
      <AuthField
        label="Database"
        icon="server-outline"
        value={db}
        onChangeText={setDb}
        placeholder="Database name"
        autoCapitalize="none"
        autoCorrect={false}
      />
    );
  } else if (loadingDbs) {
    dbField = <AuthField label="Database" icon="server-outline" loading placeholder="Fetching databases…" />;
  } else if (databases.length === 1) {
    dbField = (
      <AuthField
        label="Database"
        icon="server-outline"
        display
        value={databases[0]}
        trailing={<Ionicons name="checkmark-circle" size={21} color={c.success} />}
      />
    );
  } else if (databases.length > 1) {
    dbField = (
      <AuthField
        label="Database"
        icon="server-outline"
        value={db}
        placeholder="Select a database"
        onPress={() => setSheetOpen(true)}
        trailing={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: c.blue, fontFamily: fonts.semibold, fontSize: 13 }}>{databases.length}</Text>
            <Ionicons name="chevron-down" size={19} color={c.icon} />
          </View>
        }
      />
    );
  } else {
    dbField = (
      <AuthField
        label="Database"
        icon="server-outline"
        display
        value=""
        placeholder={dbError ? 'Not available' : 'Loads after the server URL'}
      />
    );
  }

  return (
    <>
      <ScrollView
        {...keyboardScroll}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: gutter, paddingTop: 18, paddingBottom: insets.bottom + 18 }}
        keyboardShouldPersistTaps="handled"
      >
        <AuthHeading
          eyebrow="369 AI · ATTENDANCE"
          title="Welcome to work"
          subtitle="Enter your Odoo server address and database to continue."
        />

        <AuthField
          label="Server URL"
          icon="globe-outline"
          value={url}
          onChangeText={setUrl}
          placeholder="erp.yourcompany.com"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          style={{ marginTop: 22 }}
        />

        <View style={{ marginTop: 16 }}>{dbField}</View>

        {dbError ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle" size={16} color={c.danger} />
            <Text style={{ flex: 1, color: c.danger, fontFamily: fonts.medium, fontSize: 13, marginLeft: 6 }}>{dbError}</Text>
          </View>
        ) : null}
        {dbError ? (
          <View style={{ flexDirection: 'row', gap: 20, marginTop: 8 }}>
            <Pressable onPress={() => load(url.trim())} hitSlop={8} style={styles.link}>
              <Ionicons name="refresh" size={15} color={c.blue} />
              <Text style={{ color: c.blue, fontFamily: fonts.semibold, fontSize: 14 }}>Retry</Text>
            </Pressable>
            {!manualDb ? (
              <Pressable onPress={() => setManualDb(true)} hitSlop={8} style={styles.link}>
                <Ionicons name="create-outline" size={15} color={c.blue} />
                <Text style={{ color: c.blue, fontFamily: fonts.semibold, fontSize: 14 }}>Enter database manually</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Pushes the button to the foot of the screen, as in the design. */}
        <View style={{ flex: 1, minHeight: 28 }} />

        <AuthButton
          label="Continue"
          icon="arrow-forward"
          onPress={onContinue}
          disabled={!canContinue}
          loading={submitting}
        />
      </ScrollView>

      <SelectSheet
        visible={sheetOpen}
        title="Select database"
        options={databases}
        value={db}
        onSelect={setDb}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
