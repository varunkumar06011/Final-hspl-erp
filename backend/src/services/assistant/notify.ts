/**
 * When someone saves a photo-based draft request through Miko, one person is told about it: the
 * Supervisor named Akhil. Nobody else is notified.
 */
import { prisma } from '../../config/prisma';
import { notifyUser } from '../push.service';

/** Name (case-insensitive, "contains") of the Supervisor who is notified about Miko photo saves. */
export const MIKO_PHOTO_NOTIFY_NAME = 'akhil';

export async function notifyMikoPhotoSaved(
  uploader: { id: string; name: string },
  what: string,
  url: string | null,
  entityId: string | null,
): Promise<void> {
  try {
    const recipient = await prisma.user.findFirst({
      where: { isActive: true, role: 'SUPERVISOR', name: { contains: MIKO_PHOTO_NOTIFY_NAME, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!recipient || recipient.id === uploader.id) return;
    await notifyUser(recipient.id, {
      entityType: 'MIKO_PHOTO',
      entityId: entityId ?? '',
      title: 'New request from a photo via Miko',
      body: `${uploader.name} saved a draft from a photo: ${what}. Review it, edit if needed and submit for approval.`,
      url: url ?? '/material-purchase-requests',
    });
  } catch (err) {
    console.error('[Miko] photo notification failed:', err);
  }
}
