import { Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken } from '../config/firebase';
import { prisma } from '../config/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { APPROVER_ROLES, UserRole, getNextAdminRole, effectiveExtraPermissions, normalizeModuleAccess } from '@hospital-erp/shared';
import type { User } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { isProjectUsable, resolveLoginProjectId } from '../services/project.service';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = '7d';
const MAX_PIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// In-memory rate limiting for PIN attempts (per phone number)
const pinAttempts = new Map<string, { count: number; lockedUntil: number }>();

// `projectId` is the project this session works in (chosen on the login page).
// authMiddleware reads it back; tokens without it fall back to User.projectId.
function signJwt(userId: string, projectId: string): string {
  return jwt.sign({ userId, projectId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Session permissions for login responses: the user's own grants plus module grants.
function accessFields(user: User) {
  const moduleAccess = normalizeModuleAccess(user.moduleAccess);
  return {
    extraPermissions: effectiveExtraPermissions({ role: user.role, extraPermissions: user.extraPermissions, moduleAccess }),
    directPermissions: user.extraPermissions,
    moduleAccess,
  };
}

const INVALID_PROJECT = { error: 'The selected project is not available. Please choose another.' };

export async function verifyToken(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const { idToken, name } = req.body;

    const decodedToken = await verifyFirebaseToken(idToken);

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ firebaseUid: decodedToken.uid }, { phone: decodedToken.phone_number }],
      },
    });

    if (!user) {
      res.status(403).json({
        error: 'Not authorized. Your phone number is not registered in the system.',
      });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({
        error: 'Account is inactive. Contact the Project Head.',
      });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (user.firebaseUid !== decodedToken.uid) {
      updateData.firebaseUid = decodedToken.uid;
    }
    if (name && typeof name === 'string' && name.trim() !== '') {
      updateData.name = name.trim();
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data: updateData });
    }

    res.json({
      id: user.id,
      firebaseUid: decodedToken.uid,
      phone: user.phone,
      name: updateData.name ?? user.name,
      role: user.role,
      projectId: user.projectId,
      isActive: user.isActive,
      termsAcceptedAt: user.termsAcceptedAt,
      ...accessFields(user),
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired Firebase token' });
  }
}

export async function register(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const { idToken, name, projectId: requestedProjectId } = req.body;
    const decodedToken = await verifyFirebaseToken(idToken);
    const phone = decodedToken.phone_number;

    if (!phone) {
      res.status(400).json({ error: 'Firebase account does not contain a verified phone number' });
      return;
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ firebaseUid: decodedToken.uid }, { phone }] },
    });
    if (existing) {
      res.status(409).json({ error: 'This phone number is already registered. Please sign in.' });
      return;
    }

    const projectId = await resolveLoginProjectId(requestedProjectId, null);
    if (!projectId) {
      res.status(requestedProjectId ? 400 : 503).json(
        requestedProjectId ? INVALID_PROJECT : { error: 'No active project is available for registration' }
      );
      return;
    }

    const user = await prisma.user.create({
      data: {
        firebaseUid: decodedToken.uid,
        phone,
        name: name.trim(),
        role: UserRole.SUPERVISOR,
        projectId,
        isActive: true,
        termsAcceptedAt: new Date(),
      },
    });

    res.status(201).json({
      id: user.id,
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      name: user.name,
      role: user.role,
      projectId: user.projectId,
      isActive: user.isActive,
      termsAcceptedAt: user.termsAcceptedAt,
      ...accessFields(user),
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired Firebase token' });
  }
}

export async function createUser(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const { phone, name, role, projectId } = req.body;

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      res.status(409).json({ error: 'User with this phone number already exists' });
      return;
    }

    const user = await prisma.user.create({
      data: {
        firebaseUid: `pending-${phone}`,
        phone,
        name,
        role,
        projectId,
        isActive: true,
      },
    });

    res.status(201).json({
      id: user.id,
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      name: user.name,
      role: user.role,
      projectId: user.projectId,
      isActive: user.isActive,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
}

export async function updateUser(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { name, phone, role, isActive, projectId } = req.body;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (id === req.user!.id && isActive === false) {
      res.status(400).json({ error: 'You cannot deactivate your own account' });
      return;
    }

    // Check phone uniqueness if changing
    if (phone && phone !== existing.phone) {
      const phoneConflict = await prisma.user.findFirst({
        where: { phone, id: { not: id } },
        select: { id: true },
      });
      if (phoneConflict) {
        res.status(409).json({ error: 'Another user already has this phone number' });
        return;
      }
    }

    // Users are shared by every project, so an approver role is unique across all of them.
    if (role && APPROVER_ROLES.some((approverRole) => approverRole === role)) {
      const occupied = await prisma.user.findFirst({
        where: {
          id: { not: id },
          role,
          isActive: true,
        },
        select: { name: true },
      });
      if (occupied) {
        res.status(409).json({ error: `${role.replace(/_/g, ' ')} is already assigned to ${occupied.name}` });
        return;
      }
    }

    // Dynamic admin roles (ADMIN_3, ADMIN_4, ...) — no uniqueness constraint
    // since each is a distinct role. Only the fixed ADMIN and ADMIN_2 are
    // limited to one active user each (handled by the APPROVER_ROLES check above).

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(phone && { phone }),
        ...(role && { role }),
        ...(isActive !== undefined && { isActive }),
        ...(projectId && { projectId }),
      },
    });

    res.json({
      id: updated.id,
      firebaseUid: updated.firebaseUid,
      phone: updated.phone,
      name: updated.name,
      role: updated.role,
      projectId: updated.projectId,
      isActive: updated.isActive,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
}

export async function listUsers(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          phone: true,
          name: true,
          role: true,
          projectId: true,
          isActive: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count(),
    ]);

    res.json({
      data: users,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list users' });
  }
}

