import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { interval, Subscription } from 'rxjs';
import { UserService } from '../user.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  users: any[] = [];
  filter = '';
  ticks = 0;
  private timer?: Subscription;

  constructor(
    private userService: UserService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.userService.users$.subscribe((u) => (this.users = u));
    this.route.params.subscribe((p: any) => (this.filter = p.filter));
    this.timer = interval(1000).subscribe(() => this.ticks++);
    this.userService.load();
  }

  visibleUsers(): any[] {
    return this.users.filter((u) => u.name.includes(this.filter));
  }

  isEmpty(): boolean {
    return this.visibleUsers().length === 0;
  }

  trackById(_: number, user: { id: number }): number {
    return user.id;
  }

  select(user: unknown): void {
    console.log(user);
  }
}
