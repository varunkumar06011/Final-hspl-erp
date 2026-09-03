import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { Permission, verifyTokenSchema, registerTokenSchema, createUserSchema, updateUserSchema, listUsersSchema, pinLoginSchema, setPinSchema, checkPinSchema, changePinSchema } from '@hospital-erp/shared';
import { verifyToken, register, createUser, updateUser, listUsers, getMe, devLogin, pinLogin, setPin, checkPin, changePin } from '../controllers/auth.controller';

const router = Router();

// Stricter rate limit on authentication endpoints to prevent brute-force
// OTP/PIN guessing. 10 attempts per 15 minutes per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

// POST /api/auth/verify — no auth middleware (this IS the auth endpoint)
router.post('/verify', authLimiter, validateMiddleware(verifyTokenSchema), verifyToken);
router.post('/register', authLimiter, validateMiddleware(registerTokenSchema), register);

// POST /api/auth/dev-login — dev fallback (OTP 1234), blocked in production
router.post('/dev-login', authLimiter, devLogin);

// PIN-based auth (no OTP needed for returning users) — also rate-limited.
router.get('/check-pin', authLimiter, validateMiddleware(checkPinSchema), checkPin);
router.post('/pin-login', authLimiter, validateMiddleware(pinLoginSchema), pinLogin);
router.post('/set-pin', authLimiter, validateMiddleware(setPinSchema), setPin);

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
