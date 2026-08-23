import { z } from 'zod';
import { UserRole } from '../enums.js';

// ═══════════════════════════════════════════════════════════
// Auth schemas — the contract between frontend and backend
// ═══════════════════════════════════════════════════════════

// POST /auth/verify — frontend sends Firebase ID token + optional name (set on first login)
export const verifyTokenSchema = z.object({
  body: z.object({
    idToken: z.string().min(1, 'Firebase ID token is required'),
    name: z.string().min(1).max(100).optional(),
  }),
});

export const registerTokenSchema = z.object({
  body: z.object({
    idToken: z.string().min(1, 'Firebase ID token is required'),
    name: z.string().trim().min(1, 'Name is required').max(100),
  }),
});

// POST /auth/pin-login — login with phone + 4-digit PIN (no OTP needed)
export const pinLoginSchema = z.object({
  body: z.object({
    phone: z.string().min(10, 'Phone number is required'),
    pin: z.string().length(4, 'PIN must be exactly 4 digits').regex(/^\d{4}$/, 'PIN must be 4 digits'),
  }),
});

// POST /auth/set-pin — set a 4-digit PIN after OTP verification
export const setPinSchema = z.object({
  body: z.object({
    phone: z.string().min(10, 'Phone number is required'),
    pin: z.string().length(4, 'PIN must be exactly 4 digits').regex(/^\d{4}$/, 'PIN must be 4 digits'),
  }),
});

// POST /auth/change-pin — change PIN (requires auth, sends old + new PIN)
export const changePinSchema = z.object({
  body: z.object({
    oldPin: z.string().length(4, 'Old PIN must be exactly 4 digits').regex(/^\d{4}$/, 'PIN must be 4 digits'),
    newPin: z.string().length(4, 'New PIN must be exactly 4 digits').regex(/^\d{4}$/, 'PIN must be 4 digits'),
  }),
});

// GET /auth/check-pin — check if a phone number has a PIN set (for login flow)
export const checkPinSchema = z.object({
  query: z.object({
    phone: z.string().min(10, 'Phone number is required'),
  }),
});

// Response from /auth/verify
export const userResponseSchema = z.object({
  id: z.string().uuid(),
  firebaseUid: z.string(),
  phone: z.string(),
  name: z.string(),
  role: z.nativeEnum(UserRole),
  projectId: z.string().uuid().nullable(),
  isActive: z.boolean(),
});

// POST /auth/users — create a new pre-provisioned user (Project Head only)
export const createUserSchema = z.object({
  body: z.object({
    phone: z
      .string()
      .min(10, 'Phone number must be at least 10 digits')
      .regex(/^\+?[0-9]+$/, 'Phone number must contain only digits and optional +'),
    name: z.string().min(1, 'Name is required').max(100),
    role: z.nativeEnum(UserRole),
    projectId: z.string().uuid('Valid project ID is required'),
  }),
});

// PATCH /auth/users/:id — update user role or active status
export const updateUserSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    phone: z
      .string()
      .min(10, 'Phone number must be at least 10 digits')
      .regex(/^\+?[0-9]+$/, 'Phone number must contain only digits and optional +')
      .optional(),
    role: z.nativeEnum(UserRole).optional(),
    isActive: z.boolean().optional(),
    projectId: z.string().uuid().optional(),
  }),
});

// GET /auth/users — list users (with pagination)
export const listUsersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

// ═══════════════════════════════════════════════════════════
// Type exports — derived from Zod schemas via z.infer
// ═══════════════════════════════════════════════════════════

export type UserResponse = z.infer<typeof userResponseSchema>;
export type RegisterTokenInput = z.infer<typeof registerTokenSchema>['body'];
export type PinLoginInput = z.infer<typeof pinLoginSchema>['body'];
export type SetPinInput = z.infer<typeof setPinSchema>['body'];
export type CreateUserInput = z.infer<typeof createUserSchema>['body'];
export type UpdateUserInput = z.infer<typeof updateUserSchema>['body'];
