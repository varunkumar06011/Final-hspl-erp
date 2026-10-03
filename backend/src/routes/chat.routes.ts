import { Router, Response, NextFunction, Request } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import { SocketEvents } from '@hospital-erp/shared';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { validateMiddleware } from '../middleware/validate';
import { prisma } from '../config/prisma';
import { notifyUsers } from '../services/push.service';
import { projectTitlePrefix } from '../services/project.service';
import { getStorageService, serveFile } from '../services/storage.service';
import { isAllowedUpload, ALLOWED_UPLOAD_MESSAGE } from '../utils/uploadFileTypes';
import { userIdsViewingChat } from '../socket';
import {
  CHAT_TYPES,
  ChatMention,
  directKeyFor,
  emitToConversation,
  ensureGeneralConversation,
  ensureMember,
  findAccessibleConversation,
  messageInclude,
  previewOf,
  serializeMessage,
} from '../services/chat.service';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const PAGE_SIZE = 40;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

const router = Router();
router.use(authMiddleware);

const uuid = z.string().uuid();

/** Tag candidates: real, active users — never trust names sent by the client. */
async function resolveMentions(
  mentionIds: string[] | undefined,
  conversation: { id: string; type: string },
  selfId: string,
): Promise<ChatMention[]> {
  const wanted = Array.from(new Set(mentionIds ?? [])).filter((id) => id !== selfId);
  if (wanted.length === 0) return [];
  const where: Prisma.UserWhereInput = { isActive: true, id: { in: wanted } };
  // In a private chat only people who are in it can be tagged.
  if (conversation.type !== CHAT_TYPES.GENERAL) {
    where.chatMemberships = { some: { conversationId: conversation.id } };
  }
  const users = await prisma.user.findMany({ where, select: { id: true, name: true } });
  return users.map((u) => ({ id: u.id, name: u.name }));
}

function parseMentionIds(raw: unknown): string[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const parsed = z.array(uuid).max(50).safeParse(value);
  return parsed.success ? parsed.data : [];
}

// ─── Users ───────────────────────────────────────────────────────────────

