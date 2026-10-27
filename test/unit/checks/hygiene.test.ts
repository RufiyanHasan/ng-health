import { describe, expect, it } from 'vitest';
import coverage, { lcovLinePct } from '../../../src/checks/hygiene/coverage.js';
import tests from '../../../src/checks/hygiene/tests.js';
import tooling from '../../../src/checks/hygiene/tooling.js';
import strict from '../../../src/checks/hygiene/typescript-strict.js';
import { fixture, runOn, summarize } from '../../helpers/fixtures.js';
import { makeTempProject } from '../../helpers/tmp.js';

const ng = { 'package.json': { dependencies: { '@angular/core': '^22.0.0' } } };

describe('hygiene checks on the healthy fixture', () => {
  it.each([tooling, strict, tests, coverage].map((c) => [c.id, c]))(
    '%s passes',
    async (_id, check) => {
      const r = await runOn(check, fixture('healthy'));
      expect(r.findings).toEqual([]);
      expect(r.score).toBe(100);
    },
  );
});

describe('hygiene checks on the unhealthy fixture', () => {
  it('hygiene/tooling', async () => {
    expect(summarize(await runOn(tooling, fixture('unhealthy')))).toEqual([
      ['high', null, null, 'Only TSLint (deprecated) is configured; ESLint is missing.'],
      ['low', null, null, 'No Prettier configuration found.'],
    ]);
  });

  it('hygiene/typescript-strict', async () => {
    expect(summarize(await runOn(strict, fixture('unhealthy')))).toEqual([
      ['high', 'tsconfig.json', null, 'TypeScript strict mode is off.'],
      [
        'medium',
        'tsconfig.json',
        null,
        'Angular strictTemplates is off, so template bindings are not type-checked.',
      ],
      ['low', 'tsconfig.json', null, 'Angular strictInjectionParameters is off.'],
    ]);
  });

  it('hygiene/tests', async () => {
    const r = await runOn(tests, fixture('unhealthy'));
    expect(summarize(r)).toEqual([
      [
        'high',
        null,
        null,
        '25% of components/services have a spec file (target 80%). Untested: src/app/dashboard/dashboard.component.ts, src/app/settings.service.ts, src/app/user-card.component.ts.',
      ],
    ]);
    expect(r.score).toBe(31);
  });

  it('hygiene/coverage reads lcov.info', async () => {
    const r = await runOn(coverage, fixture('unhealthy'));
    expect(summarize(r)).toEqual([
      ['high', 'coverage/lcov.info', null, 'Line coverage is 30% (target 80%).'],
    ]);
    expect(r.score).toBe(38);
  });
});

describe('hygiene edge cases', () => {
  it('flags ESLint without angular-eslint and finds Prettier config in package.json', async () => {
    const dir = await makeTempProject({
      'package.json': { dependencies: { '@angular/core': '^22.0.0' }, prettier: {} },
      '.eslintrc.json': '{}',
      'tslint.json': '{}',
    });
    expect(summarize(await runOn(tooling, dir))).toEqual([
      [
        'medium',
        '.eslintrc.json',
        null,
        'ESLint is configured without angular-eslint, so Angular template and component rules are not checked.',
      ],
      ['low', 'tslint.json', null, 'tslint.json is still present next to the ESLint config.'],
    ]);
  });

  it('follows tsconfig extends and flags disabled strict flags', async () => {
    const dir = await makeTempProject({
      ...ng,
      'tsconfig.base.json':
        '{ "compilerOptions": { "strict": true }, "angularCompilerOptions": { "strictTemplates": true, "strictInjectionParameters": true } }',
      'tsconfig.app.json':
        '{ "extends": "./tsconfig.base.json", "compilerOptions": { "strictNullChecks": false } }',
    });
    expect(summarize(await runOn(strict, dir))).toEqual([
      ['medium', 'tsconfig.app.json', null, 'strict is on but strictNullChecks is disabled.'],
    ]);
  });

  it('scores 0 without a tsconfig', async () => {
    const r = await runOn(strict, await makeTempProject(ng));
    expect(r.score).toBe(0);
    expect(r.findings[0]?.message).toBe('No tsconfig.json found.');
  });

  it('prefers coverage-summary.json and skips without a report', async () => {
    const dir = await makeTempProject({
      ...ng,
      'coverage/app/coverage-summary.json': '{ "total": { "lines": { "pct": 85.55 } } }',
      'coverage/app/lcov.info': 'LF:10\nLH:1\n',
    });
    const r = await runOn(coverage, dir);
    expect(r.findings).toEqual([]);
    expect(r.meta).toEqual({ linePct: 85.6, source: 'coverage/app/coverage-summary.json' });

    const none = await runOn(coverage, await makeTempProject(ng));
    expect(none.status).toBe('skipped');
    expect(lcovLinePct('LF:0\n')).toBeUndefined();
  });

  it('counts .test.ts files as specs and passes with no testable units', async () => {
    const dir = await makeTempProject({
      ...ng,
      'src/a.service.ts': '@Injectable() export class A {}',
      'src/a.service.test.ts': '',
    });
    expect((await runOn(tests, dir)).score).toBe(100);
    expect((await runOn(tests, await makeTempProject(ng))).meta).toMatchObject({
      testable: 0,
      ratio: 1,
    });
  });

  it('applies TypeScript 6 and Angular 22 strictness defaults', async () => {
    const modern = await makeTempProject({
      'package.json': {
        dependencies: { '@angular/core': '^22.0.0' },
        devDependencies: { typescript: '~6.0.0' },
      },
      'tsconfig.json':
        '{ "compilerOptions": {}, "angularCompilerOptions": { "strictInjectionParameters": true } }',
    });
    const r = await runOn(strict, modern);
    expect(r.findings).toEqual([]);
    expect(r.meta).toMatchObject({ typescriptMajor: 6, strict: true, strictTemplates: true });

    const older = await makeTempProject({
      'package.json': {
        dependencies: { '@angular/core': '^21.0.0' },
        devDependencies: { typescript: '~5.9.0' },
      },
      'tsconfig.json':
        '{ "compilerOptions": {}, "angularCompilerOptions": { "strictInjectionParameters": true } }',
      'node_modules/typescript/package.json': '{ "version": "5.9.3" }',
    });
    expect((await runOn(strict, older)).findings.map((f) => f.ruleId)).toEqual([
      'strict-off',
      'strict-templates-off',
    ]);
  });
});
