import { HttpClient } from '@angular/common/http';
import { AfterViewInit, Component, Injector, OnInit, afterNextRender, inject, viewChild } from '@angular/core';
import { Integer, Sequence, Utf8String } from 'asn1js';
import { ConfigService, CoreService } from './core.service';
import { AstTabComponent } from './shared/ast-tab/ast-tab.component';
import { AstTabGroupComponent } from './shared/ast-tab/ast-tab-group/ast-tab-group.component';
import { ContentComponent } from './luxio/content/content.component';
import { AstMenuComponent } from './shared/ast-menu/ast-menu.component';
import { SettingsComponent } from './luxio/settings/settings.component';
import { UserCenterComponent } from './luxio/user-center/user-center.component';
import { file } from 'opfs-tools';
import { ThemeService } from './theme.service';
import { NotificationComponent } from './shared/notification/notification.component';
import { TerminalComponent } from './shared/terminal/terminal.component'; // Import the terminal component

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    host: {
      '(mouseup)': 'dragEnd($event)',
      '(mousemove)': 'whenMouseMove($event)'
    },
    standalone: true,
    imports: [UserCenterComponent, SettingsComponent, AstMenuComponent, AstTabGroupComponent, AstTabComponent, ContentComponent, NotificationComponent, TerminalComponent], // Add TerminalComponent to imports
})
export class AppComponent implements OnInit, AfterViewInit {
  protected coreService = inject(CoreService);
  protected themeService = inject(ThemeService);
  contentComp = viewChild(ContentComponent);
  http = inject(HttpClient);

  title = 'luxio';
  luxioAppTabId: any;
  textArr: Array<String> = []

  // current selected file type (extension or nodeType)
  fileType: string = '';

  lastSelectedDisplayViewId: number = 1;
  currentDisplayViewId: number = 1;
  terminalBtnShow = false;
  terminalPanelShow = false;
  themePromptOpen = false;
  themePromptText = '';
  themePromptLoading = false;
  themePromptError: string | null = null;
  themePromptResult: Record<string, string> | null = null;
  private readonly emotionThemeSystemPrompt = `
You are a UI theme generation assistant. Your task is to analyze the user input and generate a matching UI theme color palette based on the expressed emotion.

Rules:
1. First analyze the user input for emotion or mood (for example angry, happy, sad, calm, anxious, excited, fearful, surprised).
2. Choose a matching color scheme based on the emotion:
   - Angry/Tense → warm tones (red/orange/deep red), high contrast, intense.
   - Happy/Excited → bright tones (yellow/orange/light blue), high saturation, energetic.
   - Sad/Downcast → cool tones (blue/gray/indigo), low saturation, soft.
   - Calm/Relaxed → neutral tones (green/beige/gray-blue), low contrast, comfortable.
   - Fearful/Anxious → dark tones (deep purple/dark gray/forest green), low brightness, moody.
   - Surprised/Curious → vivid tones (purple/pink/bright blue), high contrast, playful.
   - Loving/Warm → warm soft tones (pink/red/gold), medium-high saturation, gentle.
   - For other emotions, match based on the emotion characteristics.
3. If the user input is a style description rather than an emotional expression, ignore emotion analysis and generate the theme directly from the style description.
4. Use the provided tools to output color values, with each tool returning one color.
5. Color values must use hexadecimal format (e.g. #FF6B6B).
6. Ensure the six colors (background, primary, text, surface, accent, border) are visually harmonious and form a complete theme.
`;
  keepTerminalInstance = {
    value: false,
    dragHeight: 0.75,
  }
  sideOpen = true

