// Public API for embedding fe-health and for writing check plugins.
export { audit, type AuditOutcome } from './core/audit.js';
export { loadConfig, parseConfig } from './core/config/loader.js';
export * from './core/config/schema.js';
export {
  detectProject,
  type ProjectInfo,
  type AngularProjectInfo,
  type PackageManager,
} from './core/detect/index.js';
export { ExitCode, FeHealthError } from './core/errors.js';
export type { Logger } from './core/logger.js';
export type { AuditOptions } from './core/options.js';
export type { AuditReport, ReportCheck } from './core/report.js';
export { REPORT_SCHEMA_VERSION } from './core/report.js';
export { ReportSchema, reportJsonSchema } from './core/report-schema.js';
export { computeTrend, loadBaseline, type Trend } from './core/baseline.js';
export type { TopFix } from './core/top-fixes.js';
export {
  renderConsole,
  renderHtml,
  renderJson,
  renderMarkdown,
  writeReports,
} from './reporters/index.js';
export type { CategoryScore, Grade, ScoreSummary } from './core/scoring.js';
export type { ThresholdResult } from './core/thresholds.js';
export {
  defineCheck,
  skipCheck,
  CheckSkipped,
  type Check,
  type CheckCategory,
  type CheckContext,
  type CheckOutput,
  type CheckResult,
  type CheckStatus,
  type Finding,
  type ReportedFinding,
} from './core/types.js';
export { VERSION } from './version.js';
