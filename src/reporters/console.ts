import pc from 'picocolors';
import type { AuditReport } from '../core/report.js';

const scoreColor = (score: number | undefined) =>
  score === undefined ? pc.dim : score >= 80 ? pc.green : score >= 60 ? pc.yellow : pc.red;

const fmtScore = (score: number | undefined) =>
  scoreColor(score)(score === undefined ? '  –' : String(score).padStart(3));

/** Compact console summary. */
export function renderConsole(report: AuditReport): string {
  const lines: string[] = [];
  const { overall, grade } = report.score;
  lines.push('');
  lines.push(
    `${pc.bold('Overall score')}  ${fmtScore(overall)}${grade ? ` ${scoreColor(overall)(`(${grade})`)}` : ''}`,
  );
  for (const c of report.categories) lines.push(`  ${c.id.padEnd(14)} ${fmtScore(c.score)}`);

  const f = report.summary.findings;
  lines.push('');
  lines.push(
    `Findings: ${pc.red(`${f.critical} critical`)}, ${pc.magenta(`${f.high} high`)}, ${pc.yellow(`${f.medium} medium`)}, ${pc.dim(`${f.low} low`)}`,
  );
  for (const c of report.checks.filter((c) => c.status !== 'completed')) {
    const label = c.status === 'errored' ? pc.red('errored') : pc.dim('skipped');
    lines.push(`  ${label} ${c.id}${c.reason ? pc.dim(` — ${c.reason}`) : ''}`);
  }
  if (report.thresholds.length) {
    lines.push('');
    for (const t of report.thresholds) {
      const mark = t.passed ? pc.green('✔') : pc.red('✖');
      lines.push(`${mark} ${t.description}: ${t.actual ?? 'n/a'} (expected ${t.expected})`);
    }
  }
  if (!report.checks.some((c) => c.status === 'completed')) {
    lines.push(pc.yellow('No checks completed — nothing was scored.'));
  }
  return lines.join('\n');
}
