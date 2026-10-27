import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { Node, Project } from 'ts-morph';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as api from '../../src/index.js';
import {
  audit,
  CheckError,
  ConfigError,
  defineCheck,
  defineConfig,
  generateReport,
  NgHealthError,
  ProjectError,
  type AuditOptions,
  type AuditResult,
  type Config,
} from '../../src/index.js';
import { fixture } from '../helpers/fixtures.js';
import { angularApp, makeTempProject } from '../helpers/tmp.js';

const fast: AuditOptions = { skip: ['performance', 'accessibility'] };

afterEach(() => vi.restoreAllMocks());

describe('public API surface', () => {
  it('exports exactly the documented values', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'CheckError',
        'CheckSkipped',
        'ConfigError',
        'NgHealthError',
        'ProjectError',
        'REPORT_SCHEMA_VERSION',
        'audit',
        'defineCheck',
        'defineConfig',
        'generateReport',
        'skipCheck',
      ].sort(),
    );
  });

  it('is fully typed', () => {
    expectTypeOf(audit).parameters.toEqualTypeOf<[path: string, options?: AuditOptions]>();
    expectTypeOf(audit).returns.resolves.toEqualTypeOf<AuditResult>();
    expectTypeOf(generateReport).parameter(1).toEqualTypeOf<'html' | 'json' | 'md'>();
    expectTypeOf(defineConfig).parameter(0).toEqualTypeOf<Config>();
  });
});

describe('audit()', () => {
  it('returns a result without printing, writing files or exiting', async () => {
    const out = vi.spyOn(process.stdout, 'write');
    const err = vi.spyOn(process.stderr, 'write');
    const consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m),
    );
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const before = await readdir(process.cwd());

    const result = await audit(fixture('unhealthy'), fast);

    expect(result.passed).toBe(false);
    expect(result.score.overall).toBeLessThan(50);
    expect(result.findings.length).toBeGreaterThan(20);
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(await readdir(process.cwd())).toEqual(before);
  });

  it('accepts an inline config, a baseline result and reports progress', async () => {
    const events: string[] = [];
    const baseline = await audit(fixture('healthy'), fast);
    const result = await audit(fixture('unhealthy'), {
      ...fast,
      config: defineConfig({ offline: true, thresholds: { minOverallScore: 10 } }),
      baseline,
      onProgress: (e) => events.push(e.type === 'check-finished' ? 'check' : e.type),
    });
    expect(result.passed).toBe(true); // inline config replaced the fixture's stricter thresholds
    expect(result.trend?.overall.delta).toBeLessThan(0);
    expect(events[0]).toBe('project-detected');
    expect(events[1]).toBe('checks-started');
    expect(events.filter((e) => e === 'check')).toHaveLength(17); // every selected check, including self-skipped ones
  });

  it('throws typed errors', async () => {
    const notAngular = await makeTempProject({ 'package.json': {} });
    await expect(audit(notAngular)).rejects.toBeInstanceOf(ProjectError);
    await expect(audit('/definitely/missing')).rejects.toMatchObject({ code: 'ERR_PROJECT' });

    const app = await makeTempProject({
      ...angularApp(),
      'bad-check.mjs': 'export default { id: "x" }',
    });
    await expect(
      audit(app, { config: { thresholds: { minOverallScore: 500 } } }),
    ).rejects.toBeInstanceOf(ConfigError);
    await expect(audit(app, { routes: ['nope'] })).rejects.toBeInstanceOf(ConfigError);
    await expect(audit(app, { baseline: `${app}/missing.json` })).rejects.toBeInstanceOf(
      ConfigError,
    );
    const pluginError = await audit(app, { config: { plugins: ['./bad-check.mjs'] } }).catch(
      (e: unknown) => e,
    );
    expect(pluginError).toBeInstanceOf(CheckError);
    expect(pluginError).toBeInstanceOf(NgHealthError);
    expect(pluginError).toMatchObject({ name: 'CheckError', code: 'ERR_CHECK' });
  });

  it('can be cancelled with an AbortSignal', async () => {
    const aborted = new AbortController();
    aborted.abort(new Error('stop'));
    await expect(audit(fixture('healthy'), { signal: aborted.signal })).rejects.toThrow('stop');

    const app = await makeTempProject({
      ...angularApp(),
      'slow.mjs': `export default { id: 'custom/slow', name: 'Slow', category: 'custom',
        run: (ctx) => new Promise((r) => ctx.signal.addEventListener('abort', () => r({ findings: [] }))) };`,
    });
    const controller = new AbortController();
    const started = Date.now();
    const pending = audit(app, {
      only: ['custom'],
      config: { plugins: ['./slow.mjs'] },
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error('cancelled by test')), 100);
    await expect(pending).rejects.toThrow('cancelled by test');
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('generateReport()', () => {
  it('renders html, json and markdown from a result', async () => {
    const result = await audit(fixture('healthy'), fast);
    expect(generateReport(result, 'html')).toMatch(/^<!doctype html>/);
    expect(JSON.parse(generateReport(result, 'json'))).toMatchObject({
      schemaVersion: '1.0',
      passed: true,
    });
    expect(generateReport(result, 'md')).toContain('<!-- ng-health-report -->');
    expect(() => generateReport(result, 'pdf' as never)).toThrow(TypeError);
  });
});

describe('define helpers', () => {
  it('return their argument unchanged', () => {
    const config = { skip: ['bundle'] };
    expect(defineConfig(config)).toBe(config);
    const check = defineCheck({
      id: 'x/y',
      name: 'Y',
      category: 'x',
      run: () => ({ findings: [] }),
    });
    expect(check.id).toBe('x/y');
  });
});

describe('library code stays silent', () => {
  it('never prints or exits outside src/cli (the logger/spinner are only created by the CLI)', async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const files = await fg('src/**/*.ts', {
      cwd: root,
      ignore: ['src/cli/**', 'src/core/logger.ts', 'src/core/progress.ts'],
    });
    const offenders: string[] = [];
    for (const file of files) {
      const code = (await readFile(path.join(root, file), 'utf8'))
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
      if (
        /console\.(log|info|warn|error|debug)\(|process\.exit\(|process\.std(out|err)/.test(code)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('documentation', () => {
  it('every public export has a TSDoc comment', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const project = new Project({
      tsConfigFilePath: path.join(root, 'tsconfig.json'),
      skipAddingFilesFromTsConfig: true,
    });
    const entry = project.addSourceFileAtPath(path.join(root, 'src/index.ts'));
    project.resolveSourceFileDependencies();
    const undocumented: string[] = [];
    for (const [name, declarations] of entry.getExportedDeclarations()) {
      for (const d of declarations) {
        const target = Node.isVariableDeclaration(d) ? d.getVariableStatement() : d;
        const docs = target && Node.isJSDocable(target) ? target.getJsDocs() : [];
        if (!docs.length) undocumented.push(name);
      }
    }
    expect(undocumented).toEqual([]);
  }, 30_000);
});
