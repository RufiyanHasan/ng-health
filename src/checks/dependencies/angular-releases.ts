/**
 * Angular major release dates (x.0.0 on npm). Used offline; when online the dates are read
 * from the registry so new majors are picked up without a ng-health release.
 */
export const ANGULAR_RELEASES: Record<number, string> = {
  12: '2021-05-12',
  13: '2021-11-03',
  14: '2022-06-02',
  15: '2022-11-16',
  16: '2023-05-03',
  17: '2023-11-08',
  18: '2024-05-22',
  19: '2024-11-19',
  20: '2025-05-28',
  21: '2025-11-19',
  22: '2026-06-03',
};

/** Angular policy: each major gets 18 months of support (6 active + 12 LTS) from release. */
export const SUPPORT_MONTHS = 18;

export type SupportStatus = 'active' | 'lts' | 'eol';

export interface SupportInfo {
  major: number;
  latestMajor: number;
  majorsBehind: number;
  status: SupportStatus;
  releasedOn: string;
  /** When LTS ends (support window closes). */
  endOfSupport: string;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function supportInfo(
  major: number,
  releases: Record<number, string>,
  now: Date,
): SupportInfo | undefined {
  const released = Object.entries(releases)
    .map(([m, date]) => [Number(m), new Date(date)] as const)
    .filter(([, date]) => date <= now);
  const releasedOn = releases[major];
  if (!releasedOn || !released.length) return undefined;
  const latestMajor = Math.max(...released.map(([m]) => m));
  const release = new Date(releasedOn);
  const end = addMonths(release, SUPPORT_MONTHS);
  // The newest major is in active support until the next one ships; older ones are LTS.
  const status: SupportStatus = now > end ? 'eol' : major >= latestMajor ? 'active' : 'lts';
  return {
    major,
    latestMajor,
    majorsBehind: Math.max(0, latestMajor - major),
    status,
    releasedOn,
    endOfSupport: day(end),
  };
}

/** Extracts x.0.0 release dates from `npm view @angular/core time --json`. */
export function releasesFromRegistryTimes(times: Record<string, string>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [version, date] of Object.entries(times)) {
    const m = /^(\d+)\.0\.0$/.exec(version);
    if (m) out[Number(m[1])] = date.slice(0, 10);
  }
  return out;
}
