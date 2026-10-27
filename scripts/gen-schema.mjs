// Regenerates schema/config.schema.json from the zod config schema in the built package.
import { writeFile } from 'node:fs/promises';

const { configJsonSchema } = await import('../dist/index.js');
const schema = { title: 'fe-health configuration', ...configJsonSchema() };
await writeFile(
  new URL('../schema/config.schema.json', import.meta.url),
  `${JSON.stringify(schema, null, 2)}\n`,
);
