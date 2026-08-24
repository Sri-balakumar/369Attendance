import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';

/**
 * Money, rendered the same way on every payroll and report screen.
 *
 * Eight screens show amounts and nothing in components/ did, so the rounding
 * and grouping live here rather than being re-decided per screen. Deliberately
 * no currency symbol: the records carry a currency_id whose symbol is not in
 * the payload, and inventing one would be worse than omitting it -- the run
 * and the payslip both name their company, which is where the currency comes
 * from.
 */
export function formatMoney(value) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Whole days, but tolerant of the halves that half-days produce. */
export function formatDays(value) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** A label/amount row. `tone` names a palette colour; `strong` for a total. */
export function MoneyRow({ label, value, tone, strong, last, prefix }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : 1 },
      ]}
    >
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          color: strong ? colors.text : colors.muted,
          fontFamily: strong ? fonts.semibold : fonts.regular,
          fontSize: fontSize.sm,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: tone ? colors[tone] || colors.text : colors.text,
          fontFamily: strong ? fonts.bold : fonts.medium,
          fontSize: strong ? fontSize.base : fontSize.sm,
        }}
      >
        {prefix || ''}
        {formatMoney(value)}
      </Text>
    </View>
  );
}

/** A plain label/value row, for day counts and dates. */
export function FactRow({ label, value, tone, last }) {
  const { colors, fonts, fontSize } = useTheme();
  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : 1 },
      ]}
    >
      <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.sm }}>
        {label}
      </Text>
      <Text
        style={{
          color: tone ? colors[tone] || colors.text : colors.text,
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
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
});

/** hr.payslip.run.state and, through a related field, hr.payslip.state. */
export const RUN_STATES = {
  draft: { label: 'Draft', tone: 'warning', icon: 'create-outline' },
  confirmed: { label: 'Confirmed', tone: 'info', icon: 'checkmark-circle-outline' },
  paid: { label: 'Paid', tone: 'success', icon: 'cash-outline' },
};

export const runStateMeta = (s) =>
  RUN_STATES[s] || { label: s || 'Unknown', tone: 'muted', icon: 'help-circle-outline' };

export const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** month arrives as the string '1'..'12'. */
export const monthLabel = (m) => MONTH_LABELS[Number(m) - 1] || m || '—';
