import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/core/config/loader.js';
import { selectChecks, validateRegistry } from '../../src/core/registry.js';
import { stubCheck } from '../helpers/checks.js';

const checks = [
  stubCheck('angular/onpush', { findings: [] }),
  stubCheck('angular/any', { findings: [] }),
  stubCheck('bundle/size', { findings: [] }),
  stubCheck('extra/opt-in', { findings: [] }, { enabledByDefault: false }),
];

const ids = (list: { check: { id: string } }[]) => list.map((s) => s.check.id);

describe('validateRegistry', () => {
  it('rejects duplicate and malformed ids', () => {
    expect(() => validateRegistry([checks[0]!, checks[0]!])).toThrow(/Duplicate check id/);
    expect(() => validateRegistry([stubCheck('Bad Id', { findings: [] })])).toThrow(
      /Invalid check id/,
    );
    expect(() => validateRegistry(checks)).not.toThrow();
  });
});

describe('selectChecks', () => {
  it('selects all default-enabled checks', () => {
    const s = selectChecks(checks, parseConfig({}), { only: undefined, skip: [] });
    expect(ids(s.selected)).toEqual(['angular/onpush', 'angular/any', 'bundle/size']);
    expect(s.excluded).toEqual([
      { check: checks[3], reason: 'opt-in check (enable it in config)' },
    ]);
  });

  it('filters by --only and --skip using ids or categories', () => {
    const s = selectChecks(checks, parseConfig({}), {
      only: ['angular', 'extra/opt-in'],
      skip: ['angular/any', 'nope'],
    });
    expect(ids(s.selected)).toEqual(['angular/onpush', 'extra/opt-in']);
    expect(s.excluded.map((e) => [e.check.id, e.reason])).toEqual([
      ['angular/any', 'excluded by --skip'],
      ['bundle/size', 'not selected by --only'],
    ]);
    expect(s.unknownTokens).toEqual(['nope']);
  });

  it('applies config enable/disable with check-level overriding category-level', () => {
    const config = parseConfig({
      checks: {
        angular: { enabled: false, options: { a: 1, b: 1 } },
        'angular/any': { enabled: true, weight: 3, options: { b: 2 } },
        'extra/opt-in': true,
        bundle: false,
      },
    });
    const s = selectChecks(checks, config, { only: undefined, skip: [] });
    expect(ids(s.selected)).toEqual(['angular/any', 'extra/opt-in']);
    expect(s.selected[0]!.settings).toEqual({ enabled: true, weight: 3, options: { a: 1, b: 2 } });
    expect(s.excluded.map((e) => e.reason)).toEqual(['disabled in config', 'disabled in config']);
  });
});
