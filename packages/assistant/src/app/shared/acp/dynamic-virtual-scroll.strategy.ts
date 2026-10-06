import { Injectable, NgZone, inject } from '@angular/core';
import { CdkVirtualScrollViewport, VIRTUAL_SCROLL_STRATEGY } from '@angular/cdk/scrolling';
import type { Provider } from '@angular/core';

/**
 * Vertical padding of `.cdk-virtual-scroll-content-wrapper` — must stay in sync
 * with the rule of the same name in acp-chat.component.css.
 */
const WRAPPER_PADDING = 32;

/** Gap between two message groups; must stay in sync with the wrapper's `gap`. */
const WRAPPER_GAP = 16;

/** Height assumed for items that have not been measured yet (px). */
const FALLBACK_ITEM_HEIGHT = 160;

/** Pixels rendered beyond the viewport before a re-render is forced. */
const MIN_BUFFER_PX = 200;

/** Pixels of buffer rendered when a re-render is triggered. */
const MAX_BUFFER_PX = 800;

interface Range {
  start: number;
  end: number;
}

/**
 * Tiny `scrolledIndexChange` emitter.
 *
 * `rxjs` is not resolvable from this workspace (it is only available inside the
 * pnpm hidden store), so the strategy ships a structurally compatible stand-in:
 * the CDK viewport only ever calls `.subscribe(listener)`.
 */
class ScrolledIndexChange {
  private readonly listeners = new Set<(index: number) => void>();

  subscribe(listener: (index: number) => void): { unsubscribe: () => void } {
    this.listeners.add(listener);
    return { unsubscribe: () => this.listeners.delete(listener) };
  }

  next(index: number): void {
    for (const listener of Array.from(this.listeners)) {
      listener(index);
    }
  }

  complete(): void {
    this.listeners.clear();
  }
}

/**
 * Virtual scroll strategy for variable-height items (chat message groups).
 *
 * CDK only ships `FixedSizeVirtualScrollStrategy`, which estimates every item
 * with the same size — unusable for message groups ranging from ~60px to
 * thousands of pixels. This strategy measures the items that are actually
 * rendered (via `ResizeObserver` + a measurement pass after every render),
 * keeps a prefix-sum offset table, and compensates the scroll position whenever
 * those measurements change so the anchor item stays visually fixed.
 *
 * Not declared as `implements VirtualScrollStrategy` because that interface
 * types `scrolledIndexChange` as an rxjs `Observable`, which is intentionally
 * not imported here (see `ScrolledIndexChange`).
 */
@Injectable()
export class DynamicVirtualScrollStrategy {
  private readonly ngZone = inject(NgZone);

  private viewport: CdkVirtualScrollViewport | null = null;

  /**
   * Height of every item including its trailing flex gap, always populated:
   * unmeasured items carry the current `estimate` as a seed so that the prefix
   * sums never depend on a globally re-estimated value (which would shift every
   * offset above the viewport and make the scroll position jump).
   */
  private heights: number[] = [];

  /** Whether the height at the same index came from a real measurement. */
  private measuredFlags: boolean[] = [];

  /** Number of really measured items. */
  private measuredCount = 0;

  /** Sum of the heights of the really measured items. */
  private measuredTotal = 0;

  /** Prefix sums of `heights`; `offsets[i]` is the pixel offset of item `i`. */
  private offsets: number[] = [0];

  /** Height seeded into items that have not been measured yet. */
  private estimate = FALLBACK_ITEM_HEIGHT;

  /** Observed gap between two rendered items (flex `gap` / margins). */
  private gap = WRAPPER_GAP;

  private contentObserver: ResizeObserver | null = null;
  private viewportObserver: ResizeObserver | null = null;
  private measureFrame: number | null = null;
  private spacer: HTMLElement | null = null;

  readonly scrolledIndexChange = new ScrolledIndexChange();

  // ---------------------------------------------------------------------------
  // VirtualScrollStrategy
  // ---------------------------------------------------------------------------

