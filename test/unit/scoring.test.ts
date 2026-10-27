import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/core/config/loader.js';
import { computeScores, grade } from '../../src/core/scoring.js';
import { evaluateThresholds } from '../../src/core/thresholds.js';
import type { CheckResult, ReportedFinding } from '../../src/core/types.js';

const result = (
  id: string,
  score: number | undefined,
  extra: Partial<CheckResult> = {},
): CheckResult => ({
  id,
  name: id,
  category: id.split('/')[0]!,
  status: score === undefined ? 'errored' : 'completed',
  score,
  weight: 1,
  findings: [],
  durationMs: 0,
  ...extra,
});

describe('computeScores', () => {
  it('averages checks within a category and weights categories', () => {
    const s = computeScores(
      [result('angular/a', 100), result('angular/b', 50, { weight: 3 }), result('bundle/x', 40)],
      parseConfig({}),
    );
    // angular = (100 + 50*3) / 4 = 62.5 → 63; overall = (62.5*20 + 40*15) / 35
    expect(s.categories).toEqual([
      { id: 'angular', score: 63, weight: 20, checks: ['angular/a', 'angular/b'] },
      { id: 'bundle', score: 40, weight: 15, checks: ['bundle/x'] },
    ]);
    expect(s.overall).toBe(Math.round((63 * 20 + 40 * 15) / 35));
    expect(s.grade).toBe('F');
  });

  it('drops errored-only and skipped categories and renormalises', () => {
    const s = computeScores(
      [
        result('angular/a', 90),
        result('performance/lh', undefined),
        result('accessibility/axe', undefined, { status: 'skipped' }),
      ],
      parseConfig({ weights: { angular: 1 } }),
    );
    expect(s.overall).toBe(90);
    expect(s.categories.map((c) => [c.id, c.score])).toEqual([
      ['angular', 90],
      ['performance', undefined],
    ]);
  });

  it('gives plugin categories a fallback weight and returns undefined with no data', () => {
    const s = computeScores([result('custom/x', 0), result('angular/a', 100)], parseConfig({}));
    expect(s.categories.find((c) => c.id === 'custom')!.weight).toBe(10);
    expect(s.overall).toBe(Math.round((100 * 20) / 30));
    expect(computeScores([], parseConfig({}))).toEqual({
      overall: undefined,
      grade: undefined,
      categories: [],
    });
  });

  it('grades', () => {
    expect([95, 85, 75, 65, 10].map(grade)).toEqual(['A', 'B', 'C', 'D', 'F']);
  });
});

describe('evaluateThresholds', () => {
  const f = (severity: ReportedFinding['severity']) =>
    ({
      severity,
      message: 'm',
      fixHint: 'h',
      checkId: 'a/b',
      category: 'a',
      fingerprint: 'x',
    }) as ReportedFinding;

  it('checks overall, category and severity thresholds', () => {
    const scores = computeScores(
      [result('angular/a', 65), result('bundle/x', 95)],
      parseConfig({}),
    );
    const r = evaluateThresholds(
      {
        minOverallScore: 70,
        minCategoryScores: { angular: 60, bundle: 99, missing: 50 },
        failOnSeverity: 'high',
      },
      scores,
      [f('critical'), f('high'), f('medium')],
    );
    expect(r.map((t) => [t.id, t.passed, t.actual])).toEqual([
      ['minOverallScore', true, 78],
      ['minCategoryScores.angular', true, 65],
      ['minCategoryScores.bundle', false, 95],
      ['failOnSeverity', false, 2],
    ]);
  });

  it('skips the overall threshold when nothing was scored', () => {
    expect(
      evaluateThresholds({ minOverallScore: 70 }, computeScores([], parseConfig({})), []),
    ).toEqual([]);
  });

  it('evaluates bundle and vulnerability thresholds from check results', () => {
    const results = [
      result('bundle/size', 50, { meta: { initialKb: 612.5 } }),
      result('dependencies/vulnerabilities', 40, { meta: { counts: {} } }),
      result('accessibility/axe', 10, { meta: { criticalViolations: 3 } }),
    ];
    const findings = [
      { ...f('critical'), checkId: 'dependencies/vulnerabilities' },
      { ...f('critical'), checkId: 'other/check' },
    ];
    const r = evaluateThresholds(
      { maxInitialBundleKb: 500, maxCriticalVulnerabilities: 0, maxCriticalA11yViolations: 0 },
      computeScores(results, parseConfig({})),
      findings,
      results,
    );
    expect(r.map((t) => [t.id, t.passed, t.actual])).toEqual([
      ['maxInitialBundleKb', false, 612.5],
      ['maxCriticalVulnerabilities', false, 1],
      ['maxCriticalA11yViolations', false, 3],
    ]);
    // Not evaluated when the measuring check did not complete (e.g. offline)
    expect(
      evaluateThresholds(
        { maxCriticalVulnerabilities: 0 },
        computeScores([], parseConfig({})),
        [],
        [],
      ),
    ).toEqual([]);
  });
});
