import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // `server-only` is a build-time guard with no runtime behaviour: its main
      // entry throws unless the bundler resolves the `react-server` condition,
      // which Vitest does not. Without this alias, the first test that reaches a
      // repository or service fails on import — 28 modules import it — and the
      // error names the package rather than the code under test.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.mjs', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    // Integration tests touch a real database and must not race each other.
    // Unit tests are pure and parallelise freely, so the cost of serialising
    // files is small and the determinism is worth it.
    fileParallelism: false,
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**', 'server/**', 'config/**', 'services/**'],
      exclude: ['**/*.d.ts', '**/index.ts', 'server/jobs/worker-entry.ts'],
    },
  },
});
