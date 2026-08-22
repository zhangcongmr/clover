import { HttpClient } from '@angular/common/http';
import { AfterViewInit, Component, ElementRef, Injector, OnDestroy, OnInit, afterNextRender, inject, runInInjectionContext, signal, viewChild, ViewChild } from '@angular/core';
import { Integer, Sequence, Utf8String } from 'asn1js';
import { ConfigService, CoreService } from './core.service';
import { AstTabComponent } from './shared/ast-tab/ast-tab.component';
import { AstTabGroupComponent } from './shared/ast-tab/ast-tab-group/ast-tab-group.component';
import { ContentComponent } from './luxio/content/content.component';
import { AstMenuComponent } from './shared/ast-menu/ast-menu.component';
import { AstSubmenuComponent } from './shared/ast-menu/ast-submenu.component';
import { SettingsComponent } from './luxio/settings/settings.component';
import { UserCenterComponent } from './luxio/user-center/user-center.component';
import { file } from 'opfs-tools';
import { ThemeService } from './theme.service';
import { customFileIcons, customFileIconPaths } from './shared/ast-tree/ast-tree.component';
import { computeFileIcons } from './shared/ast-tree/ast-tree.component';
import { addDynamicFileIconSymbol } from '../svg-sprite.const';
import { NotificationComponent } from './shared/notification/notification.component';
import { TerminalComponent } from './shared/terminal/terminal.component'; // Import the terminal component
import { AcpPanelComponent } from './shared/acp/acp-panel.component';
import { AcpService } from './shared/acp/acp.service';
import * as Types from '@a2ui/web_core/types/types';
import { A2uiRendererService, SurfaceComponent } from '@a2ui/angular/v0_9';
import { Client } from './client';
import { NotificationService } from './shared/notification/notification.service';
import { AstDraggableComponent } from './shared/ast-draggable/ast-draggable.component';
import { DatePipe } from '@angular/common';
import { AgentComponent } from './luxio/agent-ui/agent';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: true,
    imports: [UserCenterComponent, SettingsComponent, AstMenuComponent, AstSubmenuComponent, AstTabGroupComponent,
      AstTabComponent, ContentComponent, NotificationComponent, TerminalComponent, DatePipe,
       SurfaceComponent, AgentComponent], // Add TerminalComponent to imports
})
export class AppComponent extends AstDraggableComponent implements OnInit, AfterViewInit, OnDestroy {
  protected coreService = inject(CoreService);
  protected themeService = inject(ThemeService);
  protected notificationService = inject(NotificationService);
  protected acpService = inject(AcpService);
  contentComp = viewChild(ContentComponent);
  upBtnlist = viewChild<ElementRef<HTMLElement>>('upBtnlist');
  http = inject(HttpClient);
  injector = inject(Injector);

  private hostEl = inject(ElementRef<HTMLElement>);
  private resizeObserver?: ResizeObserver;
  protected agentPanelWidthPx = signal(0);

  private refreshAgentPanelWidth(): void {
    const baseWidth = this.hostEl.nativeElement.clientWidth;
    const raw = getComputedStyle(this.hostEl.nativeElement)
      .getPropertyValue('--left-side-area-width').trim();
    const leftArea = parseFloat(raw) || this.leftSideAreaWidth;
    if (!this.astContentPanelOpen) {
      this.agentPanelWidthPx.set(baseWidth - leftArea);
      return;
    }
    this.agentPanelWidthPx.set((1 - this.leftPct) * (baseWidth - leftArea - 15));
  }
  
  title = 'luxio';
  luxioAppTabId: any;
  textArr: Array<String> = []

  lastSelectedDisplayViewId: number = 1;
  currentDisplayViewId: number = 1;
  previousViewId: number = 1;
  astContentPanelOpen = false;
  agentPanelOpen = true;
  dockPosition: 'left' | 'right' = 'left';
  terminalBtnShow = true;
  terminalPanelShow = false;
  themePromptOpen = false;
  themePromptText = '';
  themePromptLoading = false;
  themePromptError: string | null = null;
  themePromptResult: Record<string, string> | null = null;
  themeIconPath = signal<string | null>(null);
  private readonly THEME_ICON_KEY = 'vscode-theme-icon';
  private readonly FILE_ICONS_KEY = 'vscode-file-icons';
  private readonly AST_CONTENT_PANEL_OPEN_KEY = 'luxio_ast_content_panel_open';
  private readonly ACP_DOCK_POSITION_KEY = 'luxio_acp_dock_position';
  private readonly ACP_PANEL_OPEN_KEY = 'luxio_acp_panel_open';
  private readonly ACP_LEFT_PCT_KEY = 'luxio_acp_left_pct';
  private readonly ACP_PREVIOUS_LEFT_PCT_KEY = 'luxio_acp_previous_left_pct';
  private static readonly ACP_LEFT_PCT_STORAGE_KEY = 'luxio_acp_left_pct';

  keepTerminalInstance = {
    value: false,
    topPct: 0.75,
  }

  /**
   * This property indicates the type of detail panel to show in the indicator panel. It can be one of the following values:
   */
  indicatorDetailType: number | 'none' = 'none'; // 1 - notification, 2 - saving, 3 - progress, 'none' - close the detail panel

  testSurfaceComponent = false
  protected client = inject(Client);
  protected renderer = inject(A2uiRendererService);


  blurSwitch = true;
  isOpen = false;
  menuInitiator: DOMRect | undefined;

  isMenuOpen = false;
  menuAnchor: DOMRect | undefined;

  @ViewChild('fileSubmenu') fileSubmenuRef!: AstSubmenuComponent;
  @ViewChild('viewSubmenu') viewSubmenuRef!: AstSubmenuComponent;

  dataList: Array<any> = [];

  openedList: Array<any> = [
    {
      id: 'editor',
      title: 'Editor',
      isClosable: false,
    }
  ];

  /**
   * 终端Tab管理专用列表
   */
  terminalOpenedList: Array<any> = [];

