import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService, AcpPlan } from './acp.service';

@Component({
  selector: 'app-acp-plan',
  standalone: true,
  imports: [CommonModule],
  template: `
    @for (plan of planList; track plan.planId) {
    <div class="acp-plan-container" [class.collapsed]="collapsedPlans.has(plan.planId)">
      <div class="plan-header" (click)="toggleCollapse(plan.planId)">
        <div class="plan-header-left">
          <svg class="plan-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <span class="plan-title">Execution Plan</span>
          <span class="plan-progress-text">{{ getCompletedCount(plan) }}/{{ plan.entries.length }}</span>
        </div>
        <div class="plan-header-right">
          <div class="plan-progress-bar">
            <div class="plan-progress-fill" [style.width.%]="getProgressPercent(plan)"></div>
          </div>
          <svg class="collapse-icon" [class.rotated]="collapsedPlans.has(plan.planId)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>
      @if (!collapsedPlans.has(plan.planId)) {
      <div class="plan-entries">
        @for (entry of plan.entries; track $index) {
        <div class="plan-entry" [class]="'status-' + entry.status">
          <div class="entry-status">
            @switch (entry.status) {
              @case ('completed') {
              <svg class="status-icon completed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              }
              @case ('in_progress') {
              <svg class="status-icon in-progress" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              }
              @case ('cancelled') {
              <svg class="status-icon cancelled" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              }
              @default {
              <svg class="status-icon pending" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
              </svg>
              }
            }
          </div>
          <div class="entry-content">
            <span class="entry-text">{{ entry.content }}</span>
            <span class="priority-badge" [class]="'priority-' + entry.priority">{{ entry.priority }}</span>
          </div>
        </div>
        }
      </div>
      }
    </div>
    }
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    }

    .acp-plan-container {
      border-radius: var(--borderless-item-radius, 8px);
      background-color: var(--borderless-item-bg, rgba(0, 0, 0, 0.04));
      overflow: hidden;
    }

    .plan-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      cursor: pointer;
      user-select: none;
      transition: background-color 0.15s;
    }

    .plan-header:hover {
      background-color: var(--borderless-item-bg-hover, rgba(0, 0, 0, 0.08));
    }

    .plan-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .plan-icon {
      width: 16px;
      height: 16px;
      color: var(--vscode-terminal-ansiGreen, #4ec9b0);
      flex-shrink: 0;
    }

    .plan-title {
      font-weight: 600;
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
    }

    .plan-progress-text {
      font-size: var(--vscode-small-font-size);
      color: var(--vscode-foreground);
      opacity: 0.6;
      margin-left: 4px;
    }

    .plan-header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .plan-progress-bar {
      width: 60px;
      height: 4px;
      border-radius: 2px;
      background-color: var(--borderless-item-bg-hover, rgba(0, 0, 0, 0.08));
      overflow: hidden;
    }

    .plan-progress-fill {
      height: 100%;
      border-radius: 2px;
      background-color: var(--vscode-terminal-ansiGreen, #4ec9b0);
      transition: width 0.3s ease;
    }

    .collapse-icon {
      width: 14px;
      height: 14px;
      color: var(--vscode-foreground);
      opacity: 0.5;
      transition: transform 0.2s ease;
      flex-shrink: 0;
    }

    .collapse-icon.rotated {
      transform: rotate(-90deg);
    }

    .plan-entries {
      display: flex;
      flex-direction: column;
      padding: 0 4px 6px 4px;
    }

    .plan-entry {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 8px;
      border-radius: var(--borderless-item-radius, 8px);
      transition: background-color 0.15s;
    }

    .plan-entry:hover {
      background-color: var(--borderless-item-bg-hover, rgba(0, 0, 0, 0.08));
    }

    .entry-status {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 1px;
    }

    .status-icon {
      width: 16px;
      height: 16px;
    }

    .status-icon.completed {
      color: var(--vscode-terminal-ansiGreen, #4ec9b0);
    }

    .status-icon.in-progress {
      color: var(--vscode-terminal-ansiBlue, #3794ff);
      animation: spin 1.2s linear infinite;
    }

    .status-icon.pending {
      color: var(--vscode-foreground);
      opacity: 0.4;
    }

    .status-icon.cancelled {
      color: var(--vscode-terminal-ansiRed, #f44747);
      opacity: 0.6;
    }

    .entry-content {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }

    .entry-text {
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      line-height: 1.4;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-completed .entry-text {
      opacity: 0.6;
      text-decoration: line-through;
      text-decoration-color: var(--vscode-foreground);
      text-decoration-opacity: 0.3;
    }

    .status-cancelled .entry-text {
      opacity: 0.5;
      text-decoration: line-through;
    }

    .priority-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: var(--vscode-radius-sm);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .priority-high {
      background-color: rgba(244, 71, 71, 0.15);
      color: var(--vscode-terminal-ansiRed, #f44747);
    }

    .priority-medium {
      background-color: rgba(255, 193, 7, 0.15);
      color: var(--vscode-terminal-ansiYellow, #ffcc02);
    }

    .priority-low {
      background-color: rgba(128, 128, 128, 0.15);
      color: var(--vscode-foreground);
      opacity: 0.6;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `]
})
export class AcpPlanComponent {
  private acpService = inject(AcpService);

  collapsedPlans = new Set<string>();

  get planList(): AcpPlan[] {
    return Array.from(this.acpService.plans().values());
  }

  toggleCollapse(planId: string): void {
    if (this.collapsedPlans.has(planId)) {
      this.collapsedPlans.delete(planId);
    } else {
      this.collapsedPlans.add(planId);
    }
  }

  getCompletedCount(plan: AcpPlan): number {
    return plan.entries.filter(e => e.status === 'completed').length;
  }

  getProgressPercent(plan: AcpPlan): number {
    if (plan.entries.length === 0) return 0;
    return (this.getCompletedCount(plan) / plan.entries.length) * 100;
  }
}
