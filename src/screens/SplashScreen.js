import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSession, routeFor } from '../state/SessionContext';

const INTRO = require('../../assets/splash.mp4');

// The video's own edge colour (near-white), behind it: it fills whatever the
// video does not cover and shows before the first frame is drawn.
const BG = '#FEFEFE';
const VIDEO_W = 1080;
const VIDEO_H = 2340;
// Drawn a little smaller than the screen allows: the video's background is
// the same white as BG, so the shrink leaves no visible edge, just a smaller logo.
const SIZE = 0.65;
// The intro runs 4.6 s. If it cannot play at all -- a decoder problem, a
// browser that blocks autoplay -- the app must still open, so this is the
// longest anyone is ever held here.
const SAFETY_MS = 6000;

/**
 * The Attendly intro, played once per cold start. A tap anywhere skips it.
 *
 * Routes by the session rules, not by a fixed next screen:
 *   no server        -> Server
 *   server, no user  -> Login
 *   server + user    -> Home
 * Always a reset, so nothing stale sits underneath, and never before the
 * stored session has been read -- otherwise a signed-in user would flash the
 * login.
 *
 * The native launch splash (app.json) is plain white, the same as the video's
 * first frame, so launch -> intro has no visible seam.
 */
export default function SplashScreen({ navigation }) {
  const { server, user, hydrated } = useSession();
  const { width, height } = useWindowDimensions();
  // The whole video, never cropped ("contain"), so the logo is not blown up on
  // a wide tablet. Centred; its plain white background runs into BG around it.
  const scale = Math.min(width / VIDEO_W, height / VIDEO_H) * SIZE;
  const box = { width: Math.round(VIDEO_W * scale), height: Math.round(VIDEO_H * scale) };
  const [finished, setFinished] = useState(false);
  const navigated = useRef(false);

  const player = useVideoPlayer(INTRO, (p) => {
    p.loop = false;
    p.muted = true;
    p.play();
  });

  // play() in the setup above is enough on a phone, but on the web it runs
  // before the <video> element exists and is lost. Asking again once the view
  // is mounted is harmless on native.
  useEffect(() => {
    player.play();
  }, [player]);

  // Finished = the video reached its end, failed, or ran out of time.
  useEffect(() => {
    const end = player.addListener('playToEnd', () => setFinished(true));
    const status = player.addListener('statusChange', ({ status: s }) => {
      if (s === 'error') setFinished(true);
    });
    const safety = setTimeout(() => setFinished(true), SAFETY_MS);
    return () => {
      end.remove();
      status.remove();
      clearTimeout(safety);
    };
  }, [player]);

  useEffect(() => {
    if (!finished || !hydrated || navigated.current) return;
    navigated.current = true;
    navigation.reset({ index: 0, routes: [{ name: routeFor({ server, user }) }] });
  }, [finished, hydrated, server, user, navigation]);

  return (
    <Pressable
      style={styles.root}
      onPress={() => setFinished(true)}
      accessibilityRole="button"
      accessibilityLabel="Skip intro"
    >
      <StatusBar style="dark" />
      <VideoView
        player={player}
        // Explicit size, not absoluteFill: the web build's <video> keeps its
        // own 1080x1920 size unless told the box it has to fill.
        style={{ position: 'absolute', top: (height - box.height) / 2, left: (width - box.width) / 2, ...box }}
        contentFit="contain"
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
        surfaceType="textureView"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
});
