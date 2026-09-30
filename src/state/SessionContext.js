import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearSession, fetchCapabilities } from '../services/odoo';
import { registerForPush, unregisterFromPush } from '../push/registerDevice';

/**
 * Two independently persisted things, because they have different lifetimes:
 *
 *   SERVER_KEY  { url, db }  — asked for once; cleared ONLY by "Change URL"
 *   USER_KEY    signed-in user — cleared ONLY by "Logout"
 *
 * That separation is the whole point. Backgrounding the app, killing it, or
 * relaunching days later does not sign anyone out and never re-asks for the
 * server: the user comes back to the Home tab. Logging out drops the user
 * but keeps the server, so the next screen asks for username and password
 * alone.
 */
const SERVER_KEY = '@369att:server';
const USER_KEY = '@369att:user';

const NO_CAPS = {
  attendance: false,
  leave: false,
  wfh: false,
  payroll: false,
  admin: false,
  balances: false,
};

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [server, setServer] = useState(null); // { url, db }
  const [user, setUser] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  // Which manager surfaces this user gets. Drives whether the Config tab
  // exists at all AND which sections it shows -- the three are independent,
  // because a Leave Manager is not an HR Manager and vice versa.
  //
  // Never persisted: an ACL can be re-cut between launches, and a stale `true`
  // would mount a section whose every write then fails.
  const [caps, setCaps] = useState(NO_CAPS);

  // Read both keys once at startup. Splash waits for this before routing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [[, rawServer], [, rawUser]] = await AsyncStorage.multiGet([SERVER_KEY, USER_KEY]);
        if (cancelled) return;
        if (rawServer) setServer(JSON.parse(rawServer));
        if (rawUser) setUser(JSON.parse(rawUser));
      } catch (e) {
        console.warn('[session] hydrate failed:', e?.message);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Ask the server the permission questions once per signed-in user.
   *
   * Each probe answers false rather than throwing when Odoo refuses -- a
   * refusal IS the answer -- so there is nothing to catch here. All three
   * start false and stay false until the reply lands, so the Config tab
   * appears a beat late rather than flashing in and vanishing.
   */
  useEffect(() => {
    if (!user) {
      setCaps(NO_CAPS);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const next = await fetchCapabilities();
      if (!cancelled) setCaps(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  /**
   * Register this phone for push once per signed-in user. Every launch sends
   * the token again (it changes on reinstall), and a failure is silent -- the
   * bell inside the app still works without push.
   */
  const pushTokenRef = useRef(null);
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      const token = await registerForPush();
      if (!cancelled) pushTokenRef.current = token;
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // The tab itself: any one surface is enough to earn it.
  const canManage = caps.attendance || caps.leave || caps.wfh || caps.payroll || caps.balances;

  const saveServer = useCallback(async (next) => {
    setServer(next);
    try {
      await AsyncStorage.setItem(SERVER_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('[session] saveServer failed:', e?.message);
    }
  }, []);

  const signIn = useCallback(async (nextUser) => {
    setUser(nextUser);
    try {
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    } catch (e) {
      console.warn('[session] signIn failed:', e?.message);
    }
  }, []);

  // Logout: user only. The server survives so Login can show the chip and ask
  // for credentials alone.
  const signOut = useCallback(async () => {
    // Before the session is dropped: unregistering is an authenticated call,
    // and without it this phone keeps receiving the previous user's news.
    await unregisterFromPush(pushTokenRef.current);
    pushTokenRef.current = null;
    setUser(null);
    try {
      // Drop the Odoo cookie too, or the next sign-in would carry the previous
      // user's session into its first request.
      await clearSession();
      await AsyncStorage.removeItem(USER_KEY);
    } catch (e) {
      console.warn('[session] signOut failed:', e?.message);
    }
  }, []);

  // Change URL: both keys. The only route back to the Server screen.
  const changeServer = useCallback(async () => {
    await unregisterFromPush(pushTokenRef.current);
    pushTokenRef.current = null;
    setUser(null);
    setServer(null);
    try {
      await clearSession();
      await AsyncStorage.multiRemove([SERVER_KEY, USER_KEY]);
    } catch (e) {
      console.warn('[session] changeServer failed:', e?.message);
    }
  }, []);

  const value = useMemo(
    () => ({ server, user, hydrated, caps, canManage, saveServer, signIn, signOut, changeServer }),
    [server, user, hydrated, caps, canManage, saveServer, signIn, signOut, changeServer]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/** The startup route, derived from what was hydrated. */
export function routeFor({ server, user }) {
  if (!server?.url || !server?.db) return 'Server';
  if (!user) return 'Login';
  return 'Main';
}
