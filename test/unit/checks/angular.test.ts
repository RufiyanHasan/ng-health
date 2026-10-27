import { describe, expect, it } from 'vitest';
import anyUsage from '../../../src/checks/angular/any-usage.js';
import controlFlow from '../../../src/checks/angular/control-flow.js';
import injectFunction from '../../../src/checks/angular/inject-function.js';
import largeComponents from '../../../src/checks/angular/large-components.js';
import onpush from '../../../src/checks/angular/onpush.js';
import standalone from '../../../src/checks/angular/standalone.js';
import subscriptions from '../../../src/checks/angular/subscriptions.js';
import templateCalls from '../../../src/checks/angular/template-calls.js';
import { fixture, runOn, summarize } from '../../helpers/fixtures.js';
import { makeTempProject } from '../../helpers/tmp.js';

const D = 'src/app/dashboard/dashboard.component.ts';
const DH = 'src/app/dashboard/dashboard.component.html';
const U = 'src/app/user-card.component.ts';
const angularChecks = [
  onpush,
  templateCalls,
  subscriptions,
  controlFlow,
  standalone,
  injectFunction,
  anyUsage,
  largeComponents,
];

describe('angular checks on the healthy fixture', () => {
  it.each(angularChecks.map((c) => [c.id, c]))(
    '%s has no findings and scores 100',
    async (_id, check) => {
      const r = await runOn(check, fixture('healthy'));
      expect(r.status).toBe('completed');
      expect(r.findings).toEqual([]);
      expect(r.score).toBe(100);
    },
  );
});

describe('angular checks on the unhealthy fixture', () => {
  const run = (check: (typeof angularChecks)[number]) => runOn(check, fixture('unhealthy'));

  it('angular/onpush', async () => {
    const r = await run(onpush);
    expect(summarize(r)).toEqual([
      ['medium', D, 6, 'DashboardComponent uses default change detection.'],
      ['medium', U, 3, 'UserCardComponent uses default change detection.'],
    ]);
    expect(r.score).toBe(0);
  });

  it('angular/template-calls', async () => {
    const r = await run(templateCalls);
    expect(summarize(r)).toEqual([
      [
        'medium',
        DH,
        2,
        'DashboardComponent template has 3 method calls in bindings: visibleUsers(), isEmpty().',
      ],
      [
        'medium',
        U,
        7,
        'UserCardComponent template has 2 method calls in bindings: getFullName(), formatRole().',
      ],
    ]);
  });

  it('angular/subscriptions', async () => {
    const r = await run(subscriptions);
    expect(summarize(r)).toEqual([
      [
        'high',
        D,
        22,
        'DashboardComponent: subscribe() without cleanup (no takeUntilDestroyed/async pipe/DestroyRef cleanup).',
      ],
      [
        'high',
        D,
        24,
        'DashboardComponent: subscribe() without cleanup (subscription is stored but never unsubscribed).',
      ],
    ]);
    expect(r.score).toBe(33); // 1 of 3 (route.params) is fine
  });

  it('angular/control-flow', async () => {
    expect(summarize(await run(controlFlow))).toEqual([
      [
        'low',
        DH,
        3,
        'DashboardComponent template uses legacy structural directives (ngIf ×1, ngFor ×1).',
      ],
      ['low', U, 6, 'UserCardComponent template uses legacy structural directives (ngSwitch ×1).'],
    ]);
  });

  it('angular/standalone', async () => {
    const r = await run(standalone);
    expect(summarize(r)).toEqual([
      ['low', D, 6, 'DashboardComponent is declared in an NgModule instead of being standalone.'],
      ['low', U, 3, 'UserCardComponent is declared in an NgModule instead of being standalone.'],
    ]);
    expect(r.meta).toMatchObject({ ngModules: 1 });
  });

  it('angular/inject-function', async () => {
    const r = await run(injectFunction);
    expect(summarize(r)).toEqual([
      [
        'low',
        D,
        6,
        'DashboardComponent uses constructor injection (2 params) while the project convention is inject().',
      ],
    ]);
    expect(r.meta).toEqual({ convention: 'inject', usingInject: 2, usingConstructor: 1 });
  });

  it('angular/any-usage', async () => {
    const r = await run(anyUsage);
    expect(summarize(r)).toEqual([
      ['low', D, 11, '3 explicit `any`s in src/app/dashboard/dashboard.component.ts.'],
      ['low', U, 14, '1 explicit `any` in src/app/user-card.component.ts.'],
      ['low', 'src/app/user.service.ts', 8, '2 explicit `any`s in src/app/user.service.ts.'],
    ]);
    expect(r.meta).toMatchObject({ total: 6, files: 3 });
  });

  it('angular/large-components uses the configured maxLoc', async () => {
    const r = await run(largeComponents);
    expect(summarize(r)).toEqual([['medium', D, 6, 'DashboardComponent has 42 lines (limit 40).']]);
    expect(
      (await runOn(largeComponents, fixture('unhealthy'), { options: { maxLoc: 20 } })).findings[0]
        ?.severity,
    ).toBe('high');
  });
});

