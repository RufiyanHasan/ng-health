import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { DashboardComponent } from './dashboard/dashboard.component';
import { UserCardComponent } from './user-card.component';

@NgModule({
  declarations: [DashboardComponent, UserCardComponent],
  imports: [BrowserModule],
  bootstrap: [DashboardComponent],
})
export class AppModule {}
