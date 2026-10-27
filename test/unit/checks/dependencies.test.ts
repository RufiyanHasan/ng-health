import { describe, expect, it } from 'vitest';
import {
  supportInfo,
  ANGULAR_RELEASES,
} from '../../../src/checks/dependencies/angular-releases.js';
import angularVersion from '../../../src/checks/dependencies/angular-version.js';
import deprecated from '../../../src/checks/dependencies/deprecated.js';
import outdated, { parseOutdated } from '../../../src/checks/dependencies/outdated.js';
import vulnerabilities, { parseAudit } from '../../../src/checks/dependencies/vulnerabilities.js';
import { fakeExec, fixture, runOn, summarize } from '../../helpers/fixtures.js';
import { makeTempProject } from '../../helpers/tmp.js';

const NOW = new Date('2026-10-27T12:00:00Z');
const online = { offline: false };
const projectWithAngular = (range: string) =>
  makeTempProject({ 'package.json': { dependencies: { '@angular/core': range } } });

describe('dependencies/angular-version', () => {
  const run = async (range: string, extra = {}) =>
    runOn(angularVersion, await projectWithAngular(range), {
      context: { now: () => NOW, ...extra },
    });

  it.each([
    ['^22.1.0', 'active', 100, []],
    [
      '^21.0.0',
      'lts',
      85,
      [['low', null, null, 'Angular 21 is in LTS until 2027-05-19; the latest major is 22.']],
    ],
    [
      '^20.3.0',
      'lts',
      70,
      [['medium', null, null, 'Angular 20 is in LTS until 2026-11-28; the latest major is 22.']],
    ],
    [
      '^19.2.0',
      'eol',
      20,
      [
        [
          'critical',
          null,
          null,
          'Angular 19 is end-of-life since 2026-05-19 (3 majors behind 22); it no longer receives security fixes.',
        ],
      ],
    ],
    [
      '~18.0.0',
      'eol',
      10,
      [
        [
          'critical',
          null,
          null,
          'Angular 18 is end-of-life since 2025-11-22 (4 majors behind 22); it no longer receives security fixes.',
        ],
      ],
    ],
  ])('Angular %s → %s', async (range, status, score, expected) => {
    const r = await run(range);
    expect(r.meta).toMatchObject({ status, releaseDataSource: 'bundled' });
    expect(r.score).toBe(score);
    expect(summarize(r)).toEqual(expected);
  });

  it('flags the unhealthy fixture (Angular 17) as critical EOL', async () => {
    const r = await runOn(angularVersion, fixture('unhealthy'), { context: { now: () => NOW } });
    expect(summarize(r)).toEqual([
      [
        'critical',
        null,
        null,
        'Angular 17 is end-of-life since 2025-05-08 (5 majors behind 22); it no longer receives security fixes.',
      ],
    ]);
    expect(r.findings[0]?.fixHint).toContain('17 → 18 → … → 22');
  });

  it('uses registry release dates when online', async () => {
    const { exec, calls } = fakeExec({
      'npm view @angular/core time': {
        stdout: JSON.stringify({
          '22.0.0': '2026-06-03T00:00Z',
          '23.0.0': '2026-10-01T00:00Z',
          '23.0.1': 'x',
        }),
      },
    });
    const r = await run('^22.0.0', { ...online, exec });
    expect(calls).toEqual(['npm view @angular/core time --json']);
    expect(r.meta).toMatchObject({ status: 'lts', latestMajor: 23, releaseDataSource: 'registry' });
  });

  it('falls back to the bundled table when the registry fails', async () => {
    const { exec } = fakeExec({ 'npm view': { exitCode: 1 } });
    expect((await run('^22.0.0', { ...online, exec })).meta).toMatchObject({
      releaseDataSource: 'bundled',
    });
  });

  it('skips when the Angular version is unknown', async () => {
    const r = await run('github:angular/core');
    expect(r).toMatchObject({
      status: 'skipped',
      reason: 'Angular version could not be determined',
    });
  });

  it('supportInfo ignores unreleased majors', () => {
    expect(supportInfo(22, { ...ANGULAR_RELEASES, 23: '2030-01-01' }, NOW)?.latestMajor).toBe(22);
    expect(supportInfo(5, ANGULAR_RELEASES, NOW)).toBeUndefined();
  });
});

