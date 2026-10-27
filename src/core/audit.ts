import path from 'node:path';
import { builtinChecks } from '../checks/index.js';
import { computeTrend, loadBaseline } from './baseline.js';
import { loadConfig } from './config/loader.js';
import { DEFAULT_SEVERITY_PENALTIES, type Config } from './config/schema.js';
import { createBaseContext } from './context.js';
import { detectProject, type ProjectInfo } from './detect/index.js';
import { ProjectError } from './errors.js';
import { isDirectory } from './fs.js';
import { silentLogger } from './logger.js';
import { resolveOptions, type AuditOptions, type ResolvedOptions } from './options.js';
import { loadPlugins } from './plugins.js';
import { selectChecks, validateRegistry } from './registry.js';
import { buildReport, type AuditReport } from './report.js';
import { runChecks, type BaseContext } from './runner.js';
import { computeScores } from './scoring.js';
import { evaluateThresholds } from './thresholds.js';
import { topFixes } from './top-fixes.js';
import type { Check, CheckResult } from './types.js';

/** Everything an audit produced; the public API returns only `report`. */
export interface AuditRun {
  report: AuditReport;
  project: ProjectInfo;
  config: Config;
  configFile: string | undefined;
  options: ResolvedOptions;
}

/** Test and embedding hooks. Not part of the public API. */
export interface AuditDeps {
  /** Override the built-in checks. */
  checks?: Check[];
  /** Override context pieces (tests inject exec/now). */
  context?: Partial<BaseContext>;
}

/**
 * Runs an audit and returns the result. Pure in the sense the CLI relies on: no console output,
 * no report files, no process.exit. Throws NgHealthError subclasses for invalid input.
 */
export async function runAudit(
  projectPath: string,
  options: AuditOptions = {},
  deps: AuditDeps = {},
): Promise<AuditRun> {
  const startedAt = new Date();
  const logger = options.logger ?? silentLogger;
  const signal = options.signal;
  signal?.throwIfAborted();

  const absPath = path.resolve(projectPath);
  if (!(await isDirectory(absPath))) {
    throw new ProjectError(`Project path does not exist or is not a directory: ${absPath}`);
  }
  const { config, file } = await loadConfig(absPath, options.config);
  const resolved = resolveOptions(projectPath, options, config, file);
  logger.debug(file ? `Using config ${file}` : 'No config file found, using defaults');
  logger.debug(`Options: ${JSON.stringify(resolved)}`);
  // Fail fast on a bad baseline, before spending minutes on checks.
  const baseline =
    typeof options.baseline === 'string' ? await loadBaseline(options.baseline) : options.baseline;

  const project = await detectProject(absPath);
  options.onProgress?.({ type: 'project-detected', project });

  const plugins = await loadPlugins(config.plugins, file ? path.dirname(file) : absPath, absPath);
  const allChecks = [...(deps.checks ?? builtinChecks), ...plugins];
  validateRegistry(allChecks);
  const selection = selectChecks(allChecks, config, resolved);
  for (const token of selection.unknownTokens) {
    logger.warn(`"${token}" does not match any check id or category`);
  }

  const total = selection.selected.length;
  const penalties = { ...DEFAULT_SEVERITY_PENALTIES, ...config.severityPenalties };
  options.onProgress?.({ type: 'checks-started', total });
  const context = createBaseContext(project, config, logger, {
    build: resolved.build,
    offline: resolved.offline,
    runtime: resolved.runtime,
    ...deps.context,
  });
  let ran: CheckResult[];
  try {
    ran = await runChecks(selection.selected, context, {
      severityPenalties: penalties,
      ...(signal ? { signal } : {}),
      onStart: (check) => logger.debug(`Starting ${check.id}`),
      onDone: (r, done) => {
        options.onProgress?.({
          type: 'check-finished',
          checkId: r.id,
          status: r.status,
          done,
          total,
        });
        logger.debug(
          `Finished ${r.id}: ${r.status}${r.reason ? ` (${r.reason})` : ''} in ${r.durationMs}ms`,
        );
      },
    });
  } finally {
    // Always stop the local server and Chrome, including when the audit was cancelled.
    await context.dispose();
  }
  signal?.throwIfAborted();

  // Report every registered check, in registry order, including excluded ones.
  const ranById = new Map(ran.map((r) => [r.id, r]));
  const excludedById = new Map(selection.excluded.map((e) => [e.check.id, e.reason]));
  const results: CheckResult[] = allChecks.map(
    (c) =>
      ranById.get(c.id) ?? {
        id: c.id,
        name: c.name,
        category: c.category,
        status: 'skipped',
        score: undefined,
        weight: 1,
        findings: [],
        durationMs: 0,
        reason: excludedById.get(c.id) ?? 'not run',
      },
  );

  const scores = computeScores(results, config);
  const findings = results.flatMap((r) => r.findings);
  const thresholds = evaluateThresholds(config.thresholds, scores, findings, results);
  const fixes = topFixes(
    findings,
    new Map(allChecks.map((c) => [c.id, c.name])),
    config,
    penalties,
  );
  const report = buildReport({ project, results, scores, thresholds, topFixes: fixes, startedAt });
  if (baseline) report.trend = computeTrend(baseline, report);

  return { report, project, config, configFile: file, options: resolved };
}
