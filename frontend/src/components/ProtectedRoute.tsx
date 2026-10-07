import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { hasPermission, isAdminRole, moduleForPath, Permission, UserRole } from '@hospital-erp/shared';
import { firstModulePath, moduleSwitchedOff, canUseModule } from '../utils/moduleAccess';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Optional permission required to access this route. */
  permission?: Permission;
  /** Optional allowed roles. An ADMIN* entry matches every dynamic admin role (ADMIN_3, ADMIN_4, …). */
  roles?: string[];
  /** Fallback path if the user lacks access. Defaults to the user's first available module. */
  fallback?: string;
}

/** Path shown when the user has no module left to open. */
export const NO_ACCESS_PATH = '/no-access';
const DEFAULT_FALLBACK = '/work-calendar';

export default function ProtectedRoute({ children, permission, roles, fallback }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  // Pages of a module an admin switched off for this user (also covers deep links).
  const module = moduleForPath(location.pathname);
  const goElsewhere = () => {
    // The work calendar stays the landing page unless it is switched off (or is this page).
    const home =
      location.pathname !== DEFAULT_FALLBACK && !moduleSwitchedOff(user, 'workCalendar')
        ? DEFAULT_FALLBACK
        : firstModulePath(user, module?.path ?? location.pathname);
    return <Navigate to={fallback ?? home ?? NO_ACCESS_PATH} replace />;
  };
  if (module && moduleSwitchedOff(user, module.key)) {
    return goElsewhere();
  }

  if (permission && user && !hasPermission(user.role as UserRole, permission, user.extraPermissions)) {
    return goElsewhere();
  }

  // A role-restricted page is still open when an admin switched its module on for this user.
  if (roles && user && !(module && canUseModule(user, module.key))) {
    const ok = roles.some(
      (r) => r === user.role || (r.startsWith('ADMIN') && isAdminRole(user.role)),
    );
    if (!ok) return goElsewhere();
  }

  return <>{children}</>;
}