  attach(viewport: CdkVirtualScrollViewport): void {
    this.viewport = viewport;
    this.syncLengths();
    this.rebuild();
    this.updateRenderedRange();
    this.observeContent(viewport);
  }

  detach(): void {
    this.contentObserver?.disconnect();
    this.contentObserver = null;
    this.viewportObserver?.disconnect();
    this.viewportObserver = null;
    if (this.measureFrame !== null) {
      cancelAnimationFrame(this.measureFrame);
      this.measureFrame = null;
    }
    this.scrolledIndexChange.complete();
    this.viewport = null;
    this.heights = [];
    this.measuredFlags = [];
    this.measuredCount = 0;
    this.measuredTotal = 0;
    this.estimate = FALLBACK_ITEM_HEIGHT;
    this.spacer = null;
    this.offsets = [0];
  }

  onContentScrolled(): void {
    this.updateRenderedRange();
  }

  onDataLengthChanged(): void {
    this.syncLengths();
    this.rebuild();
    this.updateRenderedRange();
  }

  onContentRendered(): void {
    // The viewport queues this callback *before* the views are actually stamped
    // out, so measuring synchronously would read stale elements. Defer to the
    // next frame instead, when the DOM reflects the rendered range.
    this.scheduleMeasure();
  }

  onRenderedOffsetChanged(): void {
    // The content offset is written by `updateRenderedRange`/`rebuild`.
  }

  scrollToIndex(index: number, behavior: ScrollBehavior = 'auto'): void {
    const viewport = this.viewport;
    if (!viewport || this.heights.length === 0) return;
    const clamped = Math.max(0, Math.min(index, this.heights.length - 1));
    viewport.scrollToOffset(this.offsets[clamped] ?? 0, behavior);
  }

  // ---------------------------------------------------------------------------
  // Bookkeeping
  // ---------------------------------------------------------------------------

  /** Grows/shrinks the measurement table to match the current data length. */
  private syncLengths(): void {
    const length = this.viewport?.getDataLength() ?? 0;
    if (this.heights.length > length) {
      for (let i = length; i < this.heights.length; i++) {
        if (this.measuredFlags[i]) {
          this.measuredCount--;
          this.measuredTotal -= this.heights[i];
        }
      }
      this.heights.length = length;
      this.measuredFlags.length = length;
    }
    while (this.heights.length < length) {
      this.heights.push(this.estimate);
      this.measuredFlags.push(false);
    }
  }

  /**
   * Recomputes the offset table, publishes the new content size and keeps the
   * anchor item (the one at the current scroll offset) visually stable.
   */
  private rebuild(): void {
    const viewport = this.viewport;
    const scrollTop = viewport ? viewport.measureScrollOffset() : 0;
    const lengths = this.heights.length;
    const anchorIndex = Math.min(this.indexAt(scrollTop), Math.max(0, lengths - 1));
    const anchorDelta = scrollTop - (this.offsets[anchorIndex] ?? 0);

    const offsets = new Array<number>(lengths + 1);
    offsets[0] = 0;
    let accumulated = 0;
    for (let i = 0; i < lengths; i++) {
      accumulated += this.heights[i];
      offsets[i + 1] = accumulated;
    }
    this.offsets = offsets;

    if (!viewport) return;

    this.updateContentSize();
    if (lengths > 0) {
      const target = (this.offsets[anchorIndex] ?? 0) + anchorDelta;
      const maxScroll = Math.max(0, this.contentSize() - viewport.getViewportSize());
      const clamped = Math.max(0, Math.min(target, maxScroll));
      if (Math.abs(clamped - scrollTop) > 0.5) {
        // Grow the spacer first: otherwise the browser clamps the new
        // scrollTop against the still-stale `scrollHeight`.
        this.syncSpacerSize();
        viewport.scrollToOffset(clamped);
      }
    }
    this.applyContentOffset(this.offsets[this.range().start] ?? 0);
  }

