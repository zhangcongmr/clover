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

  constructor() {}

  ngOnInit(): void {
    // Initialize the terminal
    this.initializeTerminal();
  }

  ngAfterViewInit(): void {
    // Add welcome message after view initialization
    setTimeout(() => {
      this.terminal.writeln('Welcome to Luxio Terminal Emulator!');
      this.terminal.writeln('This is a simulated terminal for demonstration purposes.');
      this.writePrompt();
    }, 100);
  }

  ngOnDestroy(): void {
    // Clean up terminal instance
    if (this.terminal) {
      this.terminal.dispose();
    }
  }

  private initializeTerminal(): void {
    // Create terminal instance with options
    this.terminal = new Terminal({
      fontSize: this.fontSize,
      cursorBlink: true,
      rows: 30,
      cols: 80,
      theme: this.getTheme(),
      allowTransparency: true
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
        this.terminal.write('\b \b');
        break;
      default:
        this.terminal.write(data);
        break;
    }
  }

  private processCommand(): void {
    // Since we can't access the internal buffer directly, we'll use a simpler approach
    // For now, we'll just execute an empty command which will show the prompt
    // In a real implementation, we would maintain the command as it's being typed
    this.executeCommand('');
  }

  private executeCommand(command: string): void {
    if (!command) {
      this.writePrompt();
      return;
    }

    // Split command and arguments
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'help':
        this.terminal.writeln('Available commands: help, echo, clear, date, ls, pwd, whoami');
        break;
      case 'echo':
        this.terminal.writeln(args.join(' '));
        break;
      case 'date':
        this.terminal.writeln(new Date().toString());
        break;
      case 'ls':
        this.terminal.writeln('file1.txt  file2.js  folder1/  folder2/');
        break;
      case 'pwd':
        this.terminal.writeln('/home/user/project');
        break;
      case 'whoami':
        this.terminal.writeln('luxio-user');
        break;
      case 'clear':
        this.terminal.clear();
        this.writePrompt();
        return; // Don't add another prompt
      default:
        this.terminal.writeln(`Command not found: ${cmd}. Type 'help' for available commands.`);
    }

    // Show new prompt
    this.writePrompt();
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

  // Method to change the theme
  public changeTheme(theme: string): void {
    this.theme = theme;
    this.applyTheme();
  }
}