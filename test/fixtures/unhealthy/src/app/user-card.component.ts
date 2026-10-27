import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-user-card',
  template: `
    <div class="card" [ngSwitch]="user.role">
      <h3>{{ getFullName() }}</h3>
      <span *ngSwitchCase="'admin'">Admin</span>
      <span *ngSwitchDefault>{{ formatRole(user.role) }}</span>
    </div>
  `,
})
export class UserCardComponent {
  @Input() user: any;

  getFullName(): string {
    return `${this.user.first} ${this.user.last}`;
  }

  formatRole(role: string): string {
    return role.toUpperCase();
  }
}
