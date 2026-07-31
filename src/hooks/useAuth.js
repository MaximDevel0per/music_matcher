import { useCallback, useEffect, useState } from "react";
import { apiFetch, clearToken, getToken, setToken } from "../lib/api.js";

/**
 * Kompletter Auth-Zustand: Token im localStorage, Profil aus GET /users/me.
 * Die UI-Komponenten sehen nur `user`, `login`, `register`, `logout` —
 * vom Token wissen sie nichts.
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  /** false, solange ein gespeichertes Token noch geprüft wird — verhindert Flackern der Buttons. */
  const [ready, setReady] = useState(false);

  // Token überlebt den Reload; ob es noch gültig ist, weiß nur der Server.
  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    let cancelled = false;
    apiFetch("/users/me")
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch((err) => {
        // Nur bei abgelehntem Token ausloggen — ein kurzzeitig nicht
        // erreichbarer Server soll die Sitzung nicht wegwerfen.
        if (err.status === 401) clearToken();
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Beide Endpunkte liefern ein Token; das Profil holen wir danach separat. */
  const authenticate = useCallback(async (path, email, password) => {
    const { access_token } = await apiFetch(path, {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    setToken(access_token);
    try {
      setUser(await apiFetch("/users/me"));
    } catch (err) {
      clearToken();
      throw err;
    }
  }, []);

  const login = useCallback(
    (email, password) => authenticate("/auth/login", email, password),
    [authenticate],
  );

  const register = useCallback(
    (email, password) => authenticate("/auth/register", email, password),
    [authenticate],
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return { user, ready, login, register, logout };
}
