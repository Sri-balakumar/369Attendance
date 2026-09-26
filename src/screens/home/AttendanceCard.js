import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { radii } from '../../theme/tokens';
import { Card, Chip, PrimaryButton } from '../../components';
import { formatClock, formatDuration, formatTime } from '../../utils/time';

/**
 * The one action on the dashboard.
 *
 * On an ordinary day it is the one Check In / Check Out button, driven by the
 * server's attendance_state through /hr_attendance/systray_check_in_out.
 *
 * On a weekly off or a public holiday the server refuses a check-in until the
 * employee declares the day (`today.dayOff`, from /comp_off/today_status). The
 * SAME button then walks three steps, so there is never a second control to
 * look for:
 *
 *   1 Declare   "I'm working today"   -> onDeclare
 *   2 Check in  "Check In"            -> onToggle
 *   3 Check out "Check Out"           -> onToggle, which sizes the comp-off
 *
 * Every change of step animates: the button settles in with a small spring,
 * the step bar fills, and the caption fades across.
 */
export default function AttendanceCard({
  today,
  onToggle,
  onDeclare,
  onWithdraw,
  wfhToday,
  busy,
  style,
}) {
  const { fontSize, colors, fonts, spacing, radii: r, withAlpha } = useTheme();
  const [now, setNow] = useState(() => new Date());
  const pulse = useRef(new Animated.Value(0)).current;

  const checkedIn = Boolean(today?.checkedIn);
  const done = Boolean(today?.doneForToday) && !checkedIn;
  const off = today?.dayOff || null;
  const gated = Boolean(off?.gateEnabled);
  const declaration = off?.declaration || null;
  const needsDeclare = gated && !off.checkInAllowed && !checkedIn && !done;
  const fullDay = off?.fullDayHours ? trimNumber(off.fullDayHours) : null;

  // Which of the three steps is current on a gated day off: 0 = declare,
  // 1 = check in, 2 = check out, 3 = all done.
  let step = 0;
  if (gated) {
    if (needsDeclare) step = 0;
    else if (checkedIn) step = 2;
    else if (done) step = 3;
    else step = 1;
  }

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

  // The button and caption re-enter whenever the step changes.
  const actionKey = needsDeclare ? 'declare' : done ? 'done' : checkedIn ? 'out' : 'in';
  const settle = useRef(new Animated.Value(1)).current;
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    settle.setValue(0);
    Animated.spring(settle, { toValue: 1, damping: 14, stiffness: 180, mass: 0.7, useNativeDriver: true }).start();
  }, [actionKey, settle]);

  const elapsed = checkedIn && today?.checkInAt ? now - new Date(today.checkInAt) : 0;

  let chip;
  if (checkedIn) {
    chip = { label: `Checked in · ${formatDuration(elapsed)}`, tone: 'success', icon: 'ellipse' };
  } else if (done) {
    chip = { label: 'Done for today', tone: 'muted', icon: 'checkmark-done' };
  } else if (needsDeclare) {
    chip = { label: 'Day off · not declared', tone: 'accent', icon: 'sunny-outline' };
  } else if (gated && declaration) {
    chip = { label: 'Working today · declared', tone: 'accent', icon: 'briefcase-outline' };
  } else {
    chip = { label: 'Not checked in', tone: 'muted', icon: 'ellipse-outline' };
  }

  let button;
  if (needsDeclare) {
    button = { label: "I'm working today", icon: 'briefcase-outline', variant: 'solid', onPress: onDeclare };
  } else if (done) {
    button = { label: 'Checked out for today', icon: 'checkmark-done-outline', variant: 'outline', tone: 'muted', disabled: true };
  } else if (checkedIn) {
    button = { label: 'Check Out', icon: 'log-out-outline', variant: 'solid', tone: 'danger', onPress: onToggle };
  } else {
    button = { label: 'Check In', icon: 'log-in-outline', variant: 'gradient', onPress: onToggle };
  }

  let caption = null;
  if (needsDeclare) {
    caption = fullDay
      ? `Check-in opens after you declare. Under ${fullDay} h earns ½ day, ${fullDay} h or more earns 1 day.`
      : 'Check-in opens after you declare. The day earns you a comp-off.';
  } else if (gated && checkedIn && fullDay) {
    caption = `Check out after ${fullDay} h for a full comp-off day.`;
  } else if (gated && done && declaration) {
    caption =
      declaration.state === 'declared'
        ? 'Comp-off is being sized from your hours.'
        : `Earned ${declaration.days === 0.5 ? '½ day' : `${trimNumber(declaration.days)} day`} of comp-off.`;
  } else if (gated && !checkedIn && !done) {
    caption = 'Declared. Check in when you start.';
  }

  const orbTone = checkedIn ? colors.success : needsDeclare ? colors.accent : colors.muted;

  return (
    <Card style={style} elevation="raised">
      {/* Live clock */}
      <View style={styles.clockRow}>
        <View style={{ flexShrink: 1 }}>
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
          {/* One button, one status chip -- the WFH badge sits BESIDE them
              rather than replacing either. The module is explicit that an
              approved WFH day does not get its own check-in control; it only
              means this button skips the geo-fence. */}
          <View style={styles.chipRow}>
            <Chip label={chip.label} tone={chip.tone} icon={chip.icon} size="sm" />
            {wfhToday ? <Chip label="WFH" tone="accent" icon="home" size="sm" /> : null}
          </View>
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
                backgroundColor: withAlpha(orbTone, 0.14),
                borderColor: withAlpha(orbTone, 0.3),
              },
            ]}
          >
            <Ionicons
              name={needsDeclare ? 'sunny-outline' : checkedIn ? 'finger-print' : 'finger-print-outline'}
              size={26}
              color={orbTone}
            />
          </View>
        </View>
      </View>

      {gated ? <StepBar step={step} style={{ marginTop: spacing.base }} /> : null}

      {/* In / out times */}
      <View
        style={[
          styles.timesRow,
          { backgroundColor: colors.surfaceAlt, borderRadius: r.md, marginTop: spacing.base },
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

      <Animated.View
        style={{
          opacity: settle,
          transform: [{ scale: settle.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
        }}
      >
        <PrimaryButton
          label={button.label}
          icon={button.icon}
          onPress={button.onPress}
          variant={button.variant}
          tone={button.tone}
          disabled={button.disabled}
          loading={busy}
          style={{ marginTop: spacing.base }}
        />
        {caption ? (
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.regular,
              fontSize: fontSize.xs,
              textAlign: 'center',
              marginTop: spacing.sm,
              lineHeight: 17,
            }}
          >
            {caption}
          </Text>
        ) : null}
        {gated && off?.canWithdraw && !checkedIn && !done ? (
          <Pressable
            onPress={onWithdraw}
            hitSlop={8}
            accessibilityRole="button"
            style={{ alignSelf: 'center', marginTop: 6, paddingVertical: 4 }}
          >
            <Text style={{ color: colors.accent, fontFamily: fonts.semibold, fontSize: fontSize.xs }}>
              Not working after all
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>

      {today?.isWfh ? (
        <View style={{ alignItems: 'center', marginTop: spacing.md }}>
          <Chip label="Working from home today" tone="primary" icon="home-outline" size="sm" />
        </View>
      ) : null}
    </Card>
  );
}

/** The three steps of a worked day off. Each bar fills as its step is reached. */
function StepBar({ step, style }) {
  const { colors, fonts, fontSize } = useTheme();
  const progress = useRef(new Animated.Value(step)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: step,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [step, progress]);

  const steps = ['Declare', 'Check in', 'Check out, earn'];
  return (
    <View style={[styles.steps, style]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 3, now: step }}>
      {steps.map((label, i) => {
        // Before its step: empty. On its step: a third, to say "you are
        // here". Past it: full. One interpolation, so a step change slides.
        const fill = progress.interpolate({
          inputRange: [i - 1, i, i + 1],
          outputRange: ['0%', '35%', '100%'],
          extrapolate: 'clamp',
        });
        const reached = step >= i;
        return (
          <View key={label} style={{ flex: 1 }}>
            <View style={[styles.stepTrack, { backgroundColor: colors.border }]}>
              <Animated.View style={[styles.stepFill, { width: fill, backgroundColor: colors.primary }]} />
            </View>
            <Text
              numberOfLines={1}
              style={{
                marginTop: 5,
                color: reached ? colors.text : colors.muted,
                fontFamily: reached ? fonts.semibold : fonts.regular,
                fontSize: fontSize.xs,
              }}
            >
              {i + 1} {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function trimNumber(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
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
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' },
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
  steps: { flexDirection: 'row', gap: 8 },
  stepTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  stepFill: { height: 4, borderRadius: 2 },
  timesRow: { flexDirection: 'row', alignItems: 'center' },
  timeCell: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 14 },
  timeIcon: { width: 30, height: 30, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
});
