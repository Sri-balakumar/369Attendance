import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * Whether the soft keyboard is up.
 *
 * For switching a KeyboardAvoidingView on only while it is. On Android the app
 * is drawn edge-to-edge (Expo SDK 54), so the window no longer shrinks for
 * the keyboard and the avoider has to do it -- but its sums for the keyboard
 * CLOSING leave ~70dp of padding behind there. Off means exactly none.
 */
export default function useKeyboardVisible() {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}
