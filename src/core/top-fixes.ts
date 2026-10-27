import { SEVERITIES, type Config, type Severity } from './config/schema.js';
import { categoryWeight } from './scoring.js';
import type { ReportedFinding } from './types.js';

/** One entry of the ranked "Top fixes" list: a group of findings with the same check, rule and remedy. */
export interface TopFix {
  rank: number;
  checkId: string;
  checkName: string;
  category: string;
  ruleId: string | undefined;
  severity: Severity;
  /** How many findings this fix resolves. */
  count: number;
  /** Relative impact used for ranking (higher first). */
  impact: number;
  /** The finding's message, or a summary with an example when the fix covers several findings. */
  message: string;
  fixHint: string;
  docsUrl: string | undefined;
  /** Up to 5 affected files. */
  files: string[];
}

/**
 * Ranks fixes by impact = severity penalty × category weight share × (1 + log2(occurrences)).
 * Findings are grouped by check + rule, so "add OnPush to 30 components" is one fix. The log
 * keeps many low-severity occurrences from outranking a single critical issue.
 */
export function topFixes(
  findings: ReportedFinding[],
  checkNames: Map<string, string>,
  config: Config,
  penalties: Record<Severity, number>,
  limit = 10,
): TopFix[] {
  const groups = new Map<string, ReportedFinding[]>();
  for (const f of findings) {
    // Same check, rule and remedy = one fix ("add OnPush" ×30), while e.g. different
    // deprecated packages stay separate fixes because their remedies differ.
    const key = [f.checkId, f.ruleId ?? f.fingerprint, f.fixHint].join('\u0000');
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const categories = new Set(findings.map((f) => f.category));
  const totalWeight = [...categories].reduce((s, c) => s + categoryWeight(c, config), 0) || 1;

  return [...groups.values()]
    .map((list) => {
      const worst = list.reduce((a, b) =>
        SEVERITIES.indexOf(b.severity) < SEVERITIES.indexOf(a.severity) ? b : a,
      );
      const share = categoryWeight(worst.category, config) / totalWeight;
      const impact = penalties[worst.severity] * share * (1 + Math.log2(list.length));
      return {
        rank: 0,
        checkId: worst.checkId,
        checkName: checkNames.get(worst.checkId) ?? worst.checkId,
        category: worst.category,
        ruleId: worst.ruleId,
        severity: worst.severity,
        count: list.length,
        impact: Math.round(impact * 100) / 100,
        message: groupMessage(list, worst, checkNames.get(worst.checkId) ?? worst.checkId),
        fixHint: worst.fixHint,
        docsUrl: worst.docsUrl,
        files: [...new Set(list.flatMap((f) => (f.file ? [f.file] : [])))].slice(0, 5),
      };
    })
    .sort(
      (a, b) =>
        b.impact - a.impact ||
        SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
        a.message.localeCompare(b.message),
    )
    .slice(0, limit)
    .map((fix, i) => ({ ...fix, rank: i + 1 }));
}

/** "Known vulnerabilities: 67 occurrences (5 critical, 52 high, 9 medium, 1 low), e.g. …" */
function groupMessage(list: ReportedFinding[], worst: ReportedFinding, checkName: string): string {
  if (list.length === 1) return worst.message;
  const counts = SEVERITIES.map(
    (s) => [s, list.filter((f) => f.severity === s).length] as const,
  ).filter(([, n]) => n > 0);
  const breakdown = counts.length > 1 ? ` (${counts.map(([s, n]) => `${n} ${s}`).join(', ')})` : '';
  return `${checkName}: ${list.length} occurrences${breakdown}, e.g. ${worst.message}`;
}
