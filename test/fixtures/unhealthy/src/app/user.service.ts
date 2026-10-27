import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);
  readonly users$ = new BehaviorSubject<any[]>([]);

  load(): void {
    this.http.get<any[]>('/api/users').subscribe((u) => this.users$.next(u));
  }
}
