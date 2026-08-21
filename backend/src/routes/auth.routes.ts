import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { Permission, verifyTokenSchema, registerTokenSchema, createUserSchema, updateUserSchema, listUsersSchema, pinLoginSchema, setPinSchema, checkPinSchema, changePinSchema } from '@hospital-erp/shared';
import { verifyToken, register, createUser, updateUser, listUsers, getMe, devLogin, pinLogin, setPin, checkPin, changePin } from '../controllers/auth.controller';

const router = Router();

// POST /api/auth/verify — no auth middleware (this IS the auth endpoint)
router.post('/verify', validateMiddleware(verifyTokenSchema), verifyToken);
router.post('/register', validateMiddleware(registerTokenSchema), register);

// POST /api/auth/dev-login — dev fallback (OTP 1234), blocked in production
router.post('/dev-login', devLogin);

// PIN-based auth (no OTP needed for returning users)
router.get('/check-pin', validateMiddleware(checkPinSchema), checkPin);
router.post('/pin-login', validateMiddleware(pinLoginSchema), pinLogin);
router.post('/set-pin', validateMiddleware(setPinSchema), setPin);

// GET /api/auth/me — get current user profile
router.get('/me', authMiddleware, getMe);

// POST /api/auth/change-pin — change PIN (requires auth)
router.post('/change-pin', authMiddleware, validateMiddleware(changePinSchema), changePin);

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