const OUTDATED = {
  '@angular/core': { current: '17.3.12', wanted: '17.3.12', latest: '22.2.3' },
  moment: { current: '2.29.4', wanted: '2.30.1', latest: '2.30.1' },
  rxjs: { current: '7.8.0', wanted: '7.8.2', latest: '7.8.2' },
  typescript: { current: '5.4.5', wanted: '5.4.5', latest: '7.0.2' },
  karma: [{ current: '6.4.0', wanted: '6.4.4', latest: '6.4.4' }],
  'not-direct': { current: '1.0.0', wanted: '1.0.0', latest: '9.0.0' },
  protractor: { wanted: '7.0.0', latest: '7.0.0' },
};

describe('dependencies/outdated', () => {
  it('parses npm outdated JSON', () => {
    expect(parseOutdated(OUTDATED).map((p) => [p.name, p.gap, p.majorsBehind])).toEqual([
      ['@angular/core', 'major', 5],
      ['karma', 'patch', 0],
      ['moment', 'minor', 0],
      ['not-direct', 'major', 8],
      ['rxjs', 'patch', 0],
      ['typescript', 'major', 2],
    ]);
  });

  it('reports direct dependency gaps, excluding the Angular framework', async () => {
    const { exec, calls } = fakeExec({
      'npm outdated': { stdout: JSON.stringify(OUTDATED), exitCode: 1 },
    });
    const r = await runOn(outdated, fixture('unhealthy'), { context: { ...online, exec } });
    expect(calls).toEqual(['npm outdated --json']);
    expect(summarize(r)).toEqual([
      ['high', 'package.json', null, 'typescript 5.4.5 is 2 major versions behind (latest 7.0.2).'],
      ['low', 'package.json', null, '1 package behind by a minor version: moment 2.29.4→2.30.1.'],
      [
        'low',
        'package.json',
        null,
        '2 packages behind by a patch version: karma 6.4.0→6.4.4, rxjs 7.8.0→7.8.2.',
      ],
    ]);
    expect(r.score).toBe(58);
  });

  it('uses pnpm for pnpm projects and errors on unusable output', async () => {
    const dir = await makeTempProject({
      'package.json': { dependencies: { '@angular/core': '^22.0.0', lodash: '^4.0.0' } },
      'pnpm-lock.yaml': '',
    });
    const ok = fakeExec({
      'pnpm outdated': {
        stdout: JSON.stringify({ lodash: { current: '4.17.20', latest: '4.17.21' } }),
      },
    });
    const r = await runOn(outdated, dir, { context: { ...online, exec: ok.exec } });
    expect(ok.calls).toEqual(['pnpm outdated --format json']);
    expect(r.findings).toHaveLength(1);

    const bad = fakeExec({
      'pnpm outdated': { stdout: 'boom', stderr: 'ERR_PNPM_NO_IMPORTER', exitCode: 1 },
    });
    expect(await runOn(outdated, dir, { context: { ...online, exec: bad.exec } })).toMatchObject({
      status: 'errored',
      reason: 'pnpm outdated failed: ERR_PNPM_NO_IMPORTER',
    });
  });

  it('is skipped offline', async () => {
    expect((await runOn(outdated, fixture('unhealthy'))).reason).toBe(
      'Offline mode: registry lookup disabled',
    );
  });
});

const AUDIT = {
  auditReportVersion: 2,
  vulnerabilities: {
    moment: {
      name: 'moment',
      severity: 'high',
      isDirect: true,
      via: [
        {
          title: 'Path Traversal in moment.locale',
          url: 'https://github.com/advisories/GHSA-8hfj-j24r-96c4',
        },
      ],
      fixAvailable: true,
    },
    protractor: {
      name: 'protractor',
      severity: 'critical',
      isDirect: true,
      via: ['webdriver-manager'],
      fixAvailable: false,
    },
    'webdriver-manager': {
      name: 'webdriver-manager',
      severity: 'critical',
      isDirect: false,
      via: [
        {
          title: 'Prototype pollution in xml2js',
          url: 'https://github.com/advisories/GHSA-776f-qx25-q3cc',
        },
      ],
      fixAvailable: { name: 'protractor', version: '5.4.4', isSemVerMajor: true },
    },
    harmless: { name: 'harmless', severity: 'info', via: [] },
    minimist: {
      name: 'minimist',
      severity: 'moderate',
      isDirect: false,
      via: [],
      fixAvailable: true,
    },
  },
};

