import { Component, effect, inject, input, OnDestroy, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService } from '../../../shared/acp/acp.service';
import { AcpSseService } from '../../../shared/acp/acp-sse.service';
import { ACP_READ_ONLY } from '../../../shared/acp/acp-readonly.token';
import { AcpChatComponent } from '../../../shared/acp/acp-chat.component';
import type { CollabSessionTarget } from './collab.service';

/**
 * Read-only session detail panel for the collaboration transcript.
 *
 * It renders the shared `<app-acp-chat>` template, but against its **own**
 * `AcpService` + `AcpSseService` instances (component-level providers) so that
 * `session/load` for the inspected session cannot disturb the main chat:
 *
 * - `AcpService` is provided locally → the injected instance inside
 *   `<app-acp-chat>` (and its child plan / rag components) is this shadow one.
 * - `AcpSseService` is provided locally → the shadow opens its own event stream
 *   for the inspected (sub) session. The backend enforces ONE consumer per
 *   session: viewing the same sessionId here and in the main chat would make
 *   the two views take over from each other.
 * - `ACP_READ_ONLY` makes the shadow instance skip persistence (localStorage
 *   agent selection, agent-config.json, project/task records).
 *
 * The SSE stream stays open after the load completes, so later turns of the
 * inspected session keep streaming into this panel.
 */
@Component({
  selector: 'app-collab-session-detail',
  standalone: true,
  imports: [CommonModule, AcpChatComponent],
  providers: [
    AcpService,
    AcpSseService,
    { provide: ACP_READ_ONLY, useValue: true },
  ],
  templateUrl: './collab-session-detail.component.html',
  styleUrls: ['./collab-session-detail.component.css'],
})
export class CollabSessionDetailComponent implements OnDestroy {
  /** Session to display (already resolved by the transcript). */
  readonly target = input.required<CollabSessionTarget>();
  /**
   * When false the panel does not load automatically (collaboration turn in
   * flight): it waits for the user to press "立即加载" instead of racing a
   * `session/load` against a running prompt.
   */
  readonly autoLoad = input(true);

  readonly closed = output<void>();

  /** Shadow ACP instance — resolves to the local provider, not the root one. */
  protected readonly acp = inject(AcpService);

  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  /** Bumped per load so a stale response cannot overwrite a newer one. */
  private loadSeq = 0;
  /** Session currently loaded into the shadow state (null = nothing loaded). */
  private loadedSessionId: string | null = null;

  constructor() {
    effect(() => {
      const target = this.target();
      const autoLoad = this.autoLoad();
      // Reset only when the inspected session changes: flipping `autoLoad`
      // (a collaboration turn starting/finishing) must not wipe the history the
      // user is currently reading.
      untracked(() => {
        if (this.loadedSessionId !== target.sessionId) {
          this.loadedSessionId = target.sessionId;
          this.loadSeq++;
          this.loading.set(false);
          this.loadError.set(null);
          void this.acp.disconnect();
        }
        if (autoLoad) void this.load();
      });
    });
  }

  ngOnDestroy(): void {
    this.loadSeq++;
    void this.acp.disconnect();
  }

  /** `session/load` the inspected session into the shadow ACP state. */
  protected async load(): Promise<void> {
    const target = this.target();
    if (!target.sessionId) return;

    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      // `loadSession` handles agent switching, SSE connect + history replay and
      // resolves once the replay-complete marker arrived (or the fallback timer).
      await this.acp.loadSession(target.sessionId, target.cwd, this.resolvableAgentId(target.agentId));
      if (seq !== this.loadSeq) return;
    } catch (error) {
      if (seq !== this.loadSeq) return;
      this.loadError.set((error as Error)?.message || 'Failed to load session');
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  protected retry(): void {
    void this.load();
  }

  /** Shown while the panel is waiting for an explicit load (collab turn in flight). */
  protected get deferred(): boolean {
    return (
      !this.autoLoad() &&
      !this.loading() &&
      !this.loadError() &&
      this.acp.sessionState().sessionId === null
    );
  }

  protected copySessionId(): void {
    const id = this.target().sessionId;
    if (!id || typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(id).catch(() => undefined);
  }

  /**
   * `AcpService.loadSession` refuses unknown agent ids (it resolves the config
   * from the installed-agent list loaded from ~/.clover/acp.json). Collab
   * participants come from the backend agent registry, so only pass ids the
   * frontend can actually resolve — otherwise the session records own agent is
   * used (backend resolves it from `agentId` too).
   */
  private resolvableAgentId(agentId: string | undefined): string | undefined {
    if (!agentId) return undefined;
    return this.acp.findInstalledAgent(agentId) ? agentId : undefined;
  }
}
