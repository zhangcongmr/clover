import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, TemplateRef, output, ViewChild, ViewContainerRef, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { SurfaceComponent } from '@a2ui/angular/v0_9';
import { A2uiRendererService } from '@a2ui/angular/v0_9';
import { A2uiClientAction } from '@a2ui/web_core/v0_9';
import { FormatMessagePipe } from './tool-call-info.pipe';
import { A2uiThemeBridgeService } from './a2ui-theme-bridge.service';
import { ThemeService } from '../../theme.service';
import { ThemeLibraryService } from '../../theme-library.service';
import { NotificationService } from '../notification/notification.service';
import { ThemePreviewSvgComponent, ThemePreviewVariant } from './theme-preview-svg.component';

/** Ordered list of previews cycled through by the overlay navigation. */
const PREVIEW_VARIANTS: ThemePreviewVariant[] = ['welcome', 'chat'];

@Component({
  selector: 'app-a2ui-json-renderer',
  standalone: true,
  imports: [CommonModule, SurfaceComponent, FormatMessagePipe, ThemePreviewSvgComponent],
  templateUrl: './a2ui-json-renderer.component.html',
  styleUrls: ['./a2ui-json-renderer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class A2uiJsonRendererComponent implements AfterViewInit, OnDestroy {
  content = input<string>('');

  themeApply = output<Record<string, any>>();

  @ViewChild('surfacesContainer') surfacesContainer!: ElementRef<HTMLElement>;
  @ViewChild('previewRoot') previewRoot?: ElementRef<HTMLElement>;
  @ViewChild('zoomOverlay') zoomOverlay?: TemplateRef<any>;

  protected renderer = inject(A2uiRendererService);
  private themeBridge = inject(A2uiThemeBridgeService);
  private themeService = inject(ThemeService);
  private themeLibrary = inject(ThemeLibraryService);
  private notification = inject(NotificationService);
  private overlay = inject(Overlay);
  private viewContainerRef = inject(ViewContainerRef);
  private overlayRef: OverlayRef | null = null;

  private processedBlockCount = 0;
  private knownSurfaceIds = new Set<string>();
  private pendingCssVars: Record<string, string> = {};
  private pendingPreviewVars: Record<string, string> | null = null;
  private themeDataFromModel: Record<string, any> | null = null;
  private captureScreenshotEnableByLLM = false;
  private actionSubscription: any;

  surfaces = signal<string[]>([]);
  remainingContent = signal<string>('');
  /** Theme CSS variables recolouring the SVG previews; null until generated. */
  previewPalette = signal<Record<string, string> | null>(null);
  /** Which preview is maximised in the overlay, null when closed. */
  zoomedPreview = signal<ThemePreviewVariant | null>(null);

  @HostListener('document:keydown.escape')
  onEscapeKeydown(): void {
    this.zoomedPreview.set(null);
  }

  @HostListener('document:keydown.arrowleft')
  onArrowLeftKeydown(): void {
    this.stepPreview(-1);
  }

  @HostListener('document:keydown.arrowright')
  onArrowRightKeydown(): void {
    this.stepPreview(1);
  }

  /**
   * Cycles the maximised overlay through the available previews, wrapping
   * around at either end. Stops the click from bubbling to the overlay,
   * which would otherwise close it.
   */
  stepPreview(delta: number, event?: Event): void {
    event?.stopPropagation();
    if (!this.zoomedPreview()) {
      return;
    }
    const index = PREVIEW_VARIANTS.indexOf(this.zoomedPreview()!);
    const next = (index + delta + PREVIEW_VARIANTS.length) % PREVIEW_VARIANTS.length;
    this.zoomedPreview.set(PREVIEW_VARIANTS[next]);
  }

  /**
   * Renders the zoomed preview into a CDK overlay attached to the body so the
   * lightbox escapes the virtual scroll wrapper. That wrapper carries an
   * inline `transform: translateY(...)` (dynamic-virtual-scroll.strategy.ts),
   * which would otherwise become the containing block for this fixed-position
   * overlay and pin it to the message list instead of the viewport.
   */
  private openZoomOverlay(): void {
    if (!this.overlayRef) {
      this.overlayRef = this.overlay.create({
        scrollStrategy: this.overlay.scrollStrategies.block(),
        disposeOnNavigation: true,
      });
    }
    if (!this.overlayRef.hasAttached() && this.zoomOverlay) {
      this.overlayRef.attach(new TemplatePortal(this.zoomOverlay, this.viewContainerRef));
    }
  }

  private closeZoomOverlay(): void {
    this.overlayRef?.detach();
  }

  constructor() {
    effect(() => {
      const content = this.content();
      if (content) {
        this.tryProcessContent(content);
      }
    });

    effect(() => {
      if (this.zoomedPreview()) {
        this.openZoomOverlay();
      } else {
        this.closeZoomOverlay();
      }
    });

    this.actionSubscription = this.renderer.surfaceGroup.onAction.subscribe(
      async (action: A2uiClientAction) => {
        if (action.name === 'applyTheme' && this.themeDataFromModel) {
          this.themeApply.emit(this.themeDataFromModel);
        }
        // User-initiated save into the local theme library (never automatic).
        if (action.name === 'addToThemeLibrary' && this.themeDataFromModel) {
          const saved = await this.themeLibrary.addFromThemeData(this.themeDataFromModel);
          if (saved) {
            this.notification.showNotification(`"${saved.title}" added to theme library`, 'success');
          } else {
            this.notification.showNotification('Theme could not be saved to library', 'error');
          }
        }
      }
    );
  }

  ngAfterViewInit(): void {
    // Apply pending CSS variables after view is initialized
    if (Object.keys(this.pendingCssVars).length > 0 && this.surfacesContainer) {
      this.themeBridge.applyVarsToElement(this.surfacesContainer.nativeElement, this.pendingCssVars);
      this.pendingCssVars = {};
    }
    if (this.pendingPreviewVars && this.previewRoot) {
      this.themeBridge.applyVarsToElement(this.previewRoot.nativeElement, this.pendingPreviewVars);
      this.pendingPreviewVars = null;
    }
  }

  private tryProcessContent(content: string): void {
    const regex = /<a2ui-json>([\s\S]*?)<\/a2ui-json>/g;
    const completeBlocks: string[] = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      completeBlocks.push(match[1]);
    }

    const newBlocks = completeBlocks.slice(this.processedBlockCount);

    if (newBlocks.length > 0) {
      const allMessages: any[] = [];
      const newSurfaceIds = new Set<string>();
      let mergedCssVars: Record<string, string> = {};
      let allGoogleFonts: string[] = [];

      for (const block of newBlocks) {
        try {
          const jsonArray = JSON.parse(block);
          for (const item of jsonArray) {
            allMessages.push(item);
            if (item.createSurface?.surfaceId) {
              newSurfaceIds.add(item.createSurface.surfaceId);

              // Extract theme CSS vars from createSurface
              if (item.createSurface?.theme) {
                const cssVars = this.themeBridge.mapThemeToCssVars(item.createSurface.theme);
                mergedCssVars = { ...mergedCssVars, ...cssVars };

                // Extract Google Fonts (global, needs ThemeService)
                const fonts = this.themeBridge.extractGoogleFonts(item.createSurface.theme);
                allGoogleFonts = [...allGoogleFonts, ...fonts];
              }
            }
            // Store theme data from updateDataModel for applyTheme action
            if (item.updateDataModel?.value) {
              this.themeDataFromModel = item.updateDataModel.value;
              this.captureScreenshotEnableByLLM =
                item.updateDataModel.value.captureScreenshotEnableByLLM === true;
            }
          }
        } catch (e) { /* ignore invalid JSON */ }
      }

      // Delete existing surfaces with same IDs to avoid conflicts
      const surfaceGroup = this.renderer.surfaceGroup;
      for (const surfaceId of newSurfaceIds) {
        if (surfaceGroup.surfacesMap.has(surfaceId)) {
          surfaceGroup.deleteSurface(surfaceId);
        }
        this.knownSurfaceIds.add(surfaceId);
      }

      if (allMessages.length > 0) {
        this.renderer.processMessages(allMessages);
      }

      // Load Google Fonts (global, must use ThemeService)
      if (allGoogleFonts.length > 0) {
        const uniqueFonts = [...new Set(allGoogleFonts)];
        this.themeService.loadGoogleFonts(uniqueFonts);
      }

      // Apply CSS variables to surface container (scoped, not global)
      if (Object.keys(mergedCssVars).length > 0) {
        if (this.surfacesContainer) {
          this.themeBridge.applyVarsToElement(this.surfacesContainer.nativeElement, mergedCssVars);
        } else {
          // Store for later if view is not ready yet
          this.pendingCssVars = mergedCssVars;
        }
      }

      this.processedBlockCount = completeBlocks.length;
      this.surfaces.set([...this.knownSurfaceIds]);

      if (this.captureScreenshotEnableByLLM) {
        this.refreshThemePreview();
      }
    }

    this.remainingContent.set(this.computeRemainingContent(content));
  }

  /**
   * Recolours the SVG theme previews with the generated theme: converts the
   * theme data to scoped CSS variables and applies them to the preview root,
   * which the inline SVG mockups inherit through the cascade. Rendering the
   * previews is pure CSS - no rasterisation, no DOM state switching.
   */
  private refreshThemePreview(): void {
    if (!this.themeDataFromModel) {
      return;
    }
    const vars = this.themeService.themeDataToCssVars(this.themeDataFromModel);
    const root = this.previewRoot?.nativeElement;
    if (root) {
      const previous = this.previewPalette();
      if (previous) {
        for (const key of Object.keys(previous)) {
          root.style.removeProperty(key);
        }
      }
      this.themeBridge.applyVarsToElement(root, vars);
    } else {
      this.pendingPreviewVars = vars;
    }
    this.previewPalette.set(vars);
  }

  /**
   * Computes the non-a2ui markdown text to display, handling streamed fragments:
   * - strips fully complete <a2ui-json>…</a2ui-json> blocks
   * - cuts everything from a complete opening tag name onward (covers body +
   *   fragmented closing tags that follow the opening tag)
   * - cuts trailing partial opening/closing tag prefixes (e.g. "<a", "</a2ui-jso")
   *   so half-streamed tags are never rendered as markdown
   */
  private computeRemainingContent(content: string): string {
    let s = content.replace(/<a2ui-json>[\s\S]*?<\/a2ui-json>/g, '');

    const openIdx = s.search(/<a2ui-json/);
    if (openIdx !== -1) {
      return s.slice(0, openIdx).trim();
    }

    const TAGS = ['<a2ui-json', '</a2ui-json'];
    for (const tag of TAGS) {
      const maxLen = Math.min(tag.length, s.length);
      for (let len = maxLen; len >= 1; len--) {
        if (tag.startsWith(s.slice(-len))) {
          return s.slice(0, s.length - len).trim();
        }
      }
    }
    return s.trim();
  }

  ngOnDestroy(): void {
    this.overlayRef?.dispose();
    this.overlayRef = null;
    this.actionSubscription?.unsubscribe();
  }
}
