import {
  AfterViewInit,
  Directive,
  ElementRef,
  inject,
  input,
  OnDestroy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Side of the trigger the menu is laid out on. */
export type DropdownPlacement = 'top' | 'bottom';

/** Gap kept between the menu and the clipping edge. */
const EDGE_GAP = 4;

/**
 * Extra slack kept between the menu's edge and the clipping edge when the menu
 * has to be capped.
 *
 * Landing exactly on `clip.bottom` (or a fraction past it) is the state where
 * the clipping ancestor's overflow — and therefore its scrollbar, and therefore
 * its `clientHeight` — flips. A flip changes the measured room, which changes
 * the cap, which flips the overflow back: an endless two-state oscillation that
 * shows up as `max-height` jitter.
 */
const CLAMP_SLACK = 1;

/**
 * Keeps an absolutely positioned popup menu inside the box that clips it.
 *
 * The composer menus are anchored with `bottom: 100%` and used to carry a fixed
 * `max-height`, so whenever the panel (an `overflow: auto` flex column) was too
 * short the menu overflowed the panel's top edge and lost its first rows.
 *
 * This directive measures, when the menu opens and whenever the layout changes,
 * how much vertical room is left above and below the menu's containing block,
 * then:
 *
 * - caps the menu height to that room, so the menu scrolls internally instead
 *   of being clipped, and
 * - flips the menu to `data-placement="bottom"` when the preferred side cannot
 *   fit it and the other side has more room.
 *
 * The containing block is resolved through `offsetParent`, which for these
 * menus is the `.xxx-selector` (or `.acp-chat-input-box`) wrapper — exactly the
 * box the menu is anchored to. CSS only needs to provide the two placement
 * variants (see `.agent-dropdown[data-placement='bottom']` and friends).
 *
 * Because the directive writes the very size it measures around, it must never
 * let its own write feed back into the measurement:
 *
 * - the natural height comes from `scrollHeight` plus the border widths from
 *   computed style, never from `offsetHeight`/`clientHeight` of the (already
 *   capped) box, so a cap can not change the number that produced it;
 * - a cap is always {@link CLAMP_SLACK} pixels away from the clipping edge, so
 *   the cap can not toggle the ancestor's overflow/scrollbar state;
 * - re-measuring is coalesced into one `requestAnimationFrame`, so a burst of
 *   scroll or ResizeObserver events can not produce a burst of writes;
 * - as a last resort, an A → B → A cycle settles on the smaller height instead
 *   of alternating forever.
 */
@Directive({
  selector: '[appDropdownPlacement]',
  standalone: true,
})
export class DropdownPlacementDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);

  /** Hard cap for the menu height, mirroring its CSS `max-height`. */
  readonly placementMaxHeight = input<number>(400);
  /** Height under which the preferred side counts as "does not fit". */
  readonly placementMinHeight = input<number>(160);
  /** Side to use when there is enough room for it. */
  readonly placementPreference = input<DropdownPlacement>('top');

  private placement: DropdownPlacement = 'top';
  private resizeObserver?: ResizeObserver;
  private frame: number | null = null;
  /** Last applied cap, and the one before it, for cycle detection. */
  private appliedRoom: number | null = null;
  private roomBeforeLast: number | null = null;

  private readonly onLayoutChange = () => this.schedule();
  private readonly onResize = () => this.schedule();

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // First paint needs a cap synchronously, otherwise the menu flashes at its
    // CSS default height before the first frame callback runs.
    this.update();
    // Menus follow their trigger while the panel scrolls, so re-measure instead
    // of closing: scrolling never detaches the menu from the composer.
    document.addEventListener('scroll', this.onLayoutChange, { capture: true, passive: true });
    window.addEventListener('resize', this.onLayoutChange, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.onResize);
      // Panel size changes (sidebar toggle, splitter drag, layout switch) move
      // the composer without scrolling or resizing the window, so watch the
      // trigger and the boxes that clip the menu as well. Observing the menu
      // itself is still required for content changes (agents appearing /
      // disappearing), the write feedback is handled inside `update`.
      this.resizeObserver.observe(this.host.nativeElement);
      const el = this.host.nativeElement;
      const anchor = this.anchorOf(el);
      if (anchor) this.resizeObserver.observe(anchor);
      for (const node of this.clippingAncestors(el)) {
        this.resizeObserver.observe(node);
      }
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.onLayoutChange, { capture: true });
    window.removeEventListener('resize', this.onLayoutChange);
    this.resizeObserver?.disconnect();
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  /** Coalesce every trigger into a single measurement per frame. */
  private schedule(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.update();
    });
  }

  private update(): void {
    const el = this.host.nativeElement;
    if (!el.isConnected) return;

    // The containing block the menu is anchored to. `offsetParent` is the
    // nearest positioned ancestor, which is what `bottom: 100%` resolves against.
    const anchor = this.anchorOf(el);
    if (!anchor) return;

    const clip = this.clipRect(el);
    if (clip.bottom - clip.top <= 0) return;

    // Natural (unclamped) border-box height. `scrollHeight` reports the full
    // content height whatever cap is applied, and the border widths come from
    // computed style, so this number is independent of the height we wrote last
    // time — reading `offsetHeight`/`clientHeight` here used to close a
    // measurement loop with our own write.
    const naturalHeight = el.scrollHeight + this.borderHeight(el);
    const wantedHeight = Math.min(naturalHeight, this.placementMaxHeight());

    const anchorRect = anchor.getBoundingClientRect();
    const spaceAbove = anchorRect.top - clip.top - EDGE_GAP;
    const spaceBelow = clip.bottom - anchorRect.bottom - EDGE_GAP;

    const preferBottom = this.placementPreference() === 'bottom';
    const preferredSpace = preferBottom ? spaceBelow : spaceAbove;
    const fallbackSpace = preferBottom ? spaceAbove : spaceBelow;
    const flip =
      preferredSpace < Math.min(wantedHeight, this.placementMinHeight()) &&
      fallbackSpace > preferredSpace;

    const side: DropdownPlacement = flip
      ? (preferBottom ? 'top' : 'bottom')
      : this.placementPreference();
    const sideSpace = flip ? fallbackSpace : preferredSpace;

    // Nothing sensible fits (collapsed panel, hidden host): keep the CSS default
    // so the menu is not squashed to zero height.
    if (sideSpace < 1) return;

    const clamped = sideSpace < wantedHeight;
    let room = Math.floor(clamped ? sideSpace - CLAMP_SLACK : wantedHeight);

    // Two-value ping-pong (A → B → A): the measurement is still reacting to our
    // own write. Settle on the smaller height instead of alternating forever.
    if (
      this.appliedRoom !== null &&
      this.roomBeforeLast !== null &&
      room === this.roomBeforeLast &&
      room !== this.appliedRoom
    ) {
      room = Math.min(room, this.appliedRoom);
    }

    if (room < 1) return;

    if (this.placement !== side) {
      this.placement = side;
      el.dataset['placement'] = side;
    }
    // Compare before writing: the ResizeObserver below must not loop on our own
    // style change.
    const nextMaxHeight = `${room}px`;
    if (el.style.maxHeight !== nextMaxHeight) {
      el.style.maxHeight = nextMaxHeight;
    }

    this.roomBeforeLast = this.appliedRoom;
    this.appliedRoom = room;
  }

  /** Border-box vertical padding-inclusive chrome of the menu, height-agnostic. */
  private borderHeight(el: HTMLElement): number {
    const style = getComputedStyle(el);
    const top = parseFloat(style.borderTopWidth);
    const bottom = parseFloat(style.borderBottomWidth);
    return (Number.isFinite(top) ? top : 0) + (Number.isFinite(bottom) ? bottom : 0);
  }

  /**
   * Vertical range the menu must stay inside: the viewport intersected with the
   * padding box of every scroll container above it (the ACP panel, the chat
   * column, …). Overflowing any of those means being clipped.
   */
  private clipRect(el: HTMLElement): { top: number; bottom: number } {
    let top = 0;
    let bottom = document.documentElement.clientHeight || window.innerHeight;

    for (const node of this.clippingAncestors(el)) {
      const rect = node.getBoundingClientRect();
      const paddingTop = rect.top + node.clientTop;
      top = Math.max(top, paddingTop);
      bottom = Math.min(bottom, paddingTop + node.clientHeight);
    }

    return { top, bottom };
  }

  /** Positioned ancestor the menu is anchored to. */
  private anchorOf(el: HTMLElement): HTMLElement | null {
    return (el.offsetParent as HTMLElement | null) ?? el.parentElement;
  }

  /** Ancestors whose `overflow` clips the menu. */
  private clippingAncestors(el: HTMLElement): HTMLElement[] {
    const result: HTMLElement[] = [];
    let node: HTMLElement | null = el.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      if (style.overflowY !== 'visible' || style.overflowX !== 'visible') {
        result.push(node);
      }
      node = node.parentElement;
    }
    return result;
  }
}
