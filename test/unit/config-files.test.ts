import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config/loader.js';
import { audit, CheckError, ConfigError } from '../../src/index.js';
import { angularApp, makeTempProject } from '../helpers/tmp.js';

const repo = path.resolve(import.meta.dirname, '../..');
const fromSource = (code: string) =>
  // A file:// URL is the portable ESM specifier; a raw Windows path would contain backslash escapes.
  code.replaceAll(
    "from 'ng-health'",
    `from '${pathToFileURL(path.join(repo, 'src/index.ts')).href}'`,
  );

describe('config files', () => {
  it.each([
    [
      'ng-health.config.ts',
      `const offline: boolean = true;\nexport default { offline, skip: ['bundle'] } satisfies Record<string, unknown>;`,
    ],
    ['ng-health.config.mts', `export default { offline: true, skip: ['bundle'] };`],
    ['ng-health.config.js', `export default { offline: true, skip: ['bundle'] };`],
    ['ng-health.config.mjs', `export default async () => ({ offline: true, skip: ['bundle'] });`],
    ['ng-health.config.cjs', `module.exports = { offline: true, skip: ['bundle'] };`],
    ['ng-health.config.json', `{ "offline": true, "skip": ["bundle"] }`],
  ])('loads %s', async (name, code) => {
    const dir = await makeTempProject({ [name]: code });
    const { config, file } = await loadConfig(dir);
    expect(file).toBe(path.join(dir, name));
    expect(config).toMatchObject({ offline: true, skip: ['bundle'] });
  });

  it('supports defineConfig in a TypeScript config', async () => {
    const dir = await makeTempProject({
      'ng-health.config.ts': fromSource(
        `import { defineConfig } from 'ng-health';\nexport default defineConfig({ thresholds: { minOverallScore: 42 } });`,
      ),
    });
    expect((await loadConfig(dir)).config.thresholds).toEqual({ minOverallScore: 42 });
  });

  it('loads an explicit config path of any supported type', async () => {
    const dir = await makeTempProject({ 'configs/strict.ts': 'export default { offline: true };' });
    expect((await loadConfig(dir, path.join(dir, 'configs/strict.ts'))).config.offline).toBe(true);
    await expect(loadConfig(dir, path.join(dir, 'nope.ts'))).rejects.toThrow(
      /Config file not found/,
    );
  });

  it('rejects ambiguous, broken and invalid configs with ConfigError', async () => {
    const two = await makeTempProject({
      'ng-health.config.ts': 'export default {};',
      'ng-health.config.json': '{}',
    });
    await expect(loadConfig(two)).rejects.toThrow(
      expect.objectContaining({
        name: 'ConfigError',
        message: 'Found several config files: ng-health.config.ts, ng-health.config.json',
      }),
    );
    const broken = await makeTempProject({ 'ng-health.config.ts': 'export default { offline: ' });
    await expect(loadConfig(broken)).rejects.toThrow(/Could not load ng-health.config.ts/);
    const invalid = await makeTempProject({
      'ng-health.config.js': 'export default { thresholds: { minOverallScore: "high" } };',
    });
    await expect(loadConfig(invalid)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('plugins', () => {
  it('loads TypeScript plugins and `export const checks`', async () => {
    const dir = await makeTempProject({
      ...angularApp(),
      'checks/a.ts': `const run = (): { findings: never[] } => ({ findings: [] });\nexport const checks = [{ id: 'custom/a', name: 'A', category: 'custom', run }];`,
      'ng-health.config.json': { plugins: ['./checks/a.ts'], offline: true },
    });
    const result = await audit(dir, { only: ['custom'] });
    expect(result.checks.filter((c) => c.status === 'completed').map((c) => c.id)).toEqual([
      'custom/a',
    ]);
  });

  it('names exactly what is wrong with an invalid plugin', async () => {
    const dir = await makeTempProject({
      ...angularApp(),
      'one.mjs': `export default { id: 'custom/one', name: 'One', run: 'nope', timeoutMs: '5' };`,
      'many.mjs': `export default [{ id: 'custom/ok', name: 'Ok', category: 'custom', run() {} }, 42];`,
      'none.mjs': `export const something = 1;`,
    });
    const load = (plugin: string) =>
      audit(dir, { config: { plugins: [`./${plugin}`] } }).catch((e: unknown) => e);

    const one = await load('one.mjs');
    expect(one).toBeInstanceOf(CheckError);
    expect((one as Error).message).toBe(
      'Plugin "./one.mjs" does not export a valid check: its check: "category" must be a non-empty string; "run" must be a function (ctx) => { findings, score? }; "timeoutMs" must be a number',
    );
    expect(((await load('many.mjs')) as Error).message).toContain(
      'check #2: expected a check object, got number',
    );
    expect(((await load('none.mjs')) as Error).message).toBe(
      'Plugin "./none.mjs" has no default export or "checks" export',
    );
    expect(((await load('missing.mjs')) as Error).message).toMatch(
      /^Could not load plugin "\.\/missing\.mjs"/,
    );
  });
});

describe('examples/custom-check', () => {
  it('works as documented: TS config + JS and TS plugins', async () => {
    const example = path.join(repo, 'examples/custom-check');
    const dir = await makeTempProject({
      ...angularApp(),
      'src/app.ts': 'export const a = 1; // TODO: remove\nconsole.log("debug");\n',
    });
    await cp(path.join(example, 'checks'), path.join(dir, 'checks'), { recursive: true });
    for (const file of [
      'ng-health.config.ts',
      'checks/no-console.ts',
      'checks/todo-comments.mjs',
    ]) {
      const source =
        file === 'ng-health.config.ts' ? path.join(example, file) : path.join(dir, file);
      await writeFile(path.join(dir, file), fromSource(await readFile(source, 'utf8')));
    }
    const result = await audit(dir, { only: ['custom'], offline: true });
    expect(result.findings.map((f) => [f.checkId, f.line])).toEqual([
      ['custom/todo-comments', 1],
      ['custom/no-console', 2],
    ]);
    expect(result.categories).toEqual([expect.objectContaining({ id: 'custom', weight: 5 })]);
  });
});
