import path from 'node:path';
import { readJsonFile } from '../../core/fs.js';
import type { CheckContext } from '../../core/types.js';

export interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function readPackageJson(ctx: CheckContext): Promise<PackageJson> {
  return ctx.shared(
    'package.json',
    async () => (await readJsonFile<PackageJson>(path.join(ctx.root, 'package.json'))) ?? {},
  );
}

export function directDependencies(
  pkg: PackageJson,
): { name: string; range: string; dev: boolean }[] {
  return [
    ...Object.entries(pkg.dependencies ?? {}).map(([name, range]) => ({ name, range, dev: false })),
    ...Object.entries(pkg.devDependencies ?? {}).map(([name, range]) => ({
      name,
      range,
      dev: true,
    })),
  ];
}

/** The package manager binary and the args prefix for npm-compatible subcommands. */
export function pmCommand(ctx: CheckContext): 'npm' | 'pnpm' {
  // yarn and bun lack a stable JSON outdated/audit format; npm reads their node_modules fine.
  return ctx.project.packageManager === 'pnpm' ? 'pnpm' : 'npm';
}