// GET /chat/users — people to start a chat with or tag. Users are shared by every
// project, so anyone active can be reached.
router.get('/users', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const data = await prisma.user.findMany({
      where: { isActive: true, id: { not: req.user!.id } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// ─── Conversations ───────────────────────────────────────────────────────

async function unreadByConversation(userId: string, projectId: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ conversationId: string; count: number }[]>(Prisma.sql`
    SELECT m."conversationId" AS "conversationId", COUNT(*)::int AS "count"
    FROM chat_messages m
    JOIN chat_members cm ON cm."conversationId" = m."conversationId" AND cm."userId" = ${userId}::uuid
    JOIN chat_conversations c ON c.id = m."conversationId" AND c."projectId" = ${projectId}::uuid
    WHERE m."senderId" <> ${userId}::uuid
      AND m."deletedAt" IS NULL
      AND m."createdAt" > cm."lastReadAt"
    GROUP BY m."conversationId"
  `);
  return new Map(rows.map((r) => [r.conversationId, r.count]));
}

// GET /chat/unread-count — drives the badge next to "Chat" in the sidebar
router.get('/unread-count', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const map = await unreadByConversation(req.user!.id, requireProjectId(req));
    let count = 0;
    map.forEach((n) => (count += n));
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

// GET /chat/conversations — the user's chats, newest activity first
router.get('/conversations', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const projectId = requireProjectId(req);

    const general = await ensureGeneralConversation(projectId);
    await ensureMember(general.id, userId);

    const conversations = await prisma.chatConversation.findMany({
      where: { projectId, members: { some: { userId } } },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        members: { include: { user: { select: { id: true, name: true, role: true } } } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, name: true } },
            attachments: { select: { fileName: true }, take: 3 },
          },
        },
      },
    });
    const unread = await unreadByConversation(userId, projectId);

    const data = conversations.map((c) => {
      const last = c.messages[0];
      const other = c.type === CHAT_TYPES.DIRECT ? c.members.find((m) => m.userId !== userId) : null;
      return {
        id: c.id,
        type: c.type,
        name: c.type === CHAT_TYPES.DIRECT ? (other?.user.name ?? '') : (c.name ?? ''),
        memberCount: c.type === CHAT_TYPES.GENERAL ? null : c.members.length,
        members:
          c.type === CHAT_TYPES.GROUP
            ? c.members.map((m) => ({ id: m.user.id, name: m.user.name, role: m.user.role }))
            : undefined,
        directUser: other ? { id: other.user.id, name: other.user.name, role: other.user.role } : null,
        lastMessageAt: c.lastMessageAt,
        lastMessage: last
          ? {
              senderName: last.sender.name,
              senderId: last.sender.id,
              deleted: !!last.deletedAt,
              preview: last.deletedAt ? '' : previewOf(last.body, last.attachments.map((a) => a.fileName)),
            }
          : null,
        unread: unread.get(c.id) ?? 0,
      };
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

const createConversationSchema = z.object({
  body: z.discriminatedUnion('type', [
    z.object({ type: z.literal('DIRECT'), userId: uuid }),
    z.object({
      type: z.literal('GROUP'),
      name: z.string().trim().min(1).max(80),
      memberIds: z.array(uuid).min(1).max(100),
    }),
  ]),
});

// POST /chat/conversations — start a direct chat (idempotent) or a group
router.post(
  '/conversations',
  validateMiddleware(createConversationSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const me = req.user!;
      const projectId = requireProjectId(req);
      const input = req.body as
        | { type: 'DIRECT'; userId: string }
        | { type: 'GROUP'; name: string; memberIds: string[] };

      if (input.type === 'DIRECT') {
        if (input.userId === me.id) {
          res.status(400).json({ error: 'You cannot start a chat with yourself' });
          return;
        }
        const other = await prisma.user.findFirst({
          where: { id: input.userId, isActive: true },
          select: { id: true },
        });
        if (!other) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
        const directKey = directKeyFor(me.id, other.id);
        let conversation = await prisma.chatConversation.findUnique({
          where: { projectId_directKey: { projectId, directKey } },
        });
        if (!conversation) {
          try {
            conversation = await prisma.chatConversation.create({
              data: {
                projectId,
                type: CHAT_TYPES.DIRECT,
                directKey,
                createdById: me.id,
                members: { create: [{ userId: me.id }, { userId: other.id }] },
              },
            });
          } catch (e) {
            // Both people started the chat at once: use the one that won.
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
              conversation = await prisma.chatConversation.findUnique({
                where: { projectId_directKey: { projectId, directKey } },
              });
            } else {
              throw e;
            }
          }
        }
        res.status(201).json({ data: { id: conversation!.id } });
        return;
      }

      const memberIds = Array.from(new Set([...input.memberIds, me.id]));
      const users = await prisma.user.findMany({
        where: { id: { in: memberIds }, isActive: true },
        select: { id: true },
      });
      if (users.length < 2) {
        res.status(400).json({ error: 'Pick at least one other person' });
        return;
      }
      const conversation = await prisma.chatConversation.create({
        data: {
          projectId,
          type: CHAT_TYPES.GROUP,
          name: input.name,
          createdById: me.id,
          members: { create: users.map((u) => ({ userId: u.id })) },
        },
      });
      await emitToConversation(conversation, SocketEvents.CHAT_CONVERSATION, {
        conversationId: conversation.id,
      });
      res.status(201).json({ data: { id: conversation.id } });
    } catch (error) {
      next(error);
    }
  },
);

// POST /chat/conversations/:id/read — mark everything up to now as read
router.post('/conversations/:id/read', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const me = req.user!;
    const conversation = await findAccessibleConversation(req.params.id, me.id, requireProjectId(req));
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    await prisma.chatMember.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId: me.id } },
      create: { conversationId: conversation.id, userId: me.id },
      update: { lastReadAt: new Date() },
    });
    // Tag notifications for this chat are read too.
    await prisma.appNotification.updateMany({
      where: {
        userId: me.id,
        isRead: false,
        type: 'CHAT_MENTION',
        entityType: 'CHAT_CONVERSATION',
        entityId: conversation.id,
      },
      data: { isRead: true },
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ─── Messages ────────────────────────────────────────────────────────────

// GET /chat/conversations/:id/messages?before=<iso>&limit= — one page, oldest first
router.get('/conversations/:id/messages', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const conversation = await findAccessibleConversation(req.params.id, req.user!.id, requireProjectId(req));
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? PAGE_SIZE), 10) || PAGE_SIZE));
    const before = typeof req.query.before === 'string' && !isNaN(Date.parse(req.query.before))
      ? new Date(req.query.before)
      : null;

    const rows = await prisma.chatMessage.findMany({
      where: { conversationId: conversation.id, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: messageInclude,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    res.json({ data: page.map(serializeMessage), hasMore });
  } catch (error) {
    next(error);
  }
});

