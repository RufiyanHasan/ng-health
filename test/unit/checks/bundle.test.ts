import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSize } from '../../../src/checks/bundle/budgets.js';
import size from '../../../src/checks/bundle/size.js';
import {
  initialFromIndexHtml,
  initialFromWebpack,
  normalizeModulePath,
  topModules,
} from '../../../src/checks/bundle/stats.js';
import { fakeExec, fixture, runOn, summarize } from '../../helpers/fixtures.js';
import { angularApp, makeTempProject } from '../../helpers/tmp.js';

describe('bundle helpers', () => {
  it('parses budget sizes', () => {
    expect([
      parseSize('500kb'),
      parseSize('1mb'),
      parseSize('2.5MB'),
      parseSize('300b'),
      parseSize('10%'),
      parseSize(undefined),
    ]).toEqual([512000, 1048576, 2621440, 300, undefined, undefined]);
  });

  it('classifies initial files from webpack stats and index.html', () => {
    expect([
      ...initialFromWebpack({
        chunks: [
          { initial: true, files: ['main.js', 'styles.css'] },
          { initial: false, files: ['1.js'] },
        ],
      }),
    ]).toEqual(['main.js', 'styles.css']);
    expect([
      ...initialFromIndexHtml(
        '<link rel="stylesheet" href="styles-A.css"><link rel="modulepreload" href="chunk-B.js"><script src="/main-C.js" type="module"></script><script src="https://cdn.x/y.js"></script>',
      ),
    ]).toEqual(['styles-A.css', 'chunk-B.js', 'main-C.js']);
  });

  it('normalises module paths and aggregates webpack modules', () => {
    expect(normalizeModulePath('node_modules/.pnpm/rxjs@7.8.1/node_modules/rxjs/dist/x.js')).toBe(
      'node_modules/rxjs/dist/x.js',
    );
    expect(normalizeModulePath('./src/app/a.ts')).toBe('src/app/a.ts');
    expect(
      topModules({
        modules: [
          { name: './src/a.ts', size: 10 },
          { name: 'src/a.ts', size: 5 },
          { name: 'b', size: 30 },
        ],
      }),
    ).toEqual([
      { path: 'b', bytes: 30 },
      { path: 'src/a.ts', bytes: 15 },
    ]);
  });
});

