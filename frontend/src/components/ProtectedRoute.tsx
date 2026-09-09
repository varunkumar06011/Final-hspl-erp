import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { hasPermission, Permission, UserRole } from '@hospital-erp/shared';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Optional permission required to access this route. */
  permission?: Permission;
  /** Fallback path if the user lacks the permission. Defaults to '/work-calendar'. */
  fallback?: string;
}

export default function ProtectedRoute({ children, permission, fallback = '/work-calendar' }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  if (permission && user && !hasPermission(user.role as UserRole, permission)) {
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
