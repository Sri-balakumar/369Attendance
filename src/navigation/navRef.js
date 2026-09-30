import { createNavigationContainerRef } from '@react-navigation/native';

/**
 * The root navigator, reachable from outside a screen. A tapped push arrives
 * in a listener that belongs to no screen, and this is how it gets somewhere.
 */
export const navRef = createNavigationContainerRef();
