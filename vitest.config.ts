import { defineConfig } from 'vitest/config';

const STRICT = { lines: 85, statements: 85, functions: 85, branches: 80 };

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/setup/build-cli.ts'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/index.ts'],
      reporter: ['text', 'html', 'json-summary'],
      // Core and checks must stay well covered (brief: ≥80%). src/runtime is mostly exercised by
      // the real-Chrome e2e suite, which is skipped on machines without Chrome.
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 75,
        'src/core/**/*.ts': STRICT,
        'src/checks/**/*.ts': STRICT,
      },
    },
  },
});
