import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';
import { builtinChecks } from '../../src/checks/index.js';
import { DEFAULT_CATEGORY_WEIGHTS } from '../../src/core/config/schema.js';
import { validateRegistry } from '../../src/core/registry.js';

const repo = path.resolve(import.meta.dirname, '../..');

describe('built-in checks', () => {
  it('have unique, valid ids in known categories', () => {
    expect(() => validateRegistry(builtinChecks)).not.toThrow();
    for (const check of builtinChecks) {
      expect(check.id.startsWith(`${check.category}/`), check.id).toBe(true);
      expect(Object.keys(DEFAULT_CATEGORY_WEIGHTS)).toContain(check.category);
      expect(check.name.length, check.id).toBeGreaterThan(0);
      expect(check.description?.length, `${check.id} needs a description`).toBeGreaterThan(0);
      if (check.kind === 'runtime')
        expect(check.exclusive, `${check.id} must be exclusive`).toBe(true);
    }
  });

  it('each have a unit test that imports their module', async () => {
    const sources = await fg('src/checks/**/*.ts', { cwd: repo });
    const tests = await Promise.all(
      (await fg('test/unit/**/*.test.ts', { cwd: repo })).map((f) =>
        readFile(path.join(repo, f), 'utf8'),
      ),
    );
    for (const check of builtinChecks) {
      let module: string | undefined;
      for (const src of sources) {
        if ((await readFile(path.join(repo, src), 'utf8')).includes(`id: '${check.id}'`))
          module = src;
      }
      expect(module, `source of ${check.id}`).toBeDefined();
      const specifier = module!.replace(/^src\//, '/src/').replace(/\.ts$/, '.js');
      expect(
        tests.some((t) => t.includes(specifier)),
        `${check.id} (${module}) has no unit test importing ${specifier}`,
      ).toBe(true);
    }
  });
});
