import path from 'node:path';
import { REPORT_FORMATS, type Config, type ReportFormat } from '../core/config/schema.js';
import { ConfigError } from '../core/errors.js';
import type { AuditOptions } from '../core/options.js';

/** Raw `audit` flags as parsed by commander. */
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
  url?: string;
  routes?: string[];
  loginScript?: string;
  baseline?: string;
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
    throw new ConfigError(`Unknown report format: ${invalid.join(', ')}`, {
      hint: `Supported formats: ${REPORT_FORMATS.join(', ')}`,
    });
  }
  return [...new Set(formats)] as ReportFormat[];
}

/** Maps CLI flags onto the library's options (validation happens in the library). */
export function toAuditOptions(flags: AuditCliFlags): AuditOptions {
  const list = (v: string[] | undefined) => {
    const items = splitList(v);
    return items.length ? items : undefined;
  };
  const only = list(flags.only);
  const skip = list(flags.skip);
  const routes = list(flags.routes);
  return {
    ...(flags.config ? { config: flags.config } : {}),
    ...(only ? { only } : {}),
    ...(skip ? { skip } : {}),
    ...(routes ? { routes } : {}),
    ...(flags.url ? { url: flags.url } : {}),
    ...(flags.loginScript ? { loginScript: flags.loginScript } : {}),
    ...(flags.baseline ? { baseline: flags.baseline } : {}),
    ...(flags.build === false ? { build: false } : {}),
    ...(flags.offline ? { offline: true } : {}),
  };
}

export interface OutputPlan {
  formats: ReportFormat[];
  outDir: string;
}

/** Which reports to produce and where: flags win over the config's `output` section. */
export function resolveOutput(
  flags: AuditCliFlags,
  config: Config,
  cwd = process.cwd(),
): OutputPlan {
  const cliFormats = parseFormats(flags.format ?? []);
  let formats = cliFormats.length ? cliFormats : [...config.output.formats];
  if (flags.ci) {
    // CI prints the Markdown summary instead of the console table (unless --format console
    // was asked for explicitly), and always writes the .md file for PR comments.
    if (!cliFormats.includes('console')) formats = formats.filter((f) => f !== 'console');
    if (!formats.includes('md')) formats = [...formats, 'md'];
  }
  return { formats, outDir: path.resolve(cwd, flags.out ?? config.output.dir) };
}
