import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip, PrimaryButton } from '../../components';
import { formatClock, formatDuration, formatTime } from '../../utils/time';

/**
 * The one action on the dashboard. Check-in state is local to this pass —
 * nothing is sent anywhere. When it is wired up, `onToggle` becomes the call to
 * hr.employee.attendance_manual and the times come back from the server.
 */
export default function AttendanceCard({ today, onToggle, style }) {
  const { fontSize, colors, fonts, spacing, radii, withAlpha } = useTheme();
  const [now, setNow] = useState(() => new Date());
  const pulse = useRef(new Animated.Value(0)).current;

  const checkedIn = Boolean(today?.checkedIn);

  // One interval for both the wall clock and the running worked-time figure.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!checkedIn) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [checkedIn, pulse]);

  const elapsed = checkedIn && today?.checkInAt ? now - new Date(today.checkInAt) : 0;

  return (
    <Card style={style} elevation="raised">
      {/* Live clock */}
      <View style={styles.clockRow}>
        <View>
          <Text
            style={{
              color: colors.text,
              fontFamily: fonts.bold,
              fontSize: fontSize.hero,
              letterSpacing: -1,
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatClock(now)}
          </Text>
          <Chip
            label={checkedIn ? `Checked in · ${formatDuration(elapsed)}` : 'Not checked in'}
            tone={checkedIn ? 'success' : 'muted'}
            icon={checkedIn ? 'ellipse' : 'ellipse-outline'}
            size="sm"
            style={{ marginTop: 8 }}
          />
        </View>

        <View style={styles.pulseWrap}>
          {checkedIn ? (
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  borderColor: colors.success,
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
                  transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
                },
              ]}
            />
          ) : null}
          <View
            style={[
              styles.statusOrb,
              {
                backgroundColor: withAlpha(checkedIn ? colors.success : colors.muted, 0.14),
                borderColor: withAlpha(checkedIn ? colors.success : colors.muted, 0.3),
              },
            ]}
          >
            <Ionicons
              name={checkedIn ? 'finger-print' : 'finger-print-outline'}
              size={26}
              color={checkedIn ? colors.success : colors.muted}
            />
          </View>
        </View>
      </View>

      {/* In / out times */}
      <View
        style={[
          styles.timesRow,
          { backgroundColor: colors.surfaceAlt, borderRadius: radii.md, marginTop: spacing.base },
        ]}
      >
        <TimeCell
          label="Check In"
          value={formatTime(today?.checkInAt)}
          icon="log-in-outline"
          tone={colors.success}
        />
        <View style={{ width: 1, backgroundColor: colors.border, marginVertical: 12 }} />
        <TimeCell
          label="Check Out"
          value={formatTime(today?.checkOutAt)}
          icon="log-out-outline"
          tone={colors.danger}
        />
      </View>

      <PrimaryButton
        label={checkedIn ? 'Check Out' : 'Check In'}
        icon={checkedIn ? 'log-out-outline' : 'log-in-outline'}
        onPress={onToggle}
        variant={checkedIn ? 'solid' : 'gradient'}
        tone={checkedIn ? 'danger' : undefined}
        style={{ marginTop: spacing.base }}
      />

      {today?.isWfh ? (
        <View style={{ alignItems: 'center', marginTop: spacing.md }}>
          <Chip label="Working from home today" tone="primary" icon="home-outline" size="sm" />
        </View>
      ) : null}
    </Card>
  );
}

function TimeCell({ label, value, icon, tone }) {
  const { colors, fonts, fontSize, withAlpha } = useTheme();
  const empty = value === '--:--';
  return (
    <View style={styles.timeCell}>
      <View
        style={[
          styles.timeIcon,
          { backgroundColor: withAlpha(tone, empty ? 0.08 : 0.14) },
        ]}
      >
        <Ionicons name={icon} size={15} color={empty ? colors.faint : tone} />
      </View>
      <View style={{ marginLeft: 9 }}>
        <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: fontSize.xs }}>{label}</Text>
        <Text
          style={{
            color: empty ? colors.faint : colors.text,
            fontFamily: fonts.semibold,
            fontSize: fontSize.base,
            marginTop: 1,
          }}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pulseWrap: { alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 60, height: 60, borderRadius: 30, borderWidth: 2 },
  statusOrb: {
    width: 60,
    height: 60,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timesRow: { flexDirection: 'row', alignItems: 'center' },
  timeCell: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 14 },
  timeIcon: { width: 30, height: 30, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
});
