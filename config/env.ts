import 'server-only';
import { z } from 'zod';

/**
 * The single gateway to `process.env`.
 *
 * Two rules follow from this file existing:
 *
 *  1. No other module reads `process.env` directly. Grep for it — this file
 *     should be the only hit outside `tests/` and `tools/`.
 *  2. The schema is parsed once at import time, so a missing or malformed
 *     variable crashes the process at boot with a readable list of problems
 *     rather than throwing on the first request that happens to need it. A
 *     misconfigured deployment should fail loudly and immediately.
 *
 * `import 'server-only'` makes it a build error for any client component to pull
 * this in, which is the mechanism that keeps secrets out of the browser bundle.
 */

const booleanish = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no']))
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const optionalBooleanish = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? String(fallback) : value))
    .pipe(booleanish);

const intFromString = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : Number(value)))
    .pipe(z.number().int());

const floatFromString = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : Number(value)))
    .pipe(z.number());

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    NEXT_PUBLIC_APP_NAME: z.string().min(1).default('ConvoNexa'),

    /** 32 bytes minimum. Session tokens are random rather than signed, but this
     *  secret keys the encryption of stored provider tokens. */
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),

    DATABASE_URL: z.string().min(1),
    TEST_DATABASE_URL: z.string().optional(),

    AI_PROVIDER: z.enum(['openai', 'mock', 'gemini']).default('mock'),
    AI_API_KEY: z.string().optional(),
    AI_BASE_URL: z.string().url().optional(),
    AI_MODEL: z.string().default('gpt-4o-mini'),
    AI_MODEL_FAST: z.string().default('gpt-4o-mini'),
    AI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    AI_MAX_OUTPUT_TOKENS: intFromString(600).pipe(z.number().min(64).max(4096)),
    AI_CONTEXT_MESSAGE_WINDOW: intFromString(12).pipe(z.number().min(2).max(60)),
    AI_RETRIEVAL_MIN_SCORE: floatFromString(0.35).pipe(z.number().min(0).max(1)),

    MOCK_WHATSAPP: optionalBooleanish(true),
    WHATSAPP_API_VERSION: z.string().default('v21.0'),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    META_APP_SECRET: z.string().optional(),

    QUEUE_DRIVER: z.enum(['postgres', 'redis']).default('postgres'),
    REDIS_URL: z.string().optional(),

    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    STORAGE_ENDPOINT: z.string().optional(),
    STORAGE_REGION: z.string().default('auto'),
    STORAGE_ACCESS_KEY: z.string().optional(),
    STORAGE_SECRET_KEY: z.string().optional(),
    STORAGE_BUCKET: z.string().default('whatsapp-os'),
    STORAGE_LOCAL_DIR: z.string().default('.storage'),
    STORAGE_SIGNED_URL_TTL: intFromString(900).pipe(z.number().min(60).max(86_400)),
    STORAGE_MAX_UPLOAD_BYTES: intFromString(20_971_520).pipe(z.number().min(1024)),

    EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
    EMAIL_FROM: z.string().default('ConvoNexa <no-reply@example.com>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: intFromString(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
    PAYMENT_SECRET: z.string().optional(),
    PAYMENT_WEBHOOK_SECRET: z.string().optional(),
    PAYMENT_PUBLIC_KEY: z.string().optional(),

    TRIAL_DAYS: intFromString(14).pipe(z.number().min(0).max(365)),
    DEFAULT_PLAN: z.string().default('free'),

    ENABLE_CAMPAIGNS: optionalBooleanish(false),
    ENABLE_APPOINTMENTS: optionalBooleanish(false),
    ENABLE_PAYMENTS: optionalBooleanish(false),
    ENABLE_VOICE: optionalBooleanish(false),
    ENABLE_ADVANCED_AI: optionalBooleanish(false),
    ENABLE_PLATFORM_ADMIN: optionalBooleanish(true),

    SESSION_DURATION_DAYS: intFromString(30).pipe(z.number().min(1).max(365)),
    PASSWORD_SCRYPT_COST: intFromString(65_536),
    PASSWORD_SCRYPT_BLOCK_SIZE: intFromString(8),
    PASSWORD_SCRYPT_PARALLELISM: intFromString(1),
    RATE_LIMIT_ENABLED: optionalBooleanish(true),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
  })
  // Cross-field rules. Each one encodes a way a deployment can be
  // half-configured in a manner the type system alone cannot catch.
  .superRefine((value, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (value.AI_PROVIDER === 'openai' && !value.AI_API_KEY) {
      fail('AI_API_KEY', 'Required when AI_PROVIDER=openai. Use AI_PROVIDER=mock for offline work.');
    }

    if (value.AI_PROVIDER === 'gemini' && !value.AI_API_KEY) {
      fail('AI_API_KEY', 'Required when AI_PROVIDER=gemini. Use AI_PROVIDER=mock for offline work.');
    }

    const isBuildPhase =
      process.env.NEXT_PHASE === 'phase-production-build' ||
      process.env.npm_lifecycle_event === 'build';

    // The dangerous direction is a production deployment that silently answers
    // customers from a mock. Refuse to start rather than pretend.
    if (value.NODE_ENV === 'production' && !isBuildPhase && value.MOCK_WHATSAPP) {
      fail('MOCK_WHATSAPP', 'Must be false in production. A live deployment must not run the mock WhatsApp driver.');
    }

    if (!value.MOCK_WHATSAPP) {
      for (const key of [
        'WHATSAPP_ACCESS_TOKEN',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_BUSINESS_ACCOUNT_ID',
        'WHATSAPP_VERIFY_TOKEN',
        'META_APP_SECRET',
      ] as const) {
        if (!value[key]) fail(key, 'Required when MOCK_WHATSAPP=false.');
      }
    }

    if (value.QUEUE_DRIVER === 'redis' && !value.REDIS_URL) {
      fail('REDIS_URL', 'Required when QUEUE_DRIVER=redis.');
    }

    if (value.STORAGE_PROVIDER === 's3') {
      for (const key of ['STORAGE_ENDPOINT', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY'] as const) {
        if (!value[key]) fail(key, 'Required when STORAGE_PROVIDER=s3.');
      }
    }

    if (value.EMAIL_PROVIDER === 'smtp' && !value.SMTP_HOST) {
      fail('SMTP_HOST', 'Required when EMAIL_PROVIDER=smtp.');
    }

    if (value.PAYMENT_PROVIDER === 'stripe' && !value.PAYMENT_SECRET) {
      fail('PAYMENT_SECRET', 'Required when PAYMENT_PROVIDER=stripe.');
    }

    if (value.NODE_ENV === 'production' && !isBuildPhase && value.STORAGE_PROVIDER === 'local') {
      fail('STORAGE_PROVIDER', 'The local disk driver is for development only. Use s3 in production.');
    }
  });

export type Env = z.infer<typeof schema>;

function parseEnv(): Env {
  const result = schema.safeParse(process.env);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    // Thrown, not logged-and-continued. A process running on invalid config is
    // a process that will fail in a more confusing way later.
    throw new Error(
      `Invalid environment configuration.\n\n${problems}\n\n` +
        `Copy .env.example to .env and fill in the missing values. ` +
        `See docs/ENVIRONMENT.md for what each one does.\n`,
    );
  }

  return result.data;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/** True when no real WhatsApp credentials are in play. Surfaced in the UI. */
export const isWhatsAppMocked = env.MOCK_WHATSAPP;
export const isAIMocked = env.AI_PROVIDER === 'mock';