export async function getMe(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): Promise<void> {
  res.json({
    id: req.user!.id,
    firebaseUid: req.user!.firebaseUid,
    phone: req.user!.phone,
    name: req.user!.name,
    role: req.user!.role,
    projectId: req.user!.projectId,
    isActive: req.user!.isActive,
    termsAcceptedAt: req.user!.termsAcceptedAt,
    extraPermissions: req.user!.extraPermissions ?? [],
    directPermissions: req.user!.directPermissions ?? [],
    moduleAccess: req.user!.moduleAccess ?? {},
  });
}

/**
 * GET /api/auth/next-admin-role
 * Returns the next available dynamic admin role (ADMIN_3, ADMIN_4, ...).
 * Queries the DB for all existing admin roles (users are shared by every
 * project) and computes the next number. Requires MANAGE_USERS permission.
 */
export async function getNextAdminRoleEndpoint(
  _req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { role: true },
    });
    const existingRoles = users.map((u) => u.role);
    const nextRole = getNextAdminRole(existingRoles);
    const nextLabel = `Admin ${nextRole.split('_')[1]}`;
    res.json({ role: nextRole, label: nextLabel });
  } catch (error) {
    res.status(500).json({ error: 'Failed to compute next admin role' });
  }
}

export async function devLogin(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not available in production' });
    return;
  }

  try {
    const { phone, name, projectId: requestedProjectId } = req.body;
    if (!phone) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    let user = await prisma.user.findUnique({ where: { phone } });
    const projectId = await resolveLoginProjectId(requestedProjectId, user?.projectId ?? null);
    if (!projectId) {
      res.status(requestedProjectId ? 400 : 503).json(
        requestedProjectId ? INVALID_PROJECT : { error: 'No active project available' }
      );
      return;
    }
    if (!user) {
      // Dev mode: auto-create the user as SUPERVISOR if they don't exist
      user = await prisma.user.create({
        data: {
          firebaseUid: `dev-${phone}`,
          phone,
          name: (name && String(name).trim()) || 'Dev User',
          role: UserRole.SUPERVISOR,
          projectId,
          isActive: true,
        },
      });
    }

    if (!user.isActive) {
      res.status(403).json({
        error: 'Account is inactive. Contact the Project Head.',
      });
      return;
    }

    let updatedName = user.name;
    if (name && typeof name === 'string' && name.trim() !== '') {
      updatedName = name.trim();
      await prisma.user.update({ where: { id: user.id }, data: { name: updatedName } });
    }
    if (!user.termsAcceptedAt) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { termsAcceptedAt: new Date() },
      });
    }

    res.json({
      id: user.id,
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      name: updatedName,
      role: user.role,
      projectId,
      isActive: user.isActive,
      termsAcceptedAt: user.termsAcceptedAt,
      ...accessFields(user),
    });
  } catch (error) {
    res.status(500).json({ error: 'Dev login failed' });
  }
}

// GET /auth/check-pin?phone=... — check if user has a PIN set
export async function checkPin(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const phone = req.query.phone as string;
    if (!phone) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      res.status(404).json({ error: 'Phone number not registered' });
      return;
    }
    if (!user.isActive) {
      res.status(403).json({ error: 'Account is inactive. Contact the Project Head.' });
      return;
    }

    res.json({ hasPin: !!user.pinHash });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check PIN status' });
  }
}

