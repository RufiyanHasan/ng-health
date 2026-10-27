import path from 'node:path';
import type { AuditReport } from './report.js';
import type { Config, ConfigInput, RuntimeConfig } from './config/schema.js';
import type { ProjectInfo } from './detect/index.js';
import { ConfigError } from './errors.js';
import type { Logger } from './logger.js';
import type { CheckStatus } from './types.js';

/** Options for {@link audit}. Every field is optional; the project config fills the gaps. */
export interface AuditOptions {
  /**
   * A config file path (relative to the current directory) or an inline config object.
   * Default: `ng-health.config.json` in the project root, if present.
   */
  config?: string | ConfigInput;
  /** Run only these check ids or categories, e.g. `['angular', 'bundle/size']`. */
  only?: string[];
  /** Skip these check ids or categories (added to the config's `skip`). */
  skip?: string[];
  /** A previous result (or the path of its JSON report) to compute score deltas against. */
  baseline?: string | AuditReport;
  /** Audit a running app with the runtime checks instead of serving the local build. */
  url?: string;
  /** Routes for Lighthouse and axe. Default: `['/']`. */
  routes?: string[];
  /** Module that logs in before the runtime checks (path relative to the current directory). */
  loginScript?: string;
  /** Set `false` to reuse the existing build output instead of running `ng build`. Default `true`. */
  build?: boolean;
  /** Never touch the network (skips registry lookups). Default: the config's `offline`. */
  offline?: boolean;
  /** Cancels the audit: running checks stop, Chrome and the local server are shut down. */
  signal?: AbortSignal;
  /** Progress notifications, e.g. to drive a spinner. */
  onProgress?: (event: AuditProgressEvent) => void;
  /** Receives debug and warning messages. The library is silent without one. */
  logger?: Logger;
}

/** Progress notifications emitted through `AuditOptions.onProgress`, in this order: `project-detected`, `checks-started`, then one `check-finished` per selected check. */
export type AuditProgressEvent =
  | { type: 'project-detected'; project: ProjectInfo }
  | { type: 'checks-started'; total: number }
  | { type: 'check-finished'; checkId: string; status: CheckStatus; done: number; total: number };

/** Options after merging over the config. Internal. */
export interface ResolvedOptions {
  projectPath: string;
  only: string[] | undefined;
  skip: string[];
  build: boolean;
  offline: boolean;
  /** Runtime settings with overrides applied and loginScript made absolute. */
  runtime: RuntimeConfig;
}

export function resolveOptions(
  projectPath: string,
  options: AuditOptions,
  config: Config,
  configFile: string | undefined,
  cwd = process.cwd(),
): ResolvedOptions {
  return {
    projectPath: path.resolve(cwd, projectPath),
    only: options.only?.length ? options.only : config.only,
    skip: [...new Set([...config.skip, ...(options.skip ?? [])])],
    build: options.build !== false,
    offline: Boolean(options.offline) || config.offline,
    runtime: resolveRuntime(options, config, configFile, cwd),
  };
}

function resolveRuntime(
  options: AuditOptions,
  config: Config,
  configFile: string | undefined,
  cwd: string,
): RuntimeConfig {
  const routes = options.routes ?? [];
  for (const r of routes) {
    if (!r.startsWith('/')) throw new ConfigError(`Routes must start with "/": ${r}`);
  }
  if (options.url) {
    try {
      new URL(options.url);
    } catch {
      throw new ConfigError(`Invalid url: ${options.url}`);
    }
  }
  // Option paths are relative to the working directory, config paths to the config file.
  const configDir = configFile ? path.dirname(configFile) : cwd;
  const loginScript = options.loginScript
    ? path.resolve(cwd, options.loginScript)
    : config.runtime.loginScript
      ? path.resolve(configDir, config.runtime.loginScript)
      : undefined;
  return {
    ...config.runtime,
    ...(options.url ? { url: options.url } : {}),
    ...(routes.length ? { routes } : {}),
    ...(loginScript ? { loginScript } : {}),
  };
}