  constructor(injector: Injector,) {
    super();
    let me = this;
    afterNextRender(() => {
      if (chrome && chrome.tabs) {
        chrome.tabs.getCurrent((val: any) => {
          console.log("current tab id is:" + val.id);
          this.luxioAppTabId = val.id;
          chrome.storage.local.get(ConfigService.luxioAppTabIdList, (result: any) => {
            const luxioAppTabIdList = result[ConfigService.luxioAppTabIdList];
            if (!luxioAppTabIdList) {
              chrome.storage.local.set({ [ConfigService.luxioAppTabIdList]: [val.id] }, function () {
                // let us know it worked
                console.log("V3 Test: initialized test click counter to 0");
              });
            } else {
              if (luxioAppTabIdList.length >= 0 && !luxioAppTabIdList.includes(val.id)) {
                luxioAppTabIdList.push(val.id);
                chrome.storage.local.set({ [ConfigService.luxioAppTabIdList]: luxioAppTabIdList }, function () {
                  // let us know it worked
                  console.log("V3 Test: initialized test click counter to 0");
                });
              }
            }
          });
        });
      }
      window.onbeforeunload = function () {
        if (me.coreService.privacyErrorSettingWindow) {
          me.coreService.privacyErrorSettingWindow.close();
        }
      }
      // me.fileVist()
    });
  }

  ngOnInit(): void {
    let judeType = this.coreService instanceof CoreService;
    console.log("--++++++----")

    const fetchProfile = async () => {
      // Skip API call during SSR to avoid SSL certificate issues
      // The profile will be fetched when the app runs on the browser
      if (typeof window === 'undefined') {
        // Running on the server - skip the API call
        console.log("Skipping profile fetch during SSR");
        return;
      }

      try {
        const response = await fetch(`/api/auth/profile`, {
          credentials: 'include', // 携带 Cookie
        });
        this.coreService.userData = await response.json();
        this.coreService.isAuthenticated.set(true);
      } catch (err) {
        this.coreService.isAuthenticated.set(false);
        console.error('获取用户信息失败:', err);
        // // 可跳转到登录页
        // window.location.href = '/signin';
      }
    };

    fetchProfile();

    // in extension scene
    if (typeof chrome !== 'undefined' && chrome.storage) {
      function updateWindowRect() {
        // 兼容写法：优先使用 screenX/Y， fallback 到 screenLeft/Top
        const x = window.screenX || window.screenLeft;
        const y = window.screenY || window.screenTop;

        const width = window.outerWidth;
        const height = window.outerHeight;

        chrome.storage.local.set({ windowRect: { x: x, y: y, width: width, height: height } }, function () {
          // let us know it worked
          console.log("V3 Test: updated windowRect to storage: ", x, y, width, height);
        });
      }

      // 初始加载时获取一次
      updateWindowRect();

      // 监听窗口移动事件 (注意：并非所有浏览器都高频触发此事件，且拖动过程中可能不连续更新)
      // window.addEventListener('move', updateWindowRect); //move事件不生效， 注释掉
    }

    if (typeof document !== 'undefined') {
      // 初始化主题
      if (this.themeService.getCurrentTheme() === 'dark') {
        document.body.classList.add('vscode-dark-theme');
      } else {
        document.body.classList.remove('vscode-dark-theme');
      }
      // 从 localStorage 恢复主题图标
      const saved = this.loadThemeIcon();
      if (saved) {
        this.themeIconPath.set(saved);
      }
      // 从 localStorage 恢复文件图标
      this.loadSavedFileIcons();
      const savedAstContentPanelOpen = localStorage.getItem(this.AST_CONTENT_PANEL_OPEN_KEY);
      if (savedAstContentPanelOpen !== null) {
        this.astContentPanelOpen = savedAstContentPanelOpen === 'true';
      }
      // 从 localStorage 恢复停靠位置
      const savedDock = localStorage.getItem(this.ACP_DOCK_POSITION_KEY);
      if (savedDock === 'left' || savedDock === 'right') {
        this.dockPosition = savedDock;
      }
      // 从 localStorage 恢复面板打开状态
      const savedOpen = localStorage.getItem(this.ACP_PANEL_OPEN_KEY);
      if (savedOpen !== null) {
        this.agentPanelOpen = savedOpen === 'true';
      }
      // leftPct 已由 getDefaultLeftPct() 在组件构造阶段恢复（见 getDefaultLeftPct），此处无需重复赋值
      // 从 localStorage 恢复 ACP 面板最大化前的宽度比例
      const savedPreviousLeftPct = parseFloat(localStorage.getItem(this.ACP_PREVIOUS_LEFT_PCT_KEY) ?? '');
      if (Number.isFinite(savedPreviousLeftPct) && savedPreviousLeftPct >= 0 && savedPreviousLeftPct <= 1) {
        this.previousLeftPct = savedPreviousLeftPct;
      }
    }
  }


  async fileVist() {
    if(navigator == undefined || navigator.storage === undefined || await navigator.storage.getDirectory === undefined) {
      console.log("OPFS is not supported in this browser.");
      return;
    }
    const opfsRoot = await navigator.storage.getDirectory();
    // 创建层级结构的文件和文件夹
    const fileHandle = await opfsRoot.getFileHandle("my first file", {
      create: true,
    });
    const directoryHandle = await opfsRoot.getDirectoryHandle("my first folder", {
      create: true,
    });
    const nestedFileHandle = await directoryHandle.getFileHandle(
      "my first nested file",
      { create: true },
    );
    const nestedDirectoryHandle = await directoryHandle.getDirectoryHandle(
      "my first nested folder",
      { create: true },
    );

    // 通过文件名和文件夹名访问已有的文件和文件夹
    const existingFileHandle = await opfsRoot.getFileHandle("my first file");
    const existingDirectoryHandle = await opfsRoot.getDirectoryHandle("my first folder");


    directoryHandle.removeEntry("my first nested file");

    console.log("-----------")
  }

  ngAfterViewInit(): void {
    if (typeof window !== 'undefined' && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.refreshAgentPanelWidth());
      this.resizeObserver.observe(this.hostEl.nativeElement);
      this.refreshAgentPanelWidth();
    }

    if (this.fileSubmenuRef) {
      this.fileSubmenuRef.parentItem = this.fileSubmenuRef.nativeElement.parentElement ?? undefined;
    }
    if (this.viewSubmenuRef) {
      this.viewSubmenuRef.parentItem = this.viewSubmenuRef.nativeElement.parentElement ?? undefined;
    }
    const rt = this.addTexts()
    var sequence = new Sequence({name: "block1"});

    var str1 = new Utf8String();
    str1.setValue("5");

    var str2 = new Utf8String();
    str1.setValue("a");

    sequence.valueBlock.value.push(str1);
    sequence.valueBlock.value.push(str2);

    var sequence_buffer = sequence.toBER(false); // Encode current sequence to BER (in ArrayBuffer)
    var current_size = sequence_buffer.byteLength;
    var sequence_veiw = new Uint8Array(sequence_buffer);

