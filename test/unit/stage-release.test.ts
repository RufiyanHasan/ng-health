import { describe, expect, it } from 'vitest';
import { findStaged, stageIdOf } from '../../scripts/stage-release.mjs';

describe('scripts/stage-release.mjs', () => {
  it('finds the staged entry for a version in any `npm stage list --json` shape', () => {
    const entry = { id: 'stg_123', version: '0.2.0', tag: 'latest' };
    for (const shape of [
      [entry, { id: 'stg_old', version: '0.1.0' }],
      { objects: [entry] },
      { stages: [entry] },
      { 'ng-health': [entry] },
    ]) {
      expect(findStaged(shape, '0.2.0')).toEqual(entry);
    }
    expect(findStaged([entry], '9.9.9')).toBeUndefined();
    expect(findStaged(null, '0.2.0')).toBeUndefined();
    expect(findStaged('No staged versions', '0.2.0')).toBeUndefined();
  });

  it('reads the stage id whatever the field is called', () => {
    expect(stageIdOf({ id: 'a' })).toBe('a');
    expect(stageIdOf({ stageId: 'b' })).toBe('b');
    expect(stageIdOf({ stage_id: 'c' })).toBe('c');
    expect(stageIdOf({ uuid: 'd' })).toBe('d');
    expect(stageIdOf(undefined)).toBeUndefined();
  });
});
