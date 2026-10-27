import path from 'node:path';
import pc from 'picocolors';
import { githubAnnotations, writeStepSummary } from '../../ci/github.js';
import { runAudit, type AuditDeps } from '../../core/audit.js';
import type { ProjectInfo } from '../../core/detect/index.js';
import { ExitCode, errorMessage } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import { createProgress } from '../../core/progress.js';
import type { AuditReport } from '../../core/report.js';
import { renderMarkdown, writeReports } from '../../reporters/index.js';
import { parseFormats, resolveOutput, toAuditOptions, type AuditCliFlags } from '../flags.js';

export interface AuditCommandResult {
  exitCode: ExitCode;
  report: AuditReport;
  files: string[];
}

export interface AuditCommandDeps extends AuditDeps {
  /** Environment for CI integration (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

/**
 * `ng-health audit`: a thin wrapper over the library. It adds what the library deliberately
 * doesn't do: the spinner, report files, console/CI output and the exit code.
 */
export async function auditCommand(
  projectPath: string,
  flags: AuditCliFlags,
  logger: Logger,
  deps: AuditCommandDeps = {},
): Promise<AuditCommandResult> {
  parseFormats(flags.format ?? []); // reject bad --format before spending time on checks
  const progress = createProgress(!flags.ci && !flags.verbose);
  progress.start('Detecting project setup…');
  let run;
  try {
    run = await runAudit(
      projectPath,
      {
        ...toAuditOptions(flags),
        logger,
        ...(deps.signal ? { signal: deps.signal } : {}),
        onProgress: (event) => {
          if (event.type === 'project-detected') {
            progress.succeed(`Detected ${describeProject(event.project)}`);
            if (!progress.active) logger.info(`Detected ${describeProject(event.project)}`);
          } else if (event.type === 'checks-started') {
            progress.start(`Running ${event.total} checks…`);
          } else {
            progress.update(
              `Running checks (${event.done}/${event.total}) — finished ${event.checkId}`,
            );
          }
        },
      },
      deps,
    );
  } catch (err) {
    progress.fail();
    throw err;
  }
  progress.stop();

  const { report, config, project } = run;
  const { formats, outDir } = resolveOutput(flags, config);
  const files = await writeReports(report, formats, outDir, logger);
  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    logger.info(`Report written: ${rel.startsWith('..') ? file : rel}`);
  }

  if (flags.ci) await ciOutput(report, project.root, logger, deps.env ?? process.env);
  const failed = report.thresholds.filter((t) => !t.passed);
  if (failed.length) {
    logger.error(
      `Quality gate failed: ${failed.map((t) => `${t.description} ${t.actual ?? 'n/a'} (expected ${t.expected})`).join('; ')}`,
    );
  } else if (report.thresholds.length) {
    logger.success('Quality gate passed');
  }

  return { exitCode: report.passed ? ExitCode.Pass : ExitCode.ThresholdFailed, report, files };
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

/** CI mode: Markdown summary on stdout; on GitHub Actions also annotations and the job summary. */
async function ciOutput(report: AuditReport, root: string, logger: Logger, env: NodeJS.ProcessEnv) {
  const markdown = renderMarkdown(report);
  logger.out(markdown);
  if (env['GITHUB_ACTIONS'] !== 'true') return;
  for (const line of githubAnnotations(report, root, env['GITHUB_WORKSPACE'] ?? process.cwd())) {
    logger.out(line);
  }
  if (env['GITHUB_STEP_SUMMARY']) {
    try {
      await writeStepSummary(env['GITHUB_STEP_SUMMARY'], markdown);
    } catch (err) {
      logger.warn(`Could not write the GitHub job summary: ${errorMessage(err)}`);
    }
  }
}
