import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onSessionChange, restoreSession, signOut as apiSignOut } from '../api/client';
import type { Session } from '../api/session';

type AuthContextValue = {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: Session | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const unsubscribe = onSessionChange((next) => {
      if (live) setSession(next);
    });
    restoreSession()
      .then((restored) => {
        if (live) setSession(restored);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  const signOut = useCallback(() => apiSignOut(), []);

  const value = useMemo<AuthContextValue>(
    () => ({ status: loading ? 'loading' : session ? 'signedIn' : 'signedOut', session, signOut }),
    [loading, session, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
