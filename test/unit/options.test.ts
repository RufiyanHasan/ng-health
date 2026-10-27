import { describe, expect, it } from 'vitest';
import { parseFormats, resolveOutput, splitList, toAuditOptions } from '../../src/cli/flags.js';
import { parseConfig } from '../../src/core/config/loader.js';
import { resolveOptions } from '../../src/core/options.js';

describe('CLI flags', () => {
  it('splitList flattens repeated and comma-separated values', () => {
    expect(splitList(['html,json', ' md ', ''])).toEqual(['html', 'json', 'md']);
    expect(splitList(undefined)).toEqual([]);
  });

  it('parseFormats dedupes and rejects unknown formats', () => {
    expect(parseFormats(['html,json', 'html'])).toEqual(['html', 'json']);
    expect(() => parseFormats(['pdf'])).toThrow(/Unknown report format: pdf/);
  });

  it('toAuditOptions maps flags onto library options, omitting unset ones', () => {
    expect(toAuditOptions({})).toEqual({});
    expect(
      toAuditOptions({
        only: ['angular'],
        skip: ['bundle,hygiene'],
        routes: ['/,/cart'],
        url: 'https://x.test',
        loginScript: 'login.mjs',
        baseline: 'old.json',
        config: 'c.json',
        build: false,
        offline: true,
        format: ['html'],
        ci: true,
      }),
    ).toEqual({
      only: ['angular'],
      skip: ['bundle', 'hygiene'],
      routes: ['/', '/cart'],
      url: 'https://x.test',
      loginScript: 'login.mjs',
      baseline: 'old.json',
      config: 'c.json',
      build: false,
      offline: true,
    });
  });

  it('resolveOutput: flags win over config output; CI swaps console for markdown', () => {
    const config = parseConfig({ output: { dir: 'reports', formats: ['json', 'console'] } });
    expect(resolveOutput({}, config, '/work')).toEqual({
      formats: ['json', 'console'],
      outDir: '/work/reports',
    });
    expect(resolveOutput({ format: ['html,md'], out: 'out' }, config, '/work')).toEqual({
      formats: ['html', 'md'],
      outDir: '/work/out',
    });
    expect(resolveOutput({ ci: true }, config, '/w').formats).toEqual(['json', 'md']);
  });
});

describe('resolveOptions (library)', () => {
  const config = parseConfig({
    skip: ['bundle'],
    runtime: { routes: ['/a'], loginScript: 'scripts/login.mjs' },
  });

  it('falls back to config values', () => {
    expect(resolveOptions('app', {}, config, undefined, '/work')).toMatchObject({
      projectPath: '/work/app',
      only: undefined,
      skip: ['bundle'],
      build: true,
      offline: false,
      runtime: { routes: ['/a'], loginScript: '/work/scripts/login.mjs', formFactor: 'mobile' },
    });
  });

  it('lets options win, merges skip, and resolves paths', () => {
    const o = resolveOptions(
      '.',
      {
        only: ['angular'],
        skip: ['hygiene'],
        build: false,
        offline: true,
        url: 'https://staging.example.com',
        routes: ['/', '/cart'],
        loginScript: 'login.mjs',
      },
      config,
      '/proj/ng-health.config.json',
      '/work',
    );
    expect(o).toMatchObject({
      only: ['angular'],
      skip: ['bundle', 'hygiene'],
      build: false,
      offline: true,
      runtime: {
        url: 'https://staging.example.com',
        routes: ['/', '/cart'],
        loginScript: '/work/login.mjs',
      },
    });
    expect(
      resolveOptions('.', {}, config, '/proj/ng-health.config.json', '/work').runtime.loginScript,
    ).toBe('/proj/scripts/login.mjs');
  });

  it('rejects invalid routes and urls with ConfigError', () => {
    expect(() => resolveOptions('.', { routes: ['products'] }, config, undefined, '/w')).toThrow(
      expect.objectContaining({
        name: 'ConfigError',
        message: 'Routes must start with "/": products',
      }),
    );
    expect(() => resolveOptions('.', { url: 'not a url' }, config, undefined, '/w')).toThrow(
      /Invalid url/,
    );
  });
});
