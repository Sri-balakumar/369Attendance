import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import HeroPanorama, { StepDots } from './HeroPanorama';
import { AUTH } from './AuthField';
import ServerForm from './ServerForm';
import LoginForm from './LoginForm';

// Phones and tablets use their full width, so the art runs edge to edge. Only
// a desktop browser is wider than this, and there the flow is centred instead.
const MAX_STAGE = 900;
// The artwork's own background is plain white, not transparency. The header
// is that white from the left edge to the right edge and up under the status
// bar; the light theme continues it down the page so the art has no edge, the
// dark theme rounds the header off above a dark page.
const ART_BG = '#FFFFFF';

/**
 * Both login steps on one screen, so the hero art can pan between them.
 *
 * Step 0 (server URL + database) shows the left half of the panorama, step 1
 * (username + password) the right half. Moving between them is one motion,
 * timed from the reference video: the art pans ease-in-out over ~950 ms while
 * the two forms, laid side by side, slide ease-out -- the old one leaves first,
 * the new one glides in from the right. Change URL plays it backwards.
 *
 * Mounted as both the `Server` and the `Login` route (initialParams.step), so
 * every existing reset to either name still lands on the right half.
 */
export default function AuthScreen({ navigation, route }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const width = Math.min(windowWidth, MAX_STAGE);

  const initial = route?.params?.step === 1 ? 1 : 0;
  const [step, setStep] = useState(initial);

  const pan = useRef(new Animated.Value(initial)).current; // the art
  const slide = useRef(new Animated.Value(initial)).current; // the forms
  const enter = useRef(new Animated.Value(0)).current; // art entrance
  const enterForm = useRef(new Animated.Value(0)).current; // form entrance
  const moving = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(enter, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(200),
        Animated.timing(enterForm, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start();
  }, [enter, enterForm]);

  const goTo = useCallback(
    (to) => {
      if (moving.current) return;
      moving.current = true;
      Keyboard.dismiss();
      setStep(to);
      Animated.parallel([
        Animated.timing(pan, { toValue: to, duration: 950, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(40),
          Animated.timing(slide, { toValue: to, duration: 850, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
      ]).start(() => {
        moving.current = false;
      });
    },
    [pan, slide]
  );

  // Android back on the sign-in step returns to the server step -- but only
  // when that is where the person came from (Continue). Opened straight on
  // sign-in (every launch after the first, and after Log out), sign-in IS the
  // first screen, and back leaves the app as it would anywhere else.
  const cameFromServer = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (step !== 1 || !cameFromServer.current) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        cameFromServer.current = false;
        goTo(0);
        return true;
      });
      return () => sub.remove();
    }, [step, goTo])
  );

  const [keyboardUp, setKeyboardUp] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const page = (index, child) => {
    const active = step === index;
    return (
      <View
        style={{ width, flex: 1 }}
        pointerEvents={active ? 'auto' : 'none'}
        accessibilityElementsHidden={!active}
        importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      >
        {child}
      </View>
    );
  };

  // The keyboard avoider wraps the WHOLE screen, not just the form. It works
  // out the overlap from its own frame, and that frame is relative to its
  // parent: placed under the header it believed it started at the top of the
  // screen, under-counted by the header's height, and on Android (edge-to-edge,
  // so the window no longer shrinks) added nothing -- the keyboard covered
  // Sign In. Here its frame IS the screen. Only the form below gives way: the
  // header is a fixed height, so the video keeps its size and never moves.
  //
  // On Android it is switched on only while the keyboard is up. Its sums for
  // the keyboard OPENING are right, but the close event's coordinates under
  // edge-to-edge left ~70dp of padding behind, so Sign In sat too high after
  // the keyboard went away. Off means exactly no padding.
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: isDark ? colors.bg : ART_BG }}
      behavior={Platform.OS === 'web' ? undefined : 'padding'}
      enabled={Platform.OS !== 'android' || keyboardUp}
    >
      {/* The art is always on white, so the status bar icons are always dark. */}
      <StatusBar style="dark" />

      <View
        style={{
          backgroundColor: ART_BG,
          paddingTop: insets.top,
          alignItems: 'center',
          borderBottomLeftRadius: isDark ? 28 : 0,
          borderBottomRightRadius: isDark ? 28 : 0,
          overflow: 'hidden',
        }}
      >
        {/* About a third of the screen at most, so the form keeps the room. */}
        <HeroPanorama pan={pan} enter={enter} width={width} maxHeight={windowHeight * 0.3} />
        <StepDots pan={pan} color={AUTH.blue} idle="#D5DCE8" />
      </View>

      <View style={{ width, flex: 1, alignSelf: 'center' }}>
        <View style={{ flex: 1, overflow: 'hidden' }}>
          <Animated.View
            style={{
              flex: 1,
              width: width * 2,
              flexDirection: 'row',
              opacity: enterForm,
              transform: [
                { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, -width] }) },
                { translateY: enterForm.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
              ],
            }}
          >
            {page(
              0,
              <ServerForm
                onDone={() => {
                  cameFromServer.current = true;
                  goTo(1);
                }}
              />
            )}
            {page(1, <LoginForm navigation={navigation} onServerChanged={() => goTo(0)} />)}
          </Animated.View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