  private contentSize(): number {
    return (this.offsets[this.offsets.length - 1] ?? 0) + WRAPPER_PADDING;
  }

  private updateContentSize(): void {
    this.viewport?.setTotalContentSize(this.contentSize());
    this.syncSpacerSize();
  }

  /**
   * Writes the spacer height synchronously instead of waiting for the CDK's
   * `[style.height]` binding, which is only applied on the next change
   * detection pass. Without this, `scrollToOffset` in `rebuild` would be
   * clamped against a stale `scrollHeight` for one frame.
   */
  private syncSpacerSize(): void {
    const viewport = this.viewport;
    const spacer = this.spacer ?? viewport?.elementRef?.nativeElement.querySelector('.cdk-virtual-scroll-spacer');
    if (!spacer) return;
    this.spacer = spacer as HTMLElement;
    const height = `${this.contentSize()}px`;
    if (spacer.style.height !== height) {
      spacer.style.height = height;
    }
  }

  /**
   * Writes the content transform synchronously instead of waiting for the
   * CDK's `_doChangeDetection` pass (`scrolling.mjs` writes the very same
   * string afterwards, so the two writes are idempotent). This keeps the
   * `scrollTop` correction and the block offset in the same frame instead of
   * letting them land on consecutive frames, which is what made expansions
   * flicker.
   */
  private syncContentOffset(offset: number): void {
    const wrapper = this.viewport?._contentWrapper?.nativeElement;
    if (!wrapper) return;
    const transform = `translateY(${Math.round(offset)}px)`;
    if (wrapper.style.transform !== transform) {
      wrapper.style.transform = transform;
    }
  }

  private range(): Range {
    return this.viewport ? this.viewport.getRenderedRange() : { start: 0, end: 0 };
  }

  private applyContentOffset(offset: number): void {
    const rounded = Math.round(offset);
    this.viewport?.setRenderedContentOffset(rounded);
    this.syncContentOffset(rounded);
  }

  /**
   * Renders the items covering the viewport plus the configured buffers,
   * re-positioning the rendered block at its measured offset.
   */
  private updateRenderedRange(): void {
    const viewport = this.viewport;
    if (!viewport) return;
    const dataLength = viewport.getDataLength();
    const current = viewport.getRenderedRange();
    if (dataLength === 0) {
      if (current.start !== 0 || current.end !== 0) {
        viewport.setRenderedRange({ start: 0, end: 0 });
      }
      return;
    }

    const viewportSize = viewport.getViewportSize();
    const scrollOffset = viewport.measureScrollOffset();
    const range: Range = { start: current.start, end: current.end };

    const startBuffer = scrollOffset - (this.offsets[current.start] ?? 0);
    const endBuffer = (this.offsets[current.end] ?? this.contentSize()) - (scrollOffset + viewportSize);

    if (startBuffer < MIN_BUFFER_PX && current.start > 0) {
      range.start = this.firstIndexAt(Math.max(0, scrollOffset - MAX_BUFFER_PX));
      range.end = Math.min(dataLength, this.indexAt(scrollOffset + viewportSize + MIN_BUFFER_PX) + 1);
    } else if (endBuffer < MIN_BUFFER_PX && current.end < dataLength) {
      const end = Math.min(dataLength, this.indexAt(scrollOffset + viewportSize + MAX_BUFFER_PX) + 2);
      if (end > current.end) {
        range.end = end;
        range.start = Math.max(0, Math.min(this.firstIndexAt(Math.max(0, scrollOffset - MIN_BUFFER_PX)), dataLength - 1));
      }
    }

    if (range.start !== current.start || range.end !== current.end) {
      viewport.setRenderedRange(range);
    }
    this.applyContentOffset(this.offsets[range.start] ?? 0);
    this.scrolledIndexChange.next(this.firstIndexAt(scrollOffset));
  }