function runUpload(req: Request, res: Response, next: NextFunction): void {
  upload.array('files', MAX_FILES)(req, res, (err: unknown) => {
    if (!err) return next();
    const code = (err as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: `Each file must be ${MAX_FILE_BYTES / 1024 / 1024} MB or smaller` });
      return;
    }
    if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({ error: `You can attach up to ${MAX_FILES} files per message` });
      return;
    }
    next(err);
  });
}

async function notifyForMessage(opts: {
  conversation: { id: string; projectId: string; type: string; name: string | null };
  senderId: string;
  senderName: string;
  body: string;
  attachmentNames: string[];
  mentions: ChatMention[];
  newlyTaggedIds: string[];
}): Promise<void> {
  const { conversation, senderId, senderName, body, attachmentNames, mentions, newlyTaggedIds } = opts;
  const prefix = await projectTitlePrefix(conversation.projectId);
  const preview = previewOf(body, attachmentNames);
  const url = `/chat?c=${conversation.id}`;
  const where = conversation.type === CHAT_TYPES.GENERAL ? 'General' : (conversation.name ?? '');
  const groupLabel = conversation.type === CHAT_TYPES.GROUP ? ` · ${where}` : '';

  // Tagged users: in-app notification + push, whatever the chat type.
  if (newlyTaggedIds.length > 0) {
    const title = `${prefix}${senderName} mentioned you${conversation.type === CHAT_TYPES.DIRECT ? '' : ` in ${where}`}`;
    await prisma.appNotification.createMany({
      data: newlyTaggedIds.map((userId) => ({
        userId,
        projectId: conversation.projectId,
        type: 'CHAT_MENTION',
        title,
        body: preview,
        url,
        entityId: conversation.id,
        entityType: 'CHAT_CONVERSATION',
      })),
    });
    notifyUsers(
      newlyTaggedIds,
      { entityType: 'CHAT_CONVERSATION', entityId: conversation.id, title, body: preview, url },
      'chat',
    ).catch((err) => console.error('[Chat] mention push failed:', err));
  }

  // Everyone else in a direct chat or group gets a push, unless they are looking at it.
  // The open room (General) only notifies people who were tagged.
  if (conversation.type === CHAT_TYPES.GENERAL) return;
  const members = await prisma.chatMember.findMany({
    where: { conversationId: conversation.id, userId: { not: senderId } },
    select: { userId: true },
  });
  const viewing = await userIdsViewingChat(conversation.id);
  const tagged = new Set(mentions.map((m) => m.id));
  const recipients = members.map((m) => m.userId).filter((id) => !viewing.has(id) && !tagged.has(id));
  if (recipients.length > 0) {
    notifyUsers(
      recipients,
      {
        entityType: 'CHAT_CONVERSATION',
        entityId: conversation.id,
        title: `${prefix}${senderName}${groupLabel}`,
        body: preview,
        url,
      },
      'chat',
    ).catch((err) => console.error('[Chat] push failed:', err));
  }
}

