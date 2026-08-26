/**
 * Stub for the `server-only` package under the bare-node test runner.
 *
 * `server-only` is a build-time guard: importing it from a client component makes
 * the bundler fail. It has no runtime behaviour, so a no-op is a faithful stand-in
 * when running tests outside a bundler.
 */
export {};
