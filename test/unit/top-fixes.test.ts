import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/core/config/loader.js';
import { DEFAULT_SEVERITY_PENALTIES } from '../../src/core/config/schema.js';
import { topFixes } from '../../src/core/top-fixes.js';
import { reported } from '../helpers/report.js';

const names = new Map([
  ['angular/onpush', 'OnPush change detection'],
  ['dependencies/deprecated', 'Deprecated packages'],
]);
const rank = (findings: ReturnType<typeof reported>[], limit?: number) =>
  topFixes(findings, names, parseConfig({}), DEFAULT_SEVERITY_PENALTIES, limit);

describe('topFixes', () => {
  it('groups findings with the same check, rule and remedy into one fix', () => {
    const fixes = rank([
      reported('angular/onpush', {
        message: 'A uses default',
        file: 'a.ts',
        ruleId: 'missing-onpush',
      }),
      reported('angular/onpush', {
        message: 'B uses default',
        file: 'b.ts',
        ruleId: 'missing-onpush',
      }),
      reported('angular/onpush', {
        message: 'C uses default',
        file: 'a.ts',
        ruleId: 'missing-onpush',
      }),
    ]);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({
      rank: 1,
      count: 3,
      files: ['a.ts', 'b.ts'],
      message: 'OnPush change detection: 3 occurrences, e.g. A uses default',
    });
  });

  it('keeps findings with different remedies apart', () => {
    const fixes = rank([
      reported('dependencies/deprecated', {
        severity: 'high',
        message: 'tslint',
        fixHint: 'Use ESLint',
        ruleId: 'deprecated-package',
      }),
      reported('dependencies/deprecated', {
        severity: 'high',
        message: 'protractor',
        fixHint: 'Use Playwright',
        ruleId: 'deprecated-package',
      }),
    ]);
    expect(fixes.map((f) => [f.message, f.count])).toEqual([
      ['protractor', 1],
      ['tslint', 1],
    ]);
  });

  it('ranks by severity × category weight × log occurrences, and limits', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      reported('angular/onpush', { severity: 'low', message: `C${i}`, ruleId: 'missing-onpush' }),
    );
    const fixes = rank([
      ...many,
      reported('dependencies/deprecated', { severity: 'critical', message: 'eol', ruleId: 'x' }),
      reported('angular/onpush', { severity: 'high', message: 'one high', ruleId: 'other' }),
    ]);
    // critical (25 × 0.5) beats high (10 × 0.5) beats 30 lows (1 × 0.5 × (1 + log2 30) ≈ 2.95)
    expect(fixes.map((f) => [f.rank, f.severity, f.impact])).toEqual([
      [1, 'critical', 12.5],
      [2, 'high', 5],
      [3, 'low', 2.95],
    ]);
    expect(
      rank(
        many.map((f, i) => ({ ...f, ruleId: `r${i}` })),
        10,
      ),
    ).toHaveLength(10);
  });
});