describe('dependencies/vulnerabilities', () => {
  it('maps npm audit results to findings', async () => {
    const { exec } = fakeExec({ 'npm audit': { stdout: JSON.stringify(AUDIT), exitCode: 1 } });
    const r = await runOn(vulnerabilities, fixture('unhealthy'), { context: { ...online, exec } });
    expect(summarize(r)).toEqual([
      ['critical', null, null, 'protractor: via webdriver-manager'],
      ['critical', null, null, 'webdriver-manager (transitive): Prototype pollution in xml2js'],
      ['high', null, null, 'moment: Path Traversal in moment.locale'],
      ['medium', null, null, 'minimist (transitive): vulnerable version range'],
    ]);
    expect(r.findings.map((f) => f.fixHint)).toEqual([
      'No fix available yet: check whether protractor is still needed, or replace it.',
      'Upgrade protractor to 5.4.4 (breaking change).',
      'Run "npm audit fix".',
      'Run "npm audit fix".',
    ]);
    expect(r.findings[1]?.docsUrl).toBe('https://github.com/advisories/GHSA-776f-qx25-q3cc');
    expect(r.meta).toEqual({ counts: { critical: 2, high: 1, medium: 1, low: 0 } });
  });

  it('parses the pnpm/npm6 advisories format', () => {
    expect(
      parseAudit(
        {
          advisories: {
            '1': {
              module_name: 'lodash',
              severity: 'low',
              title: 'Proto',
              url: 'u',
              patched_versions: '>=4.17.21',
            },
            '2': {
              module_name: 'evil',
              severity: 'critical',
              title: 'RCE',
              patched_versions: '<0.0.0',
            },
          },
        },
        'pnpm',
      ).map((v) => [v.name, v.severity, v.fix]),
    ).toEqual([
      ['evil', 'critical', 'No patched version: replace evil or remove the dependency on it.'],
      ['lodash', 'low', 'Upgrade lodash to >=4.17.21.'],
    ]);
  });

  it('skips without a lockfile and errors on other failures', async () => {
    const noLock = fakeExec({
      'npm audit': { stdout: JSON.stringify({ error: { code: 'ENOLOCK' } }), exitCode: 1 },
    });
    expect(
      (
        await runOn(vulnerabilities, fixture('unhealthy'), {
          context: { ...online, exec: noLock.exec },
        })
      ).status,
    ).toBe('skipped');
    const net = fakeExec({
      'npm audit': {
        stdout: JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'registry unreachable' } }),
      },
    });
    expect(
      await runOn(vulnerabilities, fixture('unhealthy'), {
        context: { ...online, exec: net.exec },
      }),
    ).toMatchObject({
      status: 'errored',
      reason: 'npm audit failed: registry unreachable',
    });
    const empty = fakeExec({ 'npm audit': { stdout: '', stderr: 'npm ERR! weird' } });
    expect(
      (
        await runOn(vulnerabilities, fixture('unhealthy'), {
          context: { ...online, exec: empty.exec },
        })
      ).reason,
    ).toBe('npm audit failed: npm ERR! weird');
  });
});

describe('dependencies/deprecated', () => {
  it('flags known deprecated packages offline', async () => {
    const r = await runOn(deprecated, fixture('unhealthy'));
    expect(summarize(r)).toEqual([
      ['low', 'package.json', null, 'karma is deprecated or end-of-life.'],
      ['low', 'package.json', null, 'moment is deprecated or end-of-life.'],
      ['high', 'package.json', null, 'protractor is deprecated or end-of-life.'],
      ['high', 'package.json', null, 'tslint is deprecated or end-of-life.'],
    ]);
    expect(r.meta).toMatchObject({ registryLookup: false });
  });

  it('queries the registry for other direct dependencies when online', async () => {
    const dir = await makeTempProject({
      'package.json': {
        dependencies: { '@angular/core': '^22.0.0', 'left-pad': '^1.3.0', local: 'file:../local' },
        devDependencies: { tslint: '^6.0.0' },
      },
    });
    const { exec, calls } = fakeExec({
      'npm view left-pad@^1.3.0': {
        stdout: JSON.stringify(['old', 'use String.prototype.padStart()']),
      },
      'npm view @angular/core@^22.0.0': { stdout: '' },
    });
    const r = await runOn(deprecated, dir, { context: { ...online, exec } });
    expect(calls.sort()).toEqual([
      'npm view @angular/core@^22.0.0 deprecated --json',
      'npm view left-pad@^1.3.0 deprecated --json',
    ]);
    expect(summarize(r)).toEqual([
      ['medium', 'package.json', null, 'left-pad is deprecated: use String.prototype.padStart()'],
      ['high', 'package.json', null, 'tslint is deprecated or end-of-life.'],
    ]);
  });
});
