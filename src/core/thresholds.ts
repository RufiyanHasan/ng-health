import { SEVERITIES, type Thresholds } from './config/schema.js';
import type { ScoreSummary } from './scoring.js';
import type { CheckResult, ReportedFinding } from './types.js';

/** Outcome of one configured threshold (quality-gate rule). */
export interface ThresholdResult {
  id: string;
  description: string;
  passed: boolean;
  actual: number | string | undefined;
  expected: number | string;
}

/** Evaluates thresholds. Domain thresholds read the meta of the check that measures them. */
export function evaluateThresholds(
  thresholds: Thresholds,
  scores: ScoreSummary,
  findings: ReportedFinding[],
  results: CheckResult[] = [],
): ThresholdResult[] {
  const out: ThresholdResult[] = [];

  if (thresholds.minOverallScore !== undefined && scores.overall !== undefined) {
    out.push({
      id: 'minOverallScore',
      description: 'Overall score',
      passed: scores.overall >= thresholds.minOverallScore,
      actual: scores.overall,
      expected: `≥ ${thresholds.minOverallScore}`,
    });
  }

  for (const [category, min] of Object.entries(thresholds.minCategoryScores ?? {})) {
    const score = scores.categories.find((c) => c.id === category)?.score;
    if (score === undefined) continue;
    out.push({
      id: `minCategoryScores.${category}`,
      description: `${category} score`,
      passed: score >= min,
      actual: score,
      expected: `≥ ${min}`,
    });
  }

  if (thresholds.failOnSeverity) {
    const limit = SEVERITIES.indexOf(thresholds.failOnSeverity);
    const count = findings.filter((f) => SEVERITIES.indexOf(f.severity) <= limit).length;
    out.push({
      id: 'failOnSeverity',
      description: `Findings at or above "${thresholds.failOnSeverity}"`,
      passed: count === 0,
      actual: count,
      expected: 0,
    });
  }

  const meta = (id: string) => results.find((r) => r.id === id && r.status === 'completed')?.meta;

  const initialKb = meta('bundle/size')?.['initialKb'];
  if (thresholds.maxInitialBundleKb !== undefined && typeof initialKb === 'number') {
    out.push({
      id: 'maxInitialBundleKb',
      description: 'Initial bundle size (kB)',
      passed: initialKb <= thresholds.maxInitialBundleKb,
      actual: initialKb,
      expected: `≤ ${thresholds.maxInitialBundleKb}`,
    });
  }

  if (thresholds.maxCriticalVulnerabilities !== undefined && meta('dependencies/vulnerabilities')) {
    const count = findings.filter(
      (f) => f.checkId === 'dependencies/vulnerabilities' && f.severity === 'critical',
    ).length;
    out.push({
      id: 'maxCriticalVulnerabilities',
      description: 'Critical vulnerabilities',
      passed: count <= thresholds.maxCriticalVulnerabilities,
      actual: count,
      expected: `≤ ${thresholds.maxCriticalVulnerabilities}`,
    });
  }

  const criticalA11y = meta('accessibility/axe')?.['criticalViolations'];
  if (thresholds.maxCriticalA11yViolations !== undefined && typeof criticalA11y === 'number') {
    out.push({
      id: 'maxCriticalA11yViolations',
      description: 'Critical accessibility violations (elements)',
      passed: criticalA11y <= thresholds.maxCriticalA11yViolations,
      actual: criticalA11y,
      expected: `≤ ${thresholds.maxCriticalA11yViolations}`,
    });
  }

  return out;
}
