import { describe, expect, it } from 'vitest';
import { detectProject } from '../../src/core/detect/index.js';
import { angularApp, makeTempProject } from '../helpers/tmp.js';

describe('detectProject', () => {
  it('detects a single npm app', async () => {
    const dir = await makeTempProject(angularApp());
    const p = await detectProject(dir);
    expect(p).toMatchObject({
      name: 'demo-app',
      packageManager: 'npm',
      kind: 'single-app',
      ssr: false,
      nx: false,
      defaultProject: 'demo-app',
      angular: { declared: '^19.2.0', installed: undefined, major: 19 },
    });
    expect(p.projects[0]).toEqual({
      name: 'demo-app',
      type: 'application',
      root: '',
      sourceRoot: 'src',
      builder: '@angular/build:application',
      outputPath: 'dist/demo-app',
      ssr: false,
    });
  });

  it('prefers the installed Angular version', async () => {
    const dir = await makeTempProject(
      angularApp({ 'node_modules/@angular/core/package.json': { version: '20.1.3' } }),
    );
    expect((await detectProject(dir)).angular).toEqual({
      declared: '^19.2.0',
      installed: '20.1.3',
      major: 20,
    });
  });

  it('detects a pnpm workspace with an SSR app and a library', async () => {
    const dir = await makeTempProject({
      'package.json': { dependencies: { '@angular/core': '~18.0.0', '@angular/ssr': '^18.0.0' } },
      'pnpm-lock.yaml': '',
      'nx.json': {},
      'angular.json': `{
        // workspace with comments
        "projects": {
          "shop": { "projectType": "application", "root": "projects/shop",
            "architect": { "build": { "builder": "@angular-devkit/build-angular:application",
              "options": { "outputPath": { "base": "dist/shop" }, "ssr": { "entry": "server.ts" } } } } },
          "ui": { "projectType": "library", "root": "projects/ui", "sourceRoot": "projects/ui/src" },
        },
      }`,
    });
    const p = await detectProject(dir);
    expect(p.packageManager).toBe('pnpm');
    expect(p.kind).toBe('workspace');
    expect(p.nx).toBe(true);
    expect(p.ssr).toBe(true);
    expect(p.angular.major).toBe(18);
    expect(p.defaultProject).toBe('shop');
    expect(p.projects.map((x) => [x.name, x.type, x.sourceRoot, x.outputPath, x.ssr])).toEqual([
      ['shop', 'application', 'projects/shop/src', 'dist/shop', true],
      ['ui', 'library', 'projects/ui/src', undefined, false],
    ]);
  });

  it('honours the packageManager field and yarn lockfiles', async () => {
    const withField = await makeTempProject(
      angularApp({
        'package.json': {
          packageManager: 'yarn@4.1.0',
          dependencies: { '@angular/core': '19.0.0' },
        },
      }),
    );
    expect((await detectProject(withField)).packageManager).toBe('yarn');
    const files: Record<string, string | object> = angularApp();
    delete files['package-lock.json'];
    const withYarnLock = await makeTempProject({ ...files, 'yarn.lock': '', '.git/HEAD': '' });
    expect((await detectProject(withYarnLock)).packageManager).toBe('yarn');
  });

  it('detects SSR via server.ts and works without angular.json', async () => {
    const dir = await makeTempProject({
      'package.json': { dependencies: { '@angular/core': '^17.3.0' } },
      'server.ts': '',
    });
    const p = await detectProject(dir);
    expect(p).toMatchObject({
      ssr: true,
      projects: [],
      workspaceFile: undefined,
      kind: 'single-app',
    });
  });

  it('fails with a friendly error for non-Angular directories', async () => {
    const dir = await makeTempProject({ 'package.json': { name: 'react-app' } });
    await expect(detectProject(dir)).rejects.toThrow(/No Angular project found/);
  });
});
