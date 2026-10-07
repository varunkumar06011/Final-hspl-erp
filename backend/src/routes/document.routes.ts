import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, isAdminRole } from '@hospital-erp/shared';
import { listDocumentsSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { getStorageService, serveFile } from '../services/storage.service';
import { notifyAllHeads } from '../services/push.service';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { isAllowedUpload, ALLOWED_UPLOAD_MESSAGE } from '../utils/uploadFileTypes';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Locked documents: the uploader sets a personal 6-digit document PIN. Anyone who knows it
// can open that uploader's locked documents; everybody else sees only a locked placeholder.
// A correct PIN returns a short-lived unlock token that the client sends back as a header.
// Signed with its own secret so it can never be mistaken for a login token.
const UNLOCK_SECRET = `${process.env.JWT_SECRET || 'dev-secret-change-me'}:document-unlock`;
const UNLOCK_TTL_SECONDS = 15 * 60;
const PIN_PATTERN = /^\d{6}$/;
const MAX_PIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const pinAttempts = new Map<string, { count: number; lockedUntil: number }>();

function signUnlock(documentId: string, userId: string): string {
  return jwt.sign({ kind: 'doc-unlock', documentId, userId }, UNLOCK_SECRET, { expiresIn: UNLOCK_TTL_SECONDS });
}

/** True when the token is a valid, unexpired unlock for this document and user. */
function isUnlocked(token: string | undefined, documentId: string, userId: string): boolean {
  if (!token) return false;
  try {
    const d = jwt.verify(token, UNLOCK_SECRET) as { kind?: string; documentId?: string; userId?: string };
    return d.kind === 'doc-unlock' && d.documentId === documentId && d.userId === userId;
  } catch {
    return false;
  }
}

/** Throttles PIN guesses per user+document (or per user for PIN changes). */
function checkAttempts(key: string): string | null {
  const entry = pinAttempts.get(key);
  if (entry && entry.lockedUntil > Date.now()) {
    return `Too many wrong PINs. Try again in ${Math.ceil((entry.lockedUntil - Date.now()) / 60000)} minute(s).`;
  }
  return null;
}
function recordFailure(key: string): void {
  const entry = pinAttempts.get(key);
  const count = (entry && entry.lockedUntil <= Date.now() ? entry.count : 0) + 1;
  pinAttempts.set(key, { count, lockedUntil: count >= MAX_PIN_ATTEMPTS ? Date.now() + LOCK_DURATION_MS : 0 });
}

const router = Router();
router.use(authMiddleware);

// ── Document PIN ──────────────────────────────────────────────────────────

// GET /pin/status — does the signed-in user have a document PIN?
router.get('/pin/status', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { documentPinHash: true } });
    res.json({ hasPin: !!me?.documentPinHash });
  } catch (error) {
    next(error);
  }
});

// POST /pin — set your document PIN, or change it. Changing needs the current document PIN;
// if it is forgotten, your login PIN resets it (the old PIN stops working either way).
router.post('/pin', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { pin, currentPin, loginPin } = req.body as { pin?: string; currentPin?: string; loginPin?: string };
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
      res.status(400).json({ error: 'The document PIN must be exactly 6 digits' });
      return;
    }
    const me = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { documentPinHash: true, pinHash: true },
    });
    if (!me) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (me.documentPinHash) {
      const key = `pin:${req.user!.id}`;
      const blocked = checkAttempts(key);
      if (blocked) {
        res.status(429).json({ error: blocked });
        return;
      }
      const okCurrent = typeof currentPin === 'string' && (await bcrypt.compare(currentPin, me.documentPinHash));
      const okLogin = typeof loginPin === 'string' && !!me.pinHash && (await bcrypt.compare(loginPin, me.pinHash));
      if (!okCurrent && !okLogin) {
        recordFailure(key);
        res.status(403).json({ error: 'Enter your current document PIN (or your login PIN to reset it)', code: 'WRONG_PIN' });
        return;
      }
      pinAttempts.delete(key);
    }
    await prisma.user.update({ where: { id: req.user!.id }, data: { documentPinHash: await bcrypt.hash(pin, 10) } });
    await logAudit({
      userId: req.user!.id,
      action: AuditAction.UPDATE,
      entityType: 'DOCUMENT_PIN',
      entityId: req.user!.id,
      projectId: requireProjectId(req),
      newValue: { changed: !!me.documentPinHash },
    });
    res.json({ hasPin: true });
  } catch (error) {
    next(error);
  }
});

