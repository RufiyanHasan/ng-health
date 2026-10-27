import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import type { Todo } from '../todo.service';

@Component({
  selector: 'app-todo-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './todo-list.component.html',
})
export class TodoListComponent {
  readonly todos = input.required<Todo[]>();
  readonly toggle = output<number>();
  private readonly destroyRef = inject(DestroyRef);
  protected ticks = 0;

  constructor() {
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.ticks++);
  }
}
