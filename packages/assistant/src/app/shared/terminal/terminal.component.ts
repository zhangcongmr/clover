import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Input, AfterViewInit, input, effect } from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { AttachAddon } from '@xterm/addon-attach';

@Component({
  selector: 'app-terminal',
  templateUrl: './terminal.component.html',
  styleUrls: ['./terminal.component.css'],
  standalone: true // Make this component standalone for easier use
})
export class TerminalComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('terminal', { static: true }) terminalElement!: ElementRef;
  
  @Input() fontSize: number = 14;
  theme = input<string>('light'); // 'dark' or 'light'

  private terminal!: Terminal;
  private fitAddon!: FitAddon;
  private webLinksAddon!: WebLinksAddon;
  private attachAddon!: AttachAddon;
  private commandBuffer: string = '';
  private websocket: WebSocket | null = null;
  private pid: string | null = null;
  private isConnected: boolean = false;

  private resizeObserver?: ResizeObserver;

  previousTheme: string = 'light';
  constructor() {
    effect(() => {
      if (this.theme() !== this.previousTheme) {
        this.applyTheme();
        this.previousTheme = this.theme();
      }
    });
  }

  ngOnInit(): void {

  }

  ngAfterViewInit(): void {
    // Initialize the terminal
    this.initializeTerminal();
    // Add welcome message after view initialization
    setTimeout(() => {
      this.terminal.writeln('Connecting to terminal server...');
    }, 100);
    // Connect to WebSocket
    this.connectWebSocket();
    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        this.fitAddon.fit();
      }
    });

    const terminal = this.terminalElement.nativeElement;
    if (terminal) {
      this.resizeObserver.observe(terminal);
      // 保存 observer 以便 ngOnDestroy 中 disconnect（可选）
    }
  }

  ngOnDestroy(): void {
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
    }
  }

  private initializeTerminal(): void {
    // Create terminal instance with options
    this.terminal = new Terminal({
      fontSize: this.fontSize,
      cursorBlink: true,
      windowsPty: true ? {
        // In a real scenario, these values should be verified on the backend
        backend: 'conpty',
        buildNumber: 22621
      } : undefined,
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
    
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.webLinksAddon);

    // Open the terminal in the DOM
    this.terminal.open(this.terminalElement.nativeElement);

    // Handle terminal resize events
    this.terminal.onResize((size) => {
      if (!this.pid) {
        return;
      }
      const cols = size.cols;
      const rows = size.rows;
      const pixelWidth = Math.round(this.terminal!.dimensions?.css?.canvas?.width ?? 0);
      const pixelHeight = Math.round(this.terminal!.dimensions?.css?.canvas?.height ?? 0);
      const url = '/terminals/' + this.pid + '/size?cols=' + cols + '&rows=' + rows + '&pixelWidth=' + pixelWidth + '&pixelHeight=' + pixelHeight + '&name=excited-sailfish';

      fetch(url, { method: 'POST' });
    });
  }

  private async connectWebSocket(): Promise<void> {
    const customCwd = "/mnt/storage/"
    const pixelWidth = Math.round(this.terminal!.dimensions?.css?.canvas?.width ?? 0);
    const pixelHeight = Math.round(this.terminal!.dimensions?.css?.canvas?.height ?? 0);
    const res = await fetch('/terminals?cols=' + this.terminal!.cols + '&rows=' + this.terminal!.rows + '&name=excited-sailfish'
      + '&pixelWidth=' + pixelWidth + '&pixelHeight=' + pixelHeight + '&cwd=' + encodeURIComponent(customCwd), { method: 'POST' });
    const processId = await res.text();
    this.pid = processId;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/terminals/${this.pid}` + '&name=excited-sailfish';

    this.websocket = new WebSocket(wsUrl);

    this.websocket.onopen = (event) => {
      this.isConnected = true;
      console.log('WebSocket connected');
      // Optionally send an initial message or setup
      this.attachAddon = new AttachAddon(this.websocket!);
      this.terminal.loadAddon(this.attachAddon);
    };
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
    const selectionBackground = computedStyle.getPropertyValue('--vscode-selectionBackground')?.trim() || '#0000';

    return {
      background: background,
      foreground: foreground,
      cursor: cursor,
      selectionBackground: selectionBackground
    }
  }
}