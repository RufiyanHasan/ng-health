import { defineCheck } from '../../core/types.js';
import { ratioScore } from '../util.js';
import { getAngularAnalysis, type ComponentInfo } from './analysis.js';

/** Angular 22 made OnPush the default; `Eager` (formerly `Default`) opts out. */
export const isOnPush = (c: ComponentInfo, major: number) =>
  c.changeDetection === 'OnPush' || (major >= 22 && c.changeDetection === undefined);

export default defineCheck({
  id: 'angular/onpush',
  name: 'OnPush change detection',
  category: 'angular',
  description: 'Components should use ChangeDetectionStrategy.OnPush.',
  async run(ctx) {
    const major = ctx.project.angular.major ?? 0;
    const { components } = await getAngularAnalysis(ctx);
    const missing = components.filter((c) => !isOnPush(c, major));
    return {
      score: ratioScore(missing.length, components.length),
      findings: missing.map((c) => ({
        severity: 'medium',
        ruleId: 'missing-onpush',
        message: c.changeDetection
          ? `${c.name} opts out of OnPush with ChangeDetectionStrategy.${c.changeDetection}.`
          : `${c.name} uses default change detection.`,
        file: c.file,
        line: c.line,
        fixHint:
          major >= 22
            ? 'Remove the Eager/Default strategy (OnPush is the default since Angular 22) and drive the view from signals, inputs or the async pipe.'
            : 'Add `changeDetection: ChangeDetectionStrategy.OnPush` and drive the view from signals, inputs or the async pipe.',
        docsUrl: 'https://angular.dev/best-practices/skipping-subtrees',
      })),
      meta: { components: components.length, onPush: components.length - missing.length },
    };
  },
});
