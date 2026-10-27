import Table from 'cli-table3';
import pc from 'picocolors';
import type { Severity } from '../core/config/schema.js';
import type { AuditReport } from '../core/report.js';
import { band, categoryLabel, findingsByCategory, formatDelta, projectLine } from './format.js';

const BAND_COLOR = { good: pc.green, ok: pc.yellow, poor: pc.red, none: pc.dim } as const;
const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  critical: (s) => pc.bold(pc.red(s)),
  high: pc.red,
  medium: pc.yellow,
  low: pc.dim,
};

const colorScore = (score: number | undefined, text = score === undefined ? '–' : String(score)) =>
  BAND_COLOR[band(score)](text);

const colorDelta = (delta: number | undefined) => {
  const t = formatDelta(delta);
  return delta === undefined || delta === 0 ? pc.dim(t) : delta > 0 ? pc.green(t) : pc.red(t);
};

/** Colored terminal summary. */
export function renderConsole(report: AuditReport, opts: { topFixes?: number } = {}): string {
  const out: string[] = [''];
  const { overall, grade } = report.score;
  const trend = report.trend;
  out.push(pc.bold(projectLine(report)));
  out.push(
    `${pc.bold('Overall score')} ${colorScore(overall, overall === undefined ? 'not scored' : `${overall} (${grade})`)}` +
      (trend ? `  ${colorDelta(trend.overall.delta)} vs baseline` : ''),
  );

  const perCategory = findingsByCategory(report);
  const head = ['Category', 'Score', 'Findings', ...(trend ? ['Δ'] : [])];
  const table = new Table({
    head: head.map((h) => pc.bold(h)),
    style: { head: [], border: [] },
    colAligns: ['left', 'right', 'right', 'right'],
  });
  for (const c of report.categories) {
    table.push([
      categoryLabel(c.id),
      colorScore(c.score),
      String(perCategory.get(c.id) ?? 0),
      ...(trend ? [colorDelta(trend.categories.find((t) => t.id === c.id)?.delta)] : []),
    ]);
  }
  if (report.categories.length) out.push(table.toString());

  const s = report.summary.findings;
  out.push(
    `Findings: ${SEVERITY_COLOR.critical(`${s.critical} critical`)} · ${SEVERITY_COLOR.high(`${s.high} high`)} · ` +
      `${SEVERITY_COLOR.medium(`${s.medium} medium`)} · ${SEVERITY_COLOR.low(`${s.low} low`)}` +
      (trend
        ? pc.dim(` (${trend.newFindings.length} new, ${trend.resolvedFindings.length} resolved)`)
        : ''),
  );

  const fixes = report.topFixes.slice(0, opts.topFixes ?? 5);
  if (fixes.length) {
    out.push('', pc.bold('Top fixes'));
    for (const f of fixes) {
      out.push(
        `${String(f.rank).padStart(3)}. ${SEVERITY_COLOR[f.severity](`[${f.severity}]`)} ${f.message}`,
      );
      out.push(`     ${pc.dim('→')} ${pc.dim(f.fixHint)}`);
    }
  }

  const notRun = report.checks.filter(
    (c) =>
      c.status === 'errored' ||
      (c.status === 'skipped' && !/^(not selected|excluded|disabled|opt-in)/.test(c.reason ?? '')),
  );
  if (notRun.length) {
    out.push('', pc.bold('Checks not completed'));
    for (const c of notRun) {
      const label = c.status === 'errored' ? pc.red('errored') : pc.yellow('skipped');
      out.push(`  ${label} ${c.id}${c.reason ? pc.dim(` — ${c.reason}`) : ''}`);
    }
  }

  if (report.thresholds.length) {
    out.push('', pc.bold('Thresholds'));
    for (const t of report.thresholds) {
      out.push(
        `  ${t.passed ? pc.green('✔') : pc.red('✖')} ${t.description}: ${t.actual ?? 'n/a'} ${pc.dim(`(expected ${t.expected})`)}`,
      );
    }
  }
  if (!report.checks.some((c) => c.status === 'completed')) {
    out.push(pc.yellow('No checks completed — nothing was scored.'));
  }
  return out.join('\n');
}