    var integer_data = new ArrayBuffer(8);
    var integer_view = new Uint8Array(integer_data);
    integer_view[0] = 0x01;
    integer_view[1] = 0x01;
    integer_view[2] = 0x01;
    integer_view[3] = 0x01;
    integer_view[4] = 0x01;
    integer_view[5] = 0x01;
    integer_view[6] = 0x01;
    integer_view[7] = 0x01;

    let stry = new Utf8String()
    stry.setValue("136");

    let num = new Integer({value: 75889});
    let vi = new Uint8Array(num.toBER());

    // 将已保存的文件图标应用到当前树数据
    if (Object.keys(customFileIcons).length > 0) {
      runInInjectionContext(this.injector, () => {
        afterNextRender(() => {
          const content = this.contentComp();
          if (content) {
            const data = content.dataList();
            if (data && data.length > 0) {
              computeFileIcons(data);
              content.dataList.set([...data]);
            }
          }
        });
      });
    }
  }

  ngOnDestroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
  }

  private saveThemeIcon(): void {
    if (typeof window !== 'undefined') {
      const path = this.themeIconPath();
      if (path) {
        localStorage.setItem(this.THEME_ICON_KEY, path);
      } else {
        localStorage.removeItem(this.THEME_ICON_KEY);
      }
    }
  }

  private loadThemeIcon(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(this.THEME_ICON_KEY);
    }
    return null;
  }

  private saveFileIcons(): void {
    if (typeof window !== 'undefined') {
      if (Object.keys(customFileIconPaths).length > 0) {
        localStorage.setItem(this.FILE_ICONS_KEY, JSON.stringify(customFileIconPaths));
      }
    }
  }

  private loadSavedFileIcons(): void {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(this.FILE_ICONS_KEY);
      if (!saved) return;
      try {
        const paths = JSON.parse(saved);
        if (typeof paths !== 'object' || paths === null) return;
        for (const [ext, svgPath] of Object.entries(paths)) {
          if (typeof svgPath !== 'string' || !svgPath) continue;
          const symbolId = addDynamicFileIconSymbol(ext, svgPath);
          customFileIcons[ext] = symbolId;
          customFileIconPaths[ext] = svgPath;
        }
      } catch { /* ignore */ }
    }
  }

  // 恢复默认主题
  toggleTheme() {
    this.themeService.clearThemeVariables();
    this.themeService.setTheme('default');
    document.body.classList.remove('vscode-dark-theme');
    this.themeIconPath.set(null);
    this.saveThemeIcon();
    // 清除自定义文件图标
    for (const key of Object.keys(customFileIcons)) {
      delete customFileIcons[key];
    }
    for (const key of Object.keys(customFileIconPaths)) {
      delete customFileIconPaths[key];
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem(this.FILE_ICONS_KEY);
    }
  }

  openThemePrompt(): void {
    this.themePromptOpen = true;
    this.themePromptError = null;
    this.themePromptResult = null;
  }

  closeThemePrompt(): void {
    if (this.themePromptLoading) {
      return;
    }
    this.themePromptOpen = false;
    this.themePromptError = null;
  }

  async submitThemePrompt(): Promise<void> {
    const trimmedPrompt = this.themePromptText.trim();
    if (!trimmedPrompt) {
      this.themePromptError = 'Tell me how you feel or describe the style you want, and I will create a matching theme for you.';
      return;
    }
    await this.generateThemeFromPrompt(trimmedPrompt);
  }

  private getThemeSystemPrompt(): string {
    return `
You are a UI theme generation assistant. You MUST open your response with a single JSON code block containing ALL theme, typography, and file icon data. Do not output any other text before the JSON block.

RESPONSE FORMAT (MANDATORY): Open your response with a JSON code block wrapped in triple backticks with "json" language identifier, in exactly this format:

\`\`\`json
{
  "colors": {
    "background": "#1e1e1e",
    "primary": "#007acc",
    "text": "#cccccc",
    "surface": "#252526",
    "accent": "#0097fb",
    "border": "#3c3c3c"
  },
  "typography": {
    "fontFamily": "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    "fontSize": "14px",
    "fontWeight": "400",
    "lineHeight": "1.5",
    "monoFont": "'Courier New', monospace",
    "codeFontSize": "13px",
    "headingFont": "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    "headingWeight": "600",
    "labelSize": "13px",
    "labelWeight": "400",
    "inputSize": "14px",
    "buttonSize": "14px",
    "buttonWeight": "500",
    "menuSize": "13px",
    "tabSize": "13px",
    "treeSize": "13px",
    "badgeSize": "11px",
    "smallSize": "12px"
  },
  "googleFonts": ["Inter", "JetBrains Mono"],
  "radius": {
    "sm": "4px",
    "md": "8px",
    "lg": "16px"
  },
  "shadow": {
    "sm": "0 2px 8px rgba(0,0,0,0.1)",
    "md": "0 8px 24px rgba(0,0,0,0.15)",
    "lg": "0 18px 50px rgba(0,0,0,0.22)"
  },
  "motion": {
    "duration": "0.3s",
    "easing": "ease"
  },
  "bgGradient": "linear-gradient(135deg, rgba(102,126,234,0.12) 0%, transparent 50%, rgba(251,168,31,0.08) 100%)",
  "editorBgGradient": "linear-gradient(135deg, rgba(110,130,230,0.08) 0%, transparent 60%)",
  "themeIcon": "M12 2C6.48 2...",
  "fileIcons": [
    {
      "extension": "js",
      "iconId": "icon-file-js",
      "svgPath": "M...Z"
    }
  ]
}
\`\`\`

For colors: provide all 6 values in hex format (e.g., #1e1e1e) that match the user's described theme mood or style. The colors object must contain background, primary, text, surface, accent, border.

For typography: generate font styles that match the user's described mood or style. If using non-web-safe fonts, add the font name to the googleFonts array.
- fontFamily: primary interface font stack (prefer web-safe or Google Fonts as first choice)
- fontSize: base font size (typically 14px)
- fontWeight: base text weight (typically 400)
- lineHeight: base line height (typically 1.5)
- monoFont: monospace font stack for code
- codeFontSize: code/terminal font size (typically 13px)
- headingFont: heading font family (can differ from body)
- headingWeight: heading font weight (typically 600)
- labelSize / labelWeight: UI label font size/weight
- inputSize: input field font size
- buttonSize / buttonWeight: button font size/weight
- menuSize: menu item font size
- tabSize: tab label font size
- treeSize: file tree item font size
- badgeSize: badge/label font size
- smallSize: secondary text font size

For googleFonts: if any typography fontFamily/monoFont/headingFont uses a Google Font (e.g., Inter, Roboto, Noto Sans, JetBrains Mono, Fira Code, IBM Plex Mono, Playfair Display, etc.), list the exact font name in this array. Only include the primary font name, not the full font stack. Do NOT list system/web-safe fonts (Arial, Georgia, Times New Roman, Courier New, etc.).

For radius: generate border-radius values (px units) that match the user's described mood, emotion, or style. Provide 3 values:
- sm: small radius for small UI elements (scrollbar, badges, tree items, progress bar). Range: 2px-8px.
- md: medium radius for buttons, inputs, select menus, modals. Range: 4px-16px.
- lg: large radius for panels, dialogs, cards. Range: 8px-24px.
The pill value (9999px) is fixed and should not be included. Match the emotional mood: intense/angry/tech styles use sharper corners (sm:2, md:4, lg:8), calm/soft/friendly styles use rounder corners (sm:6, md:12, lg:20), balanced/professional styles use moderate values (sm:4, md:8, lg:16).

For shadow: generate box-shadow values (full CSS value string) for 3 elevation levels that match the user's described mood, emotion, or style. Each value should be a valid CSS box-shadow string (e.g., "0 2px 8px rgba(0,0,0,0.1)").
- sm: small elevation for menus, dropdowns, cards on hover
- md: medium elevation for modals, floating windows
- lg: large elevation for dialogs, panels, overlays
Match the emotional mood: flat/minimal styles use no or very subtle shadows (small offset, low opacity), deep/pronounced styles use larger offsets and blur with higher opacity, playful/creative styles can use colored shadows (e.g., rgba with a tint). Use rgba(0,0,0,X) as the default color.

For motion: generate duration and easing values that match the user's described mood, emotion, or style. These control all UI transitions and animations (panel fade-ins, hover effects, progress bar).
- duration: CSS transition/animation duration string. Range: 0.1s (instant/snappy) to 0.8s (slow/deliberate). Default: 0.3s.
- easing: CSS easing function string. One of "ease", "ease-in-out", "ease-out", "ease-in", "linear", or a cubic-bezier(...) value. Default: "ease".
Match the emotional mood: energetic/playful styles use shorter durations (0.15s-0.2s) with ease-out or bounce-like cubic-bezier; calm/professional styles use moderate durations (0.2s-0.3s) with ease; dramatic/emphatic styles use longer durations (0.4s-0.6s) with ease-out.

For bgGradient: generate a CSS background-image value (gradient) that adds a subtle ambient color wash to the application background. This is applied as an overlay on top of the solid background color. Recommended to use high transparency (alpha ≤ 0.15) for subtlety. The value must be a valid CSS gradient function: linear-gradient(...), radial-gradient(...), conic-gradient(...), or a comma-separated combination.
- Use rgba() with alpha ≤ 0.15 for color stops to keep the effect subtle
- Include at least one transparent or very low opacity stop to blend with the solid background
- Optionally, use multiple gradient layers separated by commas
If the user's mood does not suggest a gradient (e.g., "minimal", "clean", "professional"), set this to an empty string to omit.
Mood mapping: calm/peaceful → warm-toned subtle gradients; cold/tech-focused → blue-purple tones; playful/creative → multi-color diagonal gradients; intense/dark → very dark subtle radial gradients; minimal → no gradient (empty string).

For editorBgGradient: same rules as bgGradient, but applied specifically to the code editor background (CodeMirror editor view, markdown preview panel, and shadow DOM preview). This allows the editor area to have a distinct gradient from the body background. If omitted, the editor uses the solid --vscode-editor-background. Recommended alpha ≤ 0.08 for editor since it is a reading/editing surface.

For themeIcon: provide a single SVG path d attribute for a 24x24 icon that represents the emotion, mood, or feeling of the user's description (e.g., fire for anger, heart for love, sun for happy, cloud for sad, leaf for calm). Use fill="currentColor".

Include ALL of these extensions in fileIcons: js, ts, json, html, css, py, md, vue, go, rs, java, cpp, php, rb, sql, yaml, sh, bat, txt, csv, lock, env, git, png, jpg, svg, pdf, zip.

For each fileIcons entry:
- extension: the file extension without dot
- iconId: choose from icon-file-js, icon-file-ts, icon-file-json, icon-file-html, icon-file-css, icon-file-py, icon-file-md, icon-file-go, icon-file-rs, icon-file-vue, icon-file-sql, icon-file-txt, icon-file-xml, icon-file-sh, icon-file-pdf, icon-file-zip, icon-file-lock, icon-file-git, icon-file-env, icon-file-rb, icon-file-cpp, icon-file-java, icon-file-csv, icon-file-php, icon-file-bat
- svgPath: SVG path d attribute for a 24x24 icon. Use fill="currentColor". The paths should reflect both the file type and the user's described mood or emotion. For example, a "calm" mood should use softer, rounded paths; an "angry" or "intense" mood should use sharp, angular paths; a "playful" mood should use organic, curved shapes. Prefer using the file extension text string, its abbreviation, or related file type characteristics as the basis for svgPath generation.
`;
  }

  private async generateThemeFromPrompt(prompt: string): Promise<void> {
    this.themePromptLoading = true;
    this.themePromptError = null;
    this.themePromptResult = null;
    const systemPrompt = this.getThemeSystemPrompt();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: prompt,
          model: 'deepseek-v4-flash',
          history: [],
          system: systemPrompt,
          autoCreate: true,
        }),
        credentials: 'include',
      });

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取数据流');
      }

      const decoder = new TextDecoder();
      let assistantText = '';
      let done = false;

      while (!done) {
        const result = await reader.read();
        if (result.done) {
          break;
        }

        const chunk = decoder.decode(result.value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data:')) {
            continue;
          }

          const data = line.slice(6).trim();
          if (!data) {
            continue;
          }
          if (data === '[DONE]') {
            done = true;
            break;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              assistantText += parsed.content;
            }

            if (parsed.sessionId) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (window as any).currentSessionId = parsed.sessionId;
            }
          } catch {
            // ignore invalid JSON fragments
          }
        }
      }

      if (!response.ok) {
        throw new Error(`请求失败 ${response.status}，请稍后重试`);
      }

      console.log('生成主题成功', assistantText);
      const result = this.parseUnifiedThemeContent(assistantText);

      if (!result) {
        throw new Error('未能从响应中解析出主题变量');
      }

      const { cssVars: rawVars, googleFonts } = result;
      const cssVars = this.mapThemeKeysToCss(rawVars);

      if (!cssVars || Object.keys(cssVars).length === 0) {
        throw new Error('未能从响应中解析出主题变量');
      }

      this.themeService.setTheme('custom');
      this.themeService.setThemeVariables(cssVars);

      // Load Google Fonts if needed
      if (googleFonts.length > 0) {
        this.themeService.loadGoogleFonts(googleFonts);
      }

      if (Object.keys(customFileIcons).length > 0) {
        const content = this.contentComp();
        if (content) {
          const data = content.dataList();
          computeFileIcons(data);
          content.dataList.set([...data]);
        }
      }

      this.themePromptResult = cssVars;
      this.themePromptOpen = false;
    } catch (err: any) {
      console.error('生成主题失败', err);
      this.themePromptError = err?.message || '生成主题失败，请重试';
    } finally {
      this.themePromptLoading = false;
    }
  }

  private parseUnifiedThemeContent(text: string): { cssVars: Record<string, string>; googleFonts: string[] } | null {
    const jsonBlockRegex = /```json\s*(\{[\s\S]*?\})\s*```/g;
    const match = jsonBlockRegex.exec(text);
    if (!match) return null;

    let parsed: any;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      return null;
    }

    // Process file icons
    const icons = parsed.fileIcons;
    if (Array.isArray(icons)) {
      for (const entry of icons) {
        if (!entry.extension || !entry.svgPath) continue;
        const ext = String(entry.extension).toLowerCase().replace(/^\./, '');
        const symbolId = addDynamicFileIconSymbol(ext, entry.svgPath);
        customFileIcons[ext] = symbolId;
        customFileIconPaths[ext] = entry.svgPath;
      }
      if (Object.keys(customFileIcons).length > 0) {
        this.saveFileIcons();
      }
    }

    // Process theme icon
    if (parsed.themeIcon && typeof parsed.themeIcon === 'string') {
      this.themeIconPath.set(parsed.themeIcon);
      this.saveThemeIcon();
    }

    // Process colors
    const colors = parsed.colors;
    if (!colors || typeof colors !== 'object') return null;

    const cssVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(colors)) {
      if (typeof value === 'string' && value.trim()) {
        cssVars[key.trim()] = value.trim();
      }
    }

    // Process typography
    const typography = parsed.typography;
    if (typography && typeof typography === 'object') {
      const typoCssVars = this.mapTypographyToCss(typography);
      Object.assign(cssVars, typoCssVars);
    }

    // Process radius
    const radius = parsed.radius;
    if (radius && typeof radius === 'object') {
      const radiusCssVars = this.mapRadiusToCss(radius);
      Object.assign(cssVars, radiusCssVars);
    }

    // Process shadow
    const shadow = parsed.shadow;
    if (shadow && typeof shadow === 'object') {
      const shadowCssVars = this.mapShadowToCss(shadow);
      Object.assign(cssVars, shadowCssVars);
    }

    // Process motion
    const motion = parsed.motion;
    if (motion && typeof motion === 'object') {
      const motionCssVars = this.mapMotionToCss(motion);
      Object.assign(cssVars, motionCssVars);
    }

    // Process bgGradient
    if (parsed.bgGradient && typeof parsed.bgGradient === 'string' && parsed.bgGradient.trim()) {
      const bgGradientCssVars = this.mapBgGradientToCss(parsed.bgGradient.trim());
      Object.assign(cssVars, bgGradientCssVars);
    }

    // Process editorBgGradient
    if (parsed.editorBgGradient && typeof parsed.editorBgGradient === 'string' && parsed.editorBgGradient.trim()) {
      const editorBgGradientCssVars = this.mapEditorBgGradientToCss(parsed.editorBgGradient.trim());
      Object.assign(cssVars, editorBgGradientCssVars);
    }

    // Process googleFonts
    const googleFonts: string[] = [];
    if (Array.isArray(parsed.googleFonts)) {
      for (const name of parsed.googleFonts) {
        if (typeof name === 'string' && name.trim()) {
          googleFonts.push(name.trim());
        }
      }
    }

    return Object.keys(cssVars).length > 0 ? { cssVars, googleFonts } : null;
  }

  private mapThemeKeysToCss(themeVars: Record<string, string>): Record<string, string> {
    const keyMap: Record<string, string[]> = {
      background: [
        '--vscode-background',
        '--vscode-editor-background',
        '--vscode-panel-background',
        '--vscode-input-background',
        '--vscode-titleBar-activeBackground',
        '--vscode-titleBar-inactiveBackground',
        '--vscode-scrollbar-track',
        '--vscode-editorWidget-background',
        '--vscode-tabborder-background',
      ],
      surface: [
        '--vscode-sideBar-background',
        '--vscode-activityBar-background',
        '--vscode-tab-inactiveBackground',
        '--vscode-tab-activeBackground',
        '--vscode-list-inactiveSelectionBackground',
        '--vscode-list-hoverBackground',
        '--vscode-panel-background',
        '--vscode-editorWidget-background',
        '--vscode-input-background',
      ],
      primary: [
        '--vscode-button-background',
        '--vscode-statusBar-background',
        '--vscode-activityBarBadge-background',
        '--vscode-list-activeSelectionBackground',
        '--vscode-tab-activeBackground',
      ],
      text: [
        '--vscode-foreground',
        '--vscode-button-foreground',
        '--vscode-activityBar-foreground',
        '--vscode-activityBarBadge-foreground',
        '--vscode-list-activeSelectionForeground',
        '--vscode-icon-foreground',
        '--vscode-statusBar-foreground',
      ],
      accent: [
        '--vscode-focusBorder',
        '--vscode-textLink-foreground',
        '--vscode-textLink-activeForeground',
        '--vscode-list-hoverBackground',
        '--vscode-text-selectionBackground',
      ],
      border: [
        '--vscode-editorGroup-border',
        '--vscode-input-border',
        '--vscode-tab-border',
        '--vscode-textSeparator-foreground',
        '--vscode-tabborder-background',
      ],
    };

    const cssVars: Record<string, string> = {};

    for (const [key, value] of Object.entries(themeVars)) {
      // Keys already prefixed with --vscode- (typography, radius, shadow, motion, gradients)
      // pass through directly without remapping
      if (key.startsWith('--vscode-')) {
        cssVars[key] = value;
        continue;
      }

      const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '');
      let canonical = '';

      if (['uibackground', 'background'].includes(normalizedKey)) canonical = 'background';
      else if (['uiprimarycolor', 'primarycolor', 'primary'].includes(normalizedKey)) canonical = 'primary';
      else if (['uitextcolor', 'textcolor', 'text'].includes(normalizedKey)) canonical = 'text';
      else if (['uisurface', 'surface'].includes(normalizedKey)) canonical = 'surface';
      else if (['uiaccent', 'accent'].includes(normalizedKey)) canonical = 'accent';
      else if (['uiborder', 'border'].includes(normalizedKey)) canonical = 'border';

      if (canonical && keyMap[canonical]) {
        for (const cssVar of keyMap[canonical]) {
          cssVars[cssVar] = value;
        }
      }
    }

    return cssVars;
  }

  private mapTypographyToCss(typography: Record<string, string>): Record<string, string> {
    const keyMap: Record<string, string[]> = {
      fontFamily: ['--vscode-font-family'],
      fontSize: ['--vscode-font-size'],
      fontWeight: ['--vscode-font-weight'],
      lineHeight: ['--vscode-line-height'],
      monoFont: ['--vscode-font-mono', '--vscode-terminal-font-family'],
      codeFontSize: ['--vscode-code-font-size', '--vscode-terminal-font-size'],
      headingFont: ['--vscode-heading-font-family'],
      headingWeight: ['--vscode-heading-font-weight'],
      labelSize: ['--vscode-label-font-size'],
      labelWeight: ['--vscode-label-font-weight'],
      inputSize: ['--vscode-input-font-size'],
      buttonSize: ['--vscode-button-font-size'],
      buttonWeight: ['--vscode-button-font-weight'],
      menuSize: ['--vscode-menu-font-size'],
      tabSize: ['--vscode-tab-font-size'],
      treeSize: ['--vscode-tree-font-size'],
      badgeSize: ['--vscode-badge-font-size'],
      smallSize: ['--vscode-small-font-size'],
    };

    const cssVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(typography)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const normalizedKey = key.replace(/[\s_-]/g, '');
      const targets = keyMap[normalizedKey];
      if (targets) {
        for (const cssVar of targets) {
          cssVars[cssVar] = value;
        }
      }
    }
    return cssVars;
  }

  private mapShadowToCss(shadow: Record<string, string>): Record<string, string> {
    const keyMap: Record<string, string[]> = {
      sm: ['--vscode-shadow-sm'],
      md: ['--vscode-shadow-md'],
      lg: ['--vscode-shadow-lg'],
    };

    const cssVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(shadow)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const targets = keyMap[key];
      if (targets) {
        for (const cssVar of targets) {
          cssVars[cssVar] = value;
        }
      }
    }
    return cssVars;
  }

  private mapRadiusToCss(radius: Record<string, string>): Record<string, string> {
    const keyMap: Record<string, string[]> = {
      sm: ['--vscode-radius-sm'],
      md: ['--vscode-radius-md'],
      lg: ['--vscode-radius-lg'],
      pill: ['--vscode-radius-pill'],
    };

    const cssVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(radius)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const targets = keyMap[key];
      if (targets) {
        for (const cssVar of targets) {
          cssVars[cssVar] = value;
        }
      }
    }
    return cssVars;
  }

  private mapMotionToCss(motion: Record<string, string>): Record<string, string> {
    const keyMap: Record<string, string[]> = {
      duration: ['--vscode-motion-duration'],
      easing: ['--vscode-motion-easing'],
    };

    const cssVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(motion)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const targets = keyMap[key];
      if (targets) {
        for (const cssVar of targets) {
          cssVars[cssVar] = value;
        }
      }
    }
    return cssVars;
  }

  private mapBgGradientToCss(bgGradient: string): Record<string, string> {
    return {
      '--vscode-bg-gradient': bgGradient,
    };
  }

  private mapEditorBgGradientToCss(editorBgGradient: string): Record<string, string> {
    return {
      '--vscode-editor-bg-gradient': editorBgGradient,
    };
  }

  onCloseTab(evt: any) {
    let currentIndex = 0;
    let currentActived = evt.isActivated;
    for (let index = 0; index < this.openedList.length; index++) {
      if (this.openedList[index].id == evt.id) {
        currentIndex = index;
        this.openedList[currentIndex]["isActive"] = false;
        this.openedList.splice(index, 1);
        break;
      }
    }
    if(currentActived) { //关闭的tab是激活状态，则需要激活其他tab
      if (evt.isFirst) {
        if (this.openedList.length >= 1) {
          this.openedList[0]["isActive"] = true;
          this.activeMainPanel(this.openedList[0]);
        }
      } else if (evt.isLast) {
        if (this.openedList.length >= 1) {
          this.openedList[this.openedList.length - 1]["isActive"] = true;
          this.activeMainPanel(this.openedList[this.openedList.length - 1]);
        }
      } else {
        this.openedList[currentIndex]["isActive"] = true;//close的不是第一个也不是最后一个，则激活后一个， 即中间的某一个
        this.activeMainPanel(this.openedList[currentIndex]);
      }
    }
  }

  onClickTab(evt: any) {
    for (let index = 0; index < this.openedList.length; index++) {
      if (this.openedList[index].id == evt.id) {
        this.openedList[index]["isActive"] = true
      } else {
        this.openedList[index]["isActive"] = false
      }
    }

    this.activeMainPanel(evt);
  }

  /**
   * 激活主面板对应的侧边栏tab
   * @param evt 
   */
  private activeMainPanel(evt: any) {
    const id = evt.id;
    switch (id) {
      case 'editor':
        this.currentDisplayViewId = 1;
        this.lastSelectedDisplayViewId = this.currentDisplayViewId;
        break;
      case 'settings':
        this.currentDisplayViewId = 5;
        this.lastSelectedDisplayViewId = this.currentDisplayViewId;
        break;
      case 'profile':
        this.currentDisplayViewId = 6;
        this.lastSelectedDisplayViewId = this.currentDisplayViewId;
        break;
    }
  }

  onExplorerClickTab(evt: any) {

  }

  async addTexts() {
    // this.textArr.push("abcdd")
    // this.textArr.push("abcddf")
    // this.textArr.push("abcdde")
    await 1;
  }

  toggleDisplayViewId(currentDisplayViewId: number) {
    if (currentDisplayViewId == this.lastSelectedDisplayViewId) {
    } else {
      if(currentDisplayViewId != 4) {
        if (currentDisplayViewId === 5 || currentDisplayViewId === 6) {
          this.previousViewId = this.currentDisplayViewId;
        }
        this.currentDisplayViewId = currentDisplayViewId;
        this.lastSelectedDisplayViewId = currentDisplayViewId;
      }

      switch (currentDisplayViewId) {
        case 1:
          break;
        case 2:
          break;
        case 3:
          break;
        case 4:
          const contentComp = this.contentComp();
          if(contentComp) {
            contentComp.openTab({
              id: 'api-community',
              type: 'api-community',
              label: 'Community'
            });
            contentComp.storeOpenedList();
          }
          break;
        case 5:
          const settingBar: any = {
            id: 'settings',
            title: 'Settings'
          };
          this.openTab(settingBar);
          break;
        case 6:
          const profileBar: any = {
            id: 'profile',
            title: 'Profile'
          };
          this.openTab(profileBar);
          break;
      }
    }
    if(currentDisplayViewId == 5 || currentDisplayViewId == 6) {
      this.closeMenu();
    }
  }

  onGoBack(viewId: number) {
    this.currentDisplayViewId = viewId;
    this.lastSelectedDisplayViewId = viewId;
  }

  toggleAstContentPanel() {
    this.astContentPanelOpen = !this.astContentPanelOpen;
    localStorage.setItem(this.AST_CONTENT_PANEL_OPEN_KEY, String(this.astContentPanelOpen));
    if(!this.astContentPanelOpen) {
      this.previousLeftPct = this.leftPct;
      this.leftPct = 0;
    } else {
      this.leftPct = this.previousLeftPct;
    }
    this.saveLeftPct();
    this.refreshAgentPanelWidth();
  }

  toggleAgentPanel() {
    this.agentPanelOpen = true;
    localStorage.setItem(this.ACP_PANEL_OPEN_KEY, String(this.agentPanelOpen));
  }

  closeAcpPanel() {
    this.agentPanelOpen = false;
    localStorage.setItem(this.ACP_PANEL_OPEN_KEY, 'false');
  }

  onDockPositionChange(position: 'left' | 'right') {
    this.dockPosition = position;
    localStorage.setItem(this.ACP_DOCK_POSITION_KEY, position);
  }

  // Method to open a new terminal tab
  toggleTerminal(): void {
    if(!this.keepTerminalInstance.value) {
      this.keepTerminalInstance.value = true;
    }
    if(this.terminalPanelShow) {
      this.terminalPanelShow = false;
      this.topPct = 1;
    } else {
      this.terminalPanelShow = true;
      this.topPct = 0.75;
      if(this.keepTerminalInstance.value) {
        this.topPct = this.keepTerminalInstance.topPct;
      }
      // 新增：首次打开时自动添加一个终端tab
      if(this.terminalOpenedList.length === 0) {
        this.terminalOpenedList.push({
          id: 'terminal-' + Date.now(),
          title: '终端',
          isClosable: true,
          isActive: true,
          symbol: '>',
          saved: true
        });
      }
    }
  }


  private openTab(targetTab: any) {
    let oldTab = false;
    for (const item of this.openedList) {
      delete item["isActive"];
      if (item.id == targetTab.id) {
        item["isActive"] = true;
        oldTab = true;
      }
    }
    if (!oldTab) {
      targetTab["isActive"] = true;
      this.openedList.push(targetTab);
    }
  }

  closeMenu() {
    this.blurSwitch = true;
    this.isOpen = false;
  }

  toggleMenu(evt: MouseEvent) {
    if (this.isMenuOpen) {
      this.isMenuOpen = false;
    } else {
      this.menuAnchor = (evt.currentTarget as HTMLElement).getBoundingClientRect();
      this.isMenuOpen = true;
    }
  }

  onMenuAction(action: string) {
    this.isMenuOpen = false;
    this.fileSubmenuRef?.resetState();
    this.viewSubmenuRef?.resetState();
    switch (action) {
      case 'new-file': {
        const contentComp = this.contentComp();
        if (contentComp) {
          contentComp.openTab({
            id: 'untitled-' + Date.now(),
            type: 'untitled',
            label: 'Untitled'
          });
          contentComp.storeOpenedList();
        }
        break;
      }
      case 'open-file':
        this.toggleDisplayViewId(1);
        break;
      case 'open-folder':
        this.contentComp()?.openFolderInContent('readwrite');
        break;
      case 'close-folder':
        this.contentComp()?.closeFolder();
        this.acpService.workingDirHint.set('');
        if (this.acpService.sessionState().isConnected) {
          this.acpService.disconnect();
        }
        break;
      case 'import-api':
        this.toggleDisplayViewId(1);
        break;
      case 'search':
        this.toggleDisplayViewId(2);
        break;
      case 'terminal':
        this.toggleTerminal();
        break;
      case 'theme-prompt':
        this.openThemePrompt();
        break;
      case 'settings':
        this.toggleDisplayViewId(5);
        break;
      case 'profile':
        this.toggleDisplayViewId(6);
        break;
      case 'sign-in':
        this.redirectToLogin('/assistant');
        break;
      case 'sign-out':
        this.handleSignOut();
        break;
    }
  }

  closeAppMenu() {
    this.isMenuOpen = false;
  }

  onMenuMouseEnter() {
    this.blurSwitch = false;
  }

  onMenuMouseLeave() {
    this.blurSwitch = true;
  }

  clickMoreBtn(evt: any) {
    if (!this.isOpen) {
      this.isOpen = !this.isOpen;
      this.menuInitiator = evt.target.getBoundingClientRect();
    }
  }

  blurMoreBtn(evt: any) {
    let me = this;
    if (me.blurSwitch) {
      me.isOpen = false;
    }
  }

  mouseentermenu(evt: any) {
    this.blurSwitch = false;
  }

  mouseleavemenu(evt: any) {
    this.blurSwitch = true;
  }

  redirectToLogin(targetUrl?: string) {
    // 默认保存当前页面路径（去掉域名）
    const from = targetUrl || window.location.pathname + window.location.search;

    // 存入 sessionStorage（关闭标签页失效，比 localStorage 更安全）
    sessionStorage.setItem('redirect_after_login', from);

    // 跳转到登录页
    window.location.href = '/signin';
  }

  async handleSignOut() {
    // Clear any stored user data
    localStorage.clear();
    sessionStorage.clear();
    this.closeMenu();
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include' // 确保发送 Cookie
      });

      // 清除前端状态（如 Zustand / Redux / Context）
      // clearAuthState();

      // 跳转到登录页
      // window.location.href = '/signin'; // 或使用 navigate('/signin')
      this.coreService.isAuthenticated.set(false);
    } catch (error) {
      console.error('Logout failed:', error);
      // 即使失败也跳转（Cookie 已由后端清除）
      window.location.href = '/signin';
      this.coreService.isAuthenticated.set(false);
    }
  }

  // 添加上传任务的方法（供外部调用）
  addUploadTask(fileName: string): string {
    return this.coreService.addUploadTask(fileName);
  }

  // 更新上传任务进度的方法（供外部调用）
  updateUploadProgress(taskId: string, progress: number): void {
    this.coreService.updateUploadProgress(taskId, progress);
  }

  // 标记上传任务为失败
  failUploadTask(taskId: string): void {
    this.coreService.failUploadTask(taskId);
  }

  // 移除上传任务
  removeUploadTask(taskId: string): void {
    this.coreService.removeUploadTask(taskId);
  }

  async cleanUp() {
    await file('/dir/file.txt').remove();
    await file('/dir/openedList.txt').remove();
  }

  onHandleDataListChange(dataList: Array<any>): void {
    this.dataList = dataList;
    if (dataList.length > 0) {
      const docObj = dataList[0];
      setTimeout(() => {
        // this.terminalBtnShow = !docObj.isLocked;
      }, 0);
    }
  }

  /**
   * 关闭终端Tab
   */
  onCloseTerminalTab(evt: any) {
    let currentIndex = 0;
    let currentActived = evt.isActivated;
    for (let index = 0; index < this.terminalOpenedList.length; index++) {
      if (this.terminalOpenedList[index].id == evt.id) {
        currentIndex = index;
        this.terminalOpenedList[currentIndex]["isActive"] = false;
        this.terminalOpenedList.splice(index, 1);
        break;
      }
    }
    if(this.terminalOpenedList.length == 0) {
      this.terminalPanelShow = false;
      this.topPct = 1;
      this.keepTerminalInstance.value = false;
      this.keepTerminalInstance.topPct = 0.75;
    }
    if (currentActived) {
      if (evt.isFirst) {
        if (this.terminalOpenedList.length >= 1) {
          this.terminalOpenedList[0]["isActive"] = true;
        }
      } else if (evt.isLast) {
        if (this.terminalOpenedList.length >= 1) {
          this.terminalOpenedList[this.terminalOpenedList.length - 1]["isActive"] = true;
        }
      } else {
        this.terminalOpenedList[currentIndex]["isActive"] = true;
      }
    }
  }

  /**
   * 激活终端Tab
   */
  onClickTerminalTab(evt: any) {
    for (let index = 0; index < this.terminalOpenedList.length; index++) {
      if (this.terminalOpenedList[index].id == evt.id) {
        this.terminalOpenedList[index]["isActive"] = true;
      } else {
        this.terminalOpenedList[index]["isActive"] = false;
      }
    }
  }

  /**
   * 新建终端Tab
   */
  onAddNewTerminalTab(evt?: any) {
    // 先全部设为非激活
    this.terminalOpenedList.forEach(tab => tab.isActive = false);
    // 新建tab
    const newTab = {
      id: 'terminal-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      title: '终端',
      isClosable: true,
      isActive: true,
      symbol: '>',
      saved: true
    };
    this.terminalOpenedList.push(newTab);
  }

  /**
   * 断开所有终端连接
   */
  disconnectAllTerminals(): void {
    // 关闭终端面板
    this.terminalPanelShow = false;
    this.topPct = 1;
    this.keepTerminalInstance.value = false;
    this.keepTerminalInstance.topPct = 0.75;
    // 清空终端列表
    this.terminalOpenedList = [];
    // 清空dataList，防止重新打开终端时连接到原项目
    this.dataList = [];
  }

  protected override getDefaultLeftPct(): number {
    // getDefaultLeftPct() 在基类构造函数（super()）期间即被调用，
    // 此时实例字段尚未初始化，因此必须使用 static 常量 + 直接读 localStorage。
    const saved = typeof localStorage !== 'undefined'
      ? parseFloat(localStorage.getItem(AppComponent.ACP_LEFT_PCT_STORAGE_KEY) ?? '')
      : NaN;
    if (Number.isFinite(saved) && saved >= 0 && saved <= 1) {
      return saved;
    }
    return 0.75;
  }

  private previousLeftPct: number = this.getDefaultLeftPct();

  maximizeAcpPanel() {
    this.previousLeftPct = this.leftPct;
    this.leftPct = 0;
    this.saveLeftPct();
    this.refreshAgentPanelWidth();
  }

  restoreAcpPanel() {
    this.leftPct = this.previousLeftPct;
    this.saveLeftPct();
    this.refreshAgentPanelWidth();
  }

  override dragEnd(evt: any) {
    super.dragEnd(evt);
    this.saveLeftPct();
  }

  private saveLeftPct(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.ACP_LEFT_PCT_KEY, String(this.leftPct));
      localStorage.setItem(this.ACP_PREVIOUS_LEFT_PCT_KEY, String(this.previousLeftPct));
    }
  }

  override whenMouseMove(evt: any) {
    if (this.active) {
      evt.preventDefault();
      if (this._dragDirection === 'vertical') {
        // terminal panel position calculation
        super.whenMouseMove(evt);
        this.keepTerminalInstance.topPct = this.topPct;
      } else {
        // agent panel position calculation
        this.leftPct = this.getHorizontalPct(evt);
        this.refreshAgentPanelWidth();
      }
    }
  }

  private getHorizontalPct(evt: MouseEvent): number {
    const baseWidth = this.hostEl.nativeElement.clientWidth;
    const usable = baseWidth - this.leftSideAreaWidth - 15;
    if (this.dockPosition === 'left') {
      return 1 - (evt.clientX - this.leftSideAreaWidth) / usable;
    }
    return 1 - (baseWidth - evt.clientX - 4) / usable;
  }

  /**
   * indicatorDetailType: 
   * 1 - notification
   * 2 - saving
   * 3 - progress
   * none - close the detail panel
   * 
   * @param indicatorDetailType
   */
  toggleIndicatorDetailPanel(indicatorDetailType: number | 'none') {
    this.indicatorDetailType = indicatorDetailType;
  }

  testSurface() {
    this.testSurfaceComponent = !this.testSurfaceComponent;
  }

  protected async handleSubmit(event: SubmitEvent) {
    event.preventDefault();

    if (!(event.target instanceof HTMLFormElement)) {
      return;
    }

    const data = new FormData(event.target);
    const body = data.get('body') ?? null;

    if (body) {
      // this.startLoadingAnimation();
      const message = body as Types.A2UIClientEventMessage | string;
      // this.hasData.set(true);
      await this.client.makeRequest(message);
      // this.stopLoadingAnimation();
    }
  }
}