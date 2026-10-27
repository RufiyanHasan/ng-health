import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/core/config/loader.js';
import { parseFormats, resolveAuditOptions, splitList } from '../../src/core/options.js';

describe('splitList', () => {
  it('flattens repeated and comma-separated values', () => {
    expect(splitList(['html,json', ' md ', ''])).toEqual(['html', 'json', 'md']);
    expect(splitList(undefined)).toEqual([]);
  });
});

describe('parseFormats', () => {
  it('dedupes valid formats', () => {
    expect(parseFormats(['html,json', 'html'])).toEqual(['html', 'json']);
  });
  it('rejects unknown formats', () => {
    expect(() => parseFormats(['pdf'])).toThrow(/Unknown report format: pdf/);
  });
});

describe('resolveAuditOptions', () => {
  const config = parseConfig({ skip: ['bundle'], output: { dir: 'reports', formats: ['json'] } });

  it('falls back to config values', () => {
    const o = resolveAuditOptions('app', {}, config, undefined, '/work');
    expect(o).toMatchObject({
      projectPath: '/work/app',
      formats: ['json'],
      outDir: '/work/reports',
      only: undefined,
      skip: ['bundle'],
      ci: false,
    });
  });

  it('lets CLI flags win and merges skip lists', () => {
    const o = resolveAuditOptions(
      '.',
      { format: ['html,md'], out: 'out', only: ['angular'], skip: ['hygiene'], verbose: true },
      config,
      '/work/fe-health.config.json',
      '/work',
    );
    expect(o).toMatchObject({
      formats: ['html', 'md'],
      outDir: '/work/out',
      only: ['angular'],
      skip: ['bundle', 'hygiene'],
      verbose: true,
      configFile: '/work/fe-health.config.json',
    });
  });

  it('always adds the markdown summary in CI mode', () => {
    expect(resolveAuditOptions('.', { ci: true }, config, undefined, '/w').formats).toEqual([
      'json',
      'md',
    ]);
  });
});
