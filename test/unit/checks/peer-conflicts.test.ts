import { symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import peerConflicts, {
  compatibleVersion,
} from '../../../src/checks/dependencies/peer-conflicts.js';
import { fakeExec, fixture, runOn, summarize } from '../../helpers/fixtures.js';
import { angularApp, makeTempProject } from '../../helpers/tmp.js';

const pkg = (name: string, version: string, extra: object = {}) => ({ name, version, ...extra });

/** The portfolio situation: ngx-echarts@21 needs Angular >= 21, the app has Angular 20. */
const echartsApp = (extra: Record<string, string | object> = {}) =>
  makeTempProject({
    ...angularApp({
      'package.json': {
        name: 'charts-app',
        dependencies: { '@angular/core': '^20.2.0', 'ngx-echarts': '^21.0.0', echarts: '^5.6.0' },
      },
    }),
    'node_modules/@angular/core/package.json': pkg('@angular/core', '20.3.18'),
    'node_modules/echarts/package.json': pkg('echarts', '5.6.0'),
    'node_modules/ngx-echarts/package.json': pkg('ngx-echarts', '21.0.0', {
      peerDependencies: { '@angular/core': '>=21.0.0', echarts: '>=5.0.0' },
    }),
    ...extra,
  });

const NPM_VIEW: { version: string; peerDependencies?: Record<string, string> }[] = [
  { version: '19.0.0', peerDependencies: { echarts: '>=5.0.0' } },
  { version: '20.0.1', peerDependencies: { echarts: '>=5.0.0', '@angular/core': '>=20.0.0' } },
  { version: '20.0.2', peerDependencies: { echarts: '>=5.0.0', '@angular/core': '>=20.0.0' } },
  { version: '21.0.0', peerDependencies: { echarts: '>=5.0.0', '@angular/core': '>=21.0.0' } },
  { version: '22.0.0-rc.1', peerDependencies: { '@angular/core': '>=20.0.0' } },
];

describe('dependencies/peer-conflicts', () => {
  it('flags a framework peer outside the required range (offline: generic fix)', async () => {
    const r = await runOn(peerConflicts, await echartsApp(), { context: { offline: true } });
    expect(summarize(r)).toEqual([
      [
        'high',
        'package.json',
        null,
        'ngx-echarts 21.0.0 requires @angular/core >=21.0.0, but 20.3.18 is installed.',
      ],
    ]);
    expect(r.findings[0]?.fixHint).toMatch(
      /^Install a ngx-echarts version whose peer range accepts @angular\/core 20\.3\.18, or upgrade @angular\/core to match >=21\.0\.0\. Mismatched peers make npm install fail with ERESOLVE/,
    );
    expect(r.meta).toMatchObject({
      conflicts: [{ name: 'ngx-echarts', peer: '@angular/core', installed: '20.3.18' }],
    });
  });

  it('suggests the newest compatible stable version when online', async () => {
    const { exec, calls } = fakeExec({
      'npm view ngx-echarts@>=0.0.0': { stdout: JSON.stringify(NPM_VIEW) },
    });
    const r = await runOn(peerConflicts, await echartsApp(), { context: { offline: false, exec } });
    expect(calls).toEqual(['npm view ngx-echarts@>=0.0.0 version peerDependencies --json']);
    expect(r.findings[0]?.fixHint).toMatch(
      /^Install a compatible version: npm install ngx-echarts@20\.0\.2 /,
    );
  });

  it('reports missing required peers, ignores missing optional ones, rates mismatched optional ones low', async () => {
    const dir = await makeTempProject({
      ...angularApp({
        'package.json': {
          dependencies: { '@angular/core': '^20.0.0', 'chart-lib': '1.0.0', 'opt-lib': '1.0.0' },
        },
      }),
      'node_modules/@angular/core/package.json': pkg('@angular/core', '20.3.18'),
      'node_modules/chart-lib/package.json': pkg('chart-lib', '1.0.0', {
        peerDependencies: { 'chart-engine': '^3.0.0' },
      }),
      'node_modules/opt-lib/package.json': pkg('opt-lib', '1.0.0', {
        peerDependencies: {
          'missing-optional': '^1.0.0',
          '@angular/core': '^19.0.0',
          weird: 'workspace:*',
        },
        peerDependenciesMeta: {
          'missing-optional': { optional: true },
          '@angular/core': { optional: true },
        },
      }),
    });
    const r = await runOn(peerConflicts, dir, { context: { offline: true } });
    expect(summarize(r).map(([sev, , , msg]) => [sev, msg])).toEqual([
      ['medium', 'chart-lib 1.0.0 requires chart-engine ^3.0.0, which is not installed.'],
      ['low', 'opt-lib 1.0.0 requires @angular/core ^19.0.0, but 20.3.18 is installed.'],
    ]);
  });

  it('resolves peers like Node: nested copies and pnpm symlinked layouts are satisfied', async () => {
    const dir = await echartsApp({
      // npm nesting: a compatible @angular/core next to ngx-echarts wins over the root one
      'node_modules/ngx-echarts/node_modules/@angular/core/package.json': pkg(
        '@angular/core',
        '21.0.1',
      ),
      // pnpm: node_modules/plot-lib -> .pnpm/plot-lib@2/node_modules/plot-lib, peer alongside it
      'node_modules/.pnpm/plot-lib@2.0.0/node_modules/plot-lib/package.json': pkg(
        'plot-lib',
        '2.0.0',
        {
          peerDependencies: { '@angular/core': '>=21.0.0' },
        },
      ),
      'node_modules/.pnpm/plot-lib@2.0.0/node_modules/@angular/core/package.json': pkg(
        '@angular/core',
        '21.2.0',
      ),
      'package.json': {
        dependencies: {
          '@angular/core': '^20.2.0',
          'ngx-echarts': '^21.0.0',
          'plot-lib': '^2.0.0',
          echarts: '^5.6.0',
        },
      },
    });
    await symlink(
      path.join(dir, 'node_modules/.pnpm/plot-lib@2.0.0/node_modules/plot-lib'),
      path.join(dir, 'node_modules/plot-lib'),
      process.platform === 'win32' ? 'junction' : 'dir', // junctions need no admin rights on Windows
    );
    const r = await runOn(peerConflicts, dir, { context: { offline: true } });
    expect(r.findings).toEqual([]);
  });

  it('accepts prerelease installs and skips without node_modules', async () => {
    const dir = await echartsApp({
      'node_modules/@angular/core/package.json': pkg('@angular/core', '22.0.0-rc.1'),
    });
    expect((await runOn(peerConflicts, dir, { context: { offline: true } })).findings).toEqual([]);

    const r = await runOn(peerConflicts, fixture('unhealthy'));
    expect(r).toMatchObject({ status: 'skipped' });
    expect(r.reason).toMatch(/Dependencies are not installed/);
  });

  it('scores by severity and keeps working when the registry lookup fails', async () => {
    const { exec } = fakeExec({ 'npm view': { exitCode: 1, stderr: 'E404' } });
    const r = await runOn(peerConflicts, await echartsApp(), { context: { offline: false, exec } });
    expect(r.status).toBe('completed');
    expect(r.score).toBe(90);
    expect(r.findings[0]?.fixHint).toMatch(/^Install a ngx-echarts version whose peer range/);
  });
});

describe('compatibleVersion', () => {
  it('picks the newest stable version whose peer ranges accept the installed peers', () => {
    expect(compatibleVersion(NPM_VIEW, { '@angular/core': '20.3.18' })).toBe('20.0.2');
    expect(compatibleVersion(NPM_VIEW, { '@angular/core': '19.2.0' })).toBe('19.0.0');
    expect(
      compatibleVersion(NPM_VIEW, { '@angular/core': '23.0.0', echarts: '4.0.0' }),
    ).toBeUndefined();
  });
});
