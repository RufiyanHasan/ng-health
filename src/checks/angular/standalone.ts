import { defineCheck, skipCheck } from '../../core/types.js';
import { ratioScore } from '../util.js';
import { getAngularAnalysis, type ComponentInfo } from './analysis.js';

/** Angular 19 made standalone the default; before that it had to be opted into. */
export const isStandalone = (c: ComponentInfo, major: number) =>
  major >= 19 ? c.standalone !== false : c.standalone === true;

export default defineCheck({
  id: 'angular/standalone',
  name: 'Standalone components',
  category: 'angular',
  description: 'NgModule-declared components should be migrated to standalone.',
  async run(ctx) {
    const major = ctx.project.angular.major ?? 19;
    if (major < 15) skipCheck(`Standalone components need Angular 15+ (project uses ${major})`);
    const { components, ngModules } = await getAngularAnalysis(ctx);
    const moduleBased = components.filter((c) => !isStandalone(c, major));
    return {
      score: ratioScore(moduleBased.length, components.length),
      findings: moduleBased.map((c) => ({
        severity: 'low',
        ruleId: 'ngmodule-component',
        message: `${c.name} is declared in an NgModule instead of being standalone.`,
        file: c.file,
        line: c.line,
        fixHint:
          'Run "ng generate @angular/core:standalone" to migrate components, then remove empty NgModules.',
        docsUrl: 'https://angular.dev/reference/migrations/standalone',
      })),
      meta: {
        components: components.length,
        standalone: components.length - moduleBased.length,
        ngModules,
      },
    };
  },
});
