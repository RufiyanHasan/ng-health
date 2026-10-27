import { availableParallelism } from 'node:os';
import { z } from 'zod';
import { SeveritySchema, type Severity } from './config/schema.js';
import { errorMessage } from './errors.js';
import { fingerprint } from './fingerprint.js';
import type { SelectedCheck } from './registry.js';
import type { CheckContext, CheckOutput, CheckResult, Check } from './types.js';
import { CheckSkipped } from './types.js';

export const DEFAULT_TIMEOUT_MS = 120_000;

const FindingSchema = z.object({
  severity: SeveritySchema,
  message: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  fixHint: z.string().min(1),
  docsUrl: z.string().optional(),
  ruleId: z.string().optional(),
});

const CheckOutputSchema = z.object({
  score: z.number().min(0).max(100).optional(),
  findings: z.array(FindingSchema),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** Base context shared by all checks; the runner adds per-check options, logger and signal. */
export type BaseContext = Omit<CheckContext, 'options' | 'signal' | 'logger'> & {
  logger: CheckContext['logger'];
};

export interface RunnerOptions {
  concurrency?: number;
  severityPenalties: Record<Severity, number>;
  onStart?: (check: Check) => void;
  onDone?: (result: CheckResult, done: number, total: number) => void;
}

export function deriveScore(
  findings: { severity: Severity }[],
  penalties: Record<Severity, number>,
): number {
  const penalty = findings.reduce((sum, f) => sum + penalties[f.severity], 0);
  return Math.max(0, 100 - penalty);
}

class TimeoutError extends Error {}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(
        new TimeoutError(`Timed out after ${ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`}`),
      );
      reject(controller.signal.reason as Error);
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runCheck(
  { check, settings }: SelectedCheck,
  base: BaseContext,
  opts: RunnerOptions,
): Promise<CheckResult> {
  const started = performance.now();
  const result = (
    partial: Omit<CheckResult, 'id' | 'name' | 'category' | 'durationMs' | 'weight'>,
  ): CheckResult => ({
    id: check.id,
    name: check.name,
    category: check.category,
    weight: settings.weight ?? 1,
    durationMs: Math.round(performance.now() - started),
    ...partial,
  });
  const timeoutMs = settings.timeoutMs ?? check.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let output: CheckOutput;
  try {
    const raw = await withTimeout(
      async (signal) =>
        check.run({
          ...base,
          options: settings.options ?? {},
          signal,
          logger: {
            ...base.logger,
            debug: (msg) => base.logger.debug(`[${check.id}] ${msg}`),
          },
        }),
      timeoutMs,
    );
    const parsed = CheckOutputSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return result({
        status: 'errored',
        score: undefined,
        findings: [],
        reason: `Check returned an invalid result: ${issue?.path.join('.') || '(root)'}: ${issue?.message}`,
      });
    }
    output = parsed.data;
  } catch (err) {
    if (err instanceof CheckSkipped) {
      return result({ status: 'skipped', score: undefined, findings: [], reason: err.message });
    }
    base.logger.debug(
      `[${check.id}] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    return result({ status: 'errored', score: undefined, findings: [], reason: errorMessage(err) });
  }

  return result({
    status: 'completed',
    score: Math.round(output.score ?? deriveScore(output.findings, opts.severityPenalties)),
    findings: output.findings.map((f) => ({
      ...f,
      checkId: check.id,
      category: check.category,
      fingerprint: fingerprint(check.id, f),
    })),
    ...(output.meta ? { meta: output.meta } : {}),
  });
}

/**
 * Runs checks with bounded concurrency. Exclusive checks (builds, browsers) run one at a
 * time after the parallel batch. Results are returned in input order; a failing or hanging
 * check never affects the others.
 */
export async function runChecks(
  checks: SelectedCheck[],
  base: BaseContext,
  opts: RunnerOptions,
): Promise<CheckResult[]> {
  const results = new Array<CheckResult>(checks.length);
  const total = checks.length;
  let done = 0;
  const exec = async ([sc, index]: [SelectedCheck, number]) => {
    opts.onStart?.(sc.check);
    const r = await runCheck(sc, base, opts);
    results[index] = r;
    opts.onDone?.(r, ++done, total);
  };

  const indexed = checks.map((sc, i): [SelectedCheck, number] => [sc, i]);
  const queue = indexed.filter(([sc]) => !sc.check.exclusive);
  const exclusive = indexed.filter(([sc]) => sc.check.exclusive);
  const concurrency = Math.max(1, opts.concurrency ?? Math.min(availableParallelism(), 8));

  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) await exec(item);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  for (const item of exclusive) await exec(item);
  return results;
}
