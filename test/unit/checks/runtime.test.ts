import { describe, expect, it } from 'vitest';
import axe, { groupViolations, summarizeFailure } from '../../../src/checks/accessibility/axe.js';
import lighthouse, {
  lighthouseFindings,
  lighthouseScore,
  routeSummary,
  splitMarkdownLinks,
} from '../../../src/checks/performance/lighthouse.js';
import type { BaseContext } from '../../../src/core/runner.js';
import type { AxeResult, LighthouseResult, RuntimeSession } from '../../../src/runtime/session.js';
import { routeUrl } from '../../../src/runtime/session.js';
import { fixture, runOn, summarize } from '../../helpers/fixtures.js';
import { angularApp, makeTempProject } from '../../helpers/tmp.js';

type Audit = LighthouseResult['audits'][string];
const audit = (id: string, score: number | null, extra: Partial<Audit> = {}): Audit => ({
  id,
  title: `Title ${id}`,
  description: `Fix ${id}. [Learn more](https://web.dev/${id})`,
  score,
  scoreDisplayMode: 'numeric',
  ...extra,
});

function lhr(perf: number, bp: number, seo: number, audits: Audit[] = []): LighthouseResult {
  const map = Object.fromEntries(audits.map((a) => [a.id, a]));
  const refs = (ids: string[], group?: string) =>
    ids.map((id) => ({ id, weight: 1, ...(group ? { group } : {}) }));
  return {
    categories: {
      performance: {
        score: perf,
        auditRefs: [
          ...refs(['largest-contentful-paint', 'total-blocking-time'], 'metrics'),
          ...refs(['render-blocking', 'unused-js', 'informative']),
        ],
      },
      accessibility: { score: 0.5, auditRefs: refs(['image-alt']) },
      'best-practices': { score: bp, auditRefs: refs(['errors-in-console', 'deprecations']) },
      seo: { score: seo, auditRefs: refs(['meta-description', 'image-alt']) },
    },
    audits: map,
  };
}

const slow = lhr(0.4, 0.8, 0.9, [
  audit('largest-contentful-paint', 0.3, { displayValue: '6.1 s', numericValue: 6100 }),
  audit('total-blocking-time', 0.7, { displayValue: '450 ms', numericValue: 450 }),
  audit('render-blocking', 0, {
    scoreDisplayMode: 'metricSavings',
    metricSavings: { FCP: 1500, LCP: 1200 },
  }),
  audit('unused-js', 0.5, { details: { overallSavingsMs: 300 } }),
  audit('informative', 0, { scoreDisplayMode: 'informative' }),
  audit('errors-in-console', 0, { scoreDisplayMode: 'binary' }),
  audit('deprecations', 1, { scoreDisplayMode: 'binary' }),
  audit('meta-description', 0, { scoreDisplayMode: 'binary' }),
  audit('image-alt', 0, { scoreDisplayMode: 'binary' }),
]);
const fast = lhr(1, 1, 1, [
  audit('largest-contentful-paint', 0.6, { displayValue: '2.9 s', numericValue: 2900 }),
  audit('total-blocking-time', 1, { numericValue: 0 }),
]);

describe('lighthouse parsing', () => {
  it('turns failing audits into grouped findings with severities', () => {
    const findings = lighthouseFindings([
      { route: '/', lhr: slow },
      { route: '/about', lhr: fast },
    ]);
    expect(findings.map((f) => [f.severity, f.ruleId, f.message])).toEqual([
      [
        'high',
        'lighthouse/largest-contentful-paint',
        'Title largest-contentful-paint (6.1 s) on /, /about.',
      ],
      ['medium', 'lighthouse/errors-in-console', 'Title errors-in-console on /.'],
      ['medium', 'lighthouse/render-blocking', 'Title render-blocking on /.'],
      ['medium', 'lighthouse/total-blocking-time', 'Title total-blocking-time (450 ms) on /.'],
      ['low', 'lighthouse/meta-description', 'Title meta-description on /.'],
      ['low', 'lighthouse/unused-js', 'Title unused-js on /.'],
    ]);
    expect(findings[0]).toMatchObject({
      fixHint: 'Fix largest-contentful-paint.',
      docsUrl: 'https://web.dev/largest-contentful-paint',
    });
  });

  it('blends category scores per route and averages routes', () => {
    expect(lighthouseScore([{ route: '/', lhr: slow }])).toBe(
      Math.round((0.4 * 0.7 + 0.8 * 0.15 + 0.9 * 0.15) * 100),
    );
    expect(
      lighthouseScore([
        { route: '/', lhr: slow },
        { route: '/a', lhr: fast },
        { route: '/x', error: 'boom' },
      ]),
    ).toBe(Math.round((53.5 + 100) / 2));
    expect(lighthouseScore([{ route: '/', error: 'x' }])).toBeUndefined();
  });

  it('summarises routes and markdown', () => {
    expect(routeSummary({ route: '/', lhr: slow })).toEqual({
      route: '/',
      scores: { performance: 40, accessibility: 50, bestPractices: 80, seo: 90 },
      metrics: { fcp: null, lcp: 6100, tbt: 450, cls: null, si: null },
    });
    expect(routeSummary({ route: '/x', error: 'boom' })).toEqual({ route: '/x', error: 'boom' });
    expect(splitMarkdownLinks('Use `x`. [Learn how to do it](https://a.b/c).')).toEqual({
      text: 'Use x.',
      url: 'https://a.b/c',
    });
    expect(routeUrl('http://h:1/', '/a')).toBe('http://h:1/a');
  });
});

