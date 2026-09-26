import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, Animated, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

/**
 * The HR alert email, as HR will receive it, in a centred popup.
 *
 * `load` is an async function returning the server's preview
 * ({subject, rows:[{label,value}], intro, footer, recipients}). The server
 * builds it with the same code that builds the real email
 * (hr.leave.request.submit_mail_rows), so this is not an approximation: what
 * is shown here is what HR gets. It is re-asked every time the popup opens,
 * so it always reflects what has been typed so far.
 *
 * The email itself sits on white "paper" in both themes, because that is how
 * a mail client shows it; only the popup chrome follows the app theme.
 */
export default function MailPreviewModal({ visible, onClose, load, title = 'Email to HR' }) {
  const { colors, radii, fonts, fontSize, spacing, shadows } = useTheme();
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    setState({ loading: true, data: null, error: '' });
    appear.setValue(0);
    Animated.spring(appear, { toValue: 1, damping: 18, stiffness: 220, mass: 0.8, useNativeDriver: true }).start();
    Promise.resolve()
      .then(load)
      .then((data) => alive && setState({ loading: false, data, error: '' }))
      .catch((e) => alive && setState({ loading: false, data: null, error: e?.message || 'Could not build the preview.' }));
    return () => {
      alive = false;
    };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = state.data;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close preview" />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.lg,
              opacity: appear,
              transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
            },
            shadows.raised,
          ]}
        >
          <View style={styles.head}>
            <Ionicons name="mail-outline" size={18} color={colors.accent} />
            <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.md }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>

          {d && d.recipients ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginBottom: spacing.sm }}>
              {`Goes to ${d.recipients} ${d.recipients === 1 ? 'person' : 'people'} in HR when submitted.`}
            </Text>
          ) : null}

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 2 }}>
            {state.loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : state.error ? (
              <Text style={{ color: colors.danger, fontFamily: fonts.medium, fontSize: fontSize.sm }}>{state.error}</Text>
            ) : d ? (
              <View style={styles.paper}>
                <Text style={styles.subject}>{d.subject}</Text>
                <View style={styles.rule} />
                <Text style={styles.intro}>{d.intro}</Text>
                {d.rows.map((r) => (
                  <View key={r.label} style={styles.row}>
                    <Text style={styles.label}>{r.label}</Text>
                    <Text style={[styles.value, r.label === 'Employee' ? { fontWeight: '700' } : null]}>
                      {r.value || '—'}
                    </Text>
                  </View>
                ))}
                <View style={styles.button}>
                  <Text style={{ color: '#1E293B', fontWeight: '700', fontSize: 13 }}>Review and approve</Text>
                </View>
                <Text style={styles.footer}>{d.footer}</Text>
              </View>
            ) : null}
          </ScrollView>

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.close,
              { backgroundColor: colors.primary, borderRadius: radii.md, opacity: pressed ? 0.85 : 1, marginTop: spacing.md },
            ]}
          >
            <Text style={{ color: colors.onPrimary, fontFamily: fonts.bold, fontSize: fontSize.sm }}>Close</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 440, borderWidth: 1, padding: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  center: { paddingVertical: 36, alignItems: 'center' },
  paper: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, padding: 14 },
  subject: { color: '#111827', fontSize: 14, fontWeight: '700' },
  rule: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 10 },
  intro: { color: '#111827', fontSize: 13, marginBottom: 6 },
  row: { flexDirection: 'row', paddingVertical: 4, gap: 10 },
  label: { width: 82, color: '#6B7280', fontSize: 13 },
  value: { flex: 1, color: '#111827', fontSize: 13 },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#F59E0B',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginTop: 10,
  },
  footer: { color: '#6B7280', fontSize: 11, marginTop: 10 },
  close: { height: 44, alignItems: 'center', justifyContent: 'center' },
});
