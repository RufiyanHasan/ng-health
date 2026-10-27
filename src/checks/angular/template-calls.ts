import { defineCheck, type Finding } from '../../core/types.js';
import { listSome, plural, ratioScore } from '../util.js';
import { getAngularAnalysis, type ComponentInfo } from './analysis.js';

/**
 * Calls to component methods re-run on every change detection cycle. Zero-argument calls to
 * signals (`count()`) are the intended way to read signals and are allowed.
 */
export function offendingCalls(c: ComponentInfo) {
  const signals = new Set(c.signalMembers);
  const methods = new Set(c.methodMembers);
  return (c.template?.analysis.calls ?? []).filter((call) =>
    signals.has(call.name) ? false : methods.has(call.name) || call.argCount > 0,
  );
}

export default defineCheck({
  id: 'angular/template-calls',
  name: 'Function calls in templates',
  category: 'angular',
  description: 'Template bindings should not call component methods.',
  async run(ctx) {
    const { components } = await getAngularAnalysis(ctx);
    const withTemplate = components.filter((c) => c.template);
    const findings: Finding[] = [];
    for (const c of withTemplate) {
      const calls = offendingCalls(c);
      const first = calls[0];
      if (!first || !c.template) continue;
      const names = [...new Set(calls.map((x) => `${x.name}()`))];
      findings.push({
        severity: 'medium',
        ruleId: 'template-function-call',
        message: `${c.name} template has ${plural(calls.length, 'method call')} in bindings: ${listSome(names)}.`,
        file: c.template.file,
        line: first.line,
        fixHint:
          'Replace method calls with computed() signals, pure pipes, or precomputed properties; they run on every change detection.',
        docsUrl: 'https://angular.dev/guide/signals#computed-signals',
      });
    }
    return {
      score: ratioScore(findings.length, withTemplate.length),
      findings,
      meta: { templates: withTemplate.length },
    };
  },
});
