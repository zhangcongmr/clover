import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, PLATFORM_ID, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AcpService } from '../acp/acp.service';
import type { RagSearchHit } from '../acp/tool-call-info.pipe';
import { RagService, type RagUploadCandidate } from './rag.service';

type RagTab = 'knowledge' | 'search' | 'settings';

@Component({
  selector: 'app-rag-manager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  templateUrl: './rag-manager.component.html',
  styleUrls: ['./rag-manager.component.css'],
})
export class RagManagerComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly ragService = inject(RagService);
  private readonly acpService = inject(AcpService);

  tab = signal<RagTab>('knowledge');
  error = signal<string | null>(null);
  busy = signal(false);
  isDragOver = signal(false);

  /**
   * Fired as soon as a write-to-knowledge-base is dispatched. The host closes
   * the dialog on it; indexing progress is then shown as an animated badge on
   * the Knowledge Base sidebar button (see {@link RagService.isIndexing}).
   */
  readonly indexingStarted = output<void>();

  readonly candidates = signal<RagUploadCandidate[]>([]);
  readonly query = signal('');
  readonly limit = signal(5);
  readonly scopeDocumentId = signal('');

  readonly ragServiceApi = this.ragService;

  /** A prompt is running; don't allow a second one to interleave with it. */
  readonly isProcessing = this.acpService.isProcessing;
  readonly requiresNewSession = computed(() => this.ragService.requiresNewSession());
  readonly canSubmit = computed(() => !this.isProcessing() && !this.busy());

  readonly documents = this.ragService.lastListResult;
  readonly hits = this.ragService.lastSearchResult;
  readonly lastIndex = this.ragService.lastIndexResult;

  readonly hasCandidates = computed(() => this.candidates().length > 0);
  readonly canSearch = computed(() => this.query().trim().length > 0 && this.canSubmit());

  ngOnInit(): void {
    this.ragService.refreshServers();
  }

  switchTab(tab: RagTab): void {
    this.tab.set(tab);
    this.error.set(null);
  }

  /* ---------------------------------------------------------------------- */
  /* Upload                                                                 */
  /* ---------------------------------------------------------------------- */

  async onFilesPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    await this.addFiles(files);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.isDragOver.set(false);
    await this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  private async addFiles(files: File[]): Promise<void> {
    const rejected: string[] = [];
    for (const file of files) {
      const candidate = await this.ragService.readFile(file);
      if (candidate) {
        this.candidates.update(list => [...list, candidate]);
      } else {
        rejected.push(file.name);
      }
    }
    if (rejected.length > 0) {
      this.error.set(`Unsupported file type: ${rejected.join(', ')}. Text-based documents only.`);
    }
  }

  removeCandidate(name: string): void {
    this.candidates.update(list => list.filter(c => c.name !== name));
  }

  clearCandidates(): void {
    this.candidates.set([]);
    this.error.set(null);
  }

  /* ---------------------------------------------------------------------- */
  /* Actions                                                                */
  /* ---------------------------------------------------------------------- */

  async upload(): Promise<void> {
    const files = this.candidates();
    if (files.length === 0 || !this.canSubmit()) return;
    // Close the dialog right away — indexing keeps running in the background and
    // is surfaced as a spinner on the sidebar button instead.
    this.indexingStarted.emit();
    this.candidates.set([]);
    await this.run(() => this.ragService.upload(files));
  }

  async refreshDocuments(): Promise<void> {
    await this.run(() => this.ragService.refreshDocuments());
  }

  async removeDocument(documentId: string): Promise<void> {
    await this.run(() => this.ragService.remove(documentId));
  }

  async search(): Promise<void> {
    await this.run(() =>
      this.ragService.search(this.query(), this.limit(), this.scopeDocumentId().trim() || undefined),
    );
  }

  /** Wraps an agent round-trip with busy/error handling. */
  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(false);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Template helpers                                                       */
  /* ---------------------------------------------------------------------- */

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** Origin of a search hit, preferring explicit metadata over the raw id. */
  hitSource(hit: RagSearchHit): string {
    return hit.metadata?.['source'] || hit.metadata?.['title'] || hit.documentId;
  }

  ragServerLabel(): string {
    const name = this.ragService.ragServerName();
    if (!name) return 'Not configured';
    return this.ragService.isAttached() ? `${name} (attached)` : name;
  }
}