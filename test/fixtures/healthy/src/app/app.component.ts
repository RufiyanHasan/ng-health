import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TodoListComponent } from './todo-list/todo-list.component';
import { TodoService } from './todo.service';

@Component({
  selector: 'app-root',
  imports: [TodoListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ title() }}</h1>
    @if (remaining() > 0) {
      <p>{{ remaining() }} left</p>
    } @else {
      <p>All done</p>
    }
    <app-todo-list [todos]="todos.items()" (toggle)="todos.toggle($event)" />
  `,
})
export class AppComponent {
  protected readonly todos = inject(TodoService);
  protected readonly title = signal('Todos');
  protected readonly remaining = computed(() => this.todos.items().filter((t) => !t.done).length);
}