// POST /chat/conversations/:id/messages — multipart: body, mentionIds (JSON), replyToId, files[]
router.post(
  '/conversations/:id/messages',
  runUpload,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const stored: string[] = [];
    try {
      const me = req.user!;
      const projectId = requireProjectId(req);
      const conversation = await findAccessibleConversation(req.params.id, me.id, projectId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
      if (body.length > 4000) {
        res.status(400).json({ error: 'Message is too long (4000 characters max)' });
        return;
      }
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!body && files.length === 0) {
        res.status(400).json({ error: 'Write a message or attach a file' });
        return;
      }
      for (const f of files) {
        // multer decodes multipart names as latin1; recover UTF-8 (e.g. Telugu file names).
        f.originalname = Buffer.from(f.originalname, 'latin1').toString('utf8');
        if (!isAllowedUpload(f)) {
          res.status(400).json({ error: ALLOWED_UPLOAD_MESSAGE });
          return;
        }
      }

      let replyToId: string | null = null;
      if (req.body.replyToId) {
        if (!uuid.safeParse(req.body.replyToId).success) {
          res.status(400).json({ error: 'Invalid reply target' });
          return;
        }
        const target = await prisma.chatMessage.findFirst({
          where: { id: req.body.replyToId, conversationId: conversation.id },
          select: { id: true },
        });
        if (!target) {
          res.status(400).json({ error: 'The message you are replying to was not found' });
          return;
        }
        replyToId = target.id;
      }

      const mentions = await resolveMentions(parseMentionIds(req.body.mentionIds), conversation, me.id);

      // Upload first; rows are created in one go so a failed upload leaves no half message.
      const storage = getStorageService();
      const attachmentRows: Prisma.ChatAttachmentCreateWithoutMessageInput[] = [];
      for (const f of files) {
        const ext = path.extname(f.originalname).toLowerCase();
        const isImage = f.mimetype.startsWith('image/');
        const result = await storage.upload(
          f.buffer,
          `chat/${conversation.id}/${crypto.randomUUID()}${ext}`,
          f.mimetype,
          'attachments',
        );
        stored.push(result.filePath);
        attachmentRows.push({
          fileName: f.originalname,
          filePath: result.filePath,
          mimeType: f.mimetype,
          size: f.size,
          fileType: isImage ? 'IMAGE' : 'DOCUMENT',
        });
      }

      const message = await prisma.$transaction(async (tx) => {
        const created = await tx.chatMessage.create({
          data: {
            conversationId: conversation.id,
            senderId: me.id,
            body,
            mentions: mentions as unknown as Prisma.InputJsonValue,
            replyToId,
            attachments: { create: attachmentRows },
          },
          include: messageInclude,
        });
        await tx.chatConversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: created.createdAt },
        });
        // Sending counts as having read everything before it.
        await tx.chatMember.upsert({
          where: { conversationId_userId: { conversationId: conversation.id, userId: me.id } },
          create: { conversationId: conversation.id, userId: me.id },
          update: { lastReadAt: created.createdAt },
        });
        return created;
      });

      const dto = serializeMessage(message);
      await emitToConversation(conversation, SocketEvents.CHAT_MESSAGE, dto);

      notifyForMessage({
        conversation,
        senderId: me.id,
        senderName: me.name,
        body,
        attachmentNames: files.map((f) => f.originalname),
        mentions,
        newlyTaggedIds: mentions.map((m) => m.id),
      }).catch((err) => console.error('[Chat] notify failed:', err));

      res.status(201).json({ data: dto });
    } catch (error) {
      // Don't leave orphaned files behind when the message could not be saved.
      const storage = getStorageService();
      await Promise.all(stored.map((p) => storage.deleteFile(p).catch(() => {})));
      next(error);
    }
  },
);

const editMessageSchema = z.object({
  body: z.object({
    body: z.string().trim().min(1).max(4000),
    mentionIds: z.array(uuid).max(50).optional(),
  }),
});

async function findOwnMessageContext(req: AuthenticatedRequest) {
  const message = await prisma.chatMessage.findUnique({ where: { id: req.params.id } });
  if (!message) return null;
  const conversation = await findAccessibleConversation(message.conversationId, req.user!.id, requireProjectId(req));
  return conversation ? { message, conversation } : null;
}

