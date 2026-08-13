import { Component, computed, ElementRef, inject, input, OnInit, OnDestroy, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService } from './acp.service';
import { AcpSessionManagerComponent } from './acp-session-manager.component';
import { AcpChatComponent } from './acp-chat.component';
import { AcpChatInputComponent } from './acp-chat-input.component';
import { AcpPermissionDialogComponent } from './acp-permission-dialog.component';


@Component({
  selector: 'app-acp-panel',
  standalone: true,
  imports: [
    CommonModule,
    AcpSessionManagerComponent,
    AcpChatComponent,
    AcpChatInputComponent,
    AcpPermissionDialogComponent
  ],
  template: `
    <div class="card-base">
      <div class="acp-header">
        <div class="acp-title">
          <svg class="acp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4m0-4h.01"/>
          </svg>
          <span>ACP Agent</span>
          @if (acpService.sessionState().isConnected) {
            <span class="status-dot connected"></span>
          } @else if (acpService.sessionState().isConnecting) {
            <span class="status-dot connecting"></span>
          } @else {
            <span class="status-dot disconnected"></span>
          }
        </div>
        <div class="acp-actions">
          <button class="acp-icon-button" (click)="toggleSettings()" title="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>

          @if (isMaximized()) {
            <button class="acp-icon-button" (click)="restorePanel.emit()" title="Restore Panel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
              </svg>
            </button>
          } @else {
            <button class="acp-icon-button" (click)="maximizePanel.emit()" title="Maximize Panel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
            </button>
          }
          <div class="acp-dock-wrapper" (click)="$event.stopPropagation()">
            <button class="acp-icon-button" (click)="toggleDockMenu()" title="Dock Position">
              <svg width="16" height="16"><use href="#icon-hori-more"></use></svg>
            </button>
            @if (showDockMenu()) {
              <div class="acp-dock-menu">
                <div class="acp-dock-menu-title">Docking position</div>
                <div class="acp-dock-menu-items">
                  <button class="acp-dock-item" [class.active]="dockPosition() === 'right'" (click)="setDockPosition('right')" title="Right">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <line x1="15" y1="3" x2="15" y2="21"/>
                    </svg>
                  </button>
                  <button class="acp-dock-item" [class.active]="dockPosition() === 'left'" (click)="setDockPosition('left')" title="Left">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <line x1="9" y1="3" x2="9" y2="21"/>
                    </svg>
                  </button>
                </div>
                <button class="acp-panel-close" (click)="closePanel.emit()" title="Close Panel">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            }
          </div>
        </div>
      </div>
      <div class="acp-panel-container" [class.has-chat]="acpService.hasOpenedSession()" [class.is-wide]="isPanelWide()">
        <app-acp-session-manager [showSettings]="showSettings()" (settingsChange)="onSettingsChange($event)" />
        @if (acpService.hasOpenedSession()) {
          <app-acp-chat />
        }
        <app-acp-chat-input />
        <app-acp-permission-dialog />
      </div>
    </div>
  `,
  host: {
    '[class.dock-left]': "dockPosition() === 'left'",
    '(document:click)': 'onDocumentClick()'
  },
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      overflow: auto;
      position: relative;
      z-index: 10;
      background-color: var(--vscode-editor-background);
      margin: 5px 5px 5px 0;
    }
    :host(.dock-left) {
      margin: 5px 0 5px 5px;
    }
    .card-base {
      background-color: var(--vscode-editor-background);
      border-radius: 0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1);
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .acp-panel-container {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      align-self: center;
      width: 100%;
    }

    .acp-panel-container.is-wide {
      width: 70%;
    }

    .acp-panel-container.has-chat app-acp-session-manager {
      flex: none;
    }

    .acp-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-left: 5px;
    }

    .acp-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      color: var(--vscode-foreground, #333);
    }

    .acp-icon {
      width: 16px;
      height: 16px;
      color: var(--vscode-textLink-foreground, #0066cc);
    }

    .acp-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .acp-dock-wrapper {
      position: relative;
    }

    .acp-dock-menu {
      position: absolute;
      top: 100%;
      right: 0;
      z-index: 1000;
      min-width: 160px;
      background: var(--vscode-editorWidget-background, #ffffff);
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 8px;
    }

    .acp-dock-menu-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-foreground, #333);
      padding: 4px 8px;
      margin-bottom: 4px;
    }

    .acp-dock-menu-items {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
    }

    .acp-dock-menu .acp-panel-close {
      width: 100%;
      height: 28px;
      justify-content: center;
      color: var(--vscode-errorForeground, #d32f2f);
    }

    .acp-dock-item {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
      color: var(--vscode-foreground, #666);
      transition: background-color 0.15s, border-color 0.15s;
    }

    .acp-dock-item:hover {
      background: var(--vscode-list-hoverBackground, #e8e8e8);
    }

    .acp-dock-item.active {
      border-color: var(--vscode-focusBorder, #0066cc);
      background: var(--vscode-list-activeSelectionBackground, #e0e0e0);
    }

    .acp-dock-item svg {
      width: 20px;
      height: 20px;
    }

    .acp-panel-close {
      width: 28px;
      height: 28px;
      border: none;
      border-radius: var(--vscode-radius-sm);
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.7;
      transition: opacity 0.15s, background-color 0.15s;
    }

    .acp-panel-close:hover {
      opacity: 1;
      background-color: var(--vscode-list-hoverBackground);
    }

    .acp-panel-close svg {
      width: 16px;
      height: 16px;
    }

    .acp-icon-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      background: transparent;
      border-radius: 4px;
      cursor: pointer;
      color: var(--vscode-foreground, #333);
    }

    .acp-icon-button:hover {
      background: var(--vscode-toolbar-hoverBackground, #e0e0e0);
    }

    .acp-icon-button svg {
      width: 16px;
      height: 16px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.connected {
      background: #4caf50;
      box-shadow: 0 0 4px #4caf50;
    }

    .status-dot.connecting {
      background: #ff9800;
      animation: pulse 1s ease-in-out infinite;
    }

    .status-dot.disconnected {
      background: #9e9e9e;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `]
})
export class AcpPanelComponent implements OnInit, OnDestroy {
  private static readonly PANEL_WIDE_THRESHOLD = 600;
  closePanel = output<void>();
  maximizePanel = output<void>();
  restorePanel = output<void>();
  dockPositionChange = output<'left' | 'right'>();
  isMaximized = input<boolean>(false);
  dockPosition = input<'left' | 'right'>('right');
  protected acpService = inject(AcpService);
  showDockMenu = signal<boolean>(false);
  showSettings = signal<boolean>(false);
  protected hostWidth = signal<number>(0);
  protected isPanelWide = computed(() => this.hostWidth() >= AcpPanelComponent.PANEL_WIDE_THRESHOLD);
  private hostRef = inject(ElementRef<HTMLElement>);
  private resizeObserver?: ResizeObserver;

  ngOnInit(): void {
    this.resizeObserver = new ResizeObserver(entries => {
      this.hostWidth.set(entries[0].contentRect.width);
    });
    this.resizeObserver.observe(this.hostRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  toggleSettings(): void {
    this.showSettings.update(v => !v);
  }

  toggleDockMenu(): void {
    this.showDockMenu.update(v => !v);
  }

  setDockPosition(position: 'left' | 'right'): void {
    this.dockPositionChange.emit(position);
    this.showDockMenu.set(false);
  }

  onSettingsChange(value: boolean): void {
    this.showSettings.set(value);
  }

  onDocumentClick(): void {
    if (this.showDockMenu()) {
      this.showDockMenu.set(false);
    }
  }
}
