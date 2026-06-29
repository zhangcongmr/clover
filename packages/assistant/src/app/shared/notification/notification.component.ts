import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService, Notification } from './notification.service';

@Component({
  selector: 'app-notification',
  template: `
    @for (notification of notificationService.notifications(); track notification.id) {
      <div class="notification-item" [ngClass]="notification.type">
        <div class="notification-content">
          <span class="notification-message">{{ notification.message }}</span>
          <button class="close-btn" (click)="removeNotification(notification.id)">×</button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      position: fixed;
      bottom: 30px;
      right: 2px;
      z-index: 9999;
      max-width: 400px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .notification-item {
      padding: 12px 16px;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      min-width: 250px;
      max-width: 400px;
      display: flex;
      align-items: center;
    }

    .notification-item.success {
      background-color: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }

    .notification-item.error {
      background-color: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }

    .notification-item.info {
      background-color: #d1ecf1;
      color: #0c5460;
      border: 1px solid #bee5eb;
    }

    .notification-item.warning {
      background-color: #fff3cd;
      color: #856404;
      border: 1px solid #ffeaa7;
    }

    .notification-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }

    .notification-message {
      flex-grow: 1;
      word-wrap: break-word;
    }

    .close-btn {
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      margin-left: 10px;
      color: inherit;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `],
  standalone: true,
  imports: [CommonModule]
})
export class NotificationComponent {
  notificationService = inject(NotificationService);

  trackById(index: number, item: Notification) {
    return item.id;
  }

  removeNotification(id: string) {
    this.notificationService.removeNotification(id);
  }
}