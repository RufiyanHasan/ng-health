import { realpath } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import type { Severity } from '../../core/config/schema.js';
import { pathExists, readJsonFile } from '../../core/fs.js';
import { defineCheck, skipCheck, type CheckContext, type Finding } from '../../core/types.js';
import { parseJsonOutput } from '../util.js';
import { directDependencies, readPackageJson } from './package-json.js';

interface InstalledManifest {
  name?: string;
  version?: string;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

export interface PeerConflict {
  /** The direct dependency declaring the peer requirement. */
  name: string;
  version: string;
  peer: string;
  /** The range it requires, e.g. ">=21.0.0". */
  range: string;
  /** Installed peer version, or undefined when the peer is missing. */
  installed: string | undefined;
  optional: boolean;
}

// Prereleases (e.g. 22.0.0-rc.1) count: they are what is installed and resolved.
const satisfies = (version: string, range: string) =>
  semver.satisfies(version, range, { includePrerelease: true, loose: true });

/**
 * Resolves `name` the way Node does: for each ancestor of the dependent's real directory
 * (skipping folders that are themselves `node_modules`), look in `<ancestor>/node_modules`.
 * That covers npm/yarn (hoisted or nested) and pnpm (symlinks into .pnpm, peers alongside).
 */
async function resolveInstalled(
  fromDir: string,
  name: string,
): Promise<InstalledManifest | undefined> {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    if (path.basename(dir) !== 'node_modules') {
      const manifest = await readJsonFile<InstalledManifest>(
        path.join(dir, 'node_modules', name, 'package.json'),
      ).catch(() => undefined);
      if (manifest?.version) return manifest;
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** Unmet peer dependencies of the project's direct dependencies, read from node_modules. */
export async function findPeerConflicts(ctx: CheckContext): Promise<PeerConflict[]> {
  const conflicts: PeerConflict[] = [];
  for (const dep of directDependencies(await readPackageJson(ctx))) {
    const pkgDir = path.join(ctx.root, 'node_modules', dep.name);
    const manifest = await readJsonFile<InstalledManifest>(path.join(pkgDir, 'package.json')).catch(
      () => undefined,
    );
    if (!manifest?.version || !manifest.peerDependencies) continue;
    const realDir = await realpath(pkgDir).catch(() => pkgDir);

    for (const [peer, range] of Object.entries(manifest.peerDependencies)) {
      if (!semver.validRange(range, { loose: true })) continue; // e.g. "workspace:*", URLs
      const optional = manifest.peerDependenciesMeta?.[peer]?.optional === true;
      const installed = await resolveInstalled(realDir, peer);
      if (!installed?.version) {
        if (!optional)
          conflicts.push({
            name: dep.name,
            version: manifest.version,
            peer,
            range,
            installed: undefined,
            optional,
          });
        continue;
      }
      if (!satisfies(installed.version, range)) {
        conflicts.push({
          name: dep.name,
          version: manifest.version,
          peer,
          range,
          installed: installed.version,
          optional,
        });
      }
    }
  }
  return conflicts.sort((a, b) => a.name.localeCompare(b.name) || a.peer.localeCompare(b.peer));
}

/**
 * Newest stable version of `name` whose peer ranges all accept what is installed
 * (from `npm view <name>@>=0.0.0 version peerDependencies --json`).
 */
export function compatibleVersion(
  versions: { version: string; peerDependencies?: Record<string, string> }[],
  installedPeers: Record<string, string>,
): string | undefined {
  return versions
    .filter((v) => semver.valid(v.version) && !semver.prerelease(v.version))
    .filter((v) =>
      Object.entries(v.peerDependencies ?? {}).every(([peer, range]) => {
        const have = installedPeers[peer];
        return (
          have === undefined || !semver.validRange(range, { loose: true }) || satisfies(have, range)
        );
      }),
    )
    .map((v) => v.version)
    .sort(semver.rcompare)[0];
}

async function suggestVersion(
  ctx: CheckContext,
  conflict: PeerConflict,
  installedPeers: Record<string, string>,
) {
  if (ctx.offline) return undefined;
  try {
    // `@*` would mean only the `latest` tag; an explicit range lists every stable version.
    const r = await ctx.exec('npm', [
      'view',
      `${conflict.name}@>=0.0.0`,
      'version',
      'peerDependencies',
      '--json',
    ]);
    const parsed = r.exitCode === 0 ? parseJsonOutput<unknown>(r.stdout) : undefined;
    const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return compatibleVersion(
      list as { version: string; peerDependencies?: Record<string, string> }[],
      installedPeers,
    );
  } catch (err) {
    ctx.logger.debug(`npm view ${conflict.name} failed: ${String(err)}`);
    return undefined;
  }
}

/** Framework peers (Angular, RxJS, TypeScript) break builds or runtime; others are usually tolerable. */
const severityFor = (c: PeerConflict): Severity => {
  if (c.optional) return 'low';
  return /^(@angular\/|rxjs$|typescript$|zone\.js$)/.test(c.peer) ? 'high' : 'medium';
};

export default defineCheck({
  id: 'dependencies/peer-conflicts',
  name: 'Peer dependency conflicts',
  category: 'dependencies',
  description:
    'Direct dependencies whose peer dependencies are missing or outside the required range (the cause of npm ERESOLVE errors and --legacy-peer-deps installs).',
  timeoutMs: 120_000,
  async run(ctx) {
    if (!(await pathExists(path.join(ctx.root, 'node_modules')))) {
      skipCheck(
        'Dependencies are not installed (run npm install first): peer ranges are read from node_modules',
      );
    }
    const conflicts = await findPeerConflicts(ctx);
    const installedPeers: Record<string, string> = {};
    for (const c of conflicts) if (c.installed) installedPeers[c.peer] = c.installed;

    const findings: Finding[] = [];
    for (const c of conflicts) {
      const suggestion = await suggestVersion(ctx, c, installedPeers);
      const problem = c.installed
        ? `${c.name} ${c.version} requires ${c.peer} ${c.range}, but ${c.installed} is installed.`
        : `${c.name} ${c.version} requires ${c.peer} ${c.range}, which is not installed.`;
      const fix = suggestion
        ? suggestion === c.version
          ? `Reinstall to fix the tree, or align ${c.peer} with ${c.range}.`
          : `Install a compatible version: npm install ${c.name}@${suggestion} (or upgrade ${c.peer} to ${c.range}).`
        : c.installed
          ? `Install a ${c.name} version whose peer range accepts ${c.peer} ${c.installed}, or upgrade ${c.peer} to match ${c.range}.`
          : `Install ${c.peer} (${c.range}) or remove ${c.name}.`;
      findings.push({
        severity: severityFor(c),
        ruleId: c.installed ? 'peer-version-mismatch' : 'peer-missing',
        message: problem,
        fixHint: `${fix} Mismatched peers make npm install fail with ERESOLVE and are often hidden with --legacy-peer-deps.`,
        file: 'package.json',
        docsUrl: 'https://docs.npmjs.com/cli/configuring-npm/package-json#peerdependencies',
      });
    }
    return { findings, meta: { conflicts } };
  },
});
