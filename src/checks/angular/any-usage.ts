import { defineCheck } from '../../core/types.js';
import { clampScore, num, plural } from '../util.js';
import { getAngularAnalysis } from './analysis.js';

export default defineCheck({
  id: 'angular/any-usage',
  name: '`any` usage',
  category: 'angular',
  description: 'Explicit `any` types disable type checking.',
  async run(ctx) {
    const { anyUsage, totalLoc } = await getAngularAnalysis(ctx);
    const perFileHigh = num(ctx, 'maxPerFile', 10);
    const total = anyUsage.reduce((s, f) => s + f.count, 0);
    // Density-based: 5 `any` per 1,000 lines costs half the score.
    const per1k = totalLoc ? (total / totalLoc) * 1000 : 0;
    return {
      score: clampScore(100 - per1k * 10),
      findings: anyUsage.map((f) => ({
        severity: f.count >= perFileHigh ? 'medium' : 'low',
        ruleId: 'explicit-any',
        message: `${plural(f.count, 'explicit `any`', 'explicit `any`s')} in ${f.file}.`,
        file: f.file,
        line: f.lines[0],
        fixHint:
          'Replace `any` with a concrete type or `unknown` plus narrowing; enable @typescript-eslint/no-explicit-any.',
      })),
      meta: { total, files: anyUsage.length, per1kLoc: Math.round(per1k * 10) / 10 },
    };
  },
});