  /**
   * Stores the real heights of the currently rendered items.
   *
   * Relies on `CdkVirtualForOf` stamping out the views for
   * `[range.start, range.end)` in order as direct children of the wrapper and
   * on every group rendering exactly one element (both branches of the group
   * template in acp-chat.component.html do).
   */
  private measure(): void {
    const viewport = this.viewport;
    const wrapper = viewport?._contentWrapper?.nativeElement;
    if (!viewport || !wrapper) return;

    const range = viewport.getRenderedRange();
    const children = wrapper.children;
    const expected = Math.max(0, Math.min(range.end, this.heights.length) - range.start);
    const count = Math.min(children.length, expected);
    if (count === 0) return;

    let changed = false;
    for (let i = 0; i < count; i++) {
      const index = range.start + i;
      const element = children[i] as HTMLElement;
      const next = children[i + 1] as HTMLElement | undefined;
      let height: number;
      if (next) {
        const top = next.offsetTop - element.offsetTop;
        const observedGap = top - element.offsetHeight;
        if (observedGap >= 0) {
          this.gap = observedGap;
        }
        height = top;
      } else {
        height = element.offsetHeight + this.gap;
      }
      if (height > 0) {
        const previous = this.heights[index];
        if (Math.abs(height - previous) > 0.5) {
          if (this.measuredFlags[index]) {
            this.measuredTotal += height - previous;
          } else {
            this.measuredFlags[index] = true;
            this.measuredCount++;
            this.measuredTotal += height;
          }
          this.heights[index] = height;
          changed = true;
        }
      }
    }

    if (changed) {
      // Only feeds the seed of *future* items; existing heights (and therefore
      // the offsets derived from them) are never re-estimated.
      this.estimate = this.measuredCount > 0 ? this.measuredTotal / this.measuredCount : FALLBACK_ITEM_HEIGHT;
      this.rebuild();
      this.updateRenderedRange();
    }
  }

  /**
   * Re-measures after content resizes (expansions, images, late markdown) and
   * refreshes the viewport size whenever the scroll container itself is resized.
   */
  private observeContent(viewport: CdkVirtualScrollViewport): void {
    if (typeof ResizeObserver === 'undefined') return;

    const element = viewport._contentWrapper?.nativeElement;
    const viewportElement = viewport.elementRef?.nativeElement;
    this.ngZone.runOutsideAngular(() => {
      if (element) {
        this.contentObserver = new ResizeObserver(() => this.scheduleMeasure());
        this.contentObserver.observe(element);
      }
      if (viewportElement) {
        this.viewportObserver = new ResizeObserver(() => viewport.checkViewportSize());
        this.viewportObserver.observe(viewportElement);
      }
    });
  }

  private scheduleMeasure(): void {
    if (this.measureFrame !== null) return;
    // Measurement must run after the view has been stamped out (that happens in
    // the change detection pass following `setRenderedRange`) and outside of the
    // Angular zone: the strategy only writes plain fields, CDK re-enters the
    // zone itself when it needs another round of change detection.
    this.ngZone.runOutsideAngular(() => {
      this.measureFrame = requestAnimationFrame(() => {
        this.measureFrame = null;
        this.measure();
      });
    });
  }

  /** Index of the last item whose offset is at or before `offset`. */
  private indexAt(offset: number): number {
    const offsets = this.offsets;
    const last = offsets.length - 1;
    if (last <= 0) return 0;
    if (offset <= 0) return 0;
    if (offset >= offsets[last]) return last;

    let low = 0;
    let high = last;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (offsets[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  }

  /** Same as `indexAt`, but never returns the one-past-the-end offset. */
  private firstIndexAt(offset: number): number {
    const max = Math.max(0, this.heights.length - 1);
    return Math.min(this.indexAt(offset), max);
  }
}

/** Provider that installs {@link DynamicVirtualScrollStrategy} on a viewport. */
export const DYNAMIC_VIRTUAL_SCROLL_STRATEGY_PROVIDER: Provider = {
  provide: VIRTUAL_SCROLL_STRATEGY,
  useClass: DynamicVirtualScrollStrategy
};
