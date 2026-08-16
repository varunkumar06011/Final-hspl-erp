import { Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken } from '../config/firebase';
import { prisma } from '../config/prisma';
import { AuthenticatedRequest } from '../middleware/auth';

export async function verifyToken(
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const { idToken } = req.body;

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

    if (user.firebaseUid !== decodedToken.uid) {
      await prisma.user.update({
        where: { id: user.id },
        data: { firebaseUid: decodedToken.uid },
      });
    }

    res.json({
      id: user.id,
      firebaseUid: decodedToken.uid,
      phone: user.phone,
      name: user.name,
      role: user.role,
      projectId: user.projectId,
      isActive: user.isActive,
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
    const { name, role, isActive, projectId } = req.body;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name }),
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
  });
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
    const { phone } = req.body;
    if (!phone) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { phone } });
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

    res.json({
      id: user.id,
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      name: user.name,
      role: user.role,
      projectId: user.projectId,
      isActive: user.isActive,
    });
  } catch (error) {
    res.status(500).json({ error: 'Dev login failed' });
  }
}
