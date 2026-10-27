#!/usr/bin/env node
// Release step run by changesets/action (`npm run release`): STAGES the current version on npm
// instead of publishing it. Staged versions are invisible until a maintainer approves them with
// 2FA (`npm stage approve <id>` or on npmjs.com), so nothing ships without a human.
//
// Idempotent: does nothing if the version is already published or already staged, so re-running
// the workflow is always safe.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Finds the staged entry for `version` in `npm stage list --json` output (shape-tolerant). */
export function findStaged(listJson, version) {
  const items = Array.isArray(listJson)
    ? listJson
    : Array.isArray(listJson?.objects)
      ? listJson.objects
      : Array.isArray(listJson?.stages)
        ? listJson.stages
        : listJson && typeof listJson === 'object'
          ? Object.values(listJson).flat()
          : [];
  return items.find((item) => item && typeof item === 'object' && item.version === version);
}

/** The id to pass to `npm stage approve`, whatever the field is called. */
export const stageIdOf = (entry) => entry?.id ?? entry?.stageId ?? entry?.stage_id ?? entry?.uuid;

function npm(args, { allowFail = false } = {}) {
  const res = spawnSync('npm', args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (res.status !== 0 && !allowFail) {
    throw new Error(
      `npm ${args.join(' ')} failed (exit ${res.status}):\n${res.stdout}\n${res.stderr}`,
    );
  }
  return res;
}

function summary(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

function stagedEntry(name, version) {
  const res = npm(['stage', 'list', name, '--json'], { allowFail: true });
  try {
    return findStaged(JSON.parse(res.stdout || 'null'), version);
  } catch {
    return undefined; // "No staged versions…" is plain text
  }
}

function approvalHelp(name, version, entry) {
  const id = stageIdOf(entry);
  return [
    `### ${name}@${version} is staged on npm and waiting for your approval`,
    '',
    'Approve it with 2FA to make it public:',
    '',
    '```bash',
    id
      ? `npm stage approve ${id}`
      : `npm stage list ${name}   # find the stage id, then: npm stage approve <id>`,
    `git tag v${version} && git push origin v${version}`,
    '```',
    '',
    `Or approve it on https://www.npmjs.com/package/${name}. To discard it: \`npm stage reject <id>\`.`,
  ].join('\n');
}

export function main() {
  const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));

  if (
    npm(['view', `${name}@${version}`, 'version'], { allowFail: true }).stdout.trim() === version
  ) {
    console.log(`${name}@${version} is already published; nothing to stage.`);
    return;
  }
  const existing = stagedEntry(name, version);
  if (existing) {
    summary(approvalHelp(name, version, existing));
    return;
  }

  // Provenance comes from NPM_CONFIG_PROVENANCE in CI; access is explicit for clarity.
  npm(['stage', 'publish', '--access', 'public']);
  summary(approvalHelp(name, version, stagedEntry(name, version)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