// ── Documents ─────────────────────────────────────────────────────────────

router.get(
  '/',
  validateMiddleware(listDocumentsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20, search } = req.query as Record<string, unknown>;
      const me = req.user!.id;
      const where: Record<string, unknown> = { projectId: requireProjectId(req), deletedAt: null };
      if (search) {
        const term = String(search);
        // Locked documents are only findable by name by whoever uploaded them.
        where.OR = [
          { isLocked: false, OR: [{ name: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }] },
          { isLocked: true, uploadedBy: me, name: { contains: term, mode: 'insensitive' } },
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.document.findMany({
          where,
          include: { uploadedByUser: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.document.count({ where }),
      ]);

      // Unlock tokens the client holds (one per opened locked document).
      const tokens = String(req.headers['x-doc-unlocks'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const data = rows.map((doc) => {
        if (!doc.isLocked) return { ...doc, locked: false };
        if (tokens.some((tk) => isUnlocked(tk, doc.id, me))) return { ...doc, locked: false };
        // Still locked: no name (except for the uploader), no description, no file, no people.
        return {
          id: doc.id,
          projectId: doc.projectId,
          name: doc.uploadedBy === me ? doc.name : null,
          description: null,
          resolveTo: [],
          fileName: null,
          filePath: '',
          mimeType: '',
          uploadedBy: doc.uploadedBy,
          uploadedByUser: doc.uploadedByUser,
          isLocked: true,
          locked: true,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        };
      });

      res.json({
        data,
        pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / Number(pageSize)) },
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /upload — multipart file upload with name, description, resolveTo (and optional lock)
router.post(
  '/upload',
  rbacMiddleware(Permission.MANAGE_DOCUMENTS),
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      if (!isAllowedUpload(req.file)) {
        res.status(400).json({ error: ALLOWED_UPLOAD_MESSAGE });
        return;
      }
      if (!String(req.body.name ?? '').trim()) {
        res.status(400).json({ error: 'Document name is required' });
        return;
      }
      const resolveTo = req.body.resolveTo ? JSON.parse(String(req.body.resolveTo)) : [];
      if (!Array.isArray(resolveTo) || resolveTo.length === 0) {
        res.status(400).json({ error: 'Select at least one person to resolve to' });
        return;
      }

      const lock = String(req.body.locked ?? '') === 'true';
      if (lock) {
        const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { documentPinHash: true } });
        if (!me?.documentPinHash) {
          res.status(400).json({ error: 'Set your 6-digit document PIN before locking a document', code: 'DOCUMENT_PIN_REQUIRED' });
          return;
        }
      }

      const storage = getStorageService();
      const uploadResult = await storage.upload(req.file.buffer, req.file.originalname, req.file.mimetype, 'documents');
      const filePath = uploadResult.filePath;

      const record = await prisma.document.create({
        data: {
          projectId,
          name: String(req.body.name),
          description: req.body.description ? String(req.body.description) : null,
          resolveTo,
          fileName: req.file.originalname,
          filePath,
          mimeType: req.file.mimetype,
          uploadedBy: req.user!.id,
          isLocked: lock,
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'DOCUMENT',
        entityId: record.id,
        projectId,
        newValue: lock ? { locked: true } : { name: record.name, fileName: record.fileName },
      });

      notifyAllHeads(
        projectId,
        {
          entityType: 'DOCUMENT',
          entityId: record.id,
          title: 'New Document Uploaded',
          body: lock ? 'A locked document was uploaded' : `"${record.name}" — ${record.fileName}`,
          url: '/documents',
        },
        req.user!.id,
      ).catch((err) => console.error('[Push] Document notification error:', err));

      res.status(201).json(lock ? { id: record.id, isLocked: true } : record);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/unlock — enter the uploader's document PIN to open a locked document
router.post('/:id/unlock', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const { pin } = req.body as { pin?: string };
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
      res.status(400).json({ error: 'Enter the 6-digit PIN' });
      return;
    }
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, projectId, deletedAt: null },
      include: { uploadedByUser: { select: { id: true, name: true, documentPinHash: true } } },
    });
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    if (!doc.isLocked) {
      res.status(400).json({ error: 'This document is not locked' });
      return;
    }
    const key = `${req.user!.id}:${doc.id}`;
    const blocked = checkAttempts(key);
    if (blocked) {
      res.status(429).json({ error: blocked });
      return;
    }
    const hash = doc.uploadedByUser.documentPinHash;
    if (!hash || !(await bcrypt.compare(pin, hash))) {
      recordFailure(key);
      res.status(403).json({ error: 'Wrong PIN', code: 'WRONG_PIN' });
      return;
    }
    pinAttempts.delete(key);
    const uploader = { id: doc.uploadedByUser.id, name: doc.uploadedByUser.name };
    await logAudit({
      userId: req.user!.id,
      action: AuditAction.UPDATE,
      entityType: 'DOCUMENT',
      entityId: doc.id,
      projectId,
      newValue: { action: 'UNLOCK' },
    }).catch(() => {});
    res.json({
      token: signUnlock(doc.id, req.user!.id),
      expiresInSeconds: UNLOCK_TTL_SECONDS,
      document: { ...doc, uploadedByUser: uploader, locked: false },
    });
  } catch (error) {
    next(error);
  }
});

