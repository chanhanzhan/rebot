import * as http from 'http';
import * as url from 'url';
import { Adapter, Message } from '../common/types';
import { Logger } from '../config/log';

export interface HttpAdapterConfig {
  port: number;
  host: string;
  enableCors: boolean;
  maxRequestSize: number;
  timeout: number;
  enableAuth: boolean;
  authToken?: string;
}

/**
 * HTTP适配器 - 独立实现
 * 直接实现Adapter接口，不继承BaseAdapter
 */
export class HttpAdapterStandalone implements Adapter {
  private server?: http.Server;
  private routes: Map<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = new Map();
  private messageCallback?: (message: Message) => void;
  private config: HttpAdapterConfig;

  public readonly name = 'HTTP API';

  constructor(config?: Partial<HttpAdapterConfig>) {
    this.config = {
      port: 3000,
      host: '0.0.0.0',
      enableCors: true,
      maxRequestSize: 1024 * 1024, // 1MB
      timeout: 30000,
      enableAuth: false,
      ...config
    };
    
    this.setupRoutes();
  }

  public async connect(): Promise<void> {
    if (this.server?.listening) {
      Logger.warn('HTTP适配器已经在运行');
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error) => {
        Logger.error('HTTP服务器错误:', error);
        reject(error);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        Logger.info(`HTTP适配器已启动，监听 ${this.config.host}:${this.config.port}`);
        resolve();
      });
    });
  }

  public async disconnect(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        Logger.info('HTTP适配器已停止');
        resolve();
      });
    });
  }

  public async sendMessage(target: string, content: string): Promise<void> {
    // HTTP适配器通常不主动发送消息，而是响应请求
    // 这里可以实现向特定目标发送消息的逻辑
    Logger.info(`发送消息到 ${target}: ${content}`);
  }

  public onMessage(callback: (message: Message) => void): void {
    this.messageCallback = callback;
  }

  public isConnected(): boolean {
    return this.server?.listening || false;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // 设置CORS头
    if (this.config.enableCors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
    }

    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '/';
    
    // 路由匹配
    const routeKey = `${req.method}:${pathname}`;
    const handler = this.routes.get(routeKey) || this.routes.get(`*:${pathname}`);
    
    if (handler) {
      handler(req, res);
    } else {
      // 404处理
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Not Found',
        message: `路径 ${pathname} 不存在`
      }));
    }
  }

  private setupRoutes(): void {
    // 健康检查
    this.routes.set('GET:/health', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        adapter: this.name,
        timestamp: new Date().toISOString()
      }));
    });

    // 通用消息接收端点
    this.routes.set('POST:/message', async (req, res) => {
      try {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            
            const message: Message = {
              id: data.id || `http-${Date.now()}`,
              content: data.content,
              timestamp: Date.now(),
              sender: {
                id: data.sender?.id || 'http-user',
                name: data.sender?.name || 'HTTP User',
                permission: data.sender?.permission || 1
              },
              platform: 'http',
              groupId: data.groupId,
              extra: {
                method: req.method,
                headers: req.headers,
                ip: req.socket.remoteAddress
              }
            };

            if (this.messageCallback) {
              this.messageCallback(message);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              messageId: message.id,
              timestamp: message.timestamp
            }));

          } catch (error) {
            Logger.error('处理HTTP消息失败', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error)
            }));
          }
        });

      } catch (error) {
        Logger.error('处理HTTP消息失败', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    });
  }

  public getServer(): http.Server | undefined {
    return this.server;
  }

  public updateConfig(config: Partial<HttpAdapterConfig>): void {
    this.config = { ...this.config, ...config };
    Logger.info('HTTP适配器配置已更新', config);
  }

  public getConfig(): HttpAdapterConfig {
    return { ...this.config };
  }

  /**
   * 适配器包装器 - 实现Adapter接口
   * HTTP适配器已经直接实现了Adapter接口，所以返回自身
   */
  public getAdapterWrapper(): Adapter {
    return this;
  }
}