const axeResult = (violations: AxeResult['violations']): AxeResult => ({ violations });
const v = (
  id: string,
  impact: AxeResult['violations'][number]['impact'],
  targets: unknown[][],
) => ({
  id,
  impact,
  help: `Help ${id}`,
  description: '',
  helpUrl: `https://dequeuniversity.com/rules/axe/4.14/${id}`,
  nodes: targets.map((target) => ({
    target,
    failureSummary: 'Fix any of the following:\n  Element has no alt\n  aria-label is missing',
  })),
});

describe('axe parsing', () => {
  it('groups violations by rule across routes with selectors', () => {
    const grouped = groupViolations([
      {
        route: '/',
        result: axeResult([
          v('color-contrast', 'serious', [['.a'], ['.b']]),
          v('image-alt', 'critical', [['img']]),
        ]),
      },
      {
        route: '/about',
        result: axeResult([v('image-alt', 'critical', [['img'], [['#host', 'img.shadow']]])]),
      },
      { route: '/err', error: 'boom' },
    ]);
    expect(grouped.map((g) => [g.id, g.impact, g.nodes, g.routes])).toEqual([
      [
        'image-alt',
        'critical',
        3,
        [
          { route: '/', selectors: ['img'] },
          { route: '/about', selectors: ['img', '#host >>> img.shadow'] },
        ],
      ],
      ['color-contrast', 'serious', 2, [{ route: '/', selectors: ['.a', '.b'] }]],
    ]);
    expect(summarizeFailure('Fix all of the following:\n  A\n  B')).toBe(
      'Fix all of the following: A; B',
    );
    expect(summarizeFailure('Single line')).toBe('Single line');
    expect(summarizeFailure(undefined)).toBe('');
  });
});

function stubSession(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    baseUrl: 'http://127.0.0.1:9',
    source: 'local-build',
    authenticated: false,
    lighthouse: async () => fast,
    axe: async () => axeResult([]),
    ...overrides,
  };
}
const withSession = (session: RuntimeSession): Partial<BaseContext> => ({
  shared: <T>(key: string, factory: () => Promise<T>) =>
    key === 'runtime-session' ? (Promise.resolve(session) as Promise<T>) : factory(),
  runtime: { routes: ['/', '/broken'], formFactor: 'mobile', axeTags: ['wcag2a'] },
});

describe('runtime checks with a stub session', () => {
  it('performance/lighthouse reports per-route errors without failing the check', async () => {
    const session = stubSession({
      lighthouse: async (url) => {
        if (url.endsWith('/broken'))
          return { ...fast, runtimeError: { code: 'NO_FCP', message: 'no paint' } };
        return slow;
      },
    });
    const r = await runOn(lighthouse, fixture('healthy'), { context: withSession(session) });
    expect(r.status).toBe('completed');
    expect(r.findings[0]).toMatchObject({
      severity: 'high',
      message: 'Lighthouse could not audit /broken: NO_FCP: no paint',
    });
    expect(r.meta).toMatchObject({
      target: 'local-build',
      formFactor: 'mobile',
      authenticated: false,
    });
  });

  it('performance/lighthouse errors when every route fails', async () => {
    const session = stubSession({
      lighthouse: async () => Promise.reject(new Error('chrome died')),
    });
    expect(
      await runOn(lighthouse, fixture('healthy'), { context: withSession(session) }),
    ).toMatchObject({
      status: 'errored',
      reason: 'Lighthouse failed on every route: /: chrome died; /broken: chrome died',
    });
  });

  it('accessibility/axe produces findings, critical counts and route errors', async () => {
    const session = stubSession({
      axe: async (url) => {
        if (url.endsWith('/broken')) throw new Error('net::ERR_CONNECTION_REFUSED');
        return axeResult([
          v('image-alt', 'critical', [['img'], ['img.logo']]),
          v('region', 'moderate', [['div']]),
        ]);
      },
    });
    const r = await runOn(axe, fixture('healthy'), { context: withSession(session) });
    expect(summarize(r)).toEqual([
      ['high', null, null, 'axe could not audit /broken: net::ERR_CONNECTION_REFUSED'],
      ['critical', null, null, 'Help image-alt — 2 elements on /.'],
      ['medium', null, null, 'Help region — 1 element on /.'],
    ]);
    expect(r.findings[1]?.fixHint).toBe(
      'Fix any of the following: Element has no alt; aria-label is missing. Affected: img, img.logo',
    );
    expect(r.meta).toMatchObject({
      criticalViolations: 2,
      routes: [
        { route: '/', violations: 2 },
        { route: '/broken', error: 'net::ERR_CONNECTION_REFUSED' },
      ],
    });

    const allFail = stubSession({ axe: async () => Promise.reject(new Error('x')) });
    expect((await runOn(axe, fixture('healthy'), { context: withSession(allFail) })).status).toBe(
      'errored',
    );
  });
});

describe('runtime session setup (no browser launched)', () => {
  it('skips when Chromium cannot be found', async () => {
    const r = await runOn(axe, fixture('healthy'), {
      context: {
        runtime: { routes: ['/'], formFactor: 'mobile', axeTags: [], chromePath: '/nope/chrome' },
      },
    });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/^Chromium not available\. Install Google Chrome/);
  });

  it('skips when there is no build output to serve and no --url', async () => {
    const dir = await makeTempProject(angularApp());
    const r = await runOn(lighthouse, dir, {
      context: {
        runtime: { routes: ['/'], formFactor: 'mobile', axeTags: [], chromePath: process.execPath },
      },
    });
    expect(r).toMatchObject({
      status: 'skipped',
      reason: 'No build output to serve in dist/demo-app: build the app first, or pass --url',
    });
  });
});
