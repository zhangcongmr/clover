import { HttpClient } from '@angular/common/http';
import { AfterViewInit, Component, ElementRef, Injector, OnDestroy, OnInit, afterNextRender, inject, runInInjectionContext, signal, viewChild, ViewChild, computed } from '@angular/core';
import { Integer, Sequence, Utf8String } from 'asn1js';
import { ConfigService, CoreService } from './core.service';
import { AstTabComponent } from './shared/ast-tab/ast-tab.component';
import { AstTabGroupComponent } from './shared/ast-tab/ast-tab-group/ast-tab-group.component';
import { ContentComponent } from './main/content/content.component';
import { AstMenuComponent } from './shared/ast-menu/ast-menu.component';
import { AstSubmenuComponent } from './shared/ast-menu/ast-submenu.component';
import { SettingsComponent } from './main/settings/settings.component';
import { UserCenterComponent } from './main/user-center/user-center.component';
import { file } from 'opfs-tools';
import { ThemeService } from './theme.service';
import { ThemeLibraryService } from './theme-library.service';
import { customFileIcons, customFileIconPaths } from './shared/ast-tree/ast-tree.component';
import { computeFileIcons } from './shared/ast-tree/ast-tree.component';
import { addDynamicFileIconSymbol } from '../svg-sprite.const';
import { NotificationComponent } from './shared/notification/notification.component';
import { TerminalComponent } from './shared/terminal/terminal.component'; // Import the terminal component
import { AcpService } from './shared/acp/acp.service';
import { BUILT_IN_SKILLS } from './shared/skill-manager/built-in-skills';
import { buildThemePrompt, randomThemePromptSeed, THEME_SKILL_NAME } from './shared/skill-manager/built-in/theme-prompt-seeds';
import { NotificationService } from './shared/notification/notification.service';
import { AstDraggableComponent } from './shared/ast-draggable/ast-draggable.component';
import { DatePipe } from '@angular/common';
import { AgentComponent } from './main/agent-ui/agent';
import { KeepAliveDirective } from './shared/keep-alive.directive';
import { LayoutService } from './main/layout.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: true,
    imports: [UserCenterComponent, SettingsComponent, AstMenuComponent, AstSubmenuComponent, AstTabGroupComponent,
      AstTabComponent, ContentComponent, NotificationComponent, TerminalComponent, DatePipe,
        AgentComponent, KeepAliveDirective], // Add TerminalComponent to imports
})
export class AppComponent extends AstDraggableComponent implements OnInit, AfterViewInit, OnDestroy {
  protected coreService = inject(CoreService);
  protected themeService = inject(ThemeService);
  private themeLibrary = inject(ThemeLibraryService);
  protected notificationService = inject(NotificationService);
  protected acpService = inject(AcpService);
  protected layoutService = inject(LayoutService);
  contentComp = viewChild(ContentComponent);
  agentComp = viewChild(AgentComponent);
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
    if (!this.astContentPanelOpen()) {
      this.agentPanelWidthPx.set(baseWidth - leftArea);
      return;
    }
    this.agentPanelWidthPx.set((1 - this.leftPct) * (baseWidth - leftArea - 15));
  }
  
  title = 'clover';
  cloverAppTabId: any;
  textArr: Array<String> = []

  lastSelectedDisplayViewId: number = 1;
  currentDisplayViewId: number = 1;
  previousViewId: number = 1;
  astContentPanelOpen = computed(() => this.layoutService.astContentPanelOpen());
  /** astContentPanel open state before the ACP panel was maximized, restored on restore. */
  private previousAstContentPanelOpen = true;
  agentPanelOpen = true;
  dockPosition = computed(() => this.layoutService.dockPosition());
  terminalPanelShow = false;
  themeIconPath = signal<string | null>(null);
  private readonly THEME_ICON_KEY = 'vscode-theme-icon';
  private readonly FILE_ICONS_KEY = 'vscode-file-icons';
  private readonly ACP_PANEL_OPEN_KEY = 'clover_acp_panel_open';
  private static readonly  ACP_LEFT_PCT_KEY = 'clover_acp_left_pct';
  private readonly ACP_PREVIOUS_LEFT_PCT_KEY = 'clover_acp_previous_left_pct';
  /** Last theme style seed picked for the Generate Theme prompt (variety). */
  private lastThemeSeedLabel?: string;

  keepTerminalInstance = {
    value: false,
    topPct: 0.75,
  }

  /**
   * This property indicates the type of detail panel to show in the indicator panel. It can be one of the following values:
   */
  indicatorDetailType: number | 'none' = 'none'; // 1 - notification, 2 - saving, 3 - progress, 'none' - close the detail panel

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
          this.cloverAppTabId = val.id;
          chrome.storage.local.get(ConfigService.cloverAppTabIdList, (result: any) => {
            const cloverAppTabIdList = result[ConfigService.cloverAppTabIdList];
            if (!cloverAppTabIdList) {
              chrome.storage.local.set({ [ConfigService.cloverAppTabIdList]: [val.id] }, function () {
                // let us know it worked
                console.log("V3 Test: initialized test click counter to 0");
              });
            } else {
              if (cloverAppTabIdList.length >= 0 && !cloverAppTabIdList.includes(val.id)) {
                cloverAppTabIdList.push(val.id);
                chrome.storage.local.set({ [ConfigService.cloverAppTabIdList]: cloverAppTabIdList }, function () {
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
      const savedAstContentPanelOpen = localStorage.getItem(this.layoutService.AST_CONTENT_PANEL_OPEN_KEY);
      if (savedAstContentPanelOpen !== null) {
        this.layoutService.astContentPanelOpen.set(savedAstContentPanelOpen === 'true');
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

  onA2uiThemeApply(data: Record<string, any>) {
    try {
      this.applyToUI(data);
    } catch (err: any) {
      console.error('应用A2UI主题失败', err);
    }
  }

  private applyToUI(parsed: any) {
    const result = this.parseUnifiedThemeContent(parsed);

    if (!result) {
      throw new Error('未能从响应中解析出主题变量');
    }

    const { cssVars: rawVars, googleFonts } = result;
    const cssVars = this.themeService.mapThemeKeysToCss(rawVars);

    if (!cssVars || Object.keys(cssVars).length === 0) {
      throw new Error('未能从响应中解析出主题变量');
    }

    this.themeService.setTheme('custom');
    this.themeService.setThemeVariables(cssVars);

    // Keep the theme library's active highlight in sync when a generated
    // theme is applied from chat and it happens to be a saved library entry.
    if (typeof parsed?.title === 'string' && parsed.title.trim()) {
      this.themeLibrary.setActiveByTitle(parsed.title.trim());
    }

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
    return cssVars;
  }

  private parseUnifiedThemeContent(parsed: any): { cssVars: Record<string, string>; googleFonts: string[] } | null {
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

    // Process colors / typography / radius / shadow / motion / gradients
    const cssVars = this.themeService.parseThemeCssVars(parsed);
    if (Object.keys(cssVars).length === 0) return null;

    // Process googleFonts
    const googleFonts: string[] = [];
    if (Array.isArray(parsed.googleFonts)) {
      for (const name of parsed.googleFonts) {
        if (typeof name === 'string' && name.trim()) {
          googleFonts.push(name.trim());
        }
      }
    }

    return { cssVars, googleFonts };
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

  /** Settings → Appearance → custom theme: return to the assistant and load the
   *  Theme-generator skill into the chat input, prefilled with a complete,
   *  randomly seeded style prompt the user can send as-is or edit. */
  onGenerateCustomTheme() {
    const skill = BUILT_IN_SKILLS.find(s => s.name === THEME_SKILL_NAME);
    if (skill) {
      if (!this.agentPanelOpen) {
        this.agentPanelOpen = true;
        localStorage.setItem(this.ACP_PANEL_OPEN_KEY, 'true');
      }
      const seed = randomThemePromptSeed(this.lastThemeSeedLabel);
      this.lastThemeSeedLabel = seed.label;
      this.acpService.pendingSlashCommand.set(`/${THEME_SKILL_NAME} ${buildThemePrompt(seed)}`);
    }
    this.onGoBack(this.previousViewId);
    // Return the sidebar to a fresh task (same as clicking "New Task"), so the
    // injected slash command starts a new session instead of the previous one.
    Promise.resolve(this.agentComp()?.createNewTask()).then(() => {
      // createNewTask() is async and clears messages, which can swap the chat
      // input instance; re-apply the command so the final instance ends up
      // filled *and* focused. Skipped once the user edited or sent the text.
      const cmd = this.acpService.pendingSlashCommand();
      if (!cmd) return;
      // Already typing somewhere → don't yank focus/caret back.
      if (document.activeElement instanceof HTMLTextAreaElement) return;
      this.acpService.pendingSlashCommand.set(null);
      this.acpService.pendingSlashCommand.set(cmd);
    });
  }

  toggleAstContentPanel() {
    this.layoutService.toggleAstContentPanel();
    if (!this.layoutService.astContentPanelOpen()) {
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

  showUploadProgressDetails(): void {
    this.coreService.showNotification(this.coreService.progressDetails(), 'info');
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
      ? parseFloat(localStorage.getItem(AppComponent.ACP_LEFT_PCT_KEY) ?? '')
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

  onAgentPanelMaximize(): void {
    this.previousAstContentPanelOpen = this.astContentPanelOpen();
    if (this.astContentPanelOpen()) {
      this.toggleAstContentPanel();
    }
  }

  onAgentPanelRestore(): void {
    if (this.astContentPanelOpen() !== this.previousAstContentPanelOpen) {
      this.toggleAstContentPanel();
    }
  }

  onContentPanelMaximize(): void {
    this.agentPanelOpen = false;
    localStorage.setItem(this.ACP_PANEL_OPEN_KEY, 'false');
  }

  onContentPanelRestore(): void {
    this.agentPanelOpen = true;
    localStorage.setItem(this.ACP_PANEL_OPEN_KEY, 'true');
    this.refreshAgentPanelWidth();
  }

  override dragEnd(evt: any) {
    super.dragEnd(evt);
    this.saveLeftPct();
  }

  private saveLeftPct(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AppComponent.ACP_LEFT_PCT_KEY, String(this.leftPct));
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
    if (this.dockPosition() === 'left') {
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
}
