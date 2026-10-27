import type { Config, Severity } from './config/schema.js';
import type { ProjectInfo } from './detect/index.js';
import type { ExecFn } from './exec.js';
import type { Logger } from './logger.js';

export type { Severity } from './config/schema.js';

/** Well-known categories. Plugins may use their own category strings. */
export type CheckCategory =
  | 'dependencies'
  | 'bundle'
  | 'angular'
  | 'hygiene'
  | 'performance'
  | 'accessibility'
  | (string & {});

export interface Finding {
  severity: Severity;
  message: string;
  /** Path relative to the project root, POSIX separators. */
  file?: string;
  line?: number;
  column?: number;
  /** What to do about it. Required: every finding must be actionable. */
  fixHint: string;
  docsUrl?: string;
  /** Stable sub-rule id within the check, e.g. "missing-onpush". Groups findings for "Top fixes". */
  ruleId?: string;
}

export interface CheckOutput {
  /** 0–100. If omitted, the score is derived from finding severities. */
  score?: number;
  findings: Finding[];
  /** Check-specific data surfaced in reports (e.g. bundle sizes, Lighthouse scores). */
  meta?: Record<string, unknown>;
}

export interface CheckContext {
  /** Absolute project root. */
  root: string;
  project: ProjectInfo;
  config: Config;
  /** `checks.<id>.options` from the config (category-level options merged under check-level). */
  options: Record<string, unknown>;
  logger: Logger;
  /** Aborted when the check times out; pass it to child processes and long loops. */
  signal: AbortSignal;
  offline: boolean;
  /** False when the user passed --no-build: reuse existing build output. */
  build: boolean;
  /** Current time; injectable so date-based checks (support windows) are testable. */
  now(): Date;
  /** Runs a command (no shell) in the project root by default; aborted on timeout. */
  exec: ExecFn;
  /** Globs project files (relative POSIX paths), honouring the configured ignore globs. */
  glob(patterns: string | string[], opts?: { cwd?: string }): Promise<string[]>;
  /** Reads a file relative to the project root. */
  readText(relPath: string): Promise<string>;
  /** Memoised async values shared by all checks in one audit (e.g. a parsed TS project). */
  shared<T>(key: string, factory: () => Promise<T>): Promise<T>;
}

export interface Check {
  /** Unique, kebab-case, namespaced by category: "angular/onpush". */
  id: string;
  name: string;
  category: CheckCategory;
  description?: string;
  /** 'runtime' checks need a browser; 'static' (default) only read files. */
  kind?: 'static' | 'runtime';
  /** Not safe to run concurrently with other checks (builds, browsers). */
  exclusive?: boolean;
  /** Default timeout; overridable via config `checks.<id>.timeoutMs`. */
  timeoutMs?: number;
  /** Set false for opt-in checks. */
  enabledByDefault?: boolean;
  run(ctx: CheckContext): Promise<CheckOutput> | CheckOutput;
}

export type CheckStatus = 'completed' | 'errored' | 'skipped';

export interface ReportedFinding extends Finding {
  checkId: string;
  category: string;
  /** Stable across runs (no line numbers); used for baseline diffs. */
  fingerprint: string;
}

export interface CheckResult {
  id: string;
  name: string;
  category: string;
  status: CheckStatus;
  /** Present when status is 'completed'. */
  score: number | undefined;
  weight: number;
  findings: ReportedFinding[];
  durationMs: number;
  /** Error message (errored) or reason (skipped). */
  reason?: string;
  meta?: Record<string, unknown>;
}

/** Identity helper giving plugin authors type checking and autocomplete. */
export function defineCheck(check: Check): Check {
  return check;
}

/** Throw from `run()` to mark the check as skipped (e.g. "Chromium not available"). */
export class CheckSkipped extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'CheckSkipped';
  }
}

export function skipCheck(reason: string): never {
  throw new CheckSkipped(reason);
}
