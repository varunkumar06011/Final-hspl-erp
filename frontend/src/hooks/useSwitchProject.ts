import { useCallback, useState } from 'react';
import api, { extractErrorMessage } from '../config/api';
import { useAuthStore } from '../stores/authStore';
import { resetClientState } from '../utils/sessionCleanup';
import { isNative } from '../config/appConfig';

/**
 * Moves the signed-in user to another project. The backend re-issues the session
 * token with the new project; we then wipe everything cached for the old project
 * and do a full reload so no screen, query or socket can still hold old-project data.
 */
export function useSwitchProject() {
  const { setToken, setUser } = useAuthStore();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');

  const switchTo = useCallback(
    async (projectId: string) => {
      setSwitching(true);
      setError('');
      try {
        const res = await api.post('/auth/switch-project', { projectId });
        setToken(res.data.token);
        setUser(res.data.user);
        resetClientState();
        if (isNative) {
          // HashRouter app: stay on the same document, go home, reload.
          window.location.hash = '#/';
          window.location.reload();
        } else {
          window.location.assign('/');
        }
      } catch (err: unknown) {
        setError(extractErrorMessage(err));
        setSwitching(false);
      }
    },
    [setToken, setUser],
  );

  return { switchTo, switching, error, clearError: () => setError('') };
}
