import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useSwitchProject } from '../hooks/useSwitchProject';

/**
 * Links from outside the app (Task Hub approvals) carry `?project=<id>` so a record
 * opens in its own project. If the session is in another project, switch first and
 * land on the same page; either way the parameter is then dropped from the address.
 */
export default function ProjectLinkSwitcher() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const signedIn = useAuthStore((s) => s.isAuthenticated());
  const { switchTo } = useSwitchProject();
  const handled = useRef<string | null>(null);

  const params = new URLSearchParams(location.search);
  const target = params.get('project');

  useEffect(() => {
    if (!target || !signedIn || !user || handled.current === target) return;
    handled.current = target;
    const rest = new URLSearchParams(location.search);
    rest.delete('project');
    const landing = location.pathname + (rest.toString() ? `?${rest}` : '');
    if (user.projectId === target) {
      navigate(landing, { replace: true });
      return;
    }
    void switchTo(target, landing).then((ok) => {
      if (!ok) navigate(landing, { replace: true });
    });
  }, [target, signedIn, user, location.pathname, location.search, navigate, switchTo]);

  return null;
}
