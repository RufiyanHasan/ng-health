import path from 'node:path';
import pc from 'picocolors';
import { builtinChecks } from '../checks/index.js';
import { renderConsole } from '../reporters/console.js';
import { loadConfig } from './config/loader.js';
import { DEFAULT_SEVERITY_PENALTIES } from './config/schema.js';
import { createBaseContext } from './context.js';
import { detectProject, type ProjectInfo } from './detect/index.js';
import { ExitCode, FeHealthError } from './errors.js';
import { isDirectory } from './fs.js';
import type { Logger } from './logger.js';
import { resolveAuditOptions, type AuditCliFlags, type AuditOptions } from './options.js';
import { loadPlugins } from './plugins.js';
import { createProgress } from './progress.js';
import { selectChecks, validateRegistry } from './registry.js';
import { buildReport, type AuditReport } from './report.js';
import { runChecks, type BaseContext } from './runner.js';
import { computeScores } from './scoring.js';
import { evaluateThresholds } from './thresholds.js';
import type { Check, CheckResult } from './types.js';

export interface AuditOutcome {
  exitCode: ExitCode;
  options: AuditOptions;
  project: ProjectInfo;
  report: AuditReport;
}

export interface AuditDeps {
  /** Override the built-in checks (tests, embedding). */
  checks?: Check[];
  /** Override context pieces (tests inject exec/now). */
  context?: Partial<BaseContext>;
}

export async function audit(
  projectPath: string,
  flags: AuditCliFlags,
  logger: Logger,
  deps: AuditDeps = {},
): Promise<AuditOutcome> {
  const startedAt = new Date();
  const absPath = path.resolve(projectPath);
  if (!(await isDirectory(absPath))) {
    throw new FeHealthError(`Project path does not exist or is not a directory: ${absPath}`);
  }
  const { config, file } = await loadConfig(absPath, flags.config);
  const options = resolveAuditOptions(projectPath, flags, config, file);
  logger.debug(file ? `Using config ${file}` : 'No config file found, using defaults');
  logger.debug(`Options: ${JSON.stringify(options)}`);

  const progress = createProgress(!options.ci && !options.verbose);
  progress.start('Detecting project setup…');
  let project: ProjectInfo;
  try {
    project = await detectProject(absPath);
  } catch (err) {
    progress.fail('Project detection failed');
    throw err;
  }
  progress.succeed(`Detected ${describeProject(project)}`);
  if (!progress.active) logger.info(`Detected ${describeProject(project)}`);

  const plugins = await loadPlugins(config.plugins, file ? path.dirname(file) : absPath, absPath);
  const allChecks = [...(deps.checks ?? builtinChecks), ...plugins];
  validateRegistry(allChecks);
  const selection = selectChecks(allChecks, config, options);
  for (const token of selection.unknownTokens) {
    logger.warn(`"${token}" does not match any check id or category`);
  }

  const total = selection.selected.length;
  progress.start(`Running ${total} checks…`);
  const context = createBaseContext(project, config, logger, {
    build: options.build,
    offline: options.offline,
    runtime: options.runtime,
    ...deps.context,
  });
  let ran: CheckResult[];
  try {
    ran = await runChecks(selection.selected, context, {
      severityPenalties: { ...DEFAULT_SEVERITY_PENALTIES, ...config.severityPenalties },
      onStart: (check) => logger.debug(`Starting ${check.id}`),
      onDone: (r, done) => {
        progress.update(`Running checks (${done}/${total}) — finished ${r.id}`);
        logger.debug(
          `Finished ${r.id}: ${r.status}${r.reason ? ` (${r.reason})` : ''} in ${r.durationMs}ms`,
        );
      },
    });
  } finally {
    await context.dispose();
  }
  progress.stop();

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
  const report = buildReport({ project, results, scores, thresholds, startedAt });

  if (options.formats.includes('console')) logger.out(renderConsole(report));

  return {
    exitCode: report.passed ? ExitCode.Pass : ExitCode.ThresholdFailed,
    options,
    project,
    report,
  };
}

export function describeProject(p: ProjectInfo): string {
  const parts = [
    pc.bold(p.name),
    p.angular.major !== undefined
      ? `Angular ${p.angular.installed ?? p.angular.declared}`
      : 'Angular (version unknown)',
    p.packageManager,
    p.kind === 'workspace' ? `workspace (${p.projects.length} projects)` : 'single app',
  ];
  if (p.ssr) parts.push('SSR');
  if (p.nx) parts.push('Nx');
  return parts.join(' · ');
}
