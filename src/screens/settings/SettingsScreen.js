import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card } from '../../components';
import { useSession } from '../../state/SessionContext';
import { prettyHost } from '../../utils/url';

/**
 * Settings -- which server and database this install is talking to, and as
 * whom. Previously nowhere in the app.
 *
 * The attendance rules used to sit here too and have moved to the Config tab.
 * They were never really settings in this sense: this screen is about THIS
 * INSTALL, which every user can see and nobody can change from here, whereas
 * the rules are company policy that only an authorised user may edit. Keeping
 * them together meant one screen answering to two audiences.
 *
 * Still a pushed screen reached from the gear on the Home header, not a tab --
 * four read-only rows do not earn a permanent seat in the bottom bar.
 */
export default function SettingsScreen({ navigation }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const { server, user, canManage } = useSession();

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
              Server and account
            </Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
      >
        {/* No round trip and no loading state: the session already holds all
            four values, so this renders complete on first paint. */}
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

        {/* Only worth saying to someone who HAS a Config tab -- pointing
            staff at a destination they cannot reach is worse than silence. */}
        {canManage ? (
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.regular,
              fontSize: fontSize.xs,
              textAlign: 'center',
              marginTop: spacing.lg,
            }}
          >
            Attendance, work-from-home and leave rules live in Config.
          </Text>
        ) : null}
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
