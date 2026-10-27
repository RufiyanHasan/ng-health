import { describe, expect, it } from 'vitest';
import {
  bool,
  clampScore,
  listSome,
  num,
  parseJsonOutput,
  plural,
  ratioScore,
  strings,
} from '../../../src/checks/util.js';
import type { CheckContext } from '../../../src/core/types.js';

const ctx = (options: Record<string, unknown>) => ({ options }) as CheckContext;

describe('check utilities', () => {
  it('reads typed options with fallbacks for missing or mistyped values', () => {
    const c = ctx({ n: 5, bad: 'x', inf: Infinity, b: false, s: ['a'], mixed: ['a', 1] });
    expect([num(c, 'n', 1), num(c, 'bad', 1), num(c, 'inf', 1), num(c, 'missing', 1)]).toEqual([
      5, 1, 1, 1,
    ]);
    expect([bool(c, 'b', true), bool(c, 'n', true)]).toEqual([false, true]);
    expect([strings(c, 's', []), strings(c, 'mixed', ['z']), strings(c, 'n', ['z'])]).toEqual([
      ['a'],
      ['z'],
      ['z'],
    ]);
  });

  it('formats and scores', () => {
    expect([plural(1, 'file'), plural(2, 'file'), plural(2, 'index', 'indices')]).toEqual([
      '1 file',
      '2 files',
      '2 indices',
    ]);
    expect([ratioScore(0, 0), ratioScore(1, 4), ratioScore(4, 4)]).toEqual([100, 75, 0]);
    expect([clampScore(-5), clampScore(50.6), clampScore(130)]).toEqual([0, 51, 100]);
    expect(listSome(['a', 'b'])).toBe('a, b');
    expect(listSome(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 5)).toBe('a, b, c, d, e and 2 more');
  });

  it('parses JSON from noisy command output', () => {
    expect(parseJsonOutput('npm warn something\n{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonOutput('[1,2]')).toEqual([1, 2]);
    expect(parseJsonOutput('no json here')).toBeUndefined();
    expect(parseJsonOutput('{ broken')).toBeUndefined();
  });
});
