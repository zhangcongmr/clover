import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Input, AfterViewInit } from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

@Component({
  selector: 'app-terminal',
  templateUrl: './terminal.component.html',
  styleUrls: ['./terminal.component.css'],
  standalone: true // Make this component standalone for easier use
})
export class TerminalComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('terminal', { static: true }) terminalElement!: ElementRef;
  
  @Input() fontSize: number = 14;
  @Input() theme: string = 'light'; // 'dark' or 'light'

  private terminal!: Terminal;
  private fitAddon!: FitAddon;
  private webLinksAddon!: WebLinksAddon;
  private commandBuffer: string = '';
  private websocket: WebSocket | null = null;
  private isConnected: boolean = false;

  constructor() {}

  ngOnInit(): void {
    // Initialize the terminal
    this.initializeTerminal();
    // Connect to WebSocket
    this.connectWebSocket();
  }

  ngAfterViewInit(): void {
    // Add welcome message after view initialization
    setTimeout(() => {
      this.terminal.writeln('Connecting to terminal server...');
    }, 100);
  }

  ngOnDestroy(): void {
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
      // rows: 30,
      // cols: 80,
      theme: this.getTheme(),
      allowTransparency: true,
      // Disable the alternative scroll event handler which creates the xterm-helpers div
      altClickMovesCursor: false,
    });

    // Load addons
    this.fitAddon = new FitAddon();
    this.webLinksAddon = new WebLinksAddon();
    
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.webLinksAddon);

    // Open the terminal in the DOM
    this.terminal.open(this.terminalElement.nativeElement);

    // Apply initial theme
    this.applyTheme();

    // Fit the terminal to the container size
    setTimeout(() => {
      this.fitAddon.fit();
    }, 100);

    // Handle window resize events
    window.addEventListener('resize', () => {
      this.fitAddon.fit();
    });

    // Handle terminal resize events
    this.terminal.onResize((size) => {
      // Handle terminal resize if needed
    });

    // Handle user input
    this.terminal.onData((data) => {
      this.handleTerminalInput(data);
    });
  }

  private getTheme(): any {
    if (this.theme === 'light') {
      return {
        background: '#ffffff',
        foreground: '#000000',
        cursor: '#000000',
        selectionBackground: '#add6ff'
      };
    } else {
      return {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78'
      };
    }
  }

  private applyTheme(): void {
    if (this.terminal) {
      this.terminal.options.theme = this.getTheme();
    }
  }

  private handleTerminalInput(data: string): void {
    switch (data) {
      case '\r': // Enter key
        this.terminal.write('\r\n');
        this.processCommand();
        break;
      case '\u007F': // Backspace key
        if (this.commandBuffer.length > 0) {
          this.commandBuffer = this.commandBuffer.slice(0, -1);
          this.terminal.write('\b \b');
        }
        break;
      default:
        this.commandBuffer += data;
        this.terminal.write(data);
        break;
    }
  }

  private processCommand(): void {
    const command = this.commandBuffer.trim();
    this.commandBuffer = '';

    if (this.websocket && this.isConnected) {
      // Send command to server as JSON object
      const message = {
        type: 'input',
        data: command + '\r'
      };
      this.websocket.send(JSON.stringify(message));
    } else {
      this.terminal.writeln('Not connected to server.');
      this.writePrompt();
    }
  }



  private writePrompt(): void {
    this.terminal.write('$ ');
  }

  // Method to send data to the terminal
  public sendData(data: string): void {
    if (this.terminal) {
      this.terminal.write(data);
    }
  }

  // Method to clear the terminal
  public clear(): void {
    if (this.terminal) {
      this.terminal.clear();
      this.writePrompt();
    }
  }

  private connectWebSocket(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/terminal/ws`;

    this.websocket = new WebSocket(wsUrl);

    this.websocket.onopen = (event) => {
      this.isConnected = true;
      console.log('WebSocket connected');
      // Optionally send an initial message or setup
    };

    this.websocket.onmessage = (event) => {
      // Write server output to terminal
      this.terminal.write(event.data);
    };

    this.websocket.onclose = (event) => {
      this.isConnected = false;
      console.log('WebSocket closed');
      this.terminal.writeln('\r\nConnection closed.');
    };

    this.websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.terminal.writeln('\r\nWebSocket error occurred.');
    };
  }

  // Method to change the theme
  public changeTheme(theme: string): void {
    this.theme = theme;
    this.applyTheme();
  }
}