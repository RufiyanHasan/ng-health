import { defineCheck, type Finding } from '../../core/types.js';
import { clampScore, listSome, num } from '../util.js';
import { getAngularAnalysis } from '../angular/analysis.js';

export default defineCheck({
  id: 'hygiene/tests',
  name: 'Test file ratio',
  category: 'hygiene',
  description: 'Share of components, directives, pipes and services that have a spec file.',
  async run(ctx) {
    const target = num(ctx, 'targetRatio', 0.8);
    const { classes } = await getAngularAnalysis(ctx);
    const testable = [...new Set(classes.filter((c) => c.kind !== 'ngmodule').map((c) => c.file))];
    const specs = new Set(await ctx.glob(['**/*.spec.ts', '**/*.test.ts']));
    const untested = testable.filter(
      (f) =>
        !specs.has(f.replace(/\.ts$/, '.spec.ts')) && !specs.has(f.replace(/\.ts$/, '.test.ts')),
    );
    const ratio = testable.length ? (testable.length - untested.length) / testable.length : 1;
    const findings: Finding[] = [];
    if (ratio < target) {
      findings.push({
        severity: ratio < target / 2 ? 'high' : 'medium',
        ruleId: 'low-test-ratio',
        message: `${Math.round(ratio * 100)}% of components/services have a spec file (target ${Math.round(target * 100)}%). Untested: ${listSome(untested)}.`,
        fixHint:
          'Add spec files for untested units, starting with services and components that hold logic.',
      });
    }
    return {
      score: clampScore((ratio / target) * 100),
      findings,
      meta: {
        testable: testable.length,
        specFiles: specs.size,
        ratio: Math.round(ratio * 100) / 100,
        untested,
      },
    };
  },
});
