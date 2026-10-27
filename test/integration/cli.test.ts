import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, inject, it } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import type { AuditReport } from '../../src/core/report.js';
import { MARKDOWN_MARKER } from '../../src/reporters/markdown.js';
import { makeTempProject } from '../helpers/tmp.js';

const repo = path.resolve(import.meta.dirname, '../..');
const cli = inject('cliPath');

function run(
  args: string[],
  cwd = repo,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, ...args],
      { cwd, timeout: 170_000, env: { ...process.env, NO_COLOR: '1', GITHUB_ACTIONS: '' } },
      (err, stdout, stderr) =>
        resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
  });
}

const ajv = new Ajv2020.default({ allErrors: true, strict: false });
addFormats.default(ajv);
const validate = ajv.compile(
  JSON.parse(await readFile(path.join(repo, 'schema/report.v1.json'), 'utf8')),
);

async function readReport(dir: string): Promise<AuditReport> {
  const json: unknown = JSON.parse(await readFile(path.join(dir, 'fe-health-report.json'), 'utf8'));
  expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
  return json as AuditReport;
}

/** Findings from static checks: deterministic, unlike Lighthouse timings. */
const staticFindings = (r: AuditReport) =>
  r.findings
    .filter((f) => f.category !== 'performance' && f.category !== 'accessibility')
    .map(
      (f) =>
        `${f.severity} ${f.checkId} ${f.file ?? '-'}${f.line ? `:${f.line}` : ''} | ${f.message}`,
    );

describe('fe-health CLI binary', { timeout: 180_000 }, () => {
  it('Definition of Done: unhealthy fixture → html+json report, exit 1', async () => {
    const out = await makeTempProject({});
    const r = await run([
      'audit',
      './test/fixtures/unhealthy',
      '--format',
      'html,json',
      '--out',
      out,
    ]);
    expect(r.code).toBe(1);
    expect((await readdir(out)).sort()).toEqual(['fe-health-report.html', 'fe-health-report.json']);

    const report = await readReport(out);
    expect(report.passed).toBe(false);
    expect(report.tool).toEqual({ name: 'fe-health', version: pkg.version });
    expect(report.checks.filter((c) => c.status === 'errored')).toEqual([]);
    expect(staticFindings(report)).toMatchSnapshot();

    const html = await readFile(path.join(out, 'fe-health-report.html'), 'utf8');
    expect(html).toContain('<title>Frontend health · unhealthy-app</title>');
    expect(html).toContain('Quality gate failed');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(r.stdout).toBe(''); // no console format requested: summary only on stderr
    expect(r.stderr).toContain('Quality gate failed');
  });

  it('Definition of Done: healthy fixture → exit 0', async () => {
    const out = await makeTempProject({});
    const r = await run([
      'audit',
      './test/fixtures/healthy',
      '--format',
      'html,json',
      '--out',
      out,
    ]);
    expect(r.code).toBe(0);
    const report = await readReport(out);
    expect(report.passed).toBe(true);
    expect(staticFindings(report)).toEqual([]);
    expect(report.score.overall).toBeGreaterThanOrEqual(90);
    expect(r.stderr).toContain('Quality gate passed');
  });

  it('--ci prints Markdown to stdout and keeps diagnostics on stderr', async () => {
    const out = await makeTempProject({});
    const r = await run([
      'audit',
      'test/fixtures/unhealthy',
      '--ci',
      '--skip',
      'performance,accessibility',
      '--out',
      out,
    ]);
    expect(r.code).toBe(1);
    expect(r.stdout.startsWith(MARKDOWN_MARKER)).toBe(true);
    expect(r.stdout).not.toContain('Detected');
    expect(r.stderr).toContain('Detected unhealthy-app');
    expect(await readFile(path.join(out, 'fe-health-report.md'), 'utf8')).toBe(
      r.stdout.trimEnd() + '\n',
    );
  });

  it('--baseline shows deltas against a previous report', async () => {
    const out = await makeTempProject({});
    const flags = ['--skip', 'performance,accessibility', '--format', 'json'];
    await run(['audit', 'test/fixtures/healthy', ...flags, '--out', path.join(out, 'base')]);
    const r = await run([
      'audit',
      'test/fixtures/unhealthy',
      ...flags,
      '--out',
      out,
      '--baseline',
      path.join(out, 'base/fe-health-report.json'),
    ]);
    const report = await readReport(out);
    expect(r.code).toBe(1);
    expect(report.trend?.overall.delta).toBeLessThan(0);
    expect(report.trend?.newFindings.length).toBe(staticFindings(report).length);
  });

  it('init, --version, and tool errors (exit 2)', async () => {
    const dir = await makeTempProject({});
    expect((await run(['--version'])).stdout.trim()).toBe(pkg.version);
    expect((await run(['init'], dir)).code).toBe(0);
    expect(
      JSON.parse(await readFile(path.join(dir, 'fe-health.config.json'), 'utf8')),
    ).toHaveProperty('thresholds');
    expect((await run(['init'], dir)).code).toBe(2);
    const missing = await run(['audit', path.join(dir, 'nope')]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Project path does not exist');
    expect((await run(['audit', 'test/fixtures/healthy', '--format', 'pdf'])).code).toBe(2);
    expect((await run(['audit', dir])).stderr).toContain('No Angular project found');
  });
});