// POST /:id/lock — the uploader locks a document, or removes the lock (needs the PIN)
router.post('/:id/lock', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const { locked, pin } = req.body as { locked?: boolean; pin?: string };
    const doc = await prisma.document.findFirst({ where: { id: req.params.id, projectId, deletedAt: null } });
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    if (doc.uploadedBy !== req.user!.id) {
      res.status(403).json({ error: 'Only the person who uploaded a document can lock or unlock it' });
      return;
    }
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { documentPinHash: true } });
    if (!me?.documentPinHash) {
      res.status(400).json({ error: 'Set your 6-digit document PIN first', code: 'DOCUMENT_PIN_REQUIRED' });
      return;
    }
    if (!locked) {
      const key = `${req.user!.id}:${doc.id}`;
      const blocked = checkAttempts(key);
      if (blocked) {
        res.status(429).json({ error: blocked });
        return;
      }
      if (typeof pin !== 'string' || !(await bcrypt.compare(pin, me.documentPinHash))) {
        recordFailure(key);
        res.status(403).json({ error: 'Wrong PIN', code: 'WRONG_PIN' });
        return;
      }
      pinAttempts.delete(key);
    }
    await prisma.document.update({ where: { id: doc.id }, data: { isLocked: !!locked } });
    await logAudit({
      userId: req.user!.id,
      action: AuditAction.UPDATE,
      entityType: 'DOCUMENT',
      entityId: doc.id,
      projectId,
      newValue: { locked: !!locked },
    });
    res.json({ id: doc.id, isLocked: !!locked });
  } catch (error) {
    next(error);
  }
});

// GET /:id/file — serve the document file (locked documents need an unlock token)
router.get(
  '/:id/file',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.document.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      if (existing.isLocked && !isUnlocked(req.headers['x-doc-unlock'] as string | undefined, existing.id, req.user!.id)) {
        res.status(423).json({ error: 'This document is locked. Enter the PIN to open it.', code: 'DOCUMENT_LOCKED' });
        return;
      }
      if (!existing.filePath) {
        res.status(404).json({ error: 'No file attached' });
        return;
      }
      await serveFile(res, existing.filePath, existing.mimeType);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — soft delete (a locked document can only be removed by its uploader or an admin)
router.delete(
  '/:id',
  rbacMiddleware(Permission.MANAGE_DOCUMENTS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.document.findFirst({ where: { id: req.params.id, projectId, deletedAt: null } });
      if (!existing) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      if (existing.isLocked && existing.uploadedBy !== req.user!.id && !isAdminRole(req.user!.role)) {
        res.status(403).json({ error: 'Only the uploader or an admin can delete a locked document' });
        return;
      }
      const storage = getStorageService();
      await storage.deleteFile(existing.filePath).catch(() => {});

      await prisma.document.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'DOCUMENT',
        entityId: req.params.id,
        projectId,
      });
      res.json({ message: 'Document deleted' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
