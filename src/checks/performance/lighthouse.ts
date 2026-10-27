import type { Severity } from '../../core/config/schema.js';
import { defineCheck, type Finding } from '../../core/types.js';
import { getRuntimeSession, routeUrl, type LighthouseResult } from '../../runtime/session.js';
import { clampScore, listSome } from '../util.js';

/** The check's score blends these Lighthouse categories (accessibility is scored by axe). */
export const SCORE_WEIGHTS: Record<string, number> = {
  performance: 0.7,
  'best-practices': 0.15,
  seo: 0.15,
};
const FINDING_CATEGORIES = Object.keys(SCORE_WEIGHTS);
const SCORED_MODES = new Set(['numeric', 'binary', 'metricSavings']);
const IMPORTANT = new Set(['is-on-https', 'is-crawlable', 'http-status-code', 'errors-in-console']);
const METRICS: Record<string, string> = {
  fcp: 'first-contentful-paint',
  lcp: 'largest-contentful-paint',
  tbt: 'total-blocking-time',
  cls: 'cumulative-layout-shift',
  si: 'speed-index',
};

export interface RouteLighthouse {
  route: string;
  lhr?: LighthouseResult;
  error?: string;
}

const pct = (score: number | null | undefined) =>
  typeof score === 'number' ? Math.round(score * 100) : null;

/** "Text [Learn more](https://x)." → { text: "Text Learn more.", url: "https://x" } */
export function splitMarkdownLinks(md: string): { text: string; url: string | undefined } {
  const url = /\[[^\]]*\]\((https?:[^)]+)\)/.exec(md)?.[1];
  const text = md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s*Learn (more|how)[^.]*\.?/gi, '')
    .replace(/`/g, '')
    .trim();
  return { text: text || md, url };
}

export function lighthouseFindings(runs: RouteLighthouse[]): Finding[] {
  type Hit = { route: string; score: number; displayValue: string | undefined; savingsMs: number };
  const hits = new Map<
    string,
    { category: string; metric: boolean; title: string; description: string; list: Hit[] }
  >();

  for (const { route, lhr } of runs) {
    if (!lhr) continue;
    // Audits that are also accessibility audits (image-alt, document-title…) are reported by axe.
    const a11y = new Set((lhr.categories['accessibility']?.auditRefs ?? []).map((r) => r.id));
    for (const category of FINDING_CATEGORIES) {
      for (const ref of lhr.categories[category]?.auditRefs ?? []) {
        if (a11y.has(ref.id)) continue;
        const audit = lhr.audits[ref.id];
        if (
          !audit ||
          audit.score === null ||
          audit.score >= 0.9 ||
          !SCORED_MODES.has(audit.scoreDisplayMode)
        )
          continue;
        const savingsMs =
          audit.details?.overallSavingsMs ??
          Math.max(0, ...Object.values(audit.metricSavings ?? {}).filter((v) => v > 1));
        const entry = hits.get(ref.id) ?? {
          category,
          metric: ref.group === 'metrics',
          title: audit.title,
          description: audit.description,
          list: [],
        };
        entry.list.push({ route, score: audit.score, displayValue: audit.displayValue, savingsMs });
        hits.set(ref.id, entry);
      }
    }
  }

  const findings: Finding[] = [];
  for (const [id, h] of hits) {
    const worst = h.list.reduce((a, b) => (b.score < a.score ? b : a));
    const maxSavings = Math.max(...h.list.map((x) => x.savingsMs));
    let severity: Severity;
    if (h.metric) severity = worst.score < 0.5 ? 'high' : 'medium';
    else if (h.category === 'performance') severity = maxSavings >= 1000 ? 'medium' : 'low';
    else severity = IMPORTANT.has(id) ? 'medium' : 'low';
    const { text, url } = splitMarkdownLinks(h.description);
    const routes = h.list.map((x) => x.route);
    findings.push({
      severity,
      ruleId: `lighthouse/${id}`,
      message: `${h.title}${worst.displayValue ? ` (${worst.displayValue})` : ''} on ${listSome(routes)}.`,
      fixHint: text,
      ...(url ? { docsUrl: url } : {}),
    });
  }
  const order: Severity[] = ['critical', 'high', 'medium', 'low'];
  return findings.sort(
    (a, b) =>
      order.indexOf(a.severity) - order.indexOf(b.severity) || a.message.localeCompare(b.message),
  );
}

export function routeSummary({ route, lhr, error }: RouteLighthouse) {
  if (!lhr) return { route, error };
  const metrics = Object.fromEntries(
    Object.entries(METRICS).map(([key, id]) => [key, lhr.audits[id]?.numericValue ?? null]),
  );
  return {
    route,
    scores: {
      performance: pct(lhr.categories['performance']?.score),
      accessibility: pct(lhr.categories['accessibility']?.score),
      bestPractices: pct(lhr.categories['best-practices']?.score),
      seo: pct(lhr.categories['seo']?.score),
    },
    metrics,
  };
}

export function lighthouseScore(runs: RouteLighthouse[]): number | undefined {
  const perRoute = runs.flatMap(({ lhr }) => {
    if (!lhr) return [];
    let total = 0;
    let weight = 0;
    for (const [cat, w] of Object.entries(SCORE_WEIGHTS)) {
      const s = lhr.categories[cat]?.score;
      if (typeof s === 'number') {
        total += s * w;
        weight += w;
      }
    }
    return weight ? [(total / weight) * 100] : [];
  });
  return perRoute.length
    ? clampScore(perRoute.reduce((a, b) => a + b, 0) / perRoute.length)
    : undefined;
}

export default defineCheck({
  id: 'performance/lighthouse',
  name: 'Lighthouse',
  category: 'performance',
  description: 'Lighthouse performance, best practices and SEO for each configured route.',
  kind: 'runtime',
  exclusive: true,
  timeoutMs: 10 * 60_000,
  async run(ctx) {
    const session = await getRuntimeSession(ctx);
    const runs: RouteLighthouse[] = [];
    for (const route of ctx.runtime.routes) {
      if (ctx.signal.aborted) break;
      try {
        const lhr = await session.lighthouse(routeUrl(session.baseUrl, route));
        runs.push(
          lhr.runtimeError
            ? { route, error: `${lhr.runtimeError.code}: ${lhr.runtimeError.message}` }
            : { route, lhr },
        );
      } catch (err) {
        runs.push({ route, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const score = lighthouseScore(runs);
    if (score === undefined) {
      throw new Error(
        `Lighthouse failed on every route: ${runs.map((r) => `${r.route}: ${r.error}`).join('; ')}`,
      );
    }
    const findings = lighthouseFindings(runs);
    for (const r of runs.filter((x) => x.error)) {
      findings.unshift({
        severity: 'high',
        ruleId: 'lighthouse/route-error',
        message: `Lighthouse could not audit ${r.route}: ${r.error}`,
        fixHint:
          'Check that the route loads without errors (and that the login script covers it, if it is protected).',
      });
    }
    return {
      score,
      findings,
      meta: {
        target: session.source,
        formFactor: ctx.runtime.formFactor,
        authenticated: session.authenticated,
        routes: runs.map(routeSummary),
      },
    };
  },
});
