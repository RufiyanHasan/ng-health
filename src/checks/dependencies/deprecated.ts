import type { Severity } from '../../core/config/schema.js';
import { defineCheck, type Finding } from '../../core/types.js';
import { directDependencies, readPackageJson } from './package-json.js';

/** Well-known deprecated or end-of-life packages in Angular projects (works offline). */
export const KNOWN_DEPRECATED: Record<string, { severity: Severity; replacement: string }> = {
  tslint: {
    severity: 'high',
    replacement: 'Migrate to ESLint: "ng add @angular-eslint/schematics".',
  },
  codelyzer: { severity: 'medium', replacement: 'Remove it and use angular-eslint rules.' },
  protractor: { severity: 'high', replacement: 'Migrate e2e tests to Playwright or Cypress.' },
  '@angular/flex-layout': {
    severity: 'medium',
    replacement: 'Use CSS flexbox/grid (or a utility CSS framework).',
  },
  '@angular/http': { severity: 'high', replacement: 'Use HttpClient from @angular/common/http.' },
  '@nguniversal/express-engine': {
    severity: 'medium',
    replacement: 'Migrate to @angular/ssr ("ng update" migrates automatically).',
  },
  '@nguniversal/builders': { severity: 'medium', replacement: 'Migrate to @angular/ssr.' },
  '@nguniversal/common': { severity: 'medium', replacement: 'Migrate to @angular/ssr.' },
  'node-sass': { severity: 'medium', replacement: 'Use "sass" (Dart Sass).' },
  request: { severity: 'medium', replacement: 'Use fetch or HttpClient.' },
  'rxjs-compat': {
    severity: 'medium',
    replacement: 'Remove it after migrating to pipeable operators.',
  },
  karma: {
    severity: 'low',
    replacement:
      'Karma is deprecated: migrate unit tests to Vitest (the Angular default since v21) or Jest.',
  },
  moment: {
    severity: 'low',
    replacement:
      'moment is in maintenance mode and not tree-shakeable: consider date-fns, Luxon or the Temporal API.',
  },
};

export default defineCheck({
  id: 'dependencies/deprecated',
  name: 'Deprecated packages',
  category: 'dependencies',
  description: 'Direct dependencies that are deprecated on npm or known to be end-of-life.',
  timeoutMs: 180_000,
  async run(ctx) {
    const deps = directDependencies(await readPackageJson(ctx));
    const findings: Finding[] = [];
    const flagged = new Set<string>();

    for (const dep of deps) {
      const known = KNOWN_DEPRECATED[dep.name];
      if (!known) continue;
      flagged.add(dep.name);
      findings.push({
        severity: known.severity,
        ruleId: 'deprecated-package',
        message: `${dep.name} is deprecated or end-of-life.`,
        fixHint: known.replacement,
        file: 'package.json',
      });
    }

    if (!ctx.offline) {
      const toQuery = deps.filter(
        (d) => !flagged.has(d.name) && !/^(file|link|workspace|git)/.test(d.range),
      );
      const queue = [...toQuery];
      const worker = async () => {
        for (let dep = queue.shift(); dep; dep = queue.shift()) {
          if (ctx.signal.aborted) return;
          const r = await ctx
            .exec('npm', ['view', `${dep.name}@${dep.range}`, 'deprecated', '--json'])
            .catch(() => undefined);
          const raw = r?.exitCode === 0 ? r.stdout.trim() : '';
          if (!raw) continue;
          let message: unknown;
          try {
            message = JSON.parse(raw);
          } catch {
            message = raw;
          }
          // For ranges npm may return an array (one entry per matching version)
          const text = Array.isArray(message) ? message.at(-1) : message;
          if (typeof text !== 'string' || !text) continue;
          findings.push({
            severity: 'medium',
            ruleId: 'deprecated-package',
            message: `${dep.name} is deprecated: ${text}`,
            fixHint: `Follow the deprecation notice and replace or upgrade ${dep.name}.`,
            file: 'package.json',
          });
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
    }

    findings.sort((a, b) => a.message.localeCompare(b.message));
    return { findings, meta: { checked: deps.length, registryLookup: !ctx.offline } };
  },
});
