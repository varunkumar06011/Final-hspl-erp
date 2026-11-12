import { UserRole, type UserResponse } from '@hospital-erp/shared';
import { useAuthStore } from '../stores/authStore';

/**
 * Supervisors add records but do not change existing ones, so every "edit" control is hidden (except material/service requests and site bills, marked data-edit-keep: their edits go back to the heads)
 * for them. This is an interface rule only; the server's permissions are unchanged.
 *
 * Most edit buttons need no code: AppShell sets `data-no-edit` on <html> for a locked user
 * and index.css hides any button or menu item that carries the Edit icon. Controls that are
 * not an Edit icon (a "Change" link, an inline dropdown) read `useEditLock()` themselves.
 * Chat messages, comments and Miko's own drafts stay editable (`data-edit-keep`).
 */
export function isEditLocked(user: Pick<UserResponse, 'role' | 'extraPermissions'> | null | undefined): boolean {
  if (!user || user.role !== UserRole.SUPERVISOR) return false;
  return !user.extraPermissions?.includes('*'); // a super admin override is never locked
}

export function useEditLock(): boolean {
  return useAuthStore((s) => isEditLocked(s.user));
}
