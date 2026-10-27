import path from 'node:path';
import { loadConfig } from '../../src/core/config/loader.js';
import { DEFAULT_SEVERITY_PENALTIES } from '../../src/core/config/schema.js';
import { createBaseContext } from '../../src/core/context.js';
import { detectProject } from '../../src/core/detect/index.js';
import type { ExecFn, ExecResult } from '../../src/core/exec.js';
import { silentLogger } from '../../src/core/logger.js';
import { selectChecks } from '../../src/core/registry.js';
import { runCheck, type BaseContext } from '../../src/core/runner.js';
import type { Check, CheckResult } from '../../src/core/types.js';

export const FIXTURES = path.resolve(import.meta.dirname, '../fixtures');
export const fixture = (name: 'healthy' | 'unhealthy') => path.join(FIXTURES, name);

export interface RunOptions {
  options?: Record<string, unknown>;
  context?: Partial<BaseContext>;
}

/** Runs one check against a project directory with its real config, like the audit would. */
export async function runOn(
  check: Check,
  root: string,
  opts: RunOptions = {},
): Promise<CheckResult> {
  const project = await detectProject(root);
  const { config } = await loadConfig(root);
  // Tests must never touch the network or spawn real tools unless they stub exec.
  const base = createBaseContext(project, config, silentLogger, {
    exec: unexpectedExec,
    ...opts.context,
  });
  const settings =
    selectChecks([check], config, { only: [check.id], skip: [] }).selected[0]?.settings ?? {};
  return runCheck(
    { check, settings: { ...settings, options: { ...settings.options, ...opts.options } } },
    base,
    { severityPenalties: DEFAULT_SEVERITY_PENALTIES },
  );
}

const unexpectedExec: ExecFn = async (cmd, args) => {
  throw new Error(`Unexpected exec in test: ${[cmd, ...args].join(' ')}`);
};

/** Compact, order-preserving view of findings for exact assertions. */
export const summarize = (r: CheckResult) =>
  r.findings.map((f) => [f.severity, f.file ?? null, f.line ?? null, f.message]);

/** A fake exec that answers by "command args…" prefix and records every call. */
export function fakeExec(
  responses: Record<string, Partial<ExecResult> | (() => Partial<ExecResult>)>,
) {
  const calls: string[] = [];
  const exec: ExecFn = async (cmd, args) => {
    const key = [path.basename(cmd), ...args].join(' ');
    calls.push(key);
    const match = Object.keys(responses)
      .sort((a, b) => b.length - a.length)
      .find((k) => key.startsWith(k));
    if (!match) return { stdout: '', stderr: `no stub for: ${key}`, exitCode: 1 };
    const r = responses[match];
    const res = typeof r === 'function' ? r() : r;
    return { stdout: '', stderr: '', exitCode: 0, ...res };
  };
  return { exec, calls };
}
