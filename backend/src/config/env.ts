import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),

  // Firebase Admin
  FIREBASE_PROJECT_ID: z.string().min(1, 'FIREBASE_PROJECT_ID is required'),
  FIREBASE_CLIENT_EMAIL: z.string().min(1, 'FIREBASE_CLIENT_EMAIL is required'),
  FIREBASE_PRIVATE_KEY: z.string().min(1, 'FIREBASE_PRIVATE_KEY is required'),

  // Supabase (for prod storage)
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),

  // Frontend URL (for CORS)
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // Storage mode
  STORAGE_MODE: z.enum(['local', 'supabase']).default('local'),
  LOCAL_STORAGE_PATH: z.string().default('./uploads'),

  // OpenAI: AI assistant "Miko" and OCR document structuring (OCR uses the local parser if omitted)
  OPENAI_API_KEY: z.string().optional(),
  OCR_MODEL: z.string().default('gpt-5-mini'),

  // AI assistant (chat that reads/creates records as the logged-in user).
  // Uses OPENAI_API_KEY; switch off with ASSISTANT_ENABLED=false.
  ASSISTANT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  ASSISTANT_MODEL: z.string().default('gpt-5-mini'),
  ASSISTANT_REASONING_EFFORT: z.enum(['minimal', 'low', 'medium', 'high']).default('low'),
  // Max user messages per user per day (cost guard).
  ASSISTANT_DAILY_LIMIT: z.coerce.number().int().positive().default(150),
  // Base URL the server uses to call its own API. Default: http://127.0.0.1:$PORT
  ASSISTANT_INTERNAL_URL: z.string().optional(),

  // Camera (RTSP for gate pass video clips)
  CAMERA_RTSP_URL: z.string().optional(),
  CAMERA_CLIP_DURATION: z.coerce.number().default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
