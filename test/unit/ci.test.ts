import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { githubAnnotations, MAX_ANNOTATIONS } from '../../src/ci/github.js';
import { audit } from '../../src/core/audit.js';
import { parseConfig } from '../../src/core/config/loader.js';
import { resolveAuditOptions } from '../../src/core/options.js';
import { MARKDOWN_MARKER } from '../../src/reporters/markdown.js';
import { fixture } from '../helpers/fixtures.js';
import { reported, sampleReport } from '../helpers/report.js';
import { makeTempProject } from '../helpers/tmp.js';

describe('githubAnnotations', () => {
  it('emits errors/warnings for findings with files, escaped, relative to the repo root', () => {
    const report = {
      ...sampleReport(),
      findings: [
        reported('angular/onpush', {
          severity: 'critical',
          message: 'Bad, very: bad\n100%',
          fixHint: 'Fix',
          file: 'src/a.ts',
          line: 3,
        }),
        reported('angular/onpush', {
          severity: 'medium',
          message: 'Meh',
          fixHint: 'Tune',
          file: 'src/b.ts',
        }),
        reported('angular/onpush', { severity: 'low', message: 'Minor', file: 'src/c.ts' }),
        reported('dependencies/x', { severity: 'high', message: 'No file' }),
      ],
    };
    expect(githubAnnotations(report, '/repo/apps/web', '/repo')).toEqual([
      '::error file=apps/web/src/a.ts,line=3,title=ng-health%3A angular/onpush::Bad, very: bad%0A100%25 Fix',
      '::warning file=apps/web/src/b.ts,title=ng-health%3A angular/onpush::Meh Tune',
    ]);
    expect(githubAnnotations(report, '/elsewhere', '/repo')).toEqual([]);
  });

  it('caps the number of annotations', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      reported('angular/x', { severity: 'high', message: `m${i}`, file: 'a.ts' }),
    );
    expect(githubAnnotations({ ...sampleReport(), findings: many }, '/r', '/r')).toHaveLength(
      MAX_ANNOTATIONS,
    );
  });
});

describe('CI mode', () => {
  it('prints Markdown instead of the console table unless console is requested', () => {
    const config = parseConfig({});
    expect(resolveAuditOptions('.', { ci: true }, config, undefined, '/w').formats).toEqual([
      'html',
      'md',
    ]);
    expect(
      resolveAuditOptions('.', { ci: true, format: ['console,json'] }, config, undefined, '/w')
        .formats,
    ).toEqual(['console', 'json', 'md']);
  });

  it('writes Markdown to stdout, annotations and the GitHub job summary', async () => {
    const dir = await makeTempProject({ 'summary.md': '# existing\n' });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const logger = {
      info: (m: string) => stderr.push(m),
      success: (m: string) => stderr.push(m),
      warn: (m: string) => stderr.push(m),
      error: (m: string) => stderr.push(m),
      debug: () => {},
      out: (m: string) => stdout.push(m),
    };
    const root = fixture('unhealthy');
    const { exitCode } = await audit(
      root,
      { ci: true, skip: ['performance', 'accessibility'], out: path.join(dir, 'out') },
      logger,
      {
        env: {
          GITHUB_ACTIONS: 'true',
          GITHUB_WORKSPACE: path.resolve(root, '../../..'),
          GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(stdout[0]?.startsWith(MARKDOWN_MARKER)).toBe(true);
    expect(stdout.join('\n')).not.toContain('┌'); // no console table
    expect(stdout).toContain(
      '::error file=test/fixtures/unhealthy/src/app/dashboard/dashboard.component.ts,line=22,title=ng-health%3A angular/subscriptions::DashboardComponent: subscribe() without cleanup (no takeUntilDestroyed/async pipe/DestroyRef cleanup). Prefer the async pipe or toSignal(); otherwise add `takeUntilDestroyed(this.destroyRef)` to the pipe.',
    );
    const summary = await readFile(path.join(dir, 'summary.md'), 'utf8');
    expect(summary.startsWith(`# existing\n${MARKDOWN_MARKER}`)).toBe(true);
    expect(await readFile(path.join(dir, 'out', 'ng-health-report.md'), 'utf8')).toBe(
      `${stdout[0]}`,
    );
    expect(stderr.find((l) => l.startsWith('Quality gate failed: Overall score'))).toBeDefined();
  });

  it('does not emit GitHub output outside GitHub Actions', async () => {
    const dir = await makeTempProject({});
    const stdout: string[] = [];
    await audit(
      fixture('healthy'),
      { ci: true, skip: ['performance', 'accessibility'], out: dir },
      { info() {}, success() {}, warn() {}, error() {}, debug() {}, out: (m) => stdout.push(m) },
      { env: {} },
    );
    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toContain('✅ passed');
  });
});
