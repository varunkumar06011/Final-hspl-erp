import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { validateMiddleware } from '../middleware/validate';
import { prisma } from '../config/prisma';
import { notifyUsers } from '../services/push.service';

const router = Router();
router.use(authMiddleware);

interface Mention {
  id: string;
  name: string;
}

const createCommentSchema = z.object({
  body: z.object({
    entityType: z.string().trim().min(1).max(60),
    entityId: z.string().uuid(),
    entityLabel: z.string().trim().max(200).optional(),
    url: z.string().max(300).startsWith('/').optional(),
    body: z.string().trim().min(1).max(4000),
    mentionIds: z.array(z.string().uuid()).max(50).optional(),
    parentId: z.string().uuid().optional(),
  }),
});

// Users are shared by every project (same people, same logins), so anyone active can be
// tagged. The comments themselves stay scoped to the project they were written in.
function projectUserScope(_projectId: string | null): Prisma.UserWhereInput {
  return { isActive: true };
}

// GET /comments/users — candidates for the @ picker
router.get('/users', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      where: projectUserScope(req.user!.projectId ?? null),
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json({ data: users });
  } catch (error) {
    next(error);
  }
});

// GET /comments?entityType=&entityId= — thread for one record (oldest first)
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const entityType = String(req.query.entityType ?? '');
    const entityId = String(req.query.entityId ?? '');
    if (!entityType || !z.string().uuid().safeParse(entityId).success) {
      res.status(400).json({ error: 'entityType and a valid entityId are required' });
      return;
    }
    const data = await prisma.comment.findMany({
      where: { entityType, entityId, projectId: requireProjectId(req) },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// GET /comments/all — the Comments module: every comment, filterable
//   authorId, mentionedUserId, entityType, search, from, to, page, pageSize
router.get('/all', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const projectId = req.user!.projectId ?? null;
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '25', 10) || 25));

    const and: Prisma.CommentWhereInput[] = [];
    if (projectId) and.push({ projectId });
    if (q.authorId) and.push({ authorId: q.authorId });
    if (q.entityType) and.push({ entityType: q.entityType });
    if (q.mentionedUserId) {
      and.push({ mentions: { array_contains: [{ id: q.mentionedUserId }] } });
    }
    if (q.search) {
      and.push({
        OR: [
          { body: { contains: q.search, mode: 'insensitive' } },
          { entityLabel: { contains: q.search, mode: 'insensitive' } },
        ],
      });
    }
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.from && !isNaN(Date.parse(q.from))) createdAt.gte = new Date(q.from);
    if (q.to && !isNaN(Date.parse(q.to))) {
      const end = new Date(q.to);
      end.setHours(23, 59, 59, 999);
      createdAt.lte = end;
    }
    if (createdAt.gte || createdAt.lte) and.push({ createdAt });

    const where: Prisma.CommentWhereInput = and.length ? { AND: and } : {};
    const [data, total] = await Promise.all([
      prisma.comment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { author: { select: { id: true, name: true, role: true } } },
      }),
      prisma.comment.count({ where }),
    ]);
    res.json({
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    next(error);
  }
});

// POST /comments — add a comment; notifies tagged users, or everyone if none tagged
router.post(
  '/',
  validateMiddleware(createCommentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const { entityType, entityId, entityLabel, url, body, mentionIds, parentId } = req.body as {
        entityType: string;
        entityId: string;
        entityLabel?: string;
        url?: string;
        body: string;
        mentionIds?: string[];
        parentId?: string;
      };
      const projectId = user.projectId ?? null;

      // A reply always hangs off the top-level comment, on the same record.
      let parent: { id: string; authorId: string } | null = null;
      if (parentId) {
        const found = await prisma.comment.findUnique({ where: { id: parentId } });
        if (!found || found.entityType !== entityType || found.entityId !== entityId || found.projectId !== projectId) {
          res.status(400).json({ error: 'Comment to reply to was not found on this record' });
          return;
        }
        parent = { id: found.parentId ?? found.id, authorId: found.authorId };
      }
      const scope = projectUserScope(projectId);

      // Only accept tags of real, active users in scope; never trust client names.
      const wanted = Array.from(new Set(mentionIds ?? [])).filter((id) => id !== user.id);
      const tagged = wanted.length
        ? await prisma.user.findMany({
            where: { ...scope, id: { in: wanted } },
            select: { id: true, name: true },
          })
        : [];
      const mentions: Mention[] = tagged.map((u) => ({ id: u.id, name: u.name }));

      const comment = await prisma.comment.create({
        data: {
          projectId,
          entityType,
          entityId,
          entityLabel: entityLabel || null,
          url: url || null,
          authorId: user.id,
          body,
          parentId: parent?.id ?? null,
          mentions: mentions as unknown as Prisma.InputJsonValue,
        },
        include: { author: { select: { id: true, name: true, role: true } } },
      });

      // Recipients: tagged users (plus the author being replied to); with no tag on a
      // top-level comment, every active user in scope.
      let recipientIds: string[];
      if (parent || mentions.length > 0) {
        recipientIds = Array.from(
          new Set([...mentions.map((m) => m.id), ...(parent ? [parent.authorId] : [])]),
        ).filter((id) => id !== user.id);
      } else {
        const everyone = await prisma.user.findMany({
          where: { ...scope, id: { not: user.id } },
          select: { id: true },
        });
        recipientIds = everyone.map((u) => u.id);
      }

      if (recipientIds.length > 0) {
        const label = entityLabel || entityType.replace(/_/g, ' ').toLowerCase();
        const title = mentions.length > 0
          ? `${user.name} mentioned you on ${label}`
          : parent
            ? `${user.name} replied on ${label}`
            : `${user.name} commented on ${label}`;
        const preview = body.length > 140 ? `${body.slice(0, 137)}...` : body;
        const targetUrl = url || '/comments';

        await prisma.appNotification.createMany({
          data: recipientIds.map((userId) => ({
            userId,
            projectId,
            type: mentions.length > 0 ? 'COMMENT_MENTION' : 'COMMENT',
            title,
            body: preview,
            url: targetUrl,
            entityId,
            entityType,
          })),
        });
        notifyUsers(recipientIds, { entityType, entityId, title, body: preview, url: targetUrl }).catch(
          (err) => console.error('[Comments] push failed:', err),
        );
      }

      res.status(201).json({ data: comment });
    } catch (error) {
      next(error);
    }
  },
);

