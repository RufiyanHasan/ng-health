import path from 'node:path';
import semver from 'semver';
import { readJsonFile } from '../../core/fs.js';
import { defineCheck, skipCheck, type Finding } from '../../core/types.js';
import { clampScore, listSome, parseJsonOutput, plural } from '../util.js';
import { isAngularAligned, supportedTypescriptRange } from './angular-coupled.js';
import { directDependencies, pmCommand, readPackageJson } from './package-json.js';

interface OutdatedEntry {
  current?: string;
  wanted?: string;
  latest?: string;
}

export interface OutdatedPackage {
  name: string;
  current: string;
  latest: string;
  gap: 'major' | 'minor' | 'patch';
  majorsBehind: number;
}

/** Normalises npm and pnpm `outdated --json` output (both are keyed by package name). */
export function parseOutdated(
  json: Record<string, OutdatedEntry | OutdatedEntry[]>,
): OutdatedPackage[] {
  const result: OutdatedPackage[] = [];
  for (const [name, raw] of Object.entries(json)) {
    // npm reports one entry per location for duplicated packages
    const entry = Array.isArray(raw) ? raw[0] : raw;
    const current = semver.valid(entry?.current ?? '') ?? semver.valid(entry?.wanted ?? '');
    const latest = semver.valid(entry?.latest ?? '');
    if (!current || !latest || !semver.lt(current, latest)) continue;
    const diff = semver.diff(current, latest);
    const gap =
      diff === 'major' || diff === 'premajor'
        ? 'major'
        : diff === 'minor' || diff === 'preminor'
          ? 'minor'
          : 'patch';
    result.push({
      name,
      current,
      latest,
      gap,
      majorsBehind: semver.major(latest) - semver.major(current),
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** Angular framework packages are judged by dependencies/angular-version instead. */
const isFramework = (name: string) => /^@angular(-devkit)?\//.test(name) || name === 'zone.js';

/**
 * Packages whose upgrade path is tied to Angular's: TypeScript (each Angular major supports a
 * TypeScript range) and lockstep packages such as @ngrx/* (major N targets Angular N). They're
 * judged against the project's Angular version, never against their own latest release:
 * "upgrade TypeScript to 7" is wrong advice for an Angular 21 project.
 */
const isCoupled = (name: string) => name === 'typescript' || isAngularAligned(name);

export default defineCheck({
  id: 'dependencies/outdated',
  name: 'Outdated packages',
  category: 'dependencies',
  description: 'Major, minor and patch version gaps of direct dependencies.',
  timeoutMs: 180_000,
  async run(ctx) {
    if (ctx.offline) skipCheck('Offline mode: registry lookup disabled');
    const pm = pmCommand(ctx);
    const args = pm === 'pnpm' ? ['outdated', '--format', 'json'] : ['outdated', '--json'];
    const r = await ctx.exec(pm, args);
    const json = parseJsonOutput<Record<string, OutdatedEntry>>(r.stdout);
    if (!json || 'error' in json) {
      throw new Error(
        `${pm} outdated failed: ${(r.stderr || r.stdout).trim().split('\n')[0] ?? 'no output'}`,
      );
    }
    const pkg = await readPackageJson(ctx);
    const direct = new Set(directDependencies(pkg).map((d) => d.name));
    const outdated = parseOutdated(json).filter((p) => direct.has(p.name));
    const ownGaps = outdated.filter((p) => !isFramework(p.name) && !isCoupled(p.name));

    const findings: Finding[] = [];
    const angularMajor = ctx.project.angular.major;
    let coupledDebt = 0;

    // TypeScript: only flag versions outside the range this Angular version supports.
    const tsVersion = await installedOrDeclared(ctx, 'typescript', pkg);
    const tsRange = await supportedTypescriptRange(ctx);
    if (tsVersion && tsRange && !semver.satisfies(tsVersion, tsRange)) {
      coupledDebt += 1;
      findings.push({
        severity: 'high',
        ruleId: 'typescript-unsupported',
        message: `TypeScript ${tsVersion} is outside the range ${
          angularMajor === undefined ? 'your Angular version' : `Angular ${angularMajor}`
        } supports (${tsRange}).`,
        fixHint: `Install a supported version: npm i -D typescript@"${tsRange}". Newer TypeScript majors arrive with the next Angular upgrade.`,
        file: 'package.json',
        docsUrl: 'https://angular.dev/reference/versions',
      });
    }

    // Lockstep packages: flag only when behind the project's Angular major.
    for (const name of [...direct].filter(isAngularAligned).sort()) {
      const version = await installedOrDeclared(ctx, name, pkg);
      if (!version || angularMajor === undefined || semver.major(version) >= angularMajor) continue;
      coupledDebt += 1;
      findings.push({
        severity: 'medium',
        ruleId: 'behind-angular',
        message: `${name} ${version} targets Angular ${semver.major(version)}, but the project uses Angular ${angularMajor}.`,
        fixHint: `Upgrade it to match Angular: "ng update ${name}@${angularMajor}" (or the ${angularMajor}.x release).`,
        file: 'package.json',
      });
    }

    for (const p of ownGaps.filter((p) => p.gap === 'major')) {
      findings.push({
        severity: p.majorsBehind >= 2 ? 'high' : 'medium',
        ruleId: 'major-behind',
        message: `${p.name} ${p.current} is ${plural(p.majorsBehind, 'major version')} behind (latest ${p.latest}).`,
        fixHint: `Review the ${p.name} changelog for breaking changes, then upgrade to ${p.latest}.`,
        file: 'package.json',
      });
    }
    for (const gap of ['minor', 'patch'] as const) {
      const list = ownGaps.filter((p) => p.gap === gap);
      if (!list.length) continue;
      findings.push({
        severity: 'low',
        ruleId: `${gap}-behind`,
        message: `${plural(list.length, 'package')} behind by a ${gap} version: ${listSome(list.map((p) => `${p.name} ${p.current}→${p.latest}`))}.`,
        fixHint: `${gap === 'patch' ? 'Patch' : 'Minor'} updates should be backwards compatible: run "${pm} update" and re-run your tests.`,
        file: 'package.json',
      });
    }

    // Weighted share of out-of-date direct dependencies.
    const weight = { major: 1, minor: 0.3, patch: 0.1 };
    const debt = ownGaps.reduce((s, p) => s + weight[p.gap] * Math.min(p.majorsBehind || 1, 3), 0);
    const total = [...direct].filter((n) => !isFramework(n)).length;
    return {
      score: total ? clampScore(100 - ((debt + coupledDebt) / total) * 100) : 100,
      findings,
      meta: { outdated, directDependencies: direct.size },
    };
  },
});

/** Installed version from node_modules, else the lowest version allowed by package.json. */
async function installedOrDeclared(
  ctx: Parameters<typeof readPackageJson>[0],
  name: string,
  pkg: Awaited<ReturnType<typeof readPackageJson>>,
): Promise<string | undefined> {
  const installed = (
    await readJsonFile<{ version?: string }>(
      path.join(ctx.root, 'node_modules', name, 'package.json'),
    ).catch(() => undefined)
  )?.version;
  if (installed && semver.valid(installed)) return installed;
  const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  const min = declared && semver.validRange(declared) ? semver.minVersion(declared) : null;
  return min?.version;
}
