import { z } from 'zod';
import { UserRole, isAdminRole } from '../enums.js';

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

// Project the session should work in — chosen on the login page. Optional so old
// clients (and single-project installs) fall back to the user's default project.
const loginProjectId = z.string().uuid().optional();

export const registerTokenSchema = z.object({
  body: z.object({
    idToken: z.string().min(1, 'Firebase ID token is required'),
    name: z.string().trim().min(1, 'Name is required').max(100),
    projectId: loginProjectId,
    agreedToTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must agree to the Terms & Conditions and Privacy Policy' }),
    }),
  }),
});

// POST /auth/pin-login — login with phone + 4-digit PIN (no OTP needed)
export const pinLoginSchema = z.object({
  body: z.object({
    projectId: loginProjectId,
    phone: z.string().min(10, 'Phone number is required'),
    pin: z.string().length(4, 'PIN must be exactly 4 digits').regex(/^\d{4}$/, 'PIN must be 4 digits'),
    agreedToTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must agree to the Terms & Conditions and Privacy Policy' }),
    }),
  }),
});

// POST /auth/set-pin — set a 4-digit PIN after OTP verification
export const setPinSchema = z.object({
  body: z.object({
    projectId: loginProjectId,
    phone: z.string().min(10, 'Phone number is required'),
    pin: z.string().length(4, 'PIN must be exactly 4 digits').regex(/^\d{4}$/, 'PIN must be 4 digits'),
    agreedToTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must agree to the Terms & Conditions and Privacy Policy' }),
    }),
  }),
});

// POST /auth/change-pin — change PIN (requires auth, sends old + new PIN)
export const changePinSchema = z.object({
  body: z.object({
    oldPin: z.string().length(4, 'Old PIN must be exactly 4 digits').regex(/^\d{4}$/, 'PIN must be 4 digits'),
    newPin: z.string().length(4, 'New PIN must be exactly 4 digits').regex(/^\d{4}$/, 'PIN must be 4 digits'),
  }),
});

// POST /auth/switch-project — re-issue the session token for another project (requires auth)
export const switchProjectSchema = z.object({
  body: z.object({
    projectId: z.string().uuid('Valid project ID is required'),
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
  termsAcceptedAt: z.string().nullable().optional(),
  extraPermissions: z.array(z.string()).optional(),
});

// Custom role validator — accepts any UserRole enum value OR a dynamic admin role (ADMIN_3, ADMIN_4, ...)
const roleValidator = z
  .string()
  .refine(
    (val) => Object.values(UserRole).includes(val as UserRole) || isAdminRole(val),
    { message: 'Invalid role' }
  );

// POST /auth/users — create a new pre-provisioned user (Project Head only)
export const createUserSchema = z.object({
  body: z.object({
    phone: z
      .string()
      .min(10, 'Phone number must be at least 10 digits')
      .regex(/^\+?[0-9]+$/, 'Phone number must contain only digits and optional +'),
    name: z.string().min(1, 'Name is required').max(100),
    role: roleValidator,
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
    role: roleValidator.optional(),
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
// Projects (multi-project: separate hospitals/sites sharing the same users)
// ═══════════════════════════════════════════════════════════

const projectFields = {
  name: z.string().trim().min(1, 'Project name is required').max(150),
  description: z.string().trim().max(1000).nullable().optional(),
  totalBudget: z.coerce.number().min(0).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullable().optional(),
  status: z.enum(['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).optional(),
  officeAddress: z.string().trim().max(500).nullable().optional(),
  hospitalAddress: z.string().trim().max(500).nullable().optional(),
  gstNumber: z.string().trim().max(30).nullable().optional(),
  panNumber: z.string().trim().max(20).nullable().optional(),
};

const projectCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,5}$/, 'Code must be 2-6 letters/digits, starting with a letter');

// POST /projects
export const createProjectSchema = z.object({
  body: z.object({
    ...projectFields,
    // Prefix for document numbers (VGH-PO001).
    code: projectCode,
  }),
});

// PATCH /projects/:id  (the code can only change while no numbered document exists yet)
export const updateProjectSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    ...projectFields,
    name: projectFields.name.optional(),
    archived: z.boolean().optional(),
    code: projectCode.optional(),
  }),
});

// Entry of GET /projects/public (no auth — feeds the login-page project picker)
export const publicProjectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  // The logo itself is served by GET /settings/logo?projectId=<id>
  hasLogo: z.boolean(),
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
export type CreateProjectInput = z.infer<typeof createProjectSchema>['body'];
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>['body'];
export type PublicProject = z.infer<typeof publicProjectSchema>;
