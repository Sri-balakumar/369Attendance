import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearSession } from '../services/odoo';

/**
 * Two independently persisted things, because they have different lifetimes:
 *
 *   SERVER_KEY  { url, db }  — asked for once; cleared ONLY by "Change URL"
 *   USER_KEY    signed-in user — cleared ONLY by "Logout"
 *
 * That separation is the whole point. Backgrounding the app, killing it, or
 * relaunching days later does not sign anyone out and never re-asks for the
 * server: the user comes back to Home. Logging out drops the user but keeps
 * the server, so the next screen asks for username and password alone.
 */
const SERVER_KEY = '@369att:server';
const USER_KEY = '@369att:user';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [server, setServer] = useState(null); // { url, db }
  const [user, setUser] = useState(null);
  const [hydrated, setHydrated] = useState(false);

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
    () => ({ server, user, hydrated, saveServer, signIn, signOut, changeServer }),
    [server, user, hydrated, saveServer, signIn, signOut, changeServer]
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
  return 'Home';
}
