// A TypeScript check: ng-health loads .ts plugins directly, no build step needed.
import { defineCheck, type Finding } from 'ng-health';

export default defineCheck({
  id: 'custom/no-console',
  name: 'console.* calls',
  category: 'custom',
  description: 'Flags console.log/debug calls left in application code.',
  async run(ctx) {
    const findings: Finding[] = [];
    for (const file of await ctx.glob('src/**/*.ts')) {
      if (file.endsWith('.spec.ts')) continue;
      const lines = (await ctx.readText(file)).split('\n');
      lines.forEach((text, i) => {
        if (/\bconsole\.(log|debug)\(/.test(text)) {
          findings.push({
            severity: 'low',
            ruleId: 'console-call',
            message: `console call in ${file}`,
            file,
            line: i + 1,
            fixHint: 'Remove it, or use a logging service that is silenced in production builds.',
          });
        }
      });
    }
    return { findings };
  },
});
