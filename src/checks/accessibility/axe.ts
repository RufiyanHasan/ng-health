import type { Severity } from '../../core/config/schema.js';
import { defineCheck, type Finding } from '../../core/types.js';
import { getRuntimeSession, routeUrl, type AxeResult } from '../../runtime/session.js';
import { listSome, plural } from '../util.js';

const IMPACT: Record<string, Severity> = {
  critical: 'critical',
  serious: 'high',
  moderate: 'medium',
  minor: 'low',
};

export interface RouteAxe {
  route: string;
  result?: AxeResult;
  error?: string;
}

export interface A11yViolation {
  id: string;
  impact: string;
  help: string;
  helpUrl: string;
  /** Affected selectors per route. */
  routes: { route: string; selectors: string[] }[];
  nodes: number;
  /** axe's explanation for the first affected element. */
  failureSummary: string | undefined;
}

/** axe targets are selector strings, or arrays for shadow DOM/iframe paths. */
const selectorOf = (target: unknown[]): string =>
  target.map((t) => (Array.isArray(t) ? t.join(' >>> ') : String(t))).join(' | ');

/** "Fix any of the following:\n  A\n  B" → "Fix any of the following: A; B" */
export function summarizeFailure(summary: string | undefined): string {
  const [head, ...rest] = (summary ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!head) return '';
  return head.endsWith(':') ? `${head} ${rest.join('; ')}`.trim() : [head, ...rest].join('; ');
}

/** Groups violations by rule across routes, most severe first. */
export function groupViolations(runs: RouteAxe[]): A11yViolation[] {
  const byRule = new Map<string, A11yViolation>();
  for (const { route, result } of runs) {
    for (const v of result?.violations ?? []) {
      const entry = byRule.get(v.id) ?? {
        id: v.id,
        impact: v.impact ?? 'moderate',
        help: v.help,
        helpUrl: v.helpUrl,
        routes: [],
        nodes: 0,
        failureSummary: v.nodes[0]?.failureSummary,
      };
      entry.routes.push({
        route,
        selectors: [...new Set(v.nodes.map((n) => selectorOf(n.target)))],
      });
      entry.nodes += v.nodes.length;
      byRule.set(v.id, entry);
    }
  }
  const order = ['critical', 'serious', 'moderate', 'minor'];
  return [...byRule.values()].sort(
    (a, b) => order.indexOf(a.impact) - order.indexOf(b.impact) || a.id.localeCompare(b.id),
  );
}

export function axeFindings(violations: A11yViolation[]): Finding[] {
  return violations.map((v) => {
    const selectors = [...new Set(v.routes.flatMap((r) => r.selectors))];
    const routes = v.routes.map((r) => r.route);
    const how = summarizeFailure(v.failureSummary);
    return {
      severity: IMPACT[v.impact] ?? 'medium',
      ruleId: `axe/${v.id}`,
      message: `${v.help} — ${plural(v.nodes, 'element')} on ${listSome(routes)}.`,
      fixHint: `${how ? `${how}. ` : ''}Affected: ${listSome(selectors)}`,
      docsUrl: v.helpUrl,
    };
  });
}

export default defineCheck({
  id: 'accessibility/axe',
  name: 'Accessibility (axe-core)',
  category: 'accessibility',
  description: 'WCAG violations found by axe-core on each configured route.',
  kind: 'runtime',
  exclusive: true,
  timeoutMs: 10 * 60_000,
  async run(ctx) {
    const session = await getRuntimeSession(ctx);
    const runs: RouteAxe[] = [];
    for (const route of ctx.runtime.routes) {
      if (ctx.signal.aborted) break;
      try {
        runs.push({ route, result: await session.axe(routeUrl(session.baseUrl, route)) });
      } catch (err) {
        runs.push({ route, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (!runs.some((r) => r.result)) {
      throw new Error(
        `axe failed on every route: ${runs.map((r) => `${r.route}: ${r.error}`).join('; ')}`,
      );
    }
    const violations = groupViolations(runs);
    const findings = axeFindings(violations);
    for (const r of runs.filter((x) => x.error)) {
      findings.unshift({
        severity: 'high',
        ruleId: 'axe/route-error',
        message: `axe could not audit ${r.route}: ${r.error}`,
        fixHint:
          'Check that the route loads without errors (and that the login script covers it, if it is protected).',
      });
    }
    return {
      findings,
      meta: {
        target: session.source,
        tags: ctx.runtime.axeTags,
        /** Elements affected by critical-impact rules (used by maxCriticalA11yViolations). */
        criticalViolations: violations
          .filter((v) => v.impact === 'critical')
          .reduce((s, v) => s + v.nodes, 0),
        violations,
        routes: runs.map((r) => ({
          route: r.route,
          ...(r.error ? { error: r.error } : { violations: r.result?.violations.length ?? 0 }),
        })),
      },
    };
  },
});
