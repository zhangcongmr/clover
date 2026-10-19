import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RagMetricsService, type RagMetricRecord, type RagRecordFeedback } from './rag-metrics.service';
import type { RagSearchHit } from '../acp/tool-call-info.pipe';

/**
 * Retrieval quality evaluation.
 *
 * Quality is judged from signals the frontend can actually see: whether a query
 * returned hits, how strong the scores were, whether the answer cited the hits,
 * and explicit human relevance labels. Nothing here requires an embedding model
 * or a backend.
 */
@Component({
  selector: 'app-rag-eval',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './rag-eval.component.html',
  styleUrls: ['./rag-eval.component.css'],
})
export class RagEvalComponent {
  private readonly metrics = inject(RagMetricsService);

  readonly summary = this.metrics.summary;
  readonly citationFeedback = this.metrics.citationFeedback;
  readonly importError = signal<string | null>(null);

  /** Newest first. */
  readonly searches = computed(() => [...this.metrics.searchRecords()].reverse());

  percent(value: number | null, digits = 0): string {
    return value === null ? '—' : `${(value * 100).toFixed(digits)}%`;
  }

  latency(value: number | null): string {
    if (value === null) return '—';
    return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
  }

  time(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  citation(hit: RagSearchHit): string {
    return `${hit.documentId}#${hit.chunkIndex}`;
  }

  hitFeedback(citation: string): 'up' | 'down' | null {
    return this.citationFeedback()[citation] ?? null;
  }

  rateHit(citation: string, value: 'up' | 'down'): void {
    this.metrics.toggleCitationFeedback(citation, value);
  }

  setFeedback(record: RagMetricRecord, value: RagRecordFeedback): void {
    this.metrics.setFeedback(record.id, record.feedback === value ? undefined : value);
  }

  remove(record: RagMetricRecord): void {
    this.metrics.remove(record.id);
  }

  clearAll(): void {
    this.metrics.clear();
  }

  /* ── Import / export ── */

  exportReport(): void {
    const blob = new Blob([this.metrics.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rag-evaluation-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async onImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importError.set(null);
    try {
      this.metrics.importJson(await file.text());
    } catch (error) {
      this.importError.set(error instanceof Error ? error.message : String(error));
    }
  }
}
