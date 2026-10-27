import { SEVERITIES, type Thresholds } from './config/schema.js';
import type { ScoreSummary } from './scoring.js';
import type { ReportedFinding } from './types.js';

export interface ThresholdResult {
  id: string;
  description: string;
  passed: boolean;
  actual: number | string | undefined;
  expected: number | string;
}

/** Evaluates score- and severity-based thresholds. Domain thresholds are added by their checks' phases. */
export function evaluateThresholds(
  thresholds: Thresholds,
  scores: ScoreSummary,
  findings: ReportedFinding[],
): ThresholdResult[] {
  const results: ThresholdResult[] = [];

  if (thresholds.minOverallScore !== undefined && scores.overall !== undefined) {
    results.push({
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
    results.push({
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
    results.push({
      id: 'failOnSeverity',
      description: `Findings at or above "${thresholds.failOnSeverity}"`,
      passed: count === 0,
      actual: count,
      expected: 0,
    });
  }

  return results;
}
