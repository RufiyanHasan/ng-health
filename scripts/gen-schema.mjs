// Regenerates the published JSON Schemas from the zod schemas in the built package.
import { writeFile } from 'node:fs/promises';

const { configJsonSchema, reportJsonSchema } = await import('../dist/index.js');
const write = (name, schema) =>
  writeFile(new URL(`../schema/${name}`, import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);

await write('config.schema.json', { title: 'fe-health configuration', ...configJsonSchema() });
await write('report.v1.json', { title: 'fe-health report (v1)', ...reportJsonSchema() });
