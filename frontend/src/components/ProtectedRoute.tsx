import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { hasPermission, isAdminRole, Permission, UserRole } from '@hospital-erp/shared';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Optional permission required to access this route. */
  permission?: Permission;
  /** Optional allowed roles. An ADMIN* entry matches every dynamic admin role (ADMIN_3, ADMIN_4, …). */
  roles?: string[];
  /** Fallback path if the user lacks the permission. Defaults to '/work-calendar'. */
  fallback?: string;
}

export default function ProtectedRoute({ children, permission, roles, fallback = '/work-calendar' }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  if (permission && user && !hasPermission(user.role as UserRole, permission)) {
    return <Navigate to={fallback} replace />;
  }

  if (roles && user) {
    const ok = roles.some(
      (r) => r === user.role || (r.startsWith('ADMIN') && isAdminRole(user.role)),
    );
    if (!ok) return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
