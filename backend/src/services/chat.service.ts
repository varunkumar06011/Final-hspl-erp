import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { emitToProject, emitToUsers } from '../socket';

export const CHAT_TYPES = { GENERAL: 'GENERAL', DIRECT: 'DIRECT', GROUP: 'GROUP' } as const;

export const messageInclude = {
  sender: { select: { id: true, name: true, role: true } },
  attachments: {
    select: { id: true, fileName: true, mimeType: true, size: true, fileType: true },
    orderBy: { createdAt: 'asc' as const },
  },
  replyTo: {
    select: {
      id: true,
      body: true,
      deletedAt: true,
      sender: { select: { id: true, name: true } },
      attachments: { select: { fileName: true, fileType: true }, take: 1 },
    },
  },
} satisfies Prisma.ChatMessageInclude;

type MessageRow = Prisma.ChatMessageGetPayload<{ include: typeof messageInclude }>;

export interface ChatMention {
  id: string;
  name: string;
}

/** Message as the client sees it: deleted messages carry no text/files, replies a short preview. */
export function serializeMessage(m: MessageRow) {
  const deleted = !!m.deletedAt;
  const reply = m.replyTo;
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: m.sender,
    body: deleted ? '' : m.body,
    mentions: deleted ? [] : ((m.mentions as unknown as ChatMention[] | null) ?? []),
    attachments: deleted ? [] : m.attachments,
    replyTo: reply
      ? {
          id: reply.id,
          senderName: reply.sender.name,
          deleted: !!reply.deletedAt,
          body: reply.deletedAt ? '' : reply.body.slice(0, 140),
          attachmentName: reply.deletedAt ? null : (reply.attachments[0]?.fileName ?? null),
        }
      : null,
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
  };
}

export type ChatMessageDTO = ReturnType<typeof serializeMessage>;

/** The project's open room. Created on first use; everyone active can read and post in it. */
export async function ensureGeneralConversation(projectId: string) {
  const existing = await prisma.chatConversation.findFirst({
    where: { projectId, type: CHAT_TYPES.GENERAL },
  });
  if (existing) return existing;
  return prisma.chatConversation.create({
    data: { projectId, type: CHAT_TYPES.GENERAL, name: 'General' },
  });
}

/**
 * Conversation the user may use, or null. Always scoped to the user's project;
 * GENERAL is open to all, the rest need a membership row.
 */
export async function findAccessibleConversation(
  conversationId: string,
  userId: string,
  projectId: string,
) {
  const conversation = await prisma.chatConversation.findFirst({
    where: { id: conversationId, projectId },
  });
  if (!conversation) return null;
  if (conversation.type === CHAT_TYPES.GENERAL) return conversation;
  const member = await prisma.chatMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { id: true },
  });
  return member ? conversation : null;
}

/** Make sure the user has a read-marker row (GENERAL has no explicit membership). */
export async function ensureMember(conversationId: string, userId: string): Promise<void> {
  await prisma.chatMember.upsert({
    where: { conversationId_userId: { conversationId, userId } },
    create: { conversationId, userId },
    update: {},
  });
}

/** Send a realtime event to everyone who can see the conversation. */
export async function emitToConversation(
  conversation: { id: string; projectId: string; type: string },
  event: string,
  data: unknown,
): Promise<void> {
  if (conversation.type === CHAT_TYPES.GENERAL) {
    emitToProject(conversation.projectId, event, data);
    return;
  }
  const members = await prisma.chatMember.findMany({
    where: { conversationId: conversation.id },
    select: { userId: true },
  });
  emitToUsers(
    members.map((m) => m.userId),
    event,
    data,
  );
}

export function directKeyFor(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/** Short text for list rows / push bodies. */
export function previewOf(body: string, attachmentNames: string[]): string {
  const text = body.trim();
  if (text) return text.length > 140 ? `${text.slice(0, 137)}...` : text;
  if (attachmentNames.length === 1) return `📎 ${attachmentNames[0]}`;
  if (attachmentNames.length > 1) return `📎 ${attachmentNames.length}`;
  return '';
}
