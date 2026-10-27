import { defineConfig } from 'vitest/config';

const STRICT = { lines: 85, statements: 85, functions: 85, branches: 80 };

export default defineConfig({
  test: {
    globalSetup: ['test/setup/build-cli.ts'],
    testTimeout: 20000,
    projects: [
      { extends: true, test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
      {
        extends: true,
        // These launch Chrome + Lighthouse. Running them one file at a time keeps Lighthouse
        // timings stable and avoids CPU contention between concurrent browsers.
        test: {
          name: 'browser',
          include: ['test/e2e/**/*.test.ts', 'test/integration/**/*.test.ts'],
          fileParallelism: false,
        },
      },
    ],
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
