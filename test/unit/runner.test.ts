import { describe, expect, it } from 'vitest';
import { deriveScore, runCheck, runChecks } from '../../src/core/runner.js';
import { skipCheck } from '../../src/core/types.js';
import { DEFAULT_SEVERITY_PENALTIES } from '../../src/core/config/schema.js';
import { baseContext, finding, runnerOpts, selected, stubCheck } from '../helpers/checks.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('deriveScore', () => {
  it('subtracts severity penalties and floors at 0', () => {
    expect(deriveScore([], DEFAULT_SEVERITY_PENALTIES)).toBe(100);
    expect(
      deriveScore(
        [
          { severity: 'critical' },
          { severity: 'high' },
          { severity: 'medium' },
          { severity: 'low' },
        ],
        DEFAULT_SEVERITY_PENALTIES,
      ),
    ).toBe(60);
    expect(deriveScore(Array(5).fill({ severity: 'critical' }), DEFAULT_SEVERITY_PENALTIES)).toBe(
      0,
    );
  });
});

describe('runCheck', () => {
  it('derives a score and annotates findings', async () => {
    const check = stubCheck('angular/x', {
      findings: [finding({ severity: 'high', file: 'a.ts', line: 3 })],
    });
    const r = await runCheck(selected(check, { weight: 2 }), baseContext(), runnerOpts);
    expect(r).toMatchObject({ status: 'completed', score: 90, weight: 2, category: 'angular' });
    expect(r.findings[0]).toMatchObject({
      checkId: 'angular/x',
      category: 'angular',
      file: 'a.ts',
      line: 3,
      fingerprint: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });

  it('uses an explicit score and keeps meta', async () => {
    const r = await runCheck(
      selected(stubCheck('perf/x', { score: 42.4, findings: [], meta: { lcp: 1200 } })),
      baseContext(),
      runnerOpts,
    );
    expect(r).toMatchObject({ status: 'completed', score: 42, meta: { lcp: 1200 } });
  });

  it('isolates thrown errors as "errored"', async () => {
    const r = await runCheck(
      selected(
        stubCheck('x/boom', () => {
          throw new Error('kaboom');
        }),
      ),
      baseContext(),
      runnerOpts,
    );
    expect(r).toMatchObject({
      status: 'errored',
      reason: 'kaboom',
      score: undefined,
      findings: [],
    });
  });

  it('reports skipped checks with a reason', async () => {
    const r = await runCheck(
      selected(stubCheck('x/skip', () => skipCheck('Chromium not available'))),
      baseContext(),
      runnerOpts,
    );
    expect(r).toMatchObject({ status: 'skipped', reason: 'Chromium not available' });
  });

  it('times out hanging checks and aborts their signal', async () => {
    let aborted = false;
    const check = stubCheck('x/hang', { findings: [] });
    check.run = (ctx) => {
      ctx.signal.addEventListener('abort', () => (aborted = true));
      return new Promise(() => {});
    };
    const r = await runCheck(selected(check, { timeoutMs: 30 }), baseContext(), runnerOpts);
    expect(r).toMatchObject({ status: 'errored', reason: 'Timed out after 30ms' });
    expect(aborted).toBe(true);
  });

  it('marks invalid plugin output as errored', async () => {
    const bad = stubCheck('x/bad', { score: 150, findings: [] });
    expect((await runCheck(selected(bad), baseContext(), runnerOpts)).reason).toMatch(
      /invalid result: score/,
    );
    const noHint = stubCheck('x/nohint', {
      findings: [{ severity: 'low', message: 'm' } as never],
    });
    expect((await runCheck(selected(noHint), baseContext(), runnerOpts)).reason).toMatch(
      /findings\.0\.fixHint/,
    );
  });

  it('passes check options and a working context', async () => {
    const check = stubCheck('x/ctx', async () => ({ findings: [] }));
    let seen: unknown;
    check.run = async (ctx) => {
      seen = ctx.options;
      const a = await ctx.shared('k', async () => ({}));
      const b = await ctx.shared('k', async () => ({}));
      expect(a).toBe(b);
      return { findings: [] };
    };
    await runCheck(selected(check, { options: { maxLoc: 300 } }), baseContext(), runnerOpts);
    expect(seen).toEqual({ maxLoc: 300 });
  });
});

describe('runChecks', () => {
  it('runs in parallel, keeps input order, and survives failures', async () => {
    const order: string[] = [];
    const mk = (id: string, ms: number, fail = false) =>
      stubCheck(id, async () => {
        order.push(`start:${id}`);
        await sleep(ms);
        order.push(`end:${id}`);
        if (fail) throw new Error('nope');
        return { findings: [] };
      });
    const progress: string[] = [];
    const results = await runChecks(
      [selected(mk('a/slow', 40)), selected(mk('a/fast', 5)), selected(mk('a/fail', 1, true))],
      baseContext(),
      {
        ...runnerOpts,
        concurrency: 3,
        onDone: (r, done, total) => progress.push(`${r.id} ${done}/${total}`),
      },
    );
    expect(results.map((r) => [r.id, r.status])).toEqual([
      ['a/slow', 'completed'],
      ['a/fast', 'completed'],
      ['a/fail', 'errored'],
    ]);
    expect(order.slice(0, 3).every((e) => e.startsWith('start:'))).toBe(true);
    expect(progress.at(-1)).toBe('a/slow 3/3');
  });

  it('runs exclusive checks alone, after the parallel batch', async () => {
    let running = 0;
    let maxDuringExclusive = 0;
    const normal = (id: string) =>
      stubCheck(id, async () => {
        running++;
        await sleep(10);
        running--;
        return { findings: [] };
      });
    const exclusive = stubCheck(
      'b/build',
      async () => {
        maxDuringExclusive = Math.max(maxDuringExclusive, running);
        return { findings: [] };
      },
      { exclusive: true },
    );
    const results = await runChecks(
      [selected(exclusive), selected(normal('b/one')), selected(normal('b/two'))],
      baseContext(),
      { ...runnerOpts, concurrency: 4 },
    );
    expect(results.map((r) => r.id)).toEqual(['b/build', 'b/one', 'b/two']);
    expect(maxDuringExclusive).toBe(0);
  });

  it('handles an empty list', async () => {
    expect(await runChecks([], baseContext(), runnerOpts)).toEqual([]);
  });
});
