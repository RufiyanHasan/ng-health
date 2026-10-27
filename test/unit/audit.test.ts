import { describe, expect, it } from 'vitest';
import { audit } from '../../src/core/audit.js';
import { silentLogger } from '../../src/core/logger.js';
import { finding, stubCheck } from '../helpers/checks.js';
import { angularApp, makeTempProject } from '../helpers/tmp.js';

const checks = [
  stubCheck('angular/good', { findings: [] }),
  stubCheck('angular/bad', {
    findings: [finding({ severity: 'critical' }), finding({ severity: 'high' })],
  }),
  stubCheck('hygiene/boom', () => {
    throw new Error('boom');
  }),
];

describe('audit', () => {
  it('runs checks, scores, and fails thresholds with exit code 1', async () => {
    const dir = await makeTempProject(angularApp());
    const out = await audit(dir, { format: ['json'] }, silentLogger, { checks });
    const { report } = out;
    expect(report.checks.map((c) => [c.id, c.status, c.score])).toEqual([
      ['angular/good', 'completed', 100],
      ['angular/bad', 'completed', 65],
      ['hygiene/boom', 'errored', undefined],
    ]);
    expect(report.score).toEqual({ overall: 83, grade: 'B' });
    expect(report.summary).toEqual({
      findings: { critical: 1, high: 1, medium: 0, low: 0, total: 2 },
      checks: { completed: 2, errored: 1, skipped: 0 },
    });
    expect(report.project).toMatchObject({ name: 'demo-app', angularMajor: 19 });
    expect(JSON.stringify(report)).not.toContain(dir); // no absolute paths leak
    expect(report.thresholds.map((t) => [t.id, t.passed])).toEqual([['minOverallScore', true]]);
    expect(out.exitCode).toBe(0);

    const strict = await audit(dir, { skip: ['angular/good'] }, silentLogger, { checks });
    expect(strict.report.checks[0]).toMatchObject({
      status: 'skipped',
      reason: 'excluded by --skip',
    });
    expect(strict.report.score.overall).toBe(65);
    expect(strict.exitCode).toBe(1);
  });

  it('loads plugins declared in the config', async () => {
    const dir = await makeTempProject(
      angularApp({
        'fe-health.config.json': {
          plugins: ['./my-check.mjs'],
          thresholds: { failOnSeverity: 'low' },
        },
        'my-check.mjs': `export default {
          id: 'custom/todo', name: 'TODOs', category: 'custom',
          async run(ctx) {
            const files = await ctx.glob('src/**/*.ts');
            return { findings: files.map((file) => ({ severity: 'low', message: 'TODO found', file, fixHint: 'Resolve it' })) };
          },
        };`,
        'src/app.ts': '// TODO',
        'node_modules/ignored/src/x.ts': '',
      }),
    );
    const { report, exitCode } = await audit(dir, {}, silentLogger, { checks: [] });
    expect(report.findings.map((f) => [f.checkId, f.file])).toEqual([
      ['custom/todo', 'src/app.ts'],
    ]);
    expect(exitCode).toBe(1);
  });
});
