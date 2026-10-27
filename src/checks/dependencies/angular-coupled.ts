import path from 'node:path';
import semver from 'semver';
import { readJsonFile } from '../../core/fs.js';
import type { CheckContext } from '../../core/types.js';

/**
 * TypeScript versions supported by each Angular major (peerDependencies.typescript of the
 * latest @angular/compiler-cli in that major). Used when compiler-cli isn't installed.
 */
export const TYPESCRIPT_RANGES: Record<number, string> = {
  16: '>=4.9.3 <5.2',
  17: '>=5.2 <5.5',
  18: '>=5.4 <5.6',
  19: '>=5.5 <5.9',
  20: '>=5.8 <6.0',
  21: '>=5.9 <6.1',
  22: '>=6.0 <6.1',
};

/** Packages released in lockstep with Angular majors (package major N targets Angular N). */
export const ANGULAR_ALIGNED = [
  /^@angular-architects\//,
  /^@ngrx\//,
  /^@angular-eslint\//,
  /^angular-eslint$/,
  /^@nx\/angular$/,
];

export const isAngularAligned = (name: string) => ANGULAR_ALIGNED.some((re) => re.test(name));

/** The TypeScript range the project's Angular version supports, if known. */
export async function supportedTypescriptRange(ctx: CheckContext): Promise<string | undefined> {
  const cli = await readJsonFile<{ peerDependencies?: Record<string, string> }>(
    path.join(ctx.root, 'node_modules/@angular/compiler-cli/package.json'),
  ).catch(() => undefined);
  const installed = cli?.peerDependencies?.['typescript'];
  if (installed && semver.validRange(installed)) return installed;
  const major = ctx.project.angular.major;
  return major === undefined ? undefined : TYPESCRIPT_RANGES[major];
}
