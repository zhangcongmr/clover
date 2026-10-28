import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RagMetricsService, type RagMetricRecord } from './rag-metrics.service';

/**
 * Retrieval observability.
 *
 * A running dashboard over {@link RagMetricsService}: hit rate, citation rate,
 * score quality and latency percentiles, plus a log of recent search / index
 * operations. Everything is derived locally — no telemetry leaves the browser.
 */
@Component({
  selector: 'app-rag-insights',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './rag-insights.component.html',
  styleUrls: ['./rag-insights.component.css'],
})
export class RagInsightsComponent {
  private readonly metrics = inject(RagMetricsService);

  readonly summary = this.metrics.summary;

  /** Newest operations first, capped for a readable log. */
  readonly operations = computed(() => this.metrics.recentRecords().slice(0, 40));

  /** Rate metrics rendered as bars; `null` means "not enough data yet". */
  readonly rateBars = computed(() => {
    const s = this.summary();
    return [
      { label: 'Hit rate', value: s.hitRate, hint: 'Share of retrievals that had hits' },
      { label: 'Cited rate', value: s.citedRate, hint: 'Share of answers citing hits' },
      { label: 'Relevant rate', value: s.relevantRate, hint: 'Share rated relevant by humans' },
    ];
  });

  readonly latencyBars = computed(() => {
    const s = this.summary();
    const values = [
      { label: 'avg', value: s.avgLatencyMs },
      { label: 'p50', value: s.p50LatencyMs },
      { label: 'p95', value: s.p95LatencyMs },
    ];
    const max = Math.max(1, ...values.map(v => v.value ?? 0));
    return values.map(v => ({
      ...v,
      width: v.value === null ? 0 : Math.min(100, (v.value / max) * 100),
    }));
  });

  percent(value: number | null, digits = 0): string {
    return value === null ? '—' : `${(value * 100).toFixed(digits)}%`;
  }

  latency(value: number | null): string {
    if (value === null) return '—';
    return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
  }

  time(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }

  opLabel(record: RagMetricRecord): string {
    return record.kind === 'index' ? `index ${record.documentId ?? ''}` : record.query ?? '';
  }

  opDetail(record: RagMetricRecord): string {
    if (record.kind === 'index') return `${record.chunksCount ?? 0} chunks`;
    if (record.pending) return 'running…';
    if (record.error) return 'no result';
    return `${record.hits?.length ?? 0} hits · top ${this.percent(record.topScore ?? null, 0)}`;
  }

  clear(): void {
    this.metrics.clear();
  }
}