// PATCH /chat/messages/:id — sender only; only people newly tagged by the edit are notified
router.patch(
  '/messages/:id',
  validateMiddleware(editMessageSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const me = req.user!;
      const ctx = await findOwnMessageContext(req);
      if (!ctx) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }
      const { message, conversation } = ctx;
      if (message.senderId !== me.id) {
        res.status(403).json({ error: 'You can only edit your own messages' });
        return;
      }
      if (message.deletedAt) {
        res.status(400).json({ error: 'This message was deleted' });
        return;
      }
      const { body, mentionIds } = req.body as { body: string; mentionIds?: string[] };
      const mentions = await resolveMentions(mentionIds, conversation, me.id);
      const previous = new Set(((message.mentions as unknown as ChatMention[] | null) ?? []).map((m) => m.id));
      const newlyTagged = mentions.filter((m) => !previous.has(m.id)).map((m) => m.id);

      const updated = await prisma.chatMessage.update({
        where: { id: message.id },
        data: { body, mentions: mentions as unknown as Prisma.InputJsonValue, editedAt: new Date() },
        include: messageInclude,
      });
      const dto = serializeMessage(updated);
      await emitToConversation(conversation, SocketEvents.CHAT_MESSAGE_UPDATED, dto);

      if (newlyTagged.length > 0) {
        const prefix = await projectTitlePrefix(conversation.projectId);
        const where = conversation.type === CHAT_TYPES.GENERAL ? 'General' : (conversation.name ?? '');
        const title = `${prefix}${me.name} mentioned you${conversation.type === CHAT_TYPES.DIRECT ? '' : ` in ${where}`}`;
        const preview = previewOf(body, []);
        const url = `/chat?c=${conversation.id}`;
        await prisma.appNotification.createMany({
          data: newlyTagged.map((userId) => ({
            userId,
            projectId: conversation.projectId,
            type: 'CHAT_MENTION',
            title,
            body: preview,
            url,
            entityId: conversation.id,
            entityType: 'CHAT_CONVERSATION',
          })),
        });
        notifyUsers(
          newlyTagged,
          { entityType: 'CHAT_CONVERSATION', entityId: conversation.id, title, body: preview, url },
          'chat',
        ).catch((err) => console.error('[Chat] mention push failed:', err));
      }

      res.json({ data: dto });
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /chat/messages/:id — sender, or any admin. The row stays (replies still point at it)
// but its text, tags and files are wiped.
router.delete('/messages/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const me = req.user!;
    const ctx = await findOwnMessageContext(req);
    if (!ctx) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const { message, conversation } = ctx;
    const isAdmin = String(me.role).startsWith('ADMIN');
    if (message.senderId !== me.id && !isAdmin) {
      res.status(403).json({ error: 'You can only delete your own messages' });
      return;
    }
    if (!message.deletedAt) {
      const files = await prisma.chatAttachment.findMany({
        where: { messageId: message.id },
        select: { filePath: true },
      });
      const deletedAt = new Date();
      await prisma.$transaction([
        prisma.chatAttachment.deleteMany({ where: { messageId: message.id } }),
        prisma.chatMessage.update({
          where: { id: message.id },
          data: { body: '', mentions: [], deletedAt },
        }),
      ]);
      const storage = getStorageService();
      await Promise.all(files.map((f) => storage.deleteFile(f.filePath).catch(() => {})));
      await emitToConversation(conversation, SocketEvents.CHAT_MESSAGE_DELETED, {
        id: message.id,
        conversationId: conversation.id,
        deletedAt,
      });
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /chat/attachments/:id/file — only people who can see the conversation
router.get('/attachments/:id/file', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const attachment = await prisma.chatAttachment.findUnique({
      where: { id: req.params.id },
      include: { message: { select: { conversationId: true, deletedAt: true } } },
    });
    if (!attachment || attachment.message.deletedAt) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }
    const conversation = await findAccessibleConversation(
      attachment.message.conversationId,
      req.user!.id,
      requireProjectId(req),
    );
    if (!conversation) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }
    await serveFile(res, attachment.filePath, attachment.mimeType);
  } catch (error) {
    next(error);
  }
});

export default router;
