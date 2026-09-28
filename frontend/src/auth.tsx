import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';
import { ApiError, api, type Role, type User } from './api';

type AuthState = {
  user: User | null;
  loading: boolean;
  needsSetup: boolean;
  refresh: () => Promise<void>;
  can: (role: Role) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ['setup-status'], queryFn: () => api.get<{ needsSetup: boolean }>('/auth/setup-status') });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api.get<{ user: User }>('/auth/me')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    enabled: setup.data?.needsSetup === false,
    retry: false,
  });
  const user = me.data ?? null;
  const value: AuthState = {
    user,
    loading: setup.isLoading || (setup.data?.needsSetup === false && me.isLoading),
    needsSetup: setup.data?.needsSetup ?? false,
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ['setup-status'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    can: (role) => !!user && RANK[user.role] >= RANK[role],
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
