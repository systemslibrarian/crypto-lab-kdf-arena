import { defineConfig } from 'vitest/config';

/**
 * Unit tests only. The Playwright accessibility suite lives in e2e/ and is run
 * by `npm run test:a11y`; it must NOT be collected by vitest (Playwright's
 * `test` API is incompatible with vitest's runner).
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
