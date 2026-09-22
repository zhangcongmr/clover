import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, output, ViewChild, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  private actionSubscription: any;

  surfaces = signal<string[]>([]);
  remainingContent = signal<string>('');

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
    }

    this.remainingContent.set(this.computeRemainingContent(content));
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