describe('bundle/size', () => {
  it('healthy fixture: esbuild stats, within budgets', async () => {
    const r = await runOn(size, fixture('healthy'));
    expect(r.status).toBe('completed');
    expect(r.findings).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.meta).toMatchObject({
      statsSource: 'esbuild',
      built: false,
      initialBytes: 84992,
      initialKb: 83,
      lazyBytes: 20480,
      totalBytes: 105472,
      largestLazyChunks: [{ name: 'chunk-LAZY3456.js', bytes: 20480 }],
    });
    const meta = r.meta as {
      initialFiles: { name: string }[];
      topModules: { path: string; bytes: number }[];
      initialGzipBytes: number;
    };
    expect(meta.initialFiles.map((f) => f.name)).toEqual([
      'main-HLTH1234.js',
      'polyfills-POLY5678.js',
      'chunk-SHRD7890.js',
      'styles-STYL9012.css',
    ]);
    expect(meta.topModules[0]).toEqual({
      path: 'node_modules/@angular/core/fesm2022/core.mjs',
      bytes: 38000,
    });
    expect(meta.topModules).toHaveLength(8);
    expect(meta.initialGzipBytes).toBeGreaterThan(0);
    expect(meta.initialGzipBytes).toBeLessThan(84992);
  });

  it('unhealthy fixture: index.html fallback, budget violations', async () => {
    const r = await runOn(size, fixture('unhealthy'));
    expect(summarize(r)).toEqual([
      [
        'high',
        'angular.json',
        null,
        'Initial bundle is 190.0 kB, over the initial budget error limit of 100.0 kB.',
      ],
      [
        'medium',
        'angular.json',
        null,
        'chunk-UNHL4444.js is 300.0 kB, over the anyScript budget warning limit of 120.0 kB.',
      ],
      [
        'medium',
        'angular.json',
        null,
        'main-UNHL1111.js is 150.0 kB, over the anyScript budget warning limit of 120.0 kB.',
      ],
      ['low', null, null, 'Lazy chunk chunk-UNHL4444.js is 300.0 kB (limit 250.0 kB).'],
    ]);
    expect(r.meta).toMatchObject({ statsSource: 'index.html', initialKb: 190, topModules: [] });
    expect(r.score).toBe(0);
  });

  it('runs ng build when the CLI is installed, unless --no-build', async () => {
    const dir = await makeTempProject({ ...angularApp(), 'node_modules/.bin/ng': '#!/bin/sh\n' });
    const out = path.join(dir, 'dist/demo-app/browser');
    const { exec, calls } = fakeExec({
      'ng build': {},
    });
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'main.js'), 'x'.repeat(2048));
    await writeFile(path.join(out, 'index.html'), '<script src="main.js"></script>');
    const r = await runOn(size, dir, { context: { exec } });
    expect(calls).toEqual(['ng build demo-app --configuration production --stats-json']);
    expect(r.meta).toMatchObject({ built: true, initialBytes: 2048 });

    const noBuild = fakeExec({});
    const r2 = await runOn(size, dir, { context: { exec: noBuild.exec, build: false } });
    expect(noBuild.calls).toEqual([]);
    expect(r2.meta).toMatchObject({ built: false });
  });

  it('reports build failures as errored', async () => {
    const dir = await makeTempProject({ ...angularApp(), 'node_modules/.bin/ng': '' });
    const { exec } = fakeExec({ 'ng build': { exitCode: 1, stderr: 'line1\nError: NG8001 boom' } });
    expect(await runOn(size, dir, { context: { exec } })).toMatchObject({
      status: 'errored',
      reason: 'Production build failed (exit 1): line1 | Error: NG8001 boom',
    });
  });

  it('skips with guidance when there is no build output, or no application', async () => {
    const dir = await makeTempProject(angularApp());
    const r = await runOn(size, dir);
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('No build output in dist/demo-app');

    const lib = await makeTempProject({
      'package.json': { dependencies: { '@angular/core': '^22.0.0' } },
    });
    expect((await runOn(size, lib)).reason).toBe('No application project found in angular.json');
  });

  it('applies the Angular CLI default budget when none is configured', async () => {
    const dir = await makeTempProject({
      ...angularApp(),
      'dist/demo-app/browser/main.js': 'x'.repeat(600 * 1024),
      'dist/demo-app/browser/index.html': '<script src="main.js"></script>',
    });
    const r = await runOn(size, dir);
    expect(summarize(r)).toEqual([
      [
        'medium',
        'angular.json',
        null,
        'Initial bundle is 600.0 kB, over the initial budget warning limit of 500.0 kB.',
      ],
    ]);
    expect(r.score).toBe(Math.round(100 - (50 * 100) / 524));
  });

  it('reads browser-stats.json written by Angular 22+', async () => {
    const dir = await makeTempProject({
      ...angularApp(),
      'dist/demo-app/browser/main-A.js': 'x'.repeat(1000),
      'dist/demo-app/browser/chunk-B.js': 'x'.repeat(500),
      'dist/demo-app/browser-stats.json': {
        outputs: {
          'main-A.js': {
            bytes: 1000,
            entryPoint: 'src/main.ts',
            imports: [{ path: 'chunk-B.js', kind: 'dynamic-import' }],
            inputs: { 'src/main.ts': { bytesInOutput: 900 } },
          },
          'chunk-B.js': { bytes: 500, imports: [], inputs: {} },
        },
      },
    });
    expect((await runOn(size, dir)).meta).toMatchObject({
      statsSource: 'esbuild',
      initialBytes: 1000,
      lazyBytes: 500,
      topModules: [{ path: 'src/main.ts', bytes: 900 }],
    });
  });
});
