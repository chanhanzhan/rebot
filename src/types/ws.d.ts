declare module 'ws' {
  import { EventEmitter } from 'events';
  import * as http from 'http';

  namespace WebSocket {
    class Server extends EventEmitter {
      clients: Set<WebSocket>;
      
      constructor(options: { port?: number; server?: http.Server; host?: string; });
      
      on(event: 'connection', listener: (ws: WebSocket, req: http.IncomingMessage) => void): this;
      on(event: 'error', listener: (error: Error) => void): this;
      on(event: string, listener: (...args: any[]) => void): this;
      
      close(callback?: () => void): void;
    }

    type Data = string | Buffer | ArrayBuffer | Buffer[];
  }

  class WebSocket extends EventEmitter {
    static Server: typeof WebSocket.Server;
    
    constructor(address: string | URL, protocols?: string | string[], options?: { headers?: any });
    
    on(event: 'open', listener: () => void): this;
    on(event: 'close', listener: (code: number, reason: string) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'message', listener: (data: WebSocket.Data) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    
    send(data: any, callback?: (error?: Error) => void): void;
    close(code?: number, reason?: string): void;
    
    readyState: number;
    static CONNECTING: number;
    static OPEN: number;
    static CLOSING: number;
    static CLOSED: number;
  }

  export default WebSocket;
}