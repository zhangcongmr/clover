import { computed, Injectable, signal } from '@angular/core';

export interface Notification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  timestamp: Date;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  public notifications = signal<Notification[]>([]);

  public notificationCount = computed(() => this.notifications().length);

  showNotification(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info'): void {
    const notification: Notification = {
      id: Math.random().toString(36).substring(2, 9),
      message,
      type,
      timestamp: new Date()
    };

    const currentNotifications = this.notifications();
    currentNotifications.unshift(notification);
    this.notifications.set([...currentNotifications]);

    // 5秒后自动移除通知
    setTimeout(() => {
      this.removeNotification(notification.id);
    }, 5000);
  }

  removeNotification(id: string): void {
    const currentNotifications = this.notifications().filter(
      notification => notification.id !== id
    );
    this.notifications.set(currentNotifications);
  }

  showUploadSuccess(message: string = 'Upload completed successfully!'): void {
    this.showNotification(message, 'success');
  }

  showUploadError(message: string = 'Upload failed!'): void {
    this.showNotification(message, 'error');
  }
}