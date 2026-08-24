import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip } from '../../components';
import { dayStatusMeta } from '../attendance/constants';
import { formatDateKeyShort, odooUtcToIso } from '../../utils/time';

/** Employee name off a Many2one pair, which arrives as [id, name]. */
export const nameOf = (m2o) => (Array.isArray(m2o) ? m2o[1] : m2o || '—');

/** 'HH:MM' in the viewer's locale from an Odoo UTC datetime string. */
function clock(value) {
  const iso = odooUtcToIso(value);
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** One late check-in. */
export function LateRow({ row, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  return (
    <Card padded={false} style={style}>
      <View style={[styles.row, { padding: spacing.base }]}>
        <View style={[styles.icon, { backgroundColor: withAlpha(colors.warning, 0.13) }]}>
          <Ionicons name="alarm-outline" size={17} color={colors.warning} />
        </View>
        <View style={{ flex: 1, marginLeft: 11 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
            {nameOf(row.employee_id)}
          </Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs, marginTop: 2 }}>
            {formatDateKeyShort(row.date)} · in {clock(row.check_in)}
            {row.check_out ? ` · out ${clock(row.check_out)}` : ' · still in'}
          </Text>
        </View>
        <Chip
          label={row.late_minutes_display || `${row.late_minutes} min`}
          tone="warning"
          size="sm"
        />
      </View>
    </Card>
  );
}

/**
 * One graded day.
 *
 * deduction_amount is money, and the app deliberately keeps salary figures off
 * employee-facing screens. This one is HR-manager-only -- the Config tab is not
 * mounted otherwise -- and the deduction is the reason a manager opens it.
 */
export function DayStatusRow({ row, showEmployee = true, style }) {
  const { colors, fonts, fontSize, spacing, withAlpha } = useTheme();
  const meta = dayStatusMeta(row.status);
  const tone = colors[meta.tone] || colors.muted;
  const deduction = Number(row.deduction_amount) || 0;

  return (
    <Card padded={false} style={style}>
      <View style={[styles.row, { padding: spacing.base }]}>
        <View style={[styles.icon, { backgroundColor: withAlpha(tone, 0.13) }]}>
          <Ionicons name={meta.icon} size={17} color={tone} />
        </View>
        <View style={{ flex: 1, marginLeft: 11 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semibold, fontSize: fontSize.base }}>
            {showEmployee ? nameOf(row.employee_id) : formatDateKeyShort(row.date)}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
            {showEmployee ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: fontSize.xs }}>
                {formatDateKeyShort(row.date)}
              </Text>
            ) : null}
            {row.is_wfh ? <Chip label="WFH" tone="info" size="sm" /> : null}
            {row.leave_request_id ? <Chip label="On leave" tone="accent" size="sm" /> : null}
            {row.stamped_by_cron ? (
              <Text style={{ color: colors.faint, fontFamily: fonts.regular, fontSize: fontSize.xs }}>
                auto-stamped
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Chip label={meta.label} tone={meta.tone} size="sm" />
          {deduction > 0 ? (
            <Text style={{ color: colors.danger, fontFamily: fonts.semibold, fontSize: fontSize.xs }}>
              −{deduction.toFixed(2)}
            </Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 34, height: 34, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
});
