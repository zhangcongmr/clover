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
  private readonly onLayoutChange = () => this.update();

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.update();
    // Menus follow their trigger while the panel scrolls, so re-measure instead
    // of closing: scrolling never detaches the menu from the composer.
    document.addEventListener('scroll', this.onLayoutChange, { capture: true, passive: true });
    window.addEventListener('resize', this.onLayoutChange, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.onLayoutChange);
      this.resizeObserver.observe(this.host.nativeElement);
      // Panel size changes (sidebar toggle, splitter drag, layout switch) move
      // the composer without scrolling or resizing the window, so watch the
      // trigger and the boxes that clip the menu as well.
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

    // Natural (unclamped) height: the menu is a scroll container, so
    // `scrollHeight` reports the full content height whatever cap is applied.
    const borders = Math.max(el.offsetHeight - el.clientHeight, 0);
    const naturalHeight = Math.max(el.scrollHeight + borders, el.offsetHeight);
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
    const room = Math.min(wantedHeight, flip ? fallbackSpace : preferredSpace);

    // Nothing sensible fits (collapsed panel, hidden host): keep the CSS default
    // so the menu is not squashed to zero height.
    if (room < 1) return;

    if (this.placement !== side) {
      this.placement = side;
      el.dataset['placement'] = side;
    }
    // Compare before writing: the ResizeObserver below must not loop on our own
    // style change.
    const nextMaxHeight = `${Math.round(room)}px`;
    if (el.style.maxHeight !== nextMaxHeight) {
      el.style.maxHeight = nextMaxHeight;
    }
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
