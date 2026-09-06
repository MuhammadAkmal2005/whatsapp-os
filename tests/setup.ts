/**
 * Vitest setup file, referenced by `setupFiles` in `vitest.config.ts`.
 *
 * Two jobs, and the second one is a safety control rather than a convenience.
 *
 * First, it gives the environment the values `config/env.ts` insists on. That
 * module parses `process.env` against a Zod schema at *import* time and throws on
 * anything missing, so a test that transitively imports a service or repository
 * would fail during module loading — before a single assertion runs, with an error
 * about configuration rather than about the code under test. Setup files execute
 * before the test file's imports are evaluated, which is why this works here and
 * would not work inside a `beforeAll`.
 *
 * Second, it forces `DATABASE_URL` to the *test* database. An integration test
 * truncates tables. If `DATABASE_URL` were still pointing at the development
 * database when someone ran `npm test`, the suite would quietly delete the data
 * they were looking at a minute earlier. Redirecting here means that mistake is
 * not available to make, rather than being warned about in a document.
 */

/** Fictional. Long enough for the 32-character minimum `AUTH_SECRET` enforces. */
const TEST_AUTH_SECRET = 'test-only-auth-secret-do-not-deploy-0000';

/**
 * The throwaway container on 5433 from `docker-compose.yml`, which uses tmpfs and
 * so has nothing worth preserving. Overridden by `TEST_DATABASE_URL` in CI.
 */
const FALLBACK_TEST_DATABASE_URL =
  'postgresql://whatsapp_os:whatsapp_os@localhost:5433/whatsapp_os_test';

/**
 * Values a test run needs but should never inherit from a developer's `.env`.
 * Providers stay mocked so no test can reach a real API, send a real WhatsApp
 * message, or spend money on a model call.
 */
const forced: Record<string, string> = {
  NODE_ENV: 'test',
  AUTH_SECRET: process.env.AUTH_SECRET ?? TEST_AUTH_SECRET,
  DATABASE_URL: (process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL.trim().length > 0)
    ? process.env.TEST_DATABASE_URL
    : FALLBACK_TEST_DATABASE_URL,
  AI_PROVIDER: 'mock',
  MOCK_WHATSAPP: 'true',
  PAYMENT_PROVIDER: 'mock',
  EMAIL_PROVIDER: 'console',
  STORAGE_PROVIDER: 'local',
  QUEUE_DRIVER: 'postgres',
  WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  META_APP_ID: '000000000000000',
  META_APP_SECRET: 'test-meta-app-secret-32-chars-long',
  META_LOGIN_CONFIG_ID: '000000000000001',
  AI_API_KEY: 'test-only-ai-api-key-do-not-deploy',
  // Deterministic assertions: a limiter that is disabled in someone's .env would
  // turn the rate-limit tests into silent no-ops that still report as passing.
  RATE_LIMIT_ENABLED: 'true',
  LOG_LEVEL: 'error',
  LOG_FORMAT: 'json',
};

for (const [key, value] of Object.entries(forced)) {
  process.env[key] = value;
}

/**
 * Deliberately *not* lowering `PASSWORD_SCRYPT_COST` here. `hashPassword` takes its
 * default from a module constant in `server/auth/password.ts` rather than from the
 * environment, and `tests/unit/password.test.ts` asserts a default hash is prefixed
 * `scrypt$65536$8$1$`. Overriding the variable would not speed that up and would
 * make the suite look configurable in a way it is not; the password tests already
 * pass weak parameters explicitly where they need speed.
 */
