import type { Severity } from '../core/config/schema.js';
import type { AuditReport } from '../core/report.js';
import type { ReportedFinding } from '../core/types.js';

export type Band = 'good' | 'ok' | 'poor' | 'none';

/** Same bands everywhere: ≥80 good, ≥60 ok, below poor. */
export function band(score: number | undefined): Band {
  if (score === undefined) return 'none';
  return score >= 80 ? 'good' : score >= 60 ? 'ok' : 'poor';
}

export const CATEGORY_LABELS: Record<string, string> = {
  dependencies: 'Dependencies',
  bundle: 'Bundle size',
  angular: 'Angular code',
  hygiene: 'Code hygiene',
  performance: 'Performance',
  accessibility: 'Accessibility',
};

export const categoryLabel = (id: string) =>
  CATEGORY_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function formatDelta(delta: number | undefined): string {
  if (delta === undefined) return '';
  if (delta === 0) return '±0';
  return delta > 0 ? `+${delta}` : String(delta);
}

export function location(f: Pick<ReportedFinding, 'file' | 'line'>): string {
  if (!f.file) return '';
  return f.line ? `${f.file}:${f.line}` : f.file;
}

export function projectLine(report: AuditReport): string {
  const p = report.project;
  return [
    p.name,
    p.angularVersion ? `Angular ${p.angularVersion}` : undefined,
    p.packageManager,
    p.kind === 'workspace' ? `workspace (${p.projects.length} projects)` : 'single app',
    p.ssr ? 'SSR' : undefined,
    p.nx ? 'Nx' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function findingsByCategory(report: AuditReport): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of report.findings) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  return counts;
}

export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} kB`;
