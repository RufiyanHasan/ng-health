import { defineCheck, skipCheck } from '../../core/types.js';
import { ratioScore } from '../util.js';
import { getAngularAnalysis } from './analysis.js';

export default defineCheck({
  id: 'angular/inject-function',
  name: 'inject() convention',
  category: 'angular',
  description: 'Flags constructor injection when the project mostly uses inject().',
  async run(ctx) {
    const major = ctx.project.angular.major;
    if (major !== undefined && major < 14)
      skipCheck(`inject() needs Angular 14+ (project uses ${major})`);
    const { classes } = await getAngularAnalysis(ctx);
    const injecting = classes.filter((c) => c.constructorParams > 0 || c.injectCalls > 0);
    const viaInject = injecting.filter(
      (c) => c.injectCalls > 0 && c.constructorParams === 0,
    ).length;
    const viaCtor = injecting.filter((c) => c.constructorParams > 0);

    // 'auto' (default) follows the majority; 'inject' enforces it; 'constructor' disables the check.
    const prefer = ctx.options['prefer'] ?? 'auto';
    const convention =
      prefer === 'inject' || prefer === 'constructor'
        ? prefer
        : viaInject >= viaCtor.length
          ? 'inject'
          : 'constructor';
    const offenders = convention === 'inject' ? viaCtor : [];

    return {
      score: ratioScore(offenders.length, injecting.length),
      findings: offenders.map((c) => ({
        severity: 'low',
        ruleId: 'constructor-injection',
        message: `${c.name} uses constructor injection (${c.constructorParams} params) while the project convention is inject().`,
        file: c.file,
        line: c.line,
        fixHint:
          'Run "ng generate @angular/core:inject" or replace constructor parameters with `private x = inject(X)` fields.',
        docsUrl: 'https://angular.dev/reference/migrations/inject-function',
      })),
      meta: { convention, usingInject: viaInject, usingConstructor: viaCtor.length },
    };
  },
});
