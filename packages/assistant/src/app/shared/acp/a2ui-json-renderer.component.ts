import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, OnDestroy, PLATFORM_ID, afterNextRender, output, ViewChild, effect, inject, input, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import html2canvas from '@html2canvas/html2canvas';
import { SurfaceComponent } from '@a2ui/angular/v0_9';
import { A2uiRendererService } from '@a2ui/angular/v0_9';
import { A2uiClientAction } from '@a2ui/web_core/v0_9';
import { FormatMessagePipe } from './tool-call-info.pipe';
import { A2uiThemeBridgeService } from './a2ui-theme-bridge.service';
import { ThemeService } from '../../theme.service';

@Component({
  selector: 'app-a2ui-json-renderer',
  standalone: true,
  imports: [CommonModule, SurfaceComponent, FormatMessagePipe],
  templateUrl: './a2ui-json-renderer.component.html',
  styleUrls: ['./a2ui-json-renderer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class A2uiJsonRendererComponent implements AfterViewInit, OnDestroy {
  content = input<string>('');

  themeApply = output<Record<string, any>>();

  @ViewChild('surfacesContainer') surfacesContainer!: ElementRef<HTMLElement>;

  protected renderer = inject(A2uiRendererService);
  private themeBridge = inject(A2uiThemeBridgeService);
  private themeService = inject(ThemeService);

  private processedBlockCount = 0;
  private knownSurfaceIds = new Set<string>();
  private pendingCssVars: Record<string, string> = {};
  private themeDataFromModel: Record<string, any> | null = null;
  private captureScreenshotEnableByLLM = false;
  private actionSubscription: any;
  private platformId = inject(PLATFORM_ID);
  private injector = inject(Injector);

  surfaces = signal<string[]>([]);
  remainingContent = signal<string>('');
  screenshot = signal<string>('');
  /** Whether the maximised screenshot preview overlay is open. */
  screenshotPreviewOpen = signal(false);

  @HostListener('document:keydown.escape')
  onEscapeKeydown(): void {
    this.screenshotPreviewOpen.set(false);
  }

  constructor() {
    effect(() => {
      const content = this.content();
      if (content) {
        this.tryProcessContent(content);
      }
    });

    this.actionSubscription = this.renderer.surfaceGroup.onAction.subscribe(
      (action: A2uiClientAction) => {
        if (action.name === 'applyTheme' && this.themeDataFromModel) {
          this.themeApply.emit(this.themeDataFromModel);
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
        void this.captureScreenshot();
      }
    }

    this.remainingContent.set(this.computeRemainingContent(content));
  }

  /**
   * Captures a screenshot of document.documentElement.cloneNode(true) with the
   * generated theme applied and publishes it through the `screenshot` signal.
   */
  private async captureScreenshot(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Let Angular render the freshly created surfaces before cloning the document
    await new Promise<void>((resolve) => {
      afterNextRender(() => resolve(), { injector: this.injector });
    });

    try {
      const clone = document.documentElement.cloneNode(true) as HTMLElement;

      for (const stale of Array.from(clone.querySelectorAll('[data-a2ui-screenshot]'))) {
        stale.remove();
      }

      this.applyThemeToClone(clone);
      this.hideScreenshotExclusions(clone);

      // html2canvas only resolves its reference element while cloning the document it
      // belongs to, so the detached clone is hosted by a temporary off-screen iframe.
      const iframe = document.createElement('iframe');
      iframe.setAttribute(
        'style',
        `position:fixed;left:-10000px;top:0;border:0;width:${window.innerWidth}px;height:${window.innerHeight}px;`
      );
      document.body.appendChild(iframe);

      try {
        const iframeDoc = iframe.contentDocument;
        if (!iframeDoc) {
          return;
        }
        // Non-deprecated replacement for document.write(): move the clone in as the
        // iframe's root element. Cloned <script> elements keep their "already started"
        // flag, so no application code is re-executed inside the iframe.
        iframeDoc.documentElement.replaceWith(clone);

        const canvas = await html2canvas(iframeDoc.documentElement, {
          ignoreElements: (element) => this.isExcludedFromScreenshot(element),
        });
        this.screenshot.set(canvas.toDataURL());
      } finally {
        iframe.remove();
      }
    } catch (e) {
      console.warn('a2ui screenshot failed', e);
    }
  }

  /**
   * Sets the generated theme properties on the cloned document root through
   * ThemeService.applyThemeVariablesTo().
   */
  private applyThemeToClone(clone: HTMLElement): void {
    if (!this.themeDataFromModel) {
      return;
    }
    const cssVars = this.themeService.themeDataToCssVars(this.themeDataFromModel);
    clone.setAttribute('data-theme', 'custom');
    this.themeService.applyThemeVariablesTo(clone, cssVars);
  }

  /**
   * Elements dropped from the html2canvas clone entirely (no layout space left):
   * the agent's task list and project list.
   */
  private isExcludedFromScreenshot(element: Element): boolean {
    return element.classList.contains('task-list') || element.classList.contains('project-list');
  }

  /**
   * Replaces the ACP chat panel in the clone with an empty placeholder of the
   * same size, so html2canvas does not have to clone, serialise and lay out the
   * whole chat DOM while the surrounding elements keep their exact positions.
   * The size is measured on the live document because the clone is detached and
   * therefore has no layout. Falls back to `visibility: hidden` when the panel
   * cannot be measured (zero size or out-of-flow positioning).
   */
  private hideScreenshotExclusions(clone: HTMLElement): void {
    const sources = Array.from(document.querySelectorAll<HTMLElement>('app-acp-chat'));
    const targets = Array.from(clone.querySelectorAll<HTMLElement>('app-acp-chat'));
    for (const [index, target] of targets.entries()) {
      const source = sources[index];
      const placeholder = source ? this.createChatPlaceholder(source) : null;
      if (placeholder) {
        target.replaceWith(placeholder);
      } else {
        target.style.setProperty('visibility', 'hidden');
      }
    }
  }

  /**
   * Builds a flow-in placeholder that occupies exactly the outer box of the
   * given chat element (explicit border-box size, `flex: 0 0 auto`, copied
   * margin and border paint styles, transparent background so the parent's
   * background shows through), or returns null when the box cannot be
   * reproduced.
   */
  private createChatPlaceholder(source: HTMLElement): HTMLElement | null {
    const rect = source.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const computed = window.getComputedStyle(source);
    if (computed.position === 'absolute' || computed.position === 'fixed') {
      return null;
    }

    const placeholder = document.createElement('div');
    placeholder.style.setProperty('box-sizing', 'border-box');
    placeholder.style.setProperty('flex', '0 0 auto');
    placeholder.style.setProperty('width', `${rect.width}px`);
    placeholder.style.setProperty('height', `${rect.height}px`);
    placeholder.style.setProperty('margin', computed.margin);
    // No background on purpose: the placeholder stays transparent so the area
    // shows the parent's background painted by the clone, which keeps it in sync
    // with the theme applied to the clone instead of freezing a colour measured
    // on the live document.
    placeholder.style.setProperty('border', computed.border);
    placeholder.style.setProperty('border-radius', computed.borderRadius);
    placeholder.style.setProperty('box-shadow', computed.boxShadow);
    return placeholder;
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
    this.actionSubscription?.unsubscribe();
  }
}
