import { defineCheck, skipCheck, type Finding } from '../../core/types.js';
import { ratioScore } from '../util.js';
import { getAngularAnalysis } from './analysis.js';

export default defineCheck({
  id: 'angular/control-flow',
  name: 'Legacy structural directives',
  category: 'angular',
  description: '*ngIf/*ngFor/ngSwitch should be migrated to @if/@for/@switch.',
  async run(ctx) {
    const major = ctx.project.angular.major;
    if (major !== undefined && major < 17)
      skipCheck(`Built-in control flow needs Angular 17+ (project uses ${major})`);
    const { components } = await getAngularAnalysis(ctx);
    const withTemplate = components.filter((c) => c.template);
    const findings: Finding[] = [];
    for (const c of withTemplate) {
      const legacy = c.template?.analysis.legacy ?? [];
      const first = legacy[0];
      if (!first || !c.template) continue;
      const counts = new Map<string, number>();
      for (const l of legacy) counts.set(l.directive, (counts.get(l.directive) ?? 0) + 1);
      const summary = [...counts].map(([d, n]) => `${d} ×${n}`).join(', ');
      findings.push({
        severity: 'low',
        ruleId: 'legacy-control-flow',
        message: `${c.name} template uses legacy structural directives (${summary}).`,
        file: c.template.file,
        line: first.line,
        fixHint: 'Run "ng generate @angular/core:control-flow" to migrate to @if/@for/@switch.',
        docsUrl: 'https://angular.dev/guide/templates/control-flow',
      });
    }
    return {
      score: ratioScore(findings.length, withTemplate.length),
      findings,
      meta: { templates: withTemplate.length },
    };
  },
});
