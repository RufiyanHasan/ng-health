import path from 'node:path';
import semver from 'semver';
import { ProjectError } from '../errors.js';
import { pathExists, readJsonFile } from '../fs.js';

/** Package manager detected from `packageManager` in package.json or the lockfile. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** One project from `angular.json`. */
export interface AngularProjectInfo {
  name: string;
  type: 'application' | 'library';
  root: string;
  sourceRoot: string;
  /** Builder of the `build` target, e.g. @angular/build:application. */
  builder: string | undefined;
  outputPath: string | undefined;
  ssr: boolean;
}

/** The detected project setup: Angular version, package manager, workspace layout, SSR and Nx. */
export interface ProjectInfo {
  root: string;
  name: string;
  packageManager: PackageManager;
  angular: {
    /** Range declared in package.json, e.g. "^19.2.0". */
    declared: string | undefined;
    /** Version installed in node_modules, if present. */
    installed: string | undefined;
    /** Best-known major version (installed, else lowest version satisfying the declared range). */
    major: number | undefined;
  };
  /** 'workspace' when angular.json defines more than one project. */
  kind: 'single-app' | 'workspace';
  workspaceFile: string | undefined;
  nx: boolean;
  projects: AngularProjectInfo[];
  defaultProject: string | undefined;
  ssr: boolean;
}

interface PackageJson {
  name?: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface AngularJsonTarget {
  builder?: string;
  executor?: string;
  options?: Record<string, unknown>;
}

interface AngularJson {
  defaultProject?: string;
  projects?: Record<
    string,
    {
      projectType?: string;
      root?: string;
      sourceRoot?: string;
      architect?: Record<string, AngularJsonTarget>;
      targets?: Record<string, AngularJsonTarget>;
    }
  >;
}

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

const SSR_PACKAGES = ['@angular/ssr', '@nguniversal/express-engine', '@angular/platform-server'];

/** Walks up from `dir` looking for a lockfile (monorepos keep it at the repo root). */
export async function detectPackageManager(
  dir: string,
  pkg: PackageJson | undefined,
): Promise<PackageManager> {
  const declared = pkg?.packageManager?.split('@')[0];
  if (declared === 'npm' || declared === 'pnpm' || declared === 'yarn' || declared === 'bun') {
    return declared;
  }
  let current = path.resolve(dir);
  for (;;) {
    for (const [file, pm] of LOCKFILES) {
      if (await pathExists(path.join(current, file))) return pm;
    }
    if (await pathExists(path.join(current, '.git'))) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return 'npm';
}

function majorOf(installed: string | undefined, declared: string | undefined): number | undefined {
  if (installed && semver.valid(installed)) return semver.major(installed);
  if (declared && semver.validRange(declared)) {
    const min = semver.minVersion(declared);
    if (min) return min.major;
  }
  return undefined;
}

function isSsrTarget(targets: Record<string, AngularJsonTarget>): boolean {
  const build = targets['build'];
  const opts = build?.options ?? {};
  if (opts['ssr'] || opts['server'] || opts['prerender']) return true;
  return Boolean(targets['server'] || targets['serve-ssr'] || targets['prerender']);
}

function toProjects(ws: AngularJson): AngularProjectInfo[] {
  return Object.entries(ws.projects ?? {}).map(([name, p]) => {
    const targets = p.architect ?? p.targets ?? {};
    const build = targets['build'];
    const root = p.root ?? '';
    const outputPath = build?.options?.['outputPath'];
    return {
      name,
      type: p.projectType === 'library' ? 'library' : 'application',
      root,
      sourceRoot: p.sourceRoot ?? path.posix.join(root, 'src'),
      builder: build?.builder ?? build?.executor,
      outputPath:
        typeof outputPath === 'string'
          ? outputPath
          : typeof outputPath === 'object' && outputPath && 'base' in outputPath
            ? String((outputPath as { base: unknown }).base)
            : undefined,
      ssr: isSsrTarget(targets),
    };
  });
}

export async function detectProject(root: string): Promise<ProjectInfo> {
  const absRoot = path.resolve(root);
  const pkg = await readJsonFile<PackageJson>(path.join(absRoot, 'package.json'));
  const deps = { ...pkg?.devDependencies, ...pkg?.dependencies };

  let workspaceFile: string | undefined;
  let ws: AngularJson | undefined;
  for (const candidate of ['angular.json', '.angular-cli.json', 'workspace.json']) {
    const file = path.join(absRoot, candidate);
    ws = await readJsonFile<AngularJson>(file);
    if (ws) {
      workspaceFile = file;
      break;
    }
  }

  const declared = deps['@angular/core'];
  if (!ws && !declared) {
    throw new ProjectError(`No Angular project found in ${absRoot}`, {
      hint: 'Expected an angular.json or a package.json depending on @angular/core. Pass the project path: ng-health audit <path>',
    });
  }

  const installedPkg = await readJsonFile<{ version?: string }>(
    path.join(absRoot, 'node_modules', '@angular', 'core', 'package.json'),
  );
  const installed = installedPkg?.version;
  const projects = ws ? toProjects(ws) : [];
  const hasSsrPackage = SSR_PACKAGES.some((p) => p in deps);
  const hasServerTs = await pathExists(path.join(absRoot, 'server.ts'));

  return {
    root: absRoot,
    name: pkg?.name ?? path.basename(absRoot),
    packageManager: await detectPackageManager(absRoot, pkg),
    angular: { declared, installed, major: majorOf(installed, declared) },
    kind: projects.length > 1 ? 'workspace' : 'single-app',
    workspaceFile,
    nx: await pathExists(path.join(absRoot, 'nx.json')),
    projects,
    defaultProject:
      ws?.defaultProject ??
      projects.find((p) => p.type === 'application')?.name ??
      projects[0]?.name,
    ssr: projects.some((p) => p.ssr) || hasSsrPackage || hasServerTs,
  };
}
