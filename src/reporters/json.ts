import type { AuditReport } from '../core/report.js';

/** Stable, versioned machine-readable report (schema/report.v1.json). */
export function renderJson(report: AuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
