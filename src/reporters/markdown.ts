import type { Severity } from '../core/config/schema.js';
import type { AuditReport } from '../core/report.js';
import type { ReportedFinding } from '../core/types.js';
import { band, categoryLabel, formatDelta, location, projectLine } from './format.js';

/** Hidden marker so CI can find and update its previous PR comment. */
export const MARKDOWN_MARKER = '<!-- ng-health-report -->';

const BAND_EMOJI = { good: '🟢', ok: '🟡', poor: '🔴', none: '⚪' } as const;
const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '⚪',
};

/** Escapes text for use inside Markdown (including table cells). */
export function md(text: string): string {
  return text.replace(/[\\`*_[\]|<>]/g, (c) => `\\${c}`).replace(/\n/g, ' ');
}

const scoreCell = (score: number | undefined) =>
  score === undefined ? '–' : `${BAND_EMOJI[band(score)]} ${score}`;

function findingLine(f: ReportedFinding): string {
  const where = location(f);
  return `- ${SEVERITY_EMOJI[f.severity]} ${md(f.message)}${where ? ` — \`${where.replace(/`/g, '')}\`` : ''}`;
}

/** Short summary for PR comments and CI logs. */
export function renderMarkdown(report: AuditReport, opts: { topFixes?: number } = {}): string {
  const { overall, grade } = report.score;
  const trend = report.trend;
  const lines: string[] = [MARKDOWN_MARKER];
  const verdict = report.thresholds.length ? (report.passed ? '✅ passed' : '❌ failed') : '';
  const overallDelta = trend ? formatDelta(trend.overall.delta) : '';
  lines.push(
    `## Frontend health: ${overall === undefined ? 'not scored' : `**${overall}/100 (${grade})**`}${overallDelta ? ` (${overallDelta})` : ''}${verdict ? ` — ${verdict}` : ''}`,
    '',
    `${md(projectLine(report))} · ${report.generatedAt.slice(0, 10)}`,
    '',
  );

  lines.push(
    trend ? '| Category | Score | Δ |' : '| Category | Score |',
    trend ? '|---|---:|---:|' : '|---|---:|',
  );
  for (const c of report.categories) {
    const d = trend
      ? ` ${formatDelta(trend.categories.find((t) => t.id === c.id)?.delta) || ' '} |`
      : '';
    lines.push(`| ${md(categoryLabel(c.id))} | ${scoreCell(c.score)} |${d}`);
  }

  const s = report.summary.findings;
  lines.push(
    '',
    `**Findings:** ${s.critical} critical · ${s.high} high · ${s.medium} medium · ${s.low} low` +
      (trend
        ? ` (${trend.newFindings.length} new, ${trend.resolvedFindings.length} resolved)`
        : ''),
  );

  if (report.thresholds.length) {
    lines.push('', '| | Threshold | Actual | Expected |', '|---|---|---:|---:|');
    for (const t of report.thresholds) {
      lines.push(
        `| ${t.passed ? '✅' : '❌'} | ${md(t.description)} | ${t.actual ?? 'n/a'} | ${md(String(t.expected))} |`,
      );
    }
  }

  const fixes = report.topFixes.slice(0, opts.topFixes ?? 5);
  if (fixes.length) {
    lines.push('', '### Top fixes', '');
    for (const f of fixes) {
      lines.push(
        `${f.rank}. ${SEVERITY_EMOJI[f.severity]} **${md(f.message)}**  `,
        `   ${md(f.fixHint)}`,
      );
    }
  }

  if (trend?.newFindings.length) {
    lines.push('', `<details><summary>New findings (${trend.newFindings.length})</summary>`, '');
    lines.push(...trend.newFindings.slice(0, 20).map(findingLine));
    if (trend.newFindings.length > 20) lines.push(`- …and ${trend.newFindings.length - 20} more`);
    lines.push('', '</details>');
  }
  if (trend?.resolvedFindings.length) {
    lines.push(
      '',
      `<details><summary>Resolved findings (${trend.resolvedFindings.length})</summary>`,
      '',
    );
    lines.push(...trend.resolvedFindings.slice(0, 20).map(findingLine));
    lines.push('', '</details>');
  }

  const notRun = report.checks.filter(
    (c) =>
      c.status !== 'completed' && !/^(not selected|excluded|disabled|opt-in)/.test(c.reason ?? ''),
  );
  if (notRun.length) {
    lines.push('', `<details><summary>Checks not completed (${notRun.length})</summary>`, '');
    for (const c of notRun) lines.push(`- **${c.status}** \`${c.id}\` — ${md(c.reason ?? '')}`);
    lines.push('', '</details>');
  }

  lines.push(
    '',
    `<sub>Generated locally by ${report.tool.name} v${report.tool.version}. The full HTML report has every finding.</sub>`,
    '',
  );
  return lines.join('\n');
}
