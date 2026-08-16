import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { Permission, verifyTokenSchema, createUserSchema, updateUserSchema, listUsersSchema } from '@hospital-erp/shared';
import { verifyToken, createUser, updateUser, listUsers, getMe, devLogin } from '../controllers/auth.controller';

const router = Router();

// POST /api/auth/verify — no auth middleware (this IS the auth endpoint)
router.post('/verify', validateMiddleware(verifyTokenSchema), verifyToken);

// POST /api/auth/dev-login — dev fallback (OTP 1234), blocked in production
router.post('/dev-login', devLogin);

// GET /api/auth/me — get current user profile
router.get('/me', authMiddleware, getMe);

// GET /api/auth/users — list users (Project Head only)
router.get(
  '/users',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_USERS),
  validateMiddleware(listUsersSchema),
  listUsers
);

// POST /api/auth/users — create pre-provisioned user (Project Head only)
router.post(
  '/users',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_USERS),
  validateMiddleware(createUserSchema),
  createUser
);

// PATCH /api/auth/users/:id — update user (Project Head only)
router.patch(
  '/users/:id',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_USERS),
  validateMiddleware(updateUserSchema),
  updateUser
);

export default router;
