import { parseConfig } from '../../src/core/config/loader.js';
import { DEFAULT_SEVERITY_PENALTIES } from '../../src/core/config/schema.js';
import { buildReport, type AuditReport } from '../../src/core/report.js';
import { computeScores } from '../../src/core/scoring.js';
import { evaluateThresholds } from '../../src/core/thresholds.js';
import { topFixes } from '../../src/core/top-fixes.js';
import type { CheckResult, Finding, ReportedFinding } from '../../src/core/types.js';
import { fingerprint } from '../../src/core/fingerprint.js';
import { fakeProject } from './checks.js';

export const reported = (checkId: string, f: Partial<Finding> = {}): ReportedFinding => {
  const base: Finding = {
    severity: 'medium',
    message: `Issue in ${checkId}`,
    fixHint: 'Fix it',
    ...f,
  };
  return {
    ...base,
    checkId,
    category: checkId.split('/')[0]!,
    fingerprint: fingerprint(checkId, base),
  };
};

export const result = (
  id: string,
  name: string,
  score: number | undefined,
  findings: ReportedFinding[],
  extra: Partial<CheckResult> = {},
): CheckResult => ({
  id,
  name,
  category: id.split('/')[0]!,
  status: 'completed',
  score,
  weight: 1,
  findings,
  durationMs: 1200,
  ...extra,
});

/** A deterministic report covering every section, including hostile strings. */
export function sampleReport(): AuditReport {
  const config = parseConfig({
    thresholds: { minOverallScore: 70, maxCriticalVulnerabilities: 0 },
  });
  const results: CheckResult[] = [
    result(
      'dependencies/vulnerabilities',
      'Known vulnerabilities',
      65,
      [
        reported('dependencies/vulnerabilities', {
          severity: 'critical',
          message: 'lodash: Prototype pollution',
          fixHint: 'Run "npm audit fix".',
          docsUrl: 'https://github.com/advisories/GHSA-x',
          ruleId: 'vulnerable-package',
        }),
      ],
      { meta: { counts: { critical: 1, high: 0, medium: 0, low: 0 } } },
    ),
    result('angular/onpush', 'OnPush change detection', 50, [
      reported('angular/onpush', {
        message: 'AComponent uses default change detection.',
        file: 'src/a.component.ts',
        line: 3,
        ruleId: 'missing-onpush',
      }),
      reported('angular/onpush', {
        message: 'BComponent uses default change detection.',
        file: 'src/b.component.ts',
        line: 7,
        ruleId: 'missing-onpush',
      }),
    ]),
    result('angular/template-calls', 'Function calls in templates', 90, [
      reported('angular/template-calls', {
        severity: 'low',
        message: 'XSS <script>alert(1)</script> | pipe `tick` *star*',
        fixHint: 'Do <b>not</b> do that',
        docsUrl: 'javascript:alert(1)',
        file: 'src/x.html',
      }),
    ]),
    result('bundle/size', 'Bundle size', 100, [], {
      meta: {
        initialBytes: 300_000,
        initialKb: 293,
        initialGzipBytes: 90_000,
        lazyBytes: 120_000,
        totalBytes: 420_000,
        statsSource: 'esbuild',
        topModules: [{ path: 'node_modules/@angular/core/fesm2022/core.mjs', bytes: 150_000 }],
        largestLazyChunks: [{ name: 'chunk-ABC.js', bytes: 120_000 }],
        budgets: [],
      },
    }),
    result('performance/lighthouse', 'Lighthouse', undefined, [], {
      status: 'skipped',
      reason: 'Chromium not available.',
    }),
    result('hygiene/coverage', 'Test coverage', undefined, [], {
      status: 'errored',
      reason: 'boom',
    }),
  ];
  const scores = computeScores(results, config);
  const findings = results.flatMap((r) => r.findings);
  const report = buildReport({
    project: {
      ...fakeProject('/secret/home/user/project'),
      name: 'example-shop',
      angular: { declared: '^19.2.0', installed: '19.2.4', major: 19 },
    },
    results,
    scores,
    thresholds: evaluateThresholds(config.thresholds, scores, findings, results),
    topFixes: topFixes(
      findings,
      new Map(results.map((r) => [r.id, r.name])),
      config,
      DEFAULT_SEVERITY_PENALTIES,
    ),
    startedAt: new Date('2026-10-27T10:00:00.000Z'),
  });
  return { ...report, durationMs: 4321, tool: { ...report.tool, version: '0.0.0-test' } };
}
