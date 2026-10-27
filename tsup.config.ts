import { defineConfig } from 'tsup';
import pkg from './package.json' with { type: 'json' };

// Never bundle runtime dependencies; optional ones (browser tooling) are loaded lazily.
const external = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.optionalDependencies)];

export default defineConfig({
  entry: { index: 'src/index.ts', 'cli/index': 'src/cli/index.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  external: [...external, /^lighthouse\//],
  dts: { entry: { index: 'src/index.ts' } },
  sourcemap: true,
  clean: true,
  splitting: true,
  shims: false,
});
