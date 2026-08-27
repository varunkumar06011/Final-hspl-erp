import { Response, NextFunction } from 'express';
import { verifyFirebaseToken } from '../config/firebase';
import { prisma } from '../config/prisma';
import { UserRole } from '@hospital-erp/shared';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from './auth';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

/**
 * Optional auth middleware — populates req.user if a valid token is present,
 * but does NOT reject the request if no token or invalid token.
 * Used for public endpoints like asset QR scanning.
 */
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const idToken = authHeader.split('Bearer ')[1];

    // Dev token
    if (idToken.startsWith('dev-token') && process.env.NODE_ENV !== 'production') {
      const devUserId = idToken.split(':')[1];
      const user = devUserId
        ? await prisma.user.findUnique({ where: { id: devUserId } })
        : await prisma.user.findFirst({ where: { isActive: true } });
      if (user) {
        req.user = {
          id: user.id,
          firebaseUid: user.firebaseUid,
          phone: user.phone,
          name: user.name,
          role: user.role as UserRole,
          projectId: user.projectId,
          isActive: user.isActive,
        };
      }
      next();
      return;
    }

    // JWT token
    if (idToken.split('.').length === 3) {
      try {
        const decoded = jwt.verify(idToken, JWT_SECRET) as { userId: string };
        const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
        if (user && user.isActive) {
          req.user = {
            id: user.id,
            firebaseUid: user.firebaseUid,
            phone: user.phone,
            name: user.name,
            role: user.role as UserRole,
            projectId: user.projectId,
            isActive: user.isActive,
          };
        }
        next();
        return;
      } catch {
        next();
        return;
      }
    }

    // Firebase token
    try {
      const decodedToken = await verifyFirebaseToken(idToken);
      const user = await prisma.user.findUnique({ where: { firebaseUid: decodedToken.uid } });
      if (user && user.isActive) {
        req.user = {
          id: user.id,
          firebaseUid: user.firebaseUid,
          phone: user.phone,
          name: user.name,
          role: user.role as UserRole,
          projectId: user.projectId,
          isActive: user.isActive,
        };
      }
    } catch {
      // Invalid token — just continue without user
    }
    next();
  } catch {
    next();
  }
}
