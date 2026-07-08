import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Input, AfterViewInit, input, effect, inject } from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { AttachAddon } from '@xterm/addon-attach';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { CoreService } from '../../core.service';
import { LocalAgentService } from '../local-agent/local-agent.service';

@Component({
  selector: 'app-terminal',
  templateUrl: './terminal.component.html',
  styleUrls: ['./terminal.component.css'],
  standalone: true // Make this component standalone for easier use
})
export class TerminalComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('terminal', { static: true }) terminalElement!: ElementRef;
  
  @Input() fontSize: number = 14;
  private coreService = inject(CoreService);
  private localAgentService = inject(LocalAgentService);
  theme = input<string>('light'); // 'dark' or 'light'
  dataList = input<Array<any>>([]);

  private terminal!: Terminal;
  private fitAddon!: FitAddon;
  private webLinksAddon!: WebLinksAddon;
  private attachAddon!: AttachAddon;
  private clipboard!: ClipboardAddon;
  private commandBuffer: string = '';
  private websocket: WebSocket | null = null;
  private pid: string | null = null;
  private isConnected: boolean = false;

  private resizeObserver?: ResizeObserver;

  previousTheme: string = 'light';
  userName: string = 'Anonymous';
  customCwd: string = "/mnt/storage/";
  containerName: string = "";
  isLocalProject: boolean = false;
  private hasConnected = false;

  constructor() {
    effect(() => {
      if (this.theme() !== this.previousTheme) {
        this.applyTheme();
        this.previousTheme = this.theme();
      }
    });
    
    effect(() => {
      const dataList = this.dataList();
      // 当dataList从空变为非空，且终端已初始化但未连接时，连接终端
      if (dataList.length > 0 && this.terminal && !this.hasConnected) {
        this.userName = this.coreService.userData?.username || "Anonymous";
        this.detectLocalProject(dataList);
        this.connectTerminal();
        this.hasConnected = true;
      }
    });
  }

  ngOnInit(): void {
    const dataList = this.dataList()
    if (dataList.length > 0) {
      this.userName = this.coreService.userData?.username || "Anonymous";
      this.detectLocalProject(dataList);
    }
  }

  ngAfterViewInit(): void {
    const dataList = this.dataList();
    this.initializeTerminal();
    
    if (dataList.length === 0) {
      // 没有打开的项目，显示提示信息
      this.terminal.writeln('\x1b[33m[Info] No project opened. Please open a folder or file to use the terminal.\x1b[0m');
      return;
    }
    
    this.detectLocalProject(dataList);
    this.connectTerminal();
    this.hasConnected = true;

    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        this.fitAddon.fit();
      }
    });

    const terminal = this.terminalElement.nativeElement;
    if (terminal) {
      this.resizeObserver.observe(terminal);
    }
  }

  private detectLocalProject(dataList: Array<any>) {
    if (dataList.length === 0) return;
    const docObj = dataList[0];
    this.userName = this.coreService.userData?.username || "Anonymous";
    this.isLocalProject = docObj.isLocal === true;

    if (this.isLocalProject) {
      // Use rootPath for local project CWD
      this.customCwd = docObj.rootPath || docObj.label;
    } else {
      this.customCwd = "/mnt/storage/" + docObj.label;
    }
    this.containerName = 'con-' + this.userName + '-' + docObj.label;
  }

  private connectTerminal() {
    this.isConnected = true;
    if (this.isLocalProject) {
      this.connectLocalPty();
    } else {
      this.connectWebSocket();
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  disconnect(): void {
    // 组件销毁时，断开 ResizeObserver 的连接
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined; // 清空引用
    }
    
    // Clean up terminal instance
    if (this.terminal) {
      this.terminal.dispose();
    }
    // Close WebSocket connection
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    this.isConnected = false;
  }

  private initializeTerminal(): void {
    // Create terminal instance with options
    this.terminal = new Terminal({
      fontSize: this.fontSize,
      cursorBlink: true,
      windowsPty: {
        backend: 'conpty',
        buildNumber: 22621
      },
      // rows: 30,
      // cols: 80,
      theme: this.getTheme(),
      allowTransparency: true,
      // Disable the alternative scroll event handler which creates the xterm-helpers div
      altClickMovesCursor: true
    });

    // Load addons
    this.fitAddon = new FitAddon();
    this.webLinksAddon = new WebLinksAddon();
    this.clipboard = new ClipboardAddon();
    
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.webLinksAddon);
    this.terminal.loadAddon(this.clipboard);
    // Open the terminal in the DOM
    this.terminal.open(this.terminalElement.nativeElement);

    // Handle terminal resize events
    this.terminal.onResize((size) => {
      if (this.isLocalProject) {
        // 本地Agent：通过WS发送resize消息
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
          this.websocket.send(JSON.stringify({
            type: 'resize',
            cols: size.cols,
            rows: size.rows
          }));
        }
      } else {
        // 远程服务器：使用HTTP API
        if (!this.pid) return;
        const cols = size.cols;
        const rows = size.rows;
        const pixelWidth = Math.round(this.terminal!.dimensions?.css?.canvas?.width ?? 0);
        const pixelHeight = Math.round(this.terminal!.dimensions?.css?.canvas?.height ?? 0);
        const url = '/terminals/' + this.pid + '/size?cols=' + cols + '&rows=' + rows + '&pixelWidth=' + pixelWidth + '&pixelHeight=' + pixelHeight + '&name=' + this.containerName;
        fetch(url, { method: 'POST' });
      }
    });
  }

  private async connectWebSocket(): Promise<void> {
    try {
      const pixelWidth = Math.round(this.terminal!.dimensions?.css?.canvas?.width ?? 0);
      const pixelHeight = Math.round(this.terminal!.dimensions?.css?.canvas?.height ?? 0);
      const res = await fetch('/terminals?cols=' + this.terminal!.cols + '&rows=' + this.terminal!.rows + '&name=' + this.containerName
        + '&pixelWidth=' + pixelWidth + '&pixelHeight=' + pixelHeight + '&cwd=' + encodeURIComponent(this.customCwd), { method: 'POST' });
      const processId = await res.text();
      this.pid = processId;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/terminals/${this.pid}` + '?name=' + this.containerName;

      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = (event) => {
        this.isConnected = true;
        console.log('WebSocket connected');
        this.attachAddon = new AttachAddon(this.websocket!);
        this.terminal.loadAddon(this.attachAddon);
      };
    } catch (err) {
      console.error('[Terminal] Failed to connect to remote terminal:', err);
      this.terminal.writeln('\r\n\x1b[33m[Warning] Remote terminal not available in development mode.\x1b[0m');
    }
  }

  // Connect to local PTY via SSR WebSocket
  private async connectLocalPty(): Promise<void> {
    try {
      const wsUrl = await this.localAgentService.getTerminalWsUrl();

      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('[Terminal] WebSocket opened');
        this.websocket!.send(JSON.stringify({
          type: 'pty',
          cols: this.terminal.cols,
          rows: this.terminal.rows,
          cwd: this.customCwd
        }));

        this.attachAddon = new AttachAddon(this.websocket!);
        this.terminal.loadAddon(this.attachAddon);
        this.isConnected = true;
        console.log('[Terminal] Connected to local agent PTY');
      };

      this.websocket.onerror = (err) => {
        console.error('[Terminal] Local agent PTY error:', err);
      };

      this.websocket.onclose = () => {
        this.isConnected = false;
      };
    } catch (err) {
      console.error('[Terminal] Failed to connect to local agent PTY:', err);
      this.terminal.writeln('\r\n\x1b[31m[Error] Failed to connect to local agent. Check Agent URL in Settings.\x1b[0m');
    }
  }

  private applyTheme(): void {
    if (this.terminal) {
      this.terminal.options.theme = this.getTheme();
    }
  }

  private getTheme(): any {
    // 获取根元素
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);
    // 获取 CSS 变量值
    const background = computedStyle.getPropertyValue('--vscode-background')?.trim() || '#0000';
    const foreground = computedStyle.getPropertyValue('--vscode-foreground')?.trim() || '#616161';
    const cursor = computedStyle.getPropertyValue('--vscode-cursor-foreground')?.trim() || '#616161';
    const selectionBackground = computedStyle.getPropertyValue('--vscode-text-selectionBackground')?.trim() || '#cce0ff';

    const getVar = (name: string, fallback: string) =>
      computedStyle.getPropertyValue(`--${name}`)?.trim() || fallback;

    return {
      background: background,
      foreground: foreground,
      cursor: cursor,
      selectionBackground: selectionBackground,
      // ANSI 颜色 - 引用 CSS 变量以适配主题
      black: getVar('terminal-ansi-black', '#000000'),
      red: getVar('terminal-ansi-red', '#cd3131'),
      green: getVar('terminal-ansi-green', '#00bc00'),
      yellow: getVar('terminal-ansi-yellow', '#949800'),
      blue: getVar('terminal-ansi-blue', '#0451a5'),
      magenta: getVar('terminal-ansi-magenta', '#bc05bc'),
      cyan: getVar('terminal-ansi-cyan', '#0598bc'),
      white: getVar('terminal-ansi-white', '#555555'),
      brightBlack: getVar('terminal-ansi-bright-black', '#666666'),
      brightRed: getVar('terminal-ansi-bright-red', '#cd3131'),
      brightGreen: getVar('terminal-ansi-bright-green', '#14ce14'),
      brightYellow: getVar('terminal-ansi-bright-yellow', '#b5ba00'),
      brightBlue: getVar('terminal-ansi-bright-blue', '#0451a5'),
      brightMagenta: getVar('terminal-ansi-bright-magenta', '#bc05bc'),
      brightCyan: getVar('terminal-ansi-bright-cyan', '#0598bc'),
      brightWhite: getVar('terminal-ansi-bright-white', '#a5a5a5'),
    }
  }
}