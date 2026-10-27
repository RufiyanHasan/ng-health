import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../../src/cli/program.js';
import { builtinChecks } from '../../src/checks/index.js';
import { audit } from '../../src/index.js';
import { ConfigSchema } from '../../src/core/config/schema.js';
import { pathExists } from '../../src/core/fs.js';
import { silentLogger } from '../../src/core/logger.js';
import { makeTempProject } from '../helpers/tmp.js';

const repo = path.resolve(import.meta.dirname, '../..');
const readme = await readFile(path.join(repo, 'README.md'), 'utf8');
const pluginExample =
  /<!-- plugin-example:start -->\s*```js\n([\s\S]*?)```/.exec(readme)?.[1] ?? '';

describe('README', () => {
  it('documents every CLI flag', () => {
    const program = buildProgram(silentLogger, () => {});
    const flags = program.commands.flatMap((c) => c.options.map((o) => o.long ?? ''));
    expect(flags.length).toBeGreaterThan(10);
    for (const flag of flags) {
      expect(readme, `README is missing ${flag}`).toMatch(new RegExp(`[\`, ]${flag}[\` ,<]`));
    }
  });

  it('documents every config key and built-in check', () => {
    const keys = Object.keys(ConfigSchema.shape).filter((k) => k !== '$schema');
    const nested = ['output', 'runtime'].flatMap((k) =>
      Object.keys(
        (
          ConfigSchema.shape[k as 'output' | 'runtime'] as unknown as {
            unwrap(): { shape: object };
          }
        ).unwrap().shape,
      ).map((sub) => `${k}.${sub}`),
    );
    for (const key of [...keys.filter((k) => k !== 'output' && k !== 'runtime'), ...nested]) {
      expect(readme, `README config table is missing ${key}`).toContain(`\`${key}\``);
    }
    for (const check of builtinChecks)
      expect(readme, `README is missing ${check.id}`).toContain(`\`${check.id}\``);
  });

  it('documents every public library export and config file type', async () => {
    const api = await import('../../src/index.js');
    for (const name of Object.keys(api)) {
      if (name === 'CheckSkipped') continue; // internal signal class behind skipCheck()
      expect(readme, `README "Use as a library" is missing ${name}`).toContain(name);
    }
    for (const ext of ['.ts', '.mts', '.js', '.mjs', '.cjs', '.json']) {
      expect(readme).toContain(`\`${ext}\``);
    }
  });

  it('has only working relative links in the markdown docs', async () => {
    for (const doc of [
      'README.md',
      'CONTRIBUTING.md',
      'docs/login-script.md',
      'test/fixtures/README.md',
    ]) {
      const text = await readFile(path.join(repo, doc), 'utf8');
      for (const [, target] of text.matchAll(/\]\(((?!https?:|#|mailto:)[^)#\s]+)/g)) {
        expect(
          await pathExists(path.join(repo, path.dirname(doc), target!)),
          `${doc} links to missing ${target}`,
        ).toBe(true);
      }
    }
  });

  it('plugin example is kept in sync with examples/custom-check/checks/todo-comments.mjs', async () => {
    expect(pluginExample).toContain("id: 'custom/todo-comments'");
    expect(
      await readFile(path.join(repo, 'examples/custom-check/checks/todo-comments.mjs'), 'utf8'),
    ).toBe(pluginExample);
  });

  it('plugin example works exactly as documented', async () => {
    // Same code as the README, importing ng-health from source instead of the published package.
    const code = pluginExample.replace(
      "from 'ng-health'",
      `from '${path.join(repo, 'src/index.ts')}'`,
    );
    const dir = await makeTempProject({
      'package.json': { dependencies: { '@angular/core': '^22.0.0' } },
      'checks/todo-comments.mjs': code,
      'ng-health.config.json': {
        plugins: ['./checks/todo-comments.mjs'],
        checks: { 'custom/todo-comments': { options: { max: 5 } } },
        weights: { custom: 5 },
      },
      'src/app.ts':
        'export const a = 1; // TODO: remove\n// FIXME later\nconst todo = "TODO in a string";\n',
    });
    const report = await audit(dir, { only: ['custom'] });
    // Built-in checks are reported as skipped ("not selected by --only").
    expect(report.checks.filter((c) => c.status !== 'skipped')).toEqual([
      expect.objectContaining({ id: 'custom/todo-comments', status: 'completed', score: 100 }),
    ]);
    expect(report.findings.map((f) => [f.file, f.line, f.message])).toEqual([
      ['src/app.ts', 1, 'Unresolved comment: export const a = 1; // TODO: remove'],
      ['src/app.ts', 2, 'Unresolved comment: // FIXME later'],
    ]);
    expect(report.categories).toEqual([expect.objectContaining({ id: 'custom', weight: 5 })]);
  });
});
