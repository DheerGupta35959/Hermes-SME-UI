import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { isLive } from "../lib/hermesClient";
import * as Auth from "../lib/authClient";
import type { AuthUser } from "../lib/authClient";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isDemo: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isLive) {
      // Demo mode — no backend, use hardcoded Maya user
      setUser(Auth.DEMO_USER);
      setIsLoading(false);
      return;
    }
    // Live mode — check if we have a stored session
    Auth.getMe()
      .then((u) => {
        setUser(u);
        setIsLoading(false);
      })
      .catch(() => {
        setUser(null);
        setIsLoading(false);
      });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await Auth.login(username, password);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    Auth.logout();
    setUser(null);
  }, []);

  const hasRole = useCallback(
    (...roles: string[]) => {
      if (!user) return false;
      return roles.some((r) => user.roles.includes(r));
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: user !== null,
        isLoading,
        isDemo: !isLive,
        login,
        logout,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
