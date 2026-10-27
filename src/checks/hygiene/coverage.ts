import path from 'node:path';
import fg from 'fast-glob';
import { readJsonFile } from '../../core/fs.js';
import { defineCheck, skipCheck, type Finding } from '../../core/types.js';
import { clampScore, num } from '../util.js';

interface CoverageSummary {
  total?: { lines?: { pct?: number | string } };
}

/** Line coverage from lcov.info: LH (lines hit) / LF (lines found). */
export function lcovLinePct(text: string): number | undefined {
  let found = 0;
  let hit = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('LF:')) found += Number(line.slice(3)) || 0;
    else if (line.startsWith('LH:')) hit += Number(line.slice(3)) || 0;
  }
  return found ? (hit / found) * 100 : undefined;
}

export default defineCheck({
  id: 'hygiene/coverage',
  name: 'Test coverage',
  category: 'hygiene',
  description:
    'Line coverage from an existing coverage report (coverage-summary.json or lcov.info).',
  async run(ctx) {
    const target = num(ctx, 'targetPct', 80);
    // Not ctx.glob(): coverage/ is excluded by the default ignore globs.
    const files = (
      await fg(['coverage/**/coverage-summary.json', 'coverage/**/lcov.info'], {
        cwd: ctx.root,
        ignore: ['**/node_modules/**'],
      })
    ).sort();
    const summaryFile = files.find((f) => f.endsWith('coverage-summary.json'));
    const lcovFile = files.find((f) => f.endsWith('lcov.info'));

    let pct: number | undefined;
    let source: string | undefined;
    if (summaryFile) {
      const raw = (await readJsonFile<CoverageSummary>(path.join(ctx.root, summaryFile)))?.total
        ?.lines?.pct;
      pct =
        typeof raw === 'number'
          ? raw
          : raw !== undefined && !Number.isNaN(Number(raw))
            ? Number(raw)
            : undefined;
      source = summaryFile;
    }
    if (pct === undefined && lcovFile) {
      pct = lcovLinePct(await ctx.readText(lcovFile));
      source = lcovFile;
    }
    if (pct === undefined || !source) {
      skipCheck(
        'No coverage report found (run your tests with coverage, e.g. "ng test --coverage")',
      );
    }

    const rounded = Math.round(pct * 10) / 10;
    const findings: Finding[] = [];
    if (pct < target) {
      findings.push({
        severity: pct < target / 2 ? 'high' : 'medium',
        ruleId: 'low-coverage',
        message: `Line coverage is ${rounded}% (target ${target}%).`,
        file: source,
        fixHint:
          'Add tests for uncovered code paths and enforce a coverage threshold in your test runner config.',
      });
    }
    return {
      score: clampScore((pct / target) * 100),
      findings,
      meta: { linePct: rounded, source },
    };
  },
});
