import { SEVERITIES, type Severity } from './config/schema.js';
import type { ProjectInfo } from './detect/index.js';
import type { CategoryScore, Grade, ScoreSummary } from './scoring.js';
import type { Trend } from './baseline.js';
import type { ThresholdResult } from './thresholds.js';
import type { TopFix } from './top-fixes.js';
import type { CheckResult, CheckStatus, ReportedFinding } from './types.js';
import { TOOL_NAME, VERSION } from '../version.js';

/** Bump the major on breaking changes to the JSON report shape. */
export const REPORT_SCHEMA_VERSION = '1.0';

/** A check as listed in the report: its result without the findings (those are in `findings`). */
export interface ReportCheck extends Omit<CheckResult, 'findings'> {
  findingCount: number;
}

export interface AuditReport {
  schemaVersion: string;
  tool: { name: string; version: string };
  generatedAt: string;
  durationMs: number;
  /** No absolute paths: reports are shared with clients. */
  project: {
    name: string;
    angularVersion: string | undefined;
    angularMajor: number | undefined;
    packageManager: string;
    kind: ProjectInfo['kind'];
    ssr: boolean;
    nx: boolean;
    projects: { name: string; type: string }[];
  };
  score: { overall: number | undefined; grade: Grade | undefined };
  categories: CategoryScore[];
  checks: ReportCheck[];
  findings: ReportedFinding[];
  summary: {
    findings: Record<Severity, number> & { total: number };
    checks: Record<CheckStatus, number>;
  };
  /** The highest-impact fixes, ranked. */
  topFixes: TopFix[];
  thresholds: ThresholdResult[];
  passed: boolean;
  /** Present when a --baseline report was given. */
  trend?: Trend;
}

export function buildReport(input: {
  project: ProjectInfo;
  results: CheckResult[];
  scores: ScoreSummary;
  thresholds: ThresholdResult[];
  topFixes: TopFix[];
  startedAt: Date;
}): AuditReport {
  const { project, results, scores, thresholds } = input;
  const findings = results
    .flatMap((r) => r.findings)
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const bySeverity = Object.fromEntries(
    SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]),
  ) as Record<Severity, number>;
  const byStatus = (s: CheckStatus) => results.filter((r) => r.status === s).length;

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: VERSION },
    generatedAt: input.startedAt.toISOString(),
    durationMs: Date.now() - input.startedAt.getTime(),
    project: {
      name: project.name,
      angularVersion: project.angular.installed ?? project.angular.declared,
      angularMajor: project.angular.major,
      packageManager: project.packageManager,
      kind: project.kind,
      ssr: project.ssr,
      nx: project.nx,
      projects: project.projects.map((p) => ({ name: p.name, type: p.type })),
    },
    score: { overall: scores.overall, grade: scores.grade },
    categories: scores.categories,
    checks: results.map(({ findings: f, ...rest }) => ({ ...rest, findingCount: f.length })),
    findings,
    summary: {
      findings: { ...bySeverity, total: findings.length },
      checks: {
        completed: byStatus('completed'),
        errored: byStatus('errored'),
        skipped: byStatus('skipped'),
      },
    },
    topFixes: input.topFixes,
    thresholds,
    passed: thresholds.every((t) => t.passed),
  };
}
