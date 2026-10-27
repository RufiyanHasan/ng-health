import { Injectable, signal } from '@angular/core';

export interface Todo {
  id: number;
  title: string;
  done: boolean;
}

@Injectable({ providedIn: 'root' })
export class TodoService {
  readonly items = signal<Todo[]>([]);

  toggle(id: number): void {
    this.items.update((list) => list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }
}
