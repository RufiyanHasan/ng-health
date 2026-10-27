import { defineCheck } from '../../core/types.js';
import { ratioScore } from '../util.js';
import { getAngularAnalysis } from './analysis.js';

export default defineCheck({
  id: 'angular/subscriptions',
  name: 'Subscriptions without cleanup',
  category: 'angular',
  description: 'subscribe() in components/directives must be cleaned up to avoid memory leaks.',
  async run(ctx) {
    const { subscribes } = await getAngularAnalysis(ctx);
    const leaking = subscribes.filter((s) => !s.cleanedUp);
    const v16 = (ctx.project.angular.major ?? 99) >= 16;
    return {
      score: ratioScore(leaking.length, subscribes.length),
      findings: leaking.map((s) => ({
        severity: 'high',
        ruleId: 'subscribe-without-cleanup',
        message: `${s.className}: subscribe() without cleanup (${s.reason}).`,
        file: s.file,
        line: s.line,
        fixHint: v16
          ? 'Prefer the async pipe or toSignal(); otherwise add `takeUntilDestroyed(this.destroyRef)` to the pipe.'
          : 'Prefer the async pipe; otherwise use takeUntil(this.destroy$) and complete destroy$ in ngOnDestroy.',
        docsUrl: 'https://angular.dev/ecosystem/rxjs-interop/take-until-destroyed',
      })),
      meta: { subscribeCalls: subscribes.length, withoutCleanup: leaking.length },
    };
  },
});