  blurSwitch = true;
  isOpen = false;
  menuInitiator: DOMRect | undefined;

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
  }

  // 显示上传进度详情
  showUploadProgressDetails(): void {
    // 准备要显示的进度详情文本
    let progressDetails = "";
    if (this.coreService.uploadTasks().length > 0) {
      progressDetails = this.coreService.uploadTasks().map(task => 
        `${task.fileName}: ${Math.floor(task.progress() * 100)}% (${task.status})`
      ).join('\n');
    } else {
      progressDetails = "No active uploads";
    }

    // 使用通知组件显示进度详情
    this.coreService.showNotification(this.coreService.progressDetails(), 'info');
  }

  // 恢复默认主题
  toggleTheme() {
    this.themeService.clearThemeVariables();
    this.themeService.setTheme('default');
    document.body.classList.remove('vscode-dark-theme');
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
You are a UI theme generation assistant.
When the user's prompt expresses feeling, mood, emotion, or atmosphere, generate a mood-driven UI palette.
When the user's prompt describes style, texture, or design, generate a style-driven palette.
This applies to any language.
Always output the theme colors using the provided tools in hex format.
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
          tools: [
            {
              name: 'ui_background',
              description: 'Main application background color for page surfaces and the app canvas.',
              parameters: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                additionalProperties: false,
                type: 'object',
                properties: {
                  color: {
                    type: 'string',
                    description: 'Background color value for the main app background.',
                  },
                },
                required: ['color'],
              },
            },
            {
              name: 'ui_primary_color',
              description: 'Primary accent color for buttons, active controls, and call-to-action elements.',
              parameters: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                additionalProperties: false,
                type: 'object',
                properties: {
                  color: {
                    type: 'string',
                    description: 'Accent color value for primary UI controls.',
                  },
                },
                required: ['color'],
              },
            },
            {
              name: 'ui_text_color',
              description: 'Primary readable text color for body copy, headings, and labels.',
              parameters: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                additionalProperties: false,
                type: 'object',
                properties: {
                  color: {
                    type: 'string',
                    description: 'Text color value for readable copy.',
                  },
                },
                required: ['color'],
              },
            },
            {
              name: 'ui_surface',
              description: 'Surface color for cards, panels, sidebars, and secondary containers.',
              parameters: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                additionalProperties: false,
                type: 'object',
                properties: {
                  color: {
                    type: 'string',
                    description: 'Color value for secondary surface backgrounds.',
                  },
                },
                required: ['color'],
              },
            },
            {
              name: 'ui_accent',
              description: 'Accent color for links, focus indicators, and subtle highlights.',
              parameters: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                additionalProperties: false,
                type: 'object',
                properties: {
                  color: {
                    type: 'string',
                    description: 'Color value for accent highlights.',
                  },
                },
                required: ['color'],
              },
            },
            {
              name: 'ui_border',
              description: 'Border or divider color for separators and container edges.',
              parameters: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                additionalProperties: false,
                type: 'object',
                properties: {
                  color: {
                    type: 'string',
                    description: 'Color value for borders and dividers.',
                  },
                },
                required: ['color'],
              },
            },
          ],
        }),
        credentials: 'include',
      });

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取数据流');
      }

      const decoder = new TextDecoder();
      let accumulatedText = '';
      let payload: any = null;
      let assistantText = '';
      let done = false;
      const toolCallsByIndex: Record<string, { index: number; id?: string; name?: string; arguments?: string }> = {};

      while (!done) {
        const result = await reader.read();
        if (result.done) {
          break;
        }

        const chunk = decoder.decode(result.value, { stream: true });
        accumulatedText += chunk;
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

            const entries = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
            for (const toolCall of entries) {
              if (!toolCall || typeof toolCall !== 'object') {
                continue;
              }

              const callIndex = toolCall.index !== undefined ? String(toolCall.index) : undefined;
              if (!callIndex) {
                continue;
              }

              const existing = toolCallsByIndex[callIndex] || { index: toolCall.index };
              const fn = toolCall.function && typeof toolCall.function === 'object' ? toolCall.function : null;

              if (typeof toolCall.id === 'string' && toolCall.id) {
                existing.id = toolCall.id;
              }
              if (typeof toolCall.name === 'string' && toolCall.name) {
                existing.name = toolCall.name;
              }
              if (fn) {
                if (typeof fn.name === 'string' && fn.name) {
                  existing.name = fn.name;
                }
                if (fn.arguments !== undefined) {
                  if (typeof fn.arguments === 'string') {
                    existing.arguments = (existing.arguments ?? '') + fn.arguments;
                  } else {
                    existing.arguments = JSON.stringify(fn.arguments);
                  }
                }
              }
              if (toolCall.arguments !== undefined) {
                if (typeof toolCall.arguments === 'string') {
                  existing.arguments = (existing.arguments ?? '') + toolCall.arguments;
                } else {
                  existing.arguments = JSON.stringify(toolCall.arguments);
                }
              }

              toolCallsByIndex[callIndex] = existing;
            }

            if (parsed.theme && typeof parsed.theme === 'object') {
              payload = {
                ...payload,
                ...parsed.theme,
              };
            } else if (parsed.content && typeof parsed.content === 'object') {
              payload = {
                ...payload,
                ...parsed.content,
              };
            } else if (typeof parsed === 'object') {
              payload = {
                ...payload,
                ...parsed,
              };
            }
            if (parsed.sessionId) {
              // Keep sessionId for future use if the backend returns it
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

      const toolCalls = Object.values(toolCallsByIndex);
      const themeData = this.extractThemeVariables(payload, accumulatedText, toolCalls);
      const cssVars = this.mapThemeKeysToCss(themeData);

      if (!cssVars || Object.keys(cssVars).length === 0) {
        throw new Error('未能从响应中解析出主题变量');
      }

      this.themeService.setTheme('custom');
      this.themeService.setThemeVariables(cssVars);
      this.themePromptResult = cssVars;
      this.themePromptOpen = false;
    } catch (err: any) {
      console.error('生成主题失败', err);
      this.themePromptError = err?.message || '生成主题失败，请重试';
    } finally {
      this.themePromptLoading = false;
    }
  }

  private extractThemeVariables(payload: any, rawText: string, toolCalls: any[] = []): Record<string, string> {
    const theme: Record<string, string> = {};
    const normalized = payload && typeof payload === 'object'
      ? payload.theme && typeof payload.theme === 'object'
        ? payload.theme
        : payload
      : null;

    if (normalized) {
      for (const key of Object.keys(normalized)) {
        const value = normalized[key];
        if (typeof value === 'string' && value.trim()) {
          theme[key.trim()] = value.trim();
        }
      }
    }

    const aliasMap: Record<string, string> = {
      ui_background: 'background',
      background: 'background',
      ui_primary_color: 'primary',
      primary: 'primary',
      ui_text_color: 'text',
      text: 'text',
      ui_surface: 'surface',
      surface: 'surface',
      ui_accent: 'accent',
      accent: 'accent',
      ui_border: 'border',
      border: 'border',
    };

    if (Object.keys(theme).length === 0) {
      const jsonMatch = rawText.match(/({[\s\S]*})/m);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          for (const key of Object.keys(parsed)) {
            const value = parsed[key];
            if (typeof value === 'string' && value.trim()) {
              theme[key.trim()] = value.trim();
            }
          }
        } catch {
          // ignore JSON parse failure
        }
      }
    }

    if (Object.keys(theme).length === 0) {
      for (const [alias, canonical] of Object.entries(aliasMap)) {
        const regex = new RegExp(`${alias}\\s*[:=]\\s*(#[0-9a-fA-F]{3,8}|rgba?\\([^)]*\\)|[a-zA-Z]+)`, 'i');
        const match = rawText.match(regex);
        if (match) {
          theme[canonical] = match[1];
        }
      }
    }

    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const indexedCalls: Record<string, { name?: string; arguments?: unknown }> = {};

      for (const toolCall of toolCalls) {
        if (!toolCall || typeof toolCall !== 'object') {
          continue;
        }

        const fn = toolCall.function && typeof toolCall.function === 'object' ? toolCall.function : null;
        const callIndex = toolCall.index !== undefined ? String(toolCall.index) : undefined;
        const entryKey = callIndex ?? String(toolCall.id ?? toolCall.name ?? '');
        if (!entryKey) {
          continue;
        }

        const existing = indexedCalls[entryKey] || {};

        if (toolCall.name && typeof toolCall.name === 'string') {
          existing.name = toolCall.name;
        }

        if (fn) {
          if (typeof fn.name === 'string' && fn.name) {
            existing.name = fn.name;
          }
          if (fn.arguments !== undefined) {
            existing.arguments = fn.arguments;
          }
        }

        if (toolCall.arguments !== undefined) {
          existing.arguments = toolCall.arguments;
        }

        indexedCalls[entryKey] = existing;
      }

      for (const entry of Object.values(indexedCalls)) {
        if (!entry.name) {
          continue;
        }

        const toolName = entry.name.toLowerCase();
        const canonicalToolName = aliasMap[toolName] || aliasMap[toolName.replace(/[-_\s]/g, '')];
        let toolArgs: any = entry.arguments;

        if (typeof toolArgs === 'string') {
          const trimmed = toolArgs.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              toolArgs = JSON.parse(trimmed);
            } catch {
              toolArgs = { value: trimmed };
            }
          } else {
            toolArgs = { value: trimmed };
          }
        }

        if (canonicalToolName) {
          if (typeof toolArgs === 'string') {
            theme[canonicalToolName] = toolArgs;
          } else if (toolArgs && typeof toolArgs === 'object') {
            if (typeof toolArgs.color === 'string') {
              theme[canonicalToolName] = toolArgs.color;
            } else if (typeof toolArgs.value === 'string') {
              theme[canonicalToolName] = toolArgs.value;
            } else {
              for (const value of Object.values(toolArgs)) {
                if (typeof value === 'string' && value.trim()) {
                  theme[canonicalToolName] = value.trim();
                  break;
                }
              }
            }
          }
        } else if (toolArgs && typeof toolArgs === 'object') {
          for (const [innerKey, innerValue] of Object.entries(toolArgs)) {
            const normalizedInnerKey = innerKey.toLowerCase().replace(/[-_\s]/g, '');
            const canonicalInner = aliasMap[normalizedInnerKey] || normalizedInnerKey;
            if (typeof innerValue === 'string' && innerValue.trim()) {
              theme[canonicalInner] = innerValue.trim();
            }
          }
        }
      }
    }

    return theme;
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
      case 'user-center':
        this.currentDisplayViewId = 6;
        this.lastSelectedDisplayViewId = this.currentDisplayViewId;
        break;
      case 'terminal': // Handle terminal tab activation
        this.currentDisplayViewId = 7; // Assign a unique ID for terminal
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
      if (!this.sideOpen) {
        this.sideOpen = true;
      } else {
        this.sideOpen = false;
      }
    } else {
      if(currentDisplayViewId != 4) {
        this.currentDisplayViewId = currentDisplayViewId;
        this.sideOpen = true;
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
          const userCenterBar: any = {
            id: 'user-center',
            title: 'User Center'
          };
          this.openTab(userCenterBar);
          break;
      }
    }
    if(currentDisplayViewId == 5 || currentDisplayViewId == 6) {
      this.closeMenu();
    }
  }

  // Method to open a new terminal tab
  toggleTerminal(): void {
    if(!this.keepTerminalInstance.value) {
      this.keepTerminalInstance.value = true;
    }
    if(this.terminalPanelShow) {
      this.terminalPanelShow = false;
      this.dragHeight = 1;
    } else {
      this.terminalPanelShow = true;
      this.dragHeight = 0.75;
      if(this.keepTerminalInstance.value) {
        this.dragHeight = this.keepTerminalInstance.dragHeight;
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
        this.terminalBtnShow = !docObj.isLocked;
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
      this.dragHeight = 1;
      this.keepTerminalInstance.value = false;
      this.keepTerminalInstance.dragHeight = 0.75;
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

  dragHeight: number = 1;
  active = false;

  // 用于存储当前拖动元素的父元素，以便在拖动结束时恢复样式
  maskLayerElement: any;

  initialY: number = 0;
  topSectionHeight: number = 0;
  bottomSectionHeight: number = 0;

  dragStart(evt: any, currentCursorType: string = 'ns') {
    this.maskLayerElement = evt.target.parentElement; // 获取父元素作为遮罩层
    evt.target.parentElement.style.zIndex = 90; // 提升遮罩层的 z-index，使其覆盖其他元素
    document.body.style.cursor = currentCursorType.toLowerCase() + '-resize'; // 更改光标样式

    const currentTarget = evt.currentTarget;
    const parentParent = currentTarget.parentElement.parentElement.childNodes;
    this.topSectionHeight = parentParent[1].clientHeight
    this.bottomSectionHeight = parentParent[2].clientHeight
    this.initialY = evt.clientY;
    evt.preventDefault()
    this.active = true;
  }

  dragEnd(evt: any) {
    // initialX = currentX;  
    // initialY = currentY;  
    this.active = false;
    if (this.maskLayerElement) {
      this.maskLayerElement.style.zIndex = "";
    }
    document.body.style.cursor = 'default'; // 恢复默认光标
  }

  whenMouseMove(evt: any) {
    if (this.active) {
      evt.preventDefault()
      const yOffset = evt.clientY - this.initialY;
      this.dragHeight = (this.topSectionHeight + yOffset) / (this.topSectionHeight + this.bottomSectionHeight)
      this.keepTerminalInstance.dragHeight = this.dragHeight; // 保存当前拖动高度到 keepTerminalInstance，以便在重新打开终端时恢复
      return;
    }
  }

}