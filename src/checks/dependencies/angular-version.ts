import { defineCheck, skipCheck, type CheckContext, type Finding } from '../../core/types.js';
import { parseJsonOutput } from '../util.js';
import {
  ANGULAR_RELEASES,
  releasesFromRegistryTimes,
  supportInfo,
  type SupportInfo,
} from './angular-releases.js';

const UPDATE_GUIDE = 'https://angular.dev/update-guide';

async function releaseDates(
  ctx: CheckContext,
): Promise<{ releases: Record<number, string>; source: string }> {
  if (!ctx.offline) {
    try {
      const r = await ctx.exec('npm', ['view', '@angular/core', 'time', '--json']);
      const times =
        r.exitCode === 0 ? parseJsonOutput<Record<string, string>>(r.stdout) : undefined;
      if (times)
        return {
          releases: { ...ANGULAR_RELEASES, ...releasesFromRegistryTimes(times) },
          source: 'registry',
        };
    } catch (err) {
      ctx.logger.debug(`npm view failed, using bundled release table: ${String(err)}`);
    }
  }
  return { releases: ANGULAR_RELEASES, source: 'bundled' };
}

function scoreFor(info: SupportInfo, monthsLeft: number): number {
  if (info.status === 'active') return 100;
  if (info.status === 'lts') return monthsLeft < 3 ? 70 : 85;
  return Math.max(0, 40 - 10 * (info.majorsBehind - 1));
}

export default defineCheck({
  id: 'dependencies/angular-version',
  name: 'Angular version support',
  category: 'dependencies',
  description: 'Compares the Angular major with the latest release and its support window.',
  async run(ctx) {
    const major = ctx.project.angular.major;
    if (major === undefined) skipCheck('Angular version could not be determined');
    const now = ctx.now();
    const { releases, source } = await releaseDates(ctx);
    const info = supportInfo(major, releases, now);
    if (!info) skipCheck(`No release data for Angular ${major}`);

    const monthsLeft = (new Date(info.endOfSupport).getTime() - now.getTime()) / (30.44 * 864e5);
    const target = info.latestMajor;
    const upgradePath =
      info.majorsBehind > 1
        ? `Upgrade one major at a time (${major} → ${major + 1} → … → ${target}) with "ng update @angular/core@<n> @angular/cli@<n>".`
        : `Run "ng update @angular/core@${target} @angular/cli@${target}".`;
    const findings: Finding[] = [];

    if (info.status === 'eol') {
      findings.push({
        severity: info.majorsBehind >= 3 ? 'critical' : 'high',
        ruleId: 'angular-eol',
        message: `Angular ${major} is end-of-life since ${info.endOfSupport} (${info.majorsBehind} majors behind ${target}); it no longer receives security fixes.`,
        fixHint: upgradePath,
        docsUrl: UPDATE_GUIDE,
      });
    } else if (info.status === 'lts') {
      findings.push({
        severity: monthsLeft < 3 ? 'medium' : 'low',
        ruleId: 'angular-lts',
        message: `Angular ${major} is in LTS until ${info.endOfSupport}; the latest major is ${target}.`,
        fixHint: `Plan the upgrade before support ends. ${upgradePath}`,
        docsUrl: UPDATE_GUIDE,
      });
    }

    return {
      score: scoreFor(info, monthsLeft),
      findings,
      meta: { ...info, releaseDataSource: source },
    };
  },
});
