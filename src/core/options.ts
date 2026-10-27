import path from 'node:path';
import type { Config, ReportFormat } from './config/schema.js';
import { REPORT_FORMATS } from './config/schema.js';
import { FeHealthError } from './errors.js';

/** Raw CLI flags for `audit`, as parsed by commander. */
export interface AuditCliFlags {
  format?: string[];
  out?: string;
  only?: string[];
  skip?: string[];
  ci?: boolean;
  verbose?: boolean;
  config?: string;
  /** commander maps --no-build to build: false */
  build?: boolean;
  offline?: boolean;
}

/** Fully-resolved audit options: CLI flags merged over config. */
export interface AuditOptions {
  projectPath: string;
  formats: ReportFormat[];
  outDir: string;
  only: string[] | undefined;
  skip: string[];
  ci: boolean;
  verbose: boolean;
  configFile: string | undefined;
  build: boolean;
  offline: boolean;
}

/** Splits repeated and comma-separated values: ["html,json", "md"] → ["html","json","md"]. */
export function splitList(values: string[] | undefined): string[] {
  return (values ?? [])
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

export function parseFormats(values: string[]): ReportFormat[] {
  const formats = splitList(values);
  const invalid = formats.filter((f) => !(REPORT_FORMATS as readonly string[]).includes(f));
  if (invalid.length) {
    throw new FeHealthError(`Unknown report format: ${invalid.join(', ')}`, {
      hint: `Supported formats: ${REPORT_FORMATS.join(', ')}`,
    });
  }
  return [...new Set(formats)] as ReportFormat[];
}

export function resolveAuditOptions(
  projectPath: string,
  flags: AuditCliFlags,
  config: Config,
  configFile: string | undefined,
  cwd = process.cwd(),
): AuditOptions {
  const ci = Boolean(flags.ci);
  const cliFormats = parseFormats(flags.format ?? []);
  let formats = cliFormats.length ? cliFormats : [...config.output.formats];
  // CI logs are read by humans in a log viewer: always include the Markdown summary.
  if (ci && !formats.includes('md')) formats = [...formats, 'md'];

  const only = splitList(flags.only);
  return {
    projectPath: path.resolve(cwd, projectPath),
    formats,
    outDir: path.resolve(cwd, flags.out ?? config.output.dir),
    only: only.length ? only : config.only,
    skip: [...new Set([...config.skip, ...splitList(flags.skip)])],
    ci,
    verbose: Boolean(flags.verbose),
    configFile,
    build: flags.build !== false,
    offline: Boolean(flags.offline) || config.offline,
  };
}