// POST /auth/pin-login — login with phone + PIN
export async function pinLogin(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const { phone, pin, projectId: requestedProjectId } = req.body;

    // Rate limiting check
    const attempt = pinAttempts.get(phone);
    if (attempt && attempt.lockedUntil > Date.now()) {
      const minsLeft = Math.ceil((attempt.lockedUntil - Date.now()) / 60000);
      res.status(429).json({ error: `Too many failed attempts. Try again in ${minsLeft} minute(s).` });
      return;
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      res.status(404).json({ error: 'Phone number not registered' });
      return;
    }
    if (!user.isActive) {
      res.status(403).json({ error: 'Account is inactive. Contact the Project Head.' });
      return;
    }
    if (!user.pinHash) {
      res.status(400).json({ error: 'PIN not set. Please sign in with OTP first to set your PIN.' });
      return;
    }

    const pinValid = await bcrypt.compare(pin, user.pinHash);
    if (!pinValid) {
      // Track failed attempt
      const current = pinAttempts.get(phone) ?? { count: 0, lockedUntil: 0 };
      current.count += 1;
      if (current.count >= MAX_PIN_ATTEMPTS) {
        current.lockedUntil = Date.now() + LOCK_DURATION_MS;
        current.count = 0;
        pinAttempts.set(phone, current);
        res.status(429).json({ error: `Too many failed attempts. Account locked for 15 minutes.` });
        return;
      }
      pinAttempts.set(phone, current);
      const remaining = MAX_PIN_ATTEMPTS - current.count;
      res.status(401).json({ error: `Incorrect PIN. ${remaining} attempt(s) remaining.` });
      return;
    }

    // PIN correct — clear rate limit
    pinAttempts.delete(phone);

    // Validated after the PIN so project ids can't be probed without credentials.
    const projectId = await resolveLoginProjectId(requestedProjectId, user.projectId);
    if (!projectId) {
      res.status(400).json(INVALID_PROJECT);
      return;
    }

    // Record legal consent — keeps the first acceptance timestamp.
    const termsAcceptedAt = user.termsAcceptedAt ?? new Date();
    if (!user.termsAcceptedAt) {
      await prisma.user.update({ where: { id: user.id }, data: { termsAcceptedAt } });
    }

    const token = signJwt(user.id, projectId);
    res.json({
      token,
      user: {
        id: user.id,
        firebaseUid: user.firebaseUid,
        phone: user.phone,
        name: user.name,
        role: user.role,
        projectId,
        isActive: user.isActive,
        termsAcceptedAt,
        ...accessFields(user),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
}

// POST /auth/set-pin — set PIN after OTP verification
export async function setPin(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const { phone, pin, projectId: requestedProjectId } = req.body;

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      res.status(404).json({ error: 'Phone number not registered' });
      return;
    }
    if (!user.isActive) {
      res.status(403).json({ error: 'Account is inactive. Contact the Project Head.' });
      return;
    }

    const projectId = await resolveLoginProjectId(requestedProjectId, user.projectId);
    if (!projectId) {
      res.status(400).json(INVALID_PROJECT);
      return;
    }

    const pinHash = await bcrypt.hash(pin, 10);
    const termsAcceptedAt = user.termsAcceptedAt ?? new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: { pinHash, termsAcceptedAt },
    });

    const token = signJwt(user.id, projectId);
    res.json({
      token,
      user: {
        id: user.id,
        firebaseUid: user.firebaseUid,
        phone: user.phone,
        name: user.name,
        role: user.role,
        projectId,
        isActive: user.isActive,
        termsAcceptedAt,
        ...accessFields(user),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to set PIN' });
  }
}

// POST /auth/switch-project — move the current session to another project (requires auth).
// Users are shared across projects, so any active user may switch; the new token carries
// the new project and every later request is scoped to it.
export async function switchProject(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const { projectId } = req.body;
    if (!(await isProjectUsable(projectId))) {
      res.status(400).json(INVALID_PROJECT);
      return;
    }

    const user = req.user!;
    res.json({
      token: signJwt(user.id, projectId),
      user: {
        id: user.id,
        firebaseUid: user.firebaseUid,
        phone: user.phone,
        name: user.name,
        role: user.role,
        projectId,
        isActive: user.isActive,
        termsAcceptedAt: user.termsAcceptedAt,
        extraPermissions: user.extraPermissions ?? [],
        directPermissions: user.directPermissions ?? [],
        moduleAccess: user.moduleAccess ?? {},
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to switch project' });
  }
}

// POST /auth/change-pin — change PIN (requires auth)
export async function changePin(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const { oldPin, newPin } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (!user.pinHash) {
      res.status(400).json({ error: 'No PIN set. Please set a PIN first.' });
      return;
    }

    const pinValid = await bcrypt.compare(oldPin, user.pinHash);
    if (!pinValid) {
      res.status(401).json({ error: 'Current PIN is incorrect' });
      return;
    }

    if (oldPin === newPin) {
      res.status(400).json({ error: 'New PIN must be different from current PIN' });
      return;
    }

    const pinHash = await bcrypt.hash(newPin, 10);
    await prisma.user.update({ where: { id: user.id }, data: { pinHash } });

    res.json({ message: 'PIN updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update PIN' });
  }
}
