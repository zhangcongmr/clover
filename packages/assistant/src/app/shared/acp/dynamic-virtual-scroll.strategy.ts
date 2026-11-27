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

/**
 * Rendered rows above the viewport are only dropped once they are this far
 * off-screen; dropping them eagerly made measurement passes rebuild the whole
 * block on every frame while streaming.
 */
const RANGE_HYSTERESIS_PX = 200;

/** Longest cold-start measurement window before the list is revealed anyway. */
const SETTLE_TIMEOUT_MS = 300;

/** Consecutive unchanged measurement passes required to end the cold start. */
const SETTLE_STABLE_PASSES = 1;

interface Range {
  start: number;
  end: number;
}

/**
 * Position the viewport is anchored to while the offset table is rewritten.
 *
 * - `bottom`: keep the real bottom edge on screen (chat transcript, pinned).
 * - `index`: keep the row currently at the top edge visually fixed (free scroll).
 * - `keep`: preserve the distance to the bottom; used when a structural change
 *   (rows regrouped at the end of a turn) makes both indices and heights
 *   meaningless for the new list.
 */
type AnchorMode = 'bottom' | 'index' | 'keep';

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
 * keeps a prefix-sum offset table, and honours one of two anchors: the real
 * bottom edge while the transcript is "pinned", or the row at the top edge when
 * the user is scrolling freely.
 *
 * Pinning to the bottom is what keeps streaming stable: a new chunk (or a late
 * image/font) makes the last row taller, and re-aligning the *bottom* moves no
 * visible content. Compensating an index instead — the old behaviour — shifted
 * the viewport by hundreds of pixels per chunk and by thousands when a finished
 * turn regrouped its rows.
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

  /** Data length observed on the previous `onDataLengthChanged`. */
  private rowCount = 0;

  /** Whether the viewport is parked on the bottom edge. */
  private pinned = true;

  /** Anchor used by the next `rebuild()`; cleared once consumed. */
  private anchorMode: AnchorMode | null = null;

  /** Cold-start: the list is being measured before it is revealed. */
  private settling = false;
  private settleStartedAt = 0;
  private settleStablePasses = 0;
  private settleCallback: (() => void) | null = null;

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
    this.rowCount = viewport.getDataLength();
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
    this.rowCount = 0;
    this.estimate = FALLBACK_ITEM_HEIGHT;
    this.spacer = null;
    this.offsets = [0];
    // `pinned` intentionally survives: a re-attached viewport is still the same
    // conversation, and dropping the intent would silently stop following.
    this.settling = false;
    this.settleStablePasses = 0;
    this.settleCallback = null;
  }

  onContentScrolled(): void {
    this.updateRenderedRange();
  }

  onDataLengthChanged(): void {
    const length = this.viewport?.getDataLength() ?? 0;

    if (length < this.rowCount) {
      // A shrinking list is a *structural* change, not a removal of trailing
      // rows: a finished turn merges its per-message groups into per-round
      // groups, so index `i` no longer describes the row that was measured at
      // `i`. Keeping the prefix heights (the old behaviour) left the offset
      // table describing a different conversation, and the anchor compensation
      // then threw the viewport thousands of pixels away from the bottom.
      this.anchorMode = this.pinned ? 'bottom' : 'keep';
      this.invalidateMeasurements();
    } else {
      this.syncLengths();
      this.rowCount = length;
    }

    this.rebuild();
    this.updateRenderedRange();
    if (this.settling) {
      this.scheduleMeasure();
    }
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
  // Pinning / cold start
  // ---------------------------------------------------------------------------

  /** Parks the viewport on the real bottom edge (or releases it). */
  setPinned(pinned: boolean): void {
    if (pinned === this.pinned) return;
    this.pinned = pinned;
    if (pinned) {
      this.anchorMode = 'bottom';
      this.rebuild();
      this.updateRenderedRange();
      return;
    }
    if (this.settling) {
      // The user took control mid-settle: reveal the list without moving it.
      this.finishSettle(false);
    }
  }

  isPinned(): boolean {
    return this.pinned;
  }

  /**
   * Drops every measurement. Called when the bound conversation changes, so the
   * rows of the previous session are not mistaken for measured rows of the new
   * one.
   */
  reset(options: { keepEstimate?: boolean } = {}): void {
    this.heights = [];
    this.measuredFlags = [];
    this.measuredCount = 0;
    this.measuredTotal = 0;
    this.offsets = [0];
    this.rowCount = this.viewport?.getDataLength() ?? 0;
    this.anchorMode = this.pinned ? 'bottom' : 'keep';
    this.settling = false;
    this.settleStablePasses = 0;
    this.settleCallback = null;
    if (!options.keepEstimate) {
      this.estimate = FALLBACK_ITEM_HEIGHT;
    }
    if (this.measureFrame !== null) {
      cancelAnimationFrame(this.measureFrame);
      this.measureFrame = null;
    }
    // Seed the current rows right away so the first `rebuild` has a table.
    this.syncLengths();
  }

  /**
   * Cold-start alignment: measure the tail of a freshly loaded transcript, then
   * park on the real bottom and invoke `callback` (the caller reveals the list
   * from behind its loading overlay).
   */
  beginSettle(callback: () => void): void {
    this.settling = true;
    this.settleStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.settleStablePasses = 0;
    this.settleCallback = callback;
    this.pinned = true;
    this.anchorMode = 'bottom';
    this.rebuild();
    this.updateRenderedRange();
    this.scheduleMeasure();
  }

  /** Aligns the bottom edge immediately (`auto`) or with a smooth animation. */
  scrollToBottomNow(behavior: ScrollBehavior = 'auto'): void {
    const viewport = this.viewport;
    if (!viewport) return;
    this.pinned = true;
    this.anchorMode = 'bottom';
    if (behavior === 'smooth') {
      this.rebuild(false);
      const maxScroll = Math.max(0, this.contentSize() - viewport.getViewportSize());
      viewport.scrollToOffset(maxScroll, 'smooth');
      return;
    }
    this.rebuild();
    this.updateRenderedRange();
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
      // A freshly appended row is usually small (an empty assistant bubble, a
      // thought, a tool call). Seeding it with the running average of already
      // measured rows overshot by hundreds of pixels in long sessions, and the
      // very next measurement pass had to shrink the content again.
      this.heights.push(Math.min(this.estimate, FALLBACK_ITEM_HEIGHT));
      this.measuredFlags.push(false);
    }
  }

  /**
   * Re-seeds every row with the current estimate and forgets all measurements.
   * Used for structural changes, where retained measurements describe rows that
   * no longer exist.
   */
  private invalidateMeasurements(): void {
    const length = this.viewport?.getDataLength() ?? 0;
    this.heights = new Array<number>(length).fill(this.estimate);
    this.measuredFlags = new Array<boolean>(length).fill(false);
    this.measuredCount = 0;
    this.measuredTotal = 0;
    // Rebuild the table right away so `rebuild()` still sees a comparable
    // "before" size (used by the `keep` anchor) instead of a 32px stub.
    this.recomputeOffsets();
    this.rowCount = length;
  }

  /** Recomputes the prefix sums from `heights`. */
  private recomputeOffsets(): void {
    const lengths = this.heights.length;
    const offsets = new Array<number>(lengths + 1);
    offsets[0] = 0;
    let accumulated = 0;
    for (let i = 0; i < lengths; i++) {
      accumulated += this.heights[i];
      offsets[i + 1] = accumulated;
    }
    this.offsets = offsets;
  }

  /** Applies `anchorMode` after rewriting the offset table. */
  private rebuild(write = true): void {
    const viewport = this.viewport;
    const scrollTop = viewport ? viewport.measureScrollOffset() : 0;
    const viewportSize = viewport ? viewport.getViewportSize() : 0;
    const lengths = this.heights.length;

    const oldContent = this.contentSize();
    const oldGap = Math.max(0, oldContent - (scrollTop + viewportSize));
    const anchorIndex = lengths > 0 ? Math.min(this.indexAt(scrollTop), lengths - 1) : 0;
    const anchorDelta = scrollTop - (this.offsets[anchorIndex] ?? 0);
    const mode: AnchorMode = this.anchorMode ?? (this.pinned ? 'bottom' : 'index');
    this.anchorMode = null;

    this.recomputeOffsets();
    if (!viewport) return;

    this.updateContentSize();

    if (lengths > 0 && write) {
      const maxScroll = Math.max(0, this.contentSize() - viewportSize);
      let target: number;
      if (mode === 'bottom') {
        target = maxScroll;
      } else if (mode === 'keep') {
        target = maxScroll - oldGap;
      } else {
        target = (this.offsets[anchorIndex] ?? 0) + anchorDelta;
      }
      target = Math.max(0, Math.min(maxScroll, target));
      if (Math.abs(target - scrollTop) > 0.5) {
        // Grow the spacer first: otherwise the browser clamps the new
        // `scrollTop` against the still-stale `scrollHeight`.
        this.syncSpacerSize();
        viewport.scrollToOffset(target);
      }
    }

    // The rendered range may point past the end right after a shrink; fall back
    // to the last item instead of translating the block to offset 0.
    const rangeStart = Math.min(this.range().start, Math.max(0, lengths - 1));
    this.applyContentOffset(this.offsets[rangeStart] ?? 0);
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
    const previous = viewport.getRenderedRange();
    if (dataLength === 0) {
      if (previous.start !== 0 || previous.end !== 0) {
        viewport.setRenderedRange({ start: 0, end: 0 });
      }
      return;
    }

    const viewportSize = viewport.getViewportSize();
    const scrollOffset = viewport.measureScrollOffset();

    if (this.pinned) {
      // Pinned: always render up to the newest row, and only ever walk
      // backwards. The window is derived from the *bottom* so that height
      // corrections above it cannot make rows appear/disappear.
      const end = dataLength;
      const endOffset = this.offsets[dataLength] ?? this.contentSize();
      let start = this.firstIndexAt(Math.max(0, endOffset - viewportSize - MAX_BUFFER_PX));
      if (previous.start < start && previous.start < dataLength) {
        const dropPx = (this.offsets[start] ?? 0) - (this.offsets[previous.start] ?? 0);
        if (dropPx < RANGE_HYSTERESIS_PX) {
          start = previous.start;
        }
      }
      if (start >= end) start = Math.max(0, end - 1);

      const range: Range = { start, end };
      if (range.start !== previous.start || range.end !== previous.end) {
        viewport.setRenderedRange(range);
      }
      this.applyContentOffset(this.offsets[range.start] ?? 0);
      this.scrolledIndexChange.next(this.firstIndexAt(scrollOffset));
      return;
    }

    // The rendered range goes stale when the data length shrinks — a finished
    // turn merges its per-message groups into per-round groups (e.g. 204 groups
    // -> 48 groups). `CdkVirtualForOf` slices the data with this window, so an
    // out-of-range window yields an empty slice and every rendered view is
    // removed, blanking the list. Rebuild the window from the scroll offset
    // whenever the previous one no longer fits.
    const stale =
      previous.start >= dataLength ||
      previous.end > dataLength ||
      previous.end <= previous.start;
    const current: Range = stale
      ? {
          start: this.firstIndexAt(Math.max(0, scrollOffset - MIN_BUFFER_PX)),
          end: Math.min(dataLength, this.indexAt(scrollOffset + viewportSize + MAX_BUFFER_PX) + 1),
        }
      : previous;

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

    // Never publish an empty window: the viewport would drop every view.
    if (range.end <= range.start) {
      range.start = Math.min(current.start, dataLength - 1);
      range.end = Math.min(dataLength, range.start + 1);
    }

    if (range.start !== previous.start || range.end !== previous.end) {
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
    if (count === 0) {
      // Nothing stamped out yet (the range has not caught up with the data).
      // Do not let this count as a stable settle pass.
      return;
    }

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

    this.maybeFinishSettle(changed);
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
        this.contentObserver = new ResizeObserver(() => {
          // Inside a ResizeObserver callback layout is up to date and the frame
          // has not been painted yet, so a pinned viewport can be re-aligned
          // without a visible intermediate frame. Free scrolling keeps the
          // deferred pass to avoid measuring mid-layout on every keystroke.
          if (this.pinned) {
            this.measure();
          } else {
            this.scheduleMeasure();
          }
        });
        this.contentObserver.observe(element);
      }
      if (viewportElement) {
        this.viewportObserver = new ResizeObserver(() => {
          // `checkViewportSize` measures the new height and then calls back into
          // `onDataLengthChanged`, which re-parks a pinned transcript on the
          // bottom in the same frame. Without it, a panel appearing below the
          // list (typing indicator, todos, questions) would leave the viewport
          // exactly that many pixels above the bottom.
          viewport.checkViewportSize();
        });
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

  // ---------------------------------------------------------------------------
  // Cold-start settle
  // ---------------------------------------------------------------------------

  /**
   * Ends the cold start once measurement has converged: one unchanged pass, or
   * the timeout — whichever comes first.
   */
  private maybeFinishSettle(changed: boolean): void {
    if (!this.settling) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // A live transcript can keep changing forever; the deadline wins.
    if (now - this.settleStartedAt >= SETTLE_TIMEOUT_MS) {
      this.finishSettle(true);
      return;
    }
    if (changed) {
      this.settleStablePasses = 0;
      // Another pass is needed for the freshly measured heights to land in the
      // DOM; request it explicitly so settling cannot stall without a resize.
      this.scheduleMeasure();
      return;
    }
    this.settleStablePasses++;
    if (this.settleStablePasses >= SETTLE_STABLE_PASSES) {
      this.finishSettle(true);
    }
  }

  private finishSettle(reposition: boolean): void {
    if (!this.settling) return;
    this.settling = false;
    this.settleStablePasses = 0;
    if (reposition) {
      this.pinned = true;
      this.anchorMode = 'bottom';
      this.rebuild();
      this.updateRenderedRange();
    }
    const callback = this.settleCallback;
    this.settleCallback = null;
    callback?.();
  }

  // ---------------------------------------------------------------------------
  // Index helpers
  // ---------------------------------------------------------------------------

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