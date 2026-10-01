import { Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken } from '../config/firebase';
import { prisma } from '../config/prisma';
import { UserRole } from '@hospital-erp/shared';
import jwt from 'jsonwebtoken';
import { isProjectUsable } from '../services/project.service';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    firebaseUid: string;
    phone: string;
    name: string;
    role: UserRole;
    projectId: string | null;
    isActive: boolean;
    termsAcceptedAt: Date | null;
  };
}

// Every authenticated path must populate req.user from a Prisma user row;
// this helper centralises the mapping + the legal-consent gate.
const TERMS_REQUIRED = {
  error: 'Please accept the Terms & Conditions and Privacy Policy to continue.',
  code: 'TERMS_NOT_ACCEPTED',
} as const;

function hasAcceptedTerms(user: { termsAcceptedAt: Date | null }): boolean {
  return !!user.termsAcceptedAt;
}

/**
 * The project a session works in. Tokens issued at login/switch carry a signed
 * `projectId` claim; it wins when that project still exists and isn't archived.
 * Older tokens (no claim) and archived projects fall back to the user's default.
 */
export async function activeProjectId(
  claimedProjectId: unknown,
  userProjectId: string | null
): Promise<string | null> {
  if (typeof claimedProjectId === 'string' && claimedProjectId) {
    if (await isProjectUsable(claimedProjectId)) return claimedProjectId;
  }
  return userProjectId;
}

export function requireProjectId(req: AuthenticatedRequest): string {
  const projectId = req.user?.projectId;
  if (!projectId) {
    throw new Error('User is not assigned to a project');
  }
  return projectId;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No authorization token provided' });
      return;
    }

    const idToken = authHeader.split('Bearer ')[1];

    // Dev token (local development only)
    if (idToken.startsWith('dev-token') && process.env.NODE_ENV !== 'production') {
      const devUserId = idToken.split(':')[1];
      const user = devUserId
        ? await prisma.user.findUnique({ where: { id: devUserId } })
        : await prisma.user.findFirst({ where: { isActive: true } });
      if (!user) {
        res.status(403).json({ error: 'No active users in system. Run seed first.' });
        return;
      }
      // Dev tokens bypass the terms gate — they never reach production.
      // `X-Project-Id` lets local tests act inside a specific project.
      req.user = {
        id: user.id,
        firebaseUid: user.firebaseUid,
        phone: user.phone,
        name: user.name,
        role: user.role as UserRole,
        projectId: await activeProjectId(req.headers['x-project-id'], user.projectId),
        isActive: user.isActive,
        termsAcceptedAt: user.termsAcceptedAt,
      };
      next();
      return;
    }

    // JWT token (from PIN-based login) — 3-part dot-separated token
    if (idToken.split('.').length === 3) {
      try {
        const decoded = jwt.verify(idToken, JWT_SECRET) as { userId: string; projectId?: string };
        const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
        if (!user) {
          res.status(403).json({ error: 'User not found' });
          return;
        }
        if (!user.isActive) {
          res.status(403).json({ error: 'Account is inactive. Contact administrator.' });
          return;
        }
        if (!hasAcceptedTerms(user)) {
          res.status(403).json(TERMS_REQUIRED);
          return;
        }
        req.user = {
          id: user.id,
          firebaseUid: user.firebaseUid,
          phone: user.phone,
          name: user.name,
          role: user.role as UserRole,
          projectId: await activeProjectId(decoded.projectId, user.projectId),
          isActive: user.isActive,
          termsAcceptedAt: user.termsAcceptedAt,
        };
        next();
        return;
      } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
    }

    // Firebase ID token (from OTP-based login)
    const decodedToken = await verifyFirebaseToken(idToken);

    const user = await prisma.user.findUnique({
      where: { firebaseUid: decodedToken.uid },
    });

    if (!user) {
      res.status(403).json({ error: 'Not authorized. User not found in system.' });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: 'Account is inactive. Contact administrator.' });
      return;
    }

    if (!hasAcceptedTerms(user)) {
      res.status(403).json(TERMS_REQUIRED);
      return;
    }

    req.user = {
      id: user.id,
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      name: user.name,
      role: user.role as UserRole,
      projectId: user.projectId,
      isActive: user.isActive,
      termsAcceptedAt: user.termsAcceptedAt,
    };

    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
