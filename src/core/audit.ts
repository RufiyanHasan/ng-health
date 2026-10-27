import path from 'node:path';
import pc from 'picocolors';
import { loadConfig } from './config/loader.js';
import { detectProject, type ProjectInfo } from './detect/index.js';
import { ExitCode, FeHealthError } from './errors.js';
import { isDirectory } from './fs.js';
import type { Logger } from './logger.js';
import { resolveAuditOptions, type AuditCliFlags, type AuditOptions } from './options.js';
import { createProgress } from './progress.js';

export interface AuditOutcome {
  exitCode: ExitCode;
  options: AuditOptions;
  project: ProjectInfo;
}

export async function audit(
  projectPath: string,
  flags: AuditCliFlags,
  logger: Logger,
): Promise<AuditOutcome> {
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

  return { exitCode: ExitCode.Pass, options, project };
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
