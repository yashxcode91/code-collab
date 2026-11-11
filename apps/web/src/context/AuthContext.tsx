import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  AuthResponse,
  LoginInput,
  RegisterInput,
  User,
} from '@codecollab/shared';
import { ApiClientError, apiRequest } from '@/lib/api';

/** Persists last clicked OAuth provider across full-page redirects so GitHub logins auto-sync UI panels. */
export const OAUTH_PROVIDER_STORAGE_KEY = 'codecollab:oauth-provider';

function clearStoredOAuthProvider() {
  try {
    window.localStorage.removeItem(OAUTH_PROVIDER_STORAGE_KEY);
  } catch {
    // Ignore storage access errors in restricted/private environments
  }
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Provides global session state (`user`, `isLoading`) and auth actions (`login`, `register`, `logout`).
 * Rehydrates the current user from the server's HttpOnly cookie on initial app mount via `/api/auth/me`.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore active session from HttpOnly cookie on page refresh; `cancelled` prevents StrictMode double-effect races
  useEffect(() => {
    let cancelled = false;

    apiRequest<AuthResponse>('/api/auth/me')
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const res = await apiRequest<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    clearStoredOAuthProvider();
    setUser(res.user);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await apiRequest<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    clearStoredOAuthProvider();
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest<{ message: string }>('/api/auth/logout', {
        method: 'POST',
      });
    } catch {
      // Clear local auth state even if network logout fails
    }
    clearStoredOAuthProvider();
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

export { ApiClientError };

