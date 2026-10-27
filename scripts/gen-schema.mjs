// Post-build: regenerates the JSON Schemas (committed in schema/ and shipped in dist/schema/)
// and verifies the CLI entry is still executable with its shebang.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';

const { configJsonSchema, reportJsonSchema } = await import('../dist/internal/schemas.js');
const schemas = {
  'config.schema.json': { title: 'ng-health configuration', ...configJsonSchema() },
  'report.v1.json': { title: 'ng-health report (v1)', ...reportJsonSchema() },
};
await mkdir(new URL('../dist/schema/', import.meta.url), { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const json = `${JSON.stringify(schema, null, 2)}\n`;
  await writeFile(new URL(`../schema/${name}`, import.meta.url), json);
  await writeFile(new URL(`../dist/schema/${name}`, import.meta.url), json);
}

const cli = new URL('../dist/cli/index.js', import.meta.url);
if (!(await readFile(cli, 'utf8')).startsWith('#!/usr/bin/env node\n')) {
  throw new Error('dist/cli/index.js lost its shebang');
}
if (process.platform !== 'win32' && !((await stat(cli)).mode & 0o111)) {
  throw new Error('dist/cli/index.js is not executable');
}
