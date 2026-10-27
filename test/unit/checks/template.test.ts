import { describe, expect, it } from 'vitest';
import { analyzeTemplate, loadCompiler } from '../../../src/checks/angular/template.js';

const analyze = async (tpl: string, offset = 1) =>
  analyzeTemplate(await loadCompiler(), tpl, 't.html', offset);

describe('analyzeTemplate', () => {
  it('finds implicit-receiver calls in bindings, not in events or track expressions', async () => {
    const a = await analyze(
      [
        '<h1>{{ title() }} {{ user.name() }}</h1>',
        '<p [title]="label(1)" (click)="save()">{{ $any(x).y }}</p>',
        '@if (visible()) { <span>{{ a?.b() }}</span> }',
        '@for (i of list(); track trackFn(i)) { {{ i }} }',
        '<div *ngIf="show()"></div>',
        '@let total = sum(a, b);',
        '@switch (mode()) { @case (1) { x } }',
      ].join('\n'),
    );
    expect(a.calls.map((c) => [c.name, c.line, c.argCount])).toEqual([
      ['title', 1, 0],
      ['label', 2, 1],
      ['visible', 3, 0],
      ['list', 4, 0],
      ['show', 5, 0],
      ['sum', 6, 2],
      ['mode', 7, 0],
    ]);
    expect(a.errors).toEqual([]);
  });

  it('finds legacy structural directives with line numbers and an offset', async () => {
    const a = await analyze(
      [
        '<p *ngIf="a"></p>',
        '<li *ngFor="let x of xs; trackBy: t"></li>',
        '<ng-template [ngIf]="b"></ng-template>',
        '<div [ngSwitch]="v"><span *ngSwitchCase="1"></span></div>',
        '@if (a) {}',
      ].join('\n'),
      10,
    );
    expect(a.legacy).toEqual([
      { directive: 'ngIf', line: 10 },
      { directive: 'ngFor', line: 11 },
      { directive: 'ngIf', line: 12 },
      { directive: 'ngSwitch', line: 13 },
    ]);
  });

  it('reports parse errors without throwing', async () => {
    expect((await analyze('<div [x]="(("></div>')).errors.length).toBeGreaterThan(0);
  });
});
