import { Injectable } from '@angular/core';

export interface TerminalSize {
  cols: number;
  rows: number;
}

@Injectable({
  providedIn: 'root'
})
export class TerminalService {
  private socket: WebSocket | null = null;
  private messageSubject = new Subject<string>();
  private errorSubject = new Subject<string>();
  
  public onMessage = this.messageSubject.asObservable();
  public onError = this.errorSubject.asObservable();

  constructor() {}

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(url);
        
        this.socket.onopen = () => {
          console.log('Terminal WebSocket connection established');
          resolve();
        };

        this.socket.onmessage = (event) => {
          this.messageSubject.next(event.data);
        };

        this.socket.onerror = (error) => {
          console.error('Terminal WebSocket error:', error);
          this.errorSubject.next(error.toString());
          reject(error);
        };

        this.socket.onclose = () => {
          console.log('Terminal WebSocket connection closed');
        };
      } catch (error) {
        console.error('Failed to connect to terminal:', error);
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  sendCommand(command: string): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(command);
    } else {
      console.error('WebSocket is not connected');
    }
  }

  resizeTerminal(size: TerminalSize): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
    }
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
}