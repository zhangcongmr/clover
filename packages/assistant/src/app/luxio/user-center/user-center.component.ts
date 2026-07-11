import { Component, inject, signal } from "@angular/core";

import { CoreService } from '../../core.service';
import { NotificationService } from '../../shared/notification/notification.service';

interface DashboardCategory {
  id: string;
  label: string;
}

@Component({
  selector: 'div[user-center]',
  standalone: true,
  imports: [],
  templateUrl: './user-center.component.html',
  styleUrls: ['./user-center.component.css']
})
export class UserCenterComponent {
  protected coreService = inject(CoreService)
  protected notificationService = inject(NotificationService)

  categories: DashboardCategory[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'overview', label: 'Overview' },
    { id: 'activity', label: 'Activity' },
    { id: 'account', label: 'Account' },
  ];

  selectedCategory = signal<string>('profile');

  get serverCount(): number {
    return this.coreService.serverList?.length || 0;
  }

  setActiveCategory(id: string) {
    this.selectedCategory.set(id);
  }

  signOut() {
    localStorage.clear();
    sessionStorage.clear();
    this.coreService.isAuthenticated.set(false);
    this.notificationService.showNotification('Signed out successfully', 'info');
  }
}
