import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
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
  }),
});

// Users visible to the caller in the project: same project, or unassigned
// (heads/admins oversee every project).
function projectUserScope(projectId: string | null): Prisma.UserWhereInput {
  return projectId
    ? { isActive: true, OR: [{ projectId }, { projectId: null }] }
    : { isActive: true };
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
      where: { entityType, entityId },
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
    if (projectId) and.push({ OR: [{ projectId }, { projectId: null }] });
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
      const { entityType, entityId, entityLabel, url, body, mentionIds } = req.body as {
        entityType: string;
        entityId: string;
        entityLabel?: string;
        url?: string;
        body: string;
        mentionIds?: string[];
      };
      const projectId = user.projectId ?? null;
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
          mentions: mentions as unknown as Prisma.InputJsonValue,
        },
        include: { author: { select: { id: true, name: true, role: true } } },
      });

      // Recipients: tagged users only; with no tag, every active user in scope.
      let recipientIds: string[];
      if (mentions.length > 0) {
        recipientIds = mentions.map((m) => m.id);
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

// DELETE /comments/:id — author, or any admin
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.comment.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }
    const isAdmin = String(req.user!.role).startsWith('ADMIN');
    if (existing.authorId !== req.user!.id && !isAdmin) {
      res.status(403).json({ error: 'You can only delete your own comments' });
      return;
    }
    await prisma.comment.delete({ where: { id: existing.id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
