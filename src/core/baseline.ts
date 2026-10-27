import path from 'node:path';
import { FeHealthError } from './errors.js';
import { readJsonFile } from './fs.js';
import type { AuditReport } from './report.js';
import type { ReportedFinding } from './types.js';

export interface Trend {
  baselineGeneratedAt: string;
  baselineVersion: string;
  overall: { before: number | undefined; after: number | undefined; delta: number | undefined };
  categories: {
    id: string;
    before: number | undefined;
    after: number | undefined;
    delta: number | undefined;
  }[];
  newFindings: ReportedFinding[];
  resolvedFindings: ReportedFinding[];
}

const delta = (before: number | undefined, after: number | undefined) =>
  before === undefined || after === undefined ? undefined : after - before;

/** Loads a previous JSON report. Any 1.x schema version is compatible. */
export async function loadBaseline(file: string): Promise<AuditReport> {
  const abs = path.resolve(file);
  const raw = await readJsonFile<Partial<AuditReport>>(abs);
  if (!raw) throw new FeHealthError(`Baseline report not found: ${abs}`);
  if (typeof raw.schemaVersion !== 'string' || !raw.schemaVersion.startsWith('1.')) {
    throw new FeHealthError(
      `Unsupported baseline schema version "${String(raw.schemaVersion)}" in ${abs}`,
      {
        hint: 'Pass a JSON report produced by fe-health 1.x (--format json).',
      },
    );
  }
  if (!Array.isArray(raw.findings) || !Array.isArray(raw.categories) || !raw.score) {
    throw new FeHealthError(`${abs} is not a fe-health JSON report`);
  }
  return raw as AuditReport;
}

/**
 * Compares findings by fingerprint as multisets: two identical findings in the same file count
 * twice, so fixing one of them shows up as resolved.
 */
export function computeTrend(
  baseline: AuditReport,
  current: Pick<AuditReport, 'score' | 'categories' | 'findings'>,
): Trend {
  const diff = (a: ReportedFinding[], b: ReportedFinding[]) => {
    const remaining = new Map<string, number>();
    for (const f of b) remaining.set(f.fingerprint, (remaining.get(f.fingerprint) ?? 0) + 1);
    return a.filter((f) => {
      const n = remaining.get(f.fingerprint) ?? 0;
      if (n > 0) {
        remaining.set(f.fingerprint, n - 1);
        return false;
      }
      return true;
    });
  };
  const ids = [
    ...new Set([...current.categories.map((c) => c.id), ...baseline.categories.map((c) => c.id)]),
  ];
  return {
    baselineGeneratedAt: baseline.generatedAt,
    baselineVersion: baseline.tool?.version ?? 'unknown',
    overall: {
      before: baseline.score.overall ?? undefined,
      after: current.score.overall,
      delta: delta(baseline.score.overall ?? undefined, current.score.overall),
    },
    categories: ids.map((id) => {
      const before = baseline.categories.find((c) => c.id === id)?.score ?? undefined;
      const after = current.categories.find((c) => c.id === id)?.score;
      return { id, before, after, delta: delta(before, after) };
    }),
    newFindings: diff(current.findings, baseline.findings),
    resolvedFindings: diff(baseline.findings, current.findings),
  };
}
