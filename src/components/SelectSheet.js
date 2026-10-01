import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, FlatList, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import * as haptics from '../utils/haptics';
import AppTextInput from './AppTextInput';

/**
 * Bottom-sheet list picker.
 *
 * `options` takes either plain strings (the Server screen's database list) or
 * { value, label } objects (the config screen's timezones, companies and
 * departments), because a Selection field's stored value and its label are not
 * the same string. Strings are normalised to objects internally so both shapes
 * follow one code path.
 *
 * `searchable` exists for the office-timezone field: the model builds that
 * Selection from pytz.all_timezones, so it is ~600 rows and scrolling to
 * Asia/Kolkata by hand is not a real option.
 *
 * `multiple` turns it into a checklist: `value` becomes an array, picking
 * toggles instead of choosing, and the sheet stays open until Done. Added
 * for the report's employee filter, where the whole point is picking several.
 */
export default function SelectSheet({
  visible,
  title,
  options = [],
  value,
  onSelect,
  onClose,
  searchable = false,
  multiple = false,
  icon = 'server-outline',
  emptyLabel = 'Nothing matches that.',
  doneLabel = 'Done',
}) {
  const { colors, radii, fonts, fontSize, spacing, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;
  const [query, setQuery] = useState('');

  // Normalise once. A string option is its own value AND its own label.
  const items = useMemo(
    () =>
      options.map((o) =>
        o !== null && typeof o === 'object'
          ? { value: o.value, label: String(o.label ?? o.value) }
          : { value: o, label: String(o) }
      ),
    [options]
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: visible ? 260 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  // A stale query would silently hide most of the list the next time the sheet
  // is opened, which reads as a broken picker rather than a filter.
  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose} />
      <Animated.View
        style={[
          styles.sheet,
          // The search field brings the keyboard with it, so the sheet needs
          // more of the screen than the plain list version does.
          { maxHeight: searchable ? '88%' : '70%' },
          {
            backgroundColor: colors.surface,
            borderTopLeftRadius: radii.lg,
            borderTopRightRadius: radii.lg,
            paddingBottom: insets.bottom + spacing.base,
            transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }],
          },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        <View style={[styles.header, { paddingHorizontal: spacing.lg }]}>
          <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: fontSize.md }}>{title}</Text>
          {multiple ? (
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
              <Text style={{ color: colors.primary, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
                {doneLabel}
                {Array.isArray(value) && value.length ? ` (${value.length})` : ''}
              </Text>
            </Pressable>
          ) : (
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          )}
        </View>

        {searchable ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
            <AppTextInput
              label="Search"
              value={query}
              onChangeText={setQuery}
              icon="search-outline"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text
              style={{
                color: colors.muted,
                fontFamily: fonts.regular,
                fontSize: fontSize.xs,
                marginTop: 6,
              }}
            >
              {shown.length} of {items.length}
            </Text>
          </View>
        ) : null}

        <FlatList
          data={shown}
          keyExtractor={(item) => String(item.value)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
          ListEmptyComponent={
            <Text
              style={{
                color: colors.muted,
                fontFamily: fonts.regular,
                fontSize: fontSize.sm,
                paddingVertical: spacing.lg,
                textAlign: 'center',
              }}
            >
              {emptyLabel}
            </Text>
          }
          renderItem={({ item }) => {
            const active = multiple
              ? Array.isArray(value) && value.includes(item.value)
              : item.value === value;
            return (
              <Pressable
                onPress={() => {
                  haptics.tick();
                  if (multiple) {
                    const current = Array.isArray(value) ? value : [];
                    onSelect(
                      active
                        ? current.filter((v) => v !== item.value)
                        : [...current, item.value]
                    );
                    return;
                  }
                  onSelect(item.value);
                  onClose();
                }}
                android_ripple={{ color: withAlpha(colors.primary, 0.1) }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={styles.row}
              >
                <View
                  style={[
                    styles.rowIcon,
                    {
                      backgroundColor: withAlpha(colors.primary, active ? 0.16 : 0.08),
                      borderRadius: radii.sm,
                    },
                  ]}
                >
                  <Ionicons name={icon} size={17} color={colors.primary} />
                </View>
                <Text
                  style={{
                    flex: 1,
                    color: colors.text,
                    fontFamily: active ? fonts.semibold : fonts.medium,
                    fontSize: fontSize.base,
                  }}
                >
                  {item.label}
                </Text>
                {multiple ? (
                  <Ionicons
                    name={active ? 'checkbox' : 'square-outline'}
                    size={21}
                    color={active ? colors.primary : colors.faint}
                  />
                ) : active ? (
                  <Ionicons name="checkmark-circle" size={21} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          }}
        />
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  rowIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
