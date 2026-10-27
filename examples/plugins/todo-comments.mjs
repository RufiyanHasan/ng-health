// checks/todo-comments.mjs
import { defineCheck } from 'fe-health';

export default defineCheck({
  id: 'custom/todo-comments', // unique, lowercase, "category/name"
  name: 'TODO comments',
  category: 'custom', // a built-in category or your own
  description: 'Flags TODO and FIXME comments left in source files.',
  async run(ctx) {
    const max = typeof ctx.options.max === 'number' ? ctx.options.max : 0;
    const findings = [];
    for (const file of await ctx.glob('src/**/*.ts')) {
      const lines = (await ctx.readText(file)).split('\n');
      lines.forEach((text, i) => {
        if (/\/\/\s*(TODO|FIXME)\b/.test(text)) {
          findings.push({
            severity: 'low',
            message: `Unresolved comment: ${text.trim()}`,
            file,
            line: i + 1,
            fixHint: 'Resolve it, or turn it into a ticket and remove the comment.',
          });
        }
      });
    }
    // Optional: return your own 0–100 score. Without one, it is derived from severities.
    return {
      score: findings.length <= max ? 100 : Math.max(0, 100 - findings.length * 5),
      findings,
    };
  },
});