const editCommentSchema = z.object({
  body: z.object({
    body: z.string().trim().min(1).max(4000),
    mentionIds: z.array(z.string().uuid()).max(50).optional(),
  }),
});

// PATCH /comments/:id — author only; notifies only users newly tagged by the edit
router.patch(
  '/:id',
  validateMiddleware(editCommentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const existing = await prisma.comment.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.projectId !== requireProjectId(req)) {
        res.status(404).json({ error: 'Comment not found' });
        return;
      }
      if (existing.authorId !== user.id) {
        res.status(403).json({ error: 'You can only edit your own comments' });
        return;
      }
      if (existing.deletedAt) {
        res.status(400).json({ error: 'This comment was deleted' });
        return;
      }
      const { body, mentionIds } = req.body as { body: string; mentionIds?: string[] };
      const scope = projectUserScope(user.projectId ?? null);

      const wanted = Array.from(new Set(mentionIds ?? [])).filter((id) => id !== user.id);
      const tagged = wanted.length
        ? await prisma.user.findMany({
            where: { ...scope, id: { in: wanted } },
            select: { id: true, name: true },
          })
        : [];
      const mentions: Mention[] = tagged.map((u) => ({ id: u.id, name: u.name }));

      const previousIds = new Set(
        ((existing.mentions as unknown as Mention[] | null) ?? []).map((m) => m.id),
      );
      const newlyTagged = mentions.filter((m) => !previousIds.has(m.id));

      const comment = await prisma.comment.update({
        where: { id: existing.id },
        data: {
          body,
          mentions: mentions as unknown as Prisma.InputJsonValue,
          editedAt: new Date(),
        },
        include: { author: { select: { id: true, name: true, role: true } } },
      });

      if (existing.approvalStepId) {
        await prisma.approvalStep.update({
          where: { id: existing.approvalStepId },
          data: { comments: body },
        });
      }

      if (newlyTagged.length > 0) {
        const recipientIds = newlyTagged.map((m) => m.id);
        const label =
          existing.entityLabel || existing.entityType.replace(/_/g, ' ').toLowerCase();
        const title = `${user.name} mentioned you on ${label}`;
        const preview = body.length > 140 ? `${body.slice(0, 137)}...` : body;
        const targetUrl = existing.url || '/comments';

        await prisma.appNotification.createMany({
          data: recipientIds.map((userId) => ({
            userId,
            projectId: existing.projectId,
            type: 'COMMENT_MENTION',
            title,
            body: preview,
            url: targetUrl,
            entityId: existing.entityId,
            entityType: existing.entityType,
          })),
        });
        notifyUsers(recipientIds, {
          entityType: existing.entityType,
          entityId: existing.entityId,
          title,
          body: preview,
          url: targetUrl,
        }).catch((err) => console.error('[Comments] push failed:', err));
      }

      res.json({ data: comment });
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /comments/:id — author, or any admin. Soft delete: the row stays so the thread
// shows who deleted it; the text and tags are wiped.
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.comment.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.projectId !== requireProjectId(req)) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }
    const isAdmin = String(req.user!.role).startsWith('ADMIN');
    if (existing.authorId !== req.user!.id && !isAdmin) {
      res.status(403).json({ error: 'You can only delete your own comments' });
      return;
    }
    if (!existing.deletedAt) {
      await prisma.comment.update({
        where: { id: existing.id },
        data: {
          body: '',
          mentions: [],
          deletedAt: new Date(),
          deletedById: req.user!.id,
          deletedByName: req.user!.name,
        },
      });
      if (existing.approvalStepId) {
        await prisma.approvalStep.update({
          where: { id: existing.approvalStepId },
          data: { comments: null },
        });
      }
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
