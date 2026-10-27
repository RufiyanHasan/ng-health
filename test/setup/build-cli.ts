import { rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'tsup';
import type { TestProject } from 'vitest/node';
import pkg from '../../package.json' with { type: 'json' };

declare module 'vitest' {
  export interface ProvidedContext {
    /** Absolute path of a freshly built CLI entry point. */
    cliPath: string;
  }
}

/**
 * Builds the real CLI binary before the integration tests, so they exercise exactly what
 * `npx fe-health` runs, even on a clean clone where `npm test` runs before `npm run build`.
 * Output goes under node_modules so dependencies resolve normally.
 */
export default async function setup(project: TestProject) {
  const root = path.resolve(import.meta.dirname, '../..');
  const outDir = path.join(root, 'node_modules/.cache/fe-health-test-cli');
  await build({
    config: false,
    entry: { 'cli/index': path.join(root, 'src/cli/index.ts') },
    outDir,
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    external: [
      ...Object.keys(pkg.dependencies),
      ...Object.keys(pkg.optionalDependencies),
      /^lighthouse\//,
    ],
    splitting: false,
    sourcemap: false,
    dts: false,
    clean: true,
    silent: true,
  });
  project.provide('cliPath', path.join(outDir, 'cli/index.js'));
  return () => rm(outDir, { recursive: true, force: true });
}
