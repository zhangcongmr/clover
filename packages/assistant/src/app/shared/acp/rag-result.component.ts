import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AcpService } from './acp.service';
import type { RagExtractResult, RagDocumentInfo, RagSearchHit } from './tool-call-info.pipe';
import { RagMetricsService, type RagHitFeedback } from '../rag/rag-metrics.service';

/** Excerpt length shown before a hit is expanded to its full chunk text. */
const HIT_EXCERPT_LENGTH = 220;

/**
 * Renders the result of an RAG MCP tool call (`search` / `index_document` /
 * `list_documents` / `delete_document`).
 *
 * These tools are invoked by the agent, not by the frontend — the app ships no MCP
 * client. The payload arrives as a normal ACP tool call, so this component is a
 * pure view over an already-extracted {@link RagExtractResult}.
 */
@Component({
  selector: 'app-rag-result',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rag-result.component.html',
  styleUrls: ['./rag-result.component.css'],
})
export class RagResultComponent {
  private readonly acpService = inject(AcpService);
  private readonly metrics = inject(RagMetricsService);

  readonly result = input.required<RagExtractResult>();
  readonly collapsed = input(false);

  readonly hitCount = computed(() => this.result().hits?.length ?? 0);
  readonly documentCount = computed(() => this.result().documents?.length ?? 0);

  /** Citation label shown on a hit, e.g. `guide#3`. */
  citation(hit: RagSearchHit): string {
    return `${hit.documentId}#${hit.chunkIndex}`;
  }

  /** Recorded relevance feedback for a hit, if the user rated it. */
  feedbackFor(hit: RagSearchHit): RagHitFeedback | null {
    return this.metrics.citationFeedback()[this.citation(hit)] ?? null;
  }

  /** Toggles 👍/👎 relevance feedback for a hit. */
  rate(hit: RagSearchHit, value: RagHitFeedback): void {
    this.metrics.toggleCitationFeedback(this.citation(hit), value);
  }

  /** Human-readable origin for a hit, preferring explicit metadata over the id. */
  source(hit: RagSearchHit): string {
    return hit.metadata?.['source'] || hit.metadata?.['title'] || hit.documentId;
  }

  /** Origin of a listed document, blank when the server recorded no metadata. */
  docSource(doc: RagDocumentInfo): string {
    return doc.metadata?.['source'] || doc.metadata?.['title'] || '';
  }

  /** `0.87` → `87%`, used for the score bar width. */
  scorePercent(hit: RagSearchHit): number {
    return Math.max(0, Math.min(100, Math.round(hit.score * 100)));
  }

  excerpt(hit: RagSearchHit): string {
    const text = hit.text ?? '';
    return text.length > HIT_EXCERPT_LENGTH ? `${text.slice(0, HIT_EXCERPT_LENGTH)}…` : text;
  }

  isTruncated(hit: RagSearchHit): boolean {
    return (hit.text?.length ?? 0) > HIT_EXCERPT_LENGTH;
  }

  /** Copies a `【documentId#chunkIndex】` citation back into the chat input. */
  insertCitation(hit: RagSearchHit): void {
    this.acpService.pendingSlashCommand.set(`【${this.citation(hit)}】`);
  }

  toggle(event: Event): void {
    event.stopPropagation();
  }
}