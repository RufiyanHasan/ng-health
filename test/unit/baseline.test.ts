import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditCommand as audit } from '../../src/cli/commands/audit.js';
import { computeTrend, loadBaseline } from '../../src/core/baseline.js';
import { silentLogger } from '../../src/core/logger.js';
import { runCli } from '../../src/cli/program.js';
import { renderJson } from '../../src/reporters/json.js';
import { fixture } from '../helpers/fixtures.js';
import { reported, sampleReport } from '../helpers/report.js';
import { makeTempProject } from '../helpers/tmp.js';

describe('computeTrend', () => {
  it('computes score deltas and new/resolved findings as multisets', () => {
    const before = sampleReport();
    const dup = reported('angular/onpush', { message: 'Same', file: 'a.ts' });
    const gone = reported('angular/any-usage', { message: 'Gone' });
    const added = reported('angular/large-components', { message: 'New' });
    const baseline = { ...before, findings: [dup, dup, gone] };
    const current = {
      ...before,
      score: { overall: 80, grade: 'B' as const },
      categories: [{ id: 'angular', score: 70, weight: 20, checks: [] }],
      findings: [dup, added],
    };
    const t = computeTrend(baseline, current);
    expect(t.overall).toEqual({
      before: before.score.overall,
      after: 80,
      delta: 80 - before.score.overall!,
    });
    expect(t.categories.find((c) => c.id === 'angular')).toEqual({
      id: 'angular',
      before: before.categories.find((c) => c.id === 'angular')!.score,
      after: 70,
      delta: 70 - before.categories.find((c) => c.id === 'angular')!.score!,
    });
    expect(t.categories.find((c) => c.id === 'dependencies')).toMatchObject({
      after: undefined,
      delta: undefined,
    });
    expect(t.newFindings.map((f) => f.message)).toEqual(['New']);
    expect(t.resolvedFindings.map((f) => f.message)).toEqual(['Same', 'Gone']);
  });
});

describe('loadBaseline', () => {
  it('rejects missing, foreign and incompatible files', async () => {
    const dir = await makeTempProject({
      'v2.json': { schemaVersion: '2.0', findings: [], categories: [], score: {} },
      'other.json': { schemaVersion: '1.0', hello: 'world' },
      'ok.json': renderJson(sampleReport()),
    });
    await expect(loadBaseline(path.join(dir, 'missing.json'))).rejects.toThrow(
      /Baseline report not found/,
    );
    await expect(loadBaseline(path.join(dir, 'v2.json'))).rejects.toThrow(
      /Unsupported baseline schema version "2.0"/,
    );
    await expect(loadBaseline(path.join(dir, 'other.json'))).rejects.toThrow(
      /is not a ng-health JSON report/,
    );
    expect((await loadBaseline(path.join(dir, 'ok.json'))).project.name).toBe('example-shop');
  });

  it('adds a trend to the audit report, and fails fast (exit 2) on a bad baseline', async () => {
    const dir = await makeTempProject({});
    const flags = { skip: ['performance', 'accessibility'], format: ['json'], out: dir };
    const first = await audit(fixture('unhealthy'), flags, silentLogger);
    const baselineFile = path.join(dir, 'baseline.json');
    await writeFile(
      baselineFile,
      renderJson({ ...first.report, findings: first.report.findings.slice(3) }),
    );
    const second = await audit(
      fixture('unhealthy'),
      { ...flags, baseline: baselineFile },
      silentLogger,
    );
    expect(second.report.trend?.overall.delta).toBe(0);
    expect(second.report.trend?.newFindings).toHaveLength(3);
    expect(second.report.trend?.resolvedFindings).toHaveLength(0);

    const code = await runCli(
      ['audit', fixture('healthy'), '--baseline', path.join(dir, 'nope.json')],
      {
        stdout: { write: () => true } as never,
        stderr: { write: () => true } as never,
      },
    );
    expect(code).toBe(2);
  });
});
