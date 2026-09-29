import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

const HERO = require('../../../assets/login-hero.mp4');

// The artwork is one 3:1 panorama video (2000x666) -- walking in at the door,
// checking in at the clock, at work at the desk -- drawn two screens wide.
// Step one of the login shows its left half and step two its right half;
// `pan` (0 -> 1) is the camera moving between them.
const RATIO = 3;

/**
 * The login flow's hero art.
 *
 * A fixed-height header: it keeps its size when a field is tapped and the
 * keyboard opens (the form below scrolls instead). Inside it, two layers:
 *   outer  entrance fade and rise
 *   inner  the pan between halves and a slow float
 *
 * Android renders the video into a TextureView (surfaceType), because a
 * SurfaceView ignores transforms and would not pan with the rest.
 */
export default function HeroPanorama({ pan, enter, width, maxHeight }) {
  // The panorama is normally two screens wide. On a tall screen that makes the
  // art too tall, so it is zoomed out to `maxHeight` instead: still full width,
  // each step then simply shows a little more than half of it.
  const artWidth = Math.round(Math.min(width * 2, (maxHeight || Infinity) * RATIO));
  const height = Math.round(artWidth / RATIO);
  const travel = artWidth - width;

  const player = useVideoPlayer(HERO, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // As on the splash: the web build loses the setup's play() because the
  // <video> element does not exist yet, so ask again once mounted.
  useEffect(() => {
    player.play();
  }, [player]);

  const float = useRef(new Animated.Value(0)).current;

  // A slow drift up and down, as in the reference: a few points over ~6 s.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [float]);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, overflow: 'hidden' }}
    >
      <Animated.View
        style={{
          flex: 1,
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
        }}
      >
        <Animated.View
          style={{
            width: artWidth,
            height,
            transform: [
              { translateX: pan.interpolate({ inputRange: [0, 1], outputRange: [0, -travel] }) },
              { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [-4, 4] }) },
            ],
          }}
        >
          <VideoView
            player={player}
            style={{ width: artWidth, height }}
            contentFit="cover"
            nativeControls={false}
            allowsFullscreen={false}
            allowsPictureInPicture={false}
            surfaceType="textureView"
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/**
 * The two page dots under the art. The active one is a blue pill; as `pan`
 * moves, the pill shrinks on one dot and grows on the other. Transforms and
 * opacity only, so it runs on the native driver with the pan itself.
 */
export function StepDots({ pan, color, idle }) {
  const dot = (index) => {
    const active = index === 0 ? pan.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) : pan;
    return (
      <View key={index} style={styles.slot}>
        <View style={[styles.dot, { backgroundColor: idle }]} />
        <Animated.View
          style={[
            styles.pill,
            {
              backgroundColor: color,
              opacity: active,
              transform: [{ scaleX: active.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
            },
          ]}
        />
      </View>
    );
  };
  return <View style={styles.dots}>{[0, 1].map(dot)}</View>;
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingVertical: 10 },
  slot: { width: 24, height: 7, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pill: { position: 'absolute', width: 24, height: 7, borderRadius: 4 },
});
