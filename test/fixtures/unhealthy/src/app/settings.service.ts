import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private http = inject(HttpClient);
  readonly settings$ = this.http.get('/api/settings');
}