describe('angular edge cases', () => {
  const component = (body: string, extra = '') => `
    import { Component, DestroyRef, inject } from '@angular/core';
    @Component({ selector: 'x', template: '<p>{{ count() }} {{ fmt(1) }}</p>' ${extra} })
    export class XComponent {
      ${body}
    }`;
  const project = (files: Record<string, string>, major = '^19.0.0') =>
    makeTempProject({ 'package.json': { dependencies: { '@angular/core': major } }, ...files });

  it('recognises subscription cleanup patterns', async () => {
    const dir = await project({
      'src/x.component.ts': component(`
        private destroyRef = inject(DestroyRef);
        private http = inject(HttpClient);
        private sub = new Subscription();
        private one$ = a$.pipe(takeUntilDestroyed()).subscribe();
        init() {
          a$.pipe(first()).subscribe();
          a$.pipe(map(x => x), takeUntil(this.destroy$)).subscribe();
          this.http.get('/x').subscribe();
          this.sub.add(b$.subscribe());
          this.destroyRef.onDestroy(() => this.sub.unsubscribe());
        }`),
    });
    const r = await runOn(subscriptions, dir);
    expect(r.findings).toEqual([]);
    expect(r.meta).toEqual({ subscribeCalls: 5, withoutCleanup: 0 });
  });

  it('allows zero-arg signal reads but flags arguments to unknown members', async () => {
    const dir = await project({ 'src/x.component.ts': component(`count = signal(0);`) });
    expect(summarize(await runOn(templateCalls, dir))).toEqual([
      [
        'medium',
        'src/x.component.ts',
        3,
        'XComponent template has 1 method call in bindings: fmt().',
      ],
    ]);
  });

  it('treats components as standalone by default from Angular 19', async () => {
    const v19 = await project({ 'src/x.component.ts': component('', ', standalone: false') });
    expect((await runOn(standalone, v19)).findings).toHaveLength(1);
    const v19default = await project({ 'src/x.component.ts': component('') });
    expect((await runOn(standalone, v19default)).findings).toHaveLength(0);
  });

  it('skips version-gated checks on old Angular versions', async () => {
    const v14 = await project({ 'src/x.component.ts': component('') }, '~14.2.0');
    expect(await runOn(controlFlow, v14)).toMatchObject({
      status: 'skipped',
      reason: 'Built-in control flow needs Angular 17+ (project uses 14)',
    });
    expect((await runOn(standalone, v14)).status).toBe('skipped');
  });

  it('follows an explicit inject() preference and the constructor convention', async () => {
    const dir = await project({
      'src/a.service.ts': `@Injectable() export class A { constructor(private b: B) {} }`,
      'src/b.service.ts': `@Injectable() export class B { constructor(private c: C) {} }`,
    });
    expect((await runOn(injectFunction, dir)).findings).toEqual([]);
    expect(
      (await runOn(injectFunction, dir, { options: { prefer: 'inject' } })).findings,
    ).toHaveLength(2);
  });

  it('records unreadable templateUrl files without failing', async () => {
    const dir = await project({
      'src/x.component.ts': `@Component({ selector: 'x', templateUrl: './missing.html' }) export class X {}`,
    });
    const r = await runOn(onpush, dir);
    expect(r.status).toBe('completed');
    expect(r.findings).toHaveLength(1);
  });

  it('treats OnPush as the default from Angular 22 and flags Eager/Default opt-outs', async () => {
    const files = (cd = '') => ({
      'src/x.component.ts': `@Component({ selector: 'x', template: '' ${cd} }) export class XComponent {}`,
    });
    expect((await runOn(onpush, await project(files(), '^22.0.0'))).findings).toEqual([]);
    expect(
      summarize(
        await runOn(
          onpush,
          await project(files(', changeDetection: ChangeDetectionStrategy.Eager'), '^22.0.0'),
        ),
      ),
    ).toEqual([
      [
        'medium',
        'src/x.component.ts',
        1,
        'XComponent opts out of OnPush with ChangeDetectionStrategy.Eager.',
      ],
    ]);
    expect((await runOn(onpush, await project(files(), '^21.0.0'))).findings).toHaveLength(1);
  });
});
