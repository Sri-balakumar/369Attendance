import { useCallback, useEffect, useRef } from 'react';
import { Keyboard } from 'react-native';

/**
 * Scrolls a login form to its end once the keyboard has made room for itself.
 *
 * AuthScreen's keyboard avoider shrinks the form area above the keyboard; on
 * a tablet the form then needs a little more height than is left, and its
 * button -- at the foot, by design -- would sit just out of view. So when the
 * ScrollView gets shorter while the keyboard is up, scroll to the end: the
 * focused field, the button and the link under it all show, and at most the
 * top of the form scrolls away. It all happens inside the form's clipped
 * area, so the hero video above never moves.
 *
 * Returns the props to spread on the ScrollView: { ref, onLayout, onContentSizeChange }.
 */
export default function useKeyboardScrollToEnd() {
  const ref = useRef(null);
  const keyboardUp = useRef(false);
  const lastHeight = useRef(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      keyboardUp.current = true;
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardUp.current = false;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const onLayout = useCallback((e) => {
    const height = e.nativeEvent.layout.height;
    const shrank = height < lastHeight.current;
    lastHeight.current = height;
    if (shrank && keyboardUp.current) ref.current?.scrollToEnd({ animated: true });
  }, []);

  // The same when the form grows under an open keyboard -- "Invalid username
  // or password." appearing would otherwise push the link under the keys.
  const lastContent = useRef(0);
  const onContentSizeChange = useCallback((w, h) => {
    const grew = h > lastContent.current;
    lastContent.current = h;
    if (grew && keyboardUp.current) ref.current?.scrollToEnd({ animated: true });
  }, []);

  return { ref, onLayout, onContentSizeChange };
}
