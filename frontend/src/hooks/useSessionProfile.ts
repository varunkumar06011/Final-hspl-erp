import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SocketEvents, type UserResponse } from '@hospital-erp/shared';
import api from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { getSocket } from './usePresence';

const ME_KEY = ['/auth/me'];

/**
 * Keeps the stored user's role and module access in step with the server
 * (mounted once in the app shell). An admin changing this user's module access
 * pushes a socket event; the minute poll and window focus cover missed events.
 */
export function useSessionProfile(): void {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const userId = user?.id;

  const { data: me } = useQuery<UserResponse>({
    queryKey: ME_KEY,
    queryFn: async () => (await api.get('/auth/me')).data,
    enabled: !!userId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!me || !user || me.id !== user.id) return;
    const next: UserResponse = {
      ...user,
      name: me.name,
      role: me.role,
      extraPermissions: me.extraPermissions ?? [],
      directPermissions: me.directPermissions ?? [],
      moduleAccess: me.moduleAccess ?? {},
    };
    const changed = (['name', 'role', 'extraPermissions', 'directPermissions', 'moduleAccess'] as const).some(
      (k) => JSON.stringify(next[k]) !== JSON.stringify(user[k]),
    );
    if (changed) setUser(next);
  }, [me, user, setUser]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let off: (() => void) | undefined;
    void getSocket().then((s) => {
      if (cancelled || !s) return;
      const refresh = () => void queryClient.invalidateQueries({ queryKey: ME_KEY });
      s.on(SocketEvents.MODULE_ACCESS_CHANGED, refresh);
      off = () => s.off(SocketEvents.MODULE_ACCESS_CHANGED, refresh);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [userId, queryClient]);
}
