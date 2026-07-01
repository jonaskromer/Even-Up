import { z } from 'zod';

// Docker Compose passes unset variables as empty strings rather than omitting them,
// so optional vars must treat "" the same as undefined to avoid spurious validation errors.
const optionalString = () => z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
const optionalUrl = () =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional());

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  // Public anon key — safe to embed, required for server-side Supabase auth calls.
  SUPABASE_ANON_KEY: z.string(),
  // Only needed if the Supabase project signs JWTs with the legacy HS256 (shared
  // secret) scheme rather than the default asymmetric (JWKS-based) scheme.
  SUPABASE_JWT_SECRET: optionalString(),
  PORT: z.coerce.number().default(4000),
  RESEND_API_KEY: optionalString(),
  EMAIL_FROM: optionalString(),
  APP_URL: optionalUrl(),
  CORS_ORIGIN: optionalString(),
  // Receipt-upload AI parsing (Gemini). Optional — the feature is hidden client-side
  // and the parse endpoint 404s when unset, same graceful-degrade pattern as Resend.
  GEMINI_API_KEY: optionalString(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
});

export const env = envSchema.parse(process.env);
