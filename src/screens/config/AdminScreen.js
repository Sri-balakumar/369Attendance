import React from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Skeleton } from '../../components';

/**
 * The shell every Attendance Status screen sits in.
 *
 * Six screens land on the root stack above the tabs at once, and each of them
 * wants the same gradient header, the same back chevron, the same pull to
 * refresh and the same three states (loading / failed / empty). The app
 * already carries that block copied by hand into six older screens; adding six
 * more copies is how a header ends up subtly different on one screen only.
 *
 * Pushed above Main, so the floating tab bar is covered while any of these is
 * open -- which is why the bottom padding here uses the raw safe-area inset
 * rather than useTabBarLift().
 */
export default function AdminScreen({
  navigation,
  title,
  subtitle,
  icon,
  headerExtra,
  loading,
  error,
  onRetry,
  refreshing,
  onRefresh,
  empty,
  emptyTitle,
  emptyMessage,
  emptyIcon = 'checkmark-circle-outline',
  children,
}) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();

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
            <Text numberOfLines={1} style={{ color: colors.onHeader, fontFamily: fonts.bold, fontSize: fontSize.lg }}>
              {title}
            </Text>
            {subtitle ? (
              <Text
                numberOfLines={1}
                style={{
                  color: withAlpha(colors.onHeader, 0.8),
                  fontFamily: fonts.regular,
                  fontSize: fontSize.sm,
                }}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
          {icon ? <Ionicons name={icon} size={20} color={withAlpha(colors.onHeader, 0.7)} /> : null}
        </View>
        {headerExtra}
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={Boolean(refreshing)}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          ) : undefined
        }
      >
        {loading ? (
          <>
            {[0, 1, 2].map((i) => (
              <Card key={i} style={{ marginTop: i === 0 ? 0 : spacing.md }}>
                <Skeleton width="45%" height={14} />
                <Skeleton width="70%" height={11} style={{ marginTop: 10 }} />
              </Card>
            ))}
          </>
        ) : error ? (
          <ErrorCard message={error} onRetry={onRetry} />
        ) : empty ? (
          <EmptyState title={emptyTitle} message={emptyMessage} icon={emptyIcon} />
        ) : (
          children
        )}
      </ScrollView>
    </View>
  );
}

/**
 * The empty copy is lifted from each backend action's <field name="help">.
 * Those strings are already written, already accurate, and already explain WHY
 * a list is empty -- which is the part a blank screen cannot say for itself.
 */
function EmptyState({ title, message, icon }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  return (
    <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: radii.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(colors.success, 0.13),
        }}
      >
        <Ionicons name={icon} size={26} color={colors.success} />
      </View>
      <Text
        style={{
          color: colors.text,
          fontFamily: fonts.semibold,
          fontSize: fontSize.base,
          marginTop: spacing.md,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {message ? (
        <Text
          style={{
            color: colors.muted,
            fontFamily: fonts.regular,
            fontSize: fontSize.sm,
            marginTop: 6,
            textAlign: 'center',
            lineHeight: 19,
          }}
        >
          {message}
        </Text>
      ) : null}
    </Card>
  );
}

export function ErrorCard({ message, onRetry }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  return (
    <Card
      style={{
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
          {onRetry ? (
            <Pressable onPress={onRetry} hitSlop={8} style={{ marginTop: spacing.sm }}>
              <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.sm }}>
                Retry
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

/** Month pager for the header, matching the one on the attendance history. */
export function MonthNav({ label, onPrev, onNext, nextDisabled }) {
  const { colors, fonts, fontSize, withAlpha } = useTheme();
  const Btn = ({ dir, onPress, disabled }) => (
    <Pressable
      onPress={disabled ? undefined : onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={dir === 'back' ? 'Previous month' : 'Next month'}
      style={({ pressed }) => [
        styles.navBtn,
        {
          backgroundColor: withAlpha(colors.onHeader, pressed ? 0.28 : 0.16),
          borderColor: withAlpha(colors.onHeader, 0.22),
          opacity: disabled ? 0.35 : 1,
        },
      ]}
    >
      <Ionicons
        name={dir === 'back' ? 'chevron-back' : 'chevron-forward'}
        size={16}
        color={colors.onHeader}
      />
    </Pressable>
  );
  return (
    <View style={styles.monthRow}>
      <Btn dir="back" onPress={onPrev} />
      <Text
        style={{
          flex: 1,
          textAlign: 'center',
          color: colors.onHeader,
          fontFamily: fonts.semibold,
          fontSize: fontSize.base,
        }}
      >
        {label}
      </Text>
      <Btn dir="fwd" onPress={onNext} disabled={nextDisabled} />
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
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 10 },
});
