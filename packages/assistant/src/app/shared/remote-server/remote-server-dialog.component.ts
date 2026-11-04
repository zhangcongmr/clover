import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AstModalComponent } from '../ast-modal/ast-modal.component';
import {
  LocalServerService,
  REMOTE_PROBE_TIMEOUT_MS,
} from '../local-server/local-server.service';
import { AcpService } from '../acp/acp.service';
import { NotificationService } from '../notification/notification.service';

/**
 * Dialog for pointing the app at another (local or remote) server.
 *
 * The address is probed *before* it is applied: a server that does not answer
 * must not repoint the app, otherwise a typo would leave the UI talking to a
 * dead endpoint. Once the probe succeeds the address is persisted and the
 * ACP layer is rebound to it.
 */
@Component({
  selector: 'app-remote-server-dialog',
  standalone: true,
  imports: [FormsModule, AstModalComponent],
  templateUrl: './remote-server-dialog.component.html',
  styleUrls: ['./remote-server-dialog.component.css'],
})
export class RemoteServerDialogComponent {
  private localServerService = inject(LocalServerService);
  private acpService = inject(AcpService);
  private notification = inject(NotificationService);

  /** Parent-controlled visibility. */
  readonly visible = input(false);
  /** Emitted when the dialog should close (Cancel / close button). */
  readonly close = output<void>();
  /** Emitted with the address now in use; empty means the app's own origin. */
  readonly connected = output<string>();

  /** Draft address bound to the input. */
  readonly url = signal('');
  /** The address the app is actually bound to; empty means its own origin. */
  readonly currentUrl = signal('');
  /** True while a connection attempt is in flight. */
  readonly connecting = signal(false);
  /** Message of the last failed attempt. */
  readonly error = signal<string | null>(null);

  /** Recently connected server addresses, most recent first. */
  readonly history = this.localServerService.serverUrlHistory;

  /**
   * Whether the footer button offers Disconnect instead of Connect.
   *
   * True only while a remote server is in use AND the input still holds that
   * same address: typing a different address turns the button back into
   * Connect, so moving from one remote server to another stays a single
   * action rather than needing a disconnect first.
   */
  readonly isConnected = computed(() => {
    const current = this.currentUrl();
    return !!current && this.url().trim() === current;
  });

  constructor() {
    // Seed the field with the address currently in use each time the dialog
    // opens, so the user edits the live value instead of a stale copy.
    effect(() => {
      if (this.visible()) {
        this.url.set(this.localServerService.serverUrl);
        this.error.set(null);
      }
    });

    // Track the live address so the footer button can flip between Connect
    // and Disconnect. `serverEpoch` is the signal that changes with it.
    effect(() => {
      this.localServerService.serverEpoch();
      this.currentUrl.set(this.localServerService.serverUrl);
    });
  }

  /**
   * The footer's primary action: connects to the address in the input, or
   * disconnects from the remote server when one is already in use.
   *
   * The button is a single element whose label and behaviour follow the
   * current state, so the two directions never sit side by side.
   */
  onPrimaryAction(): void {
    if (this.isConnected()) {
      void this.disconnect();
    } else {
      void this.connect();
    }
  }

  /** Fills the input with a remembered address. */
  useHistoryEntry(url: string): void {
    this.url.set(url);
  }

  /** Forgets a single remembered address. */
  removeHistoryEntry(url: string, event: Event): void {
    // The row itself fills the input on click, so keep the click on the
    // delete button from selecting the address as well.
    event.stopPropagation();
    this.localServerService.removeFromHistory(url);
  }

  /** Probe the given address and switch to it once it answers. */
  async connect(): Promise<void> {
    if (this.connecting()) return;

    const url = this.url().trim();
    if (!url) {
      this.error.set('Enter the address of the server to connect to.');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      this.error.set('The address must start with http:// or https://');
      return;
    }

    this.connecting.set(true);
    this.error.set(null);
    try {
      // Probe first: a failed probe must not repoint the app at a server
      // that is not there.
      const reachable = await this.localServerService.checkServerAvailable(url, REMOTE_PROBE_TIMEOUT_MS);
      if (!reachable) {
        this.error.set(`No server responded at ${url}`);
        return;
      }

      // Drop the token and the file-watch socket bound to the previous server
      // FIRST: switching the address signals the server-bound connections to
      // re-open, so the old socket has to be gone before that happens.
      this.localServerService.disconnect();
      this.localServerService.setServerUrl(url);
      await this.acpService.rebindToServer();

      // Remember the address so it can be picked again next time.
      this.localServerService.addToHistory(url);

      this.notification.showNotification(`Connected to ${url}`, 'success');
      this.connected.emit(url);
      this.close.emit();
    } catch (error) {
      this.error.set((error as Error).message || 'Failed to connect to the server');
    } finally {
      this.connecting.set(false);
    }
  }

  /**
   * Disconnects from the remote server: switches back to the server that
   * serves this page (same origin).
   */
  async disconnect(): Promise<void> {
    if (this.connecting()) return;

    this.connecting.set(true);
    this.error.set(null);
    try {
      // Tear down the previous server's connections before the address
      // changes, so the re-established ones are not closed right after.
      this.localServerService.disconnect();
      this.localServerService.setServerUrl('');
      await this.acpService.rebindToServer();

      this.notification.showNotification('Switched back to the local server', 'success');
      this.connected.emit('');
      this.close.emit();
    } catch (error) {
      this.error.set((error as Error).message || 'Failed to switch to the local server');
    } finally {
      this.connecting.set(false);
    }
  }
}
