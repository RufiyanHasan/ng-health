import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** Creates a temp directory with the given files (objects are written as JSON). */
export async function makeTempProject(files: Record<string, string | object>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ng-health-'));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

export const angularApp = (overrides: Record<string, string | object> = {}) => ({
  'package.json': { name: 'demo-app', dependencies: { '@angular/core': '^19.2.0' } },
  'package-lock.json': '{}',
  'angular.json': {
    version: 1,
    projects: {
      'demo-app': {
        projectType: 'application',
        root: '',
        sourceRoot: 'src',
        architect: {
          build: {
            builder: '@angular/build:application',
            options: { outputPath: 'dist/demo-app' },
          },
        },
      },
    },
  },
  ...overrides,
});
