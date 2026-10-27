/**
 * ng-health: audit Angular codebases and produce a scored, actionable health report.
 *
 * ```ts
 * import { audit, generateReport } from 'ng-health';
 *
 * const result = await audit('./my-app', { skip: ['performance'] });
 * console.log(result.score.overall, result.passed);
 * await writeFile('report.html', generateReport(result, 'html'));
 * ```
 *
 * The library never prints, writes files or exits the process; it returns data and throws
 * typed errors ({@link ConfigError}, {@link CheckError}, {@link ProjectError}).
 *
 * @packageDocumentation
 */
import { runAudit } from './core/audit.js';
import type { ConfigInput } from './core/config/schema.js';
import type { AuditOptions } from './core/options.js';
import type { AuditReport } from './core/report.js';
import { renderHtml } from './reporters/html.js';
import { renderJson } from './reporters/json.js';
import { renderMarkdown } from './reporters/markdown.js';

/**
 * The result of an audit: scores, findings, top fixes, thresholds and project metadata.
 * Serialized with {@link generateReport}(result, 'json') it matches the published
 * `report.v1.json` schema.
 */
export type AuditResult = AuditReport;

/**
 * The config file shape (`ng-health.config.json` or {@link defineConfig}). Every field is
 * optional; omitted fields take their defaults.
 */
export type Config = ConfigInput;

/** Report formats {@link generateReport} can produce. */
export type ReportFileFormat = 'html' | 'json' | 'md';

/**
 * Audits the Angular project at `path`.
 *
 * Runs every enabled check (dependencies, bundle, Angular code, hygiene and, when Chrome is
 * available, Lighthouse and axe), then scores the results and evaluates thresholds. Nothing is
 * printed and no files are written; use {@link generateReport} to render the result.
 *
 * @param path - The project directory (the one containing `angular.json`).
 * @param options - Overrides for the project's config; see {@link AuditOptions}.
 * @returns The audit result. `result.passed` is `false` when a threshold failed.
 * @throws {@link ProjectError} if `path` is not an Angular project.
 * @throws {@link ConfigError} if the config, options or baseline are invalid.
 * @throws {@link CheckError} if a plugin is invalid or check ids clash.
 * @throws The signal's reason if `options.signal` aborts the audit.
 */
export async function audit(path: string, options: AuditOptions = {}): Promise<AuditResult> {
  return (await runAudit(path, options)).report;
}

/**
 * Renders an audit result as a self-contained HTML report, the versioned JSON report, or a
 * short Markdown summary (for PR comments).
 *
 * @param result - A result from {@link audit}.
 * @param format - `'html'`, `'json'` or `'md'`.
 * @returns The report content; write it wherever you like.
 */
export function generateReport(result: AuditResult, format: ReportFileFormat): string {
  switch (format) {
    case 'html':
      return renderHtml(result);
    case 'json':
      return renderJson(result);
    case 'md':
      return renderMarkdown(result);
    default:
      throw new TypeError(`Unknown report format: ${String(format)}`);
  }
}

/**
 * Identity helper that gives a JavaScript or TypeScript config file type checking and
 * autocomplete:
 *
 * ```ts
 * // ng-health.config.ts
 * import { defineConfig } from 'ng-health';
 * export default defineConfig({ thresholds: { minOverallScore: 80 } });
 * ```
 */
export function defineConfig(config: Config): Config {
  return config;
}

/**
 * Identity helper for writing a custom check with type checking; see {@link Check}.
 * Throw {@link skipCheck} from `run()` when there is nothing to assess.
 */
export { defineCheck, skipCheck, CheckSkipped } from './core/types.js';

export { NgHealthError, ConfigError, CheckError, ProjectError } from './core/errors.js';
export type { NgHealthErrorOptions } from './core/errors.js';

/** Version of the JSON report schema produced by {@link generateReport}(…, 'json'). */
export { REPORT_SCHEMA_VERSION } from './core/report.js';

export type { AuditOptions, AuditProgressEvent } from './core/options.js';
export type {
  Check,
  CheckCategory as Category,
  CheckContext,
  CheckOutput,
  CheckResult,
  CheckStatus,
  Finding,
  ReportedFinding,
  Severity,
} from './core/types.js';
export type { Config as ResolvedConfig, RuntimeConfig, Thresholds } from './core/config/schema.js';
export type { ProjectInfo, AngularProjectInfo, PackageManager } from './core/detect/index.js';
export type { ReportCheck } from './core/report.js';
export type { CategoryScore, Grade } from './core/scoring.js';
export type { ThresholdResult } from './core/thresholds.js';
export type { TopFix } from './core/top-fixes.js';
export type { Trend } from './core/baseline.js';
export type { Logger } from './core/logger.js';
export type { ExecFn, ExecResult, ExecOptions } from './core/exec.js';
