import { defineCheck } from '../../core/types.js';
import { num, ratioScore } from '../util.js';
import { getAngularAnalysis } from './analysis.js';

export default defineCheck({
  id: 'angular/large-components',
  name: 'Large components',
  category: 'angular',
  description: 'Components above a line-count limit (class + template) are hard to maintain.',
  async run(ctx) {
    const maxLoc = num(ctx, 'maxLoc', 400);
    const { components } = await getAngularAnalysis(ctx);
    const sized = components.map((c) => ({
      c,
      loc: c.loc + (c.template && !c.template.inline ? c.template.loc : 0),
    }));
    const large = sized.filter((s) => s.loc > maxLoc);
    return {
      score: ratioScore(large.length, components.length),
      findings: large.map(({ c, loc }) => ({
        severity: loc > maxLoc * 2 ? 'high' : 'medium',
        ruleId: 'large-component',
        message: `${c.name} has ${loc} lines (limit ${maxLoc}).`,
        file: c.file,
        line: c.line,
        fixHint:
          'Split it into smaller presentational components and move logic into services or computed signals.',
      })),
      meta: {
        maxLoc,
        largest: sized
          .sort((a, b) => b.loc - a.loc)
          .slice(0, 5)
          .map((s) => ({ name: s.c.name, loc: s.loc })),
      },
    };
  },
});
