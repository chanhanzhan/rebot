import { BaseAdapter, AdapterMetadata, MessageContext } from './base-adapter';
import { Logger } from '../config/log';
import { Message, Adapter } from '../common/types';
import * as http from 'http';
import * as url from 'url';
import * as querystring from 'querystring';

export interface HttpAdapterConfig {
  port: number;
  host: string;
  enableCors: boolean;
  maxRequestSize: string;
  timeout: number;
  middleware?: string[];
}

/**
 * HTTP适配器 - 重构版本
 * 继承BaseAdapter，支持HTTP请求处理
 * 实现Adapter接口
 */
export class HttpAdapter extends BaseAdapter {
  public readonly metadata: AdapterMetadata = {
    name: 'http-adapter',
    version: '2.0.0',
    description: 'HTTP协议适配器，处理HTTP请求和响应',
    author: 'Framework Team',
    type: 'bidirectional',
    protocol: 'http',
    dependencies: [],
    priority: 100,
    config: {
      port: 3000,
      host: '0.0.0.0',
      enableCors: true,
      maxRequestSize: '10mb',
      timeout: 30000,
      middleware: []
    }
  };

  private server?: http.Server;
  private routes: Map<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = new Map();
  private httpConfig?: HttpAdapterConfig;
  private messageCallback?: (message: Message) => void;

  constructor() {
    super();
    // 延迟初始化配置，避免在构造函数中访问metadata
  }

  /**
   * 获取HTTP配置
   */
  private getHttpConfig(): HttpAdapterConfig {
    if (!this.httpConfig) {
      this.httpConfig = this.metadata.config as HttpAdapterConfig;
    }
    return this.httpConfig;
  }

  /**
   * 适配器加载
   */
  protected async onLoad(): Promise<void> {
    Logger.debug('HTTP适配器开始加载');
    
    // 创建HTTP服务器
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });
    
    Logger.debug(`HTTP适配器加载完成，服务器状态: ${this.server ? '已创建' : '未创建'}`);
  }

  /**
   * 适配器初始化
   */
  protected async onInitialize(): Promise<void> {
    Logger.debug('HTTP适配器开始初始化');
    
    if (!this.server) {
      throw new Error('HTTP服务器未创建');
    }

    // 设置路由
    this.setupRoutes();
    
    Logger.debug('HTTP适配器初始化完成');
  }

  /**
   * 适配器连接
   */
  protected async onConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error('HTTP服务器未创建'));
        return;
      }

      const config = this.getHttpConfig();
      Logger.info(`HTTP适配器启动服务器: ${config.host}:${config.port}`);

      this.server.listen(config.port, config.host, () => {
        Logger.info(`HTTP适配器已启动，监听 ${config.host}:${config.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        Logger.error('HTTP适配器启动失败', error);
        reject(error);
      });
    });
  }

  /**
   * 适配器断开连接
   */
  protected async onDisconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        Logger.info('关闭HTTP服务器');
        this.server.close(() => {
          Logger.info('✅ HTTP服务器已关闭');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 适配器卸载
   */
  protected async onUnload(): Promise<void> {
    Logger.debug('HTTP适配器开始卸载');
    
    this.server = undefined;
    this.routes.clear();
    
    Logger.debug('HTTP适配器卸载完成');
  }

  /**
   * 发送消息（HTTP响应）
   */
  protected async onSendMessage(context: MessageContext): Promise<void> {
    // HTTP适配器的发送消息通常是通过响应对象
    // 这里可以根据具体需求实现
    Logger.debug('HTTP适配器发送消息', { id: context.id, type: context.type });
  }

  /**
   * 发送消息到目标（内部方法）
   */
  private async sendMessageToTarget(target: string, content: string): Promise<void> {
    const context: MessageContext = {
      id: `http-send-${Date.now()}`,
      target,
      content,
      timestamp: new Date(),
      source: 'http',
      type: 'text',
      metadata: {}
    };
    
    await this.onSendMessage(context);
  }

  /**
   * 处理HTTP请求
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const config = this.getHttpConfig();
    
    // 设置CORS头
    if (config.enableCors) {
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

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 健康检查
    this.routes.set('GET:/health', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        adapter: this.metadata.name,
        version: this.metadata.version,
        uptime: this.getStats().uptime,
        timestamp: new Date().toISOString()
      }));
    });

    // 适配器信息
    this.routes.set('GET:/adapter/info', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        metadata: this.metadata,
        state: this.getLifecycleState(),
        stats: this.getStats()
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
            const parsedUrl = url.parse(req.url || '', true);
            
            const context: MessageContext = {
              id: data.id || `http-${Date.now()}`,
              timestamp: new Date(),
              source: 'http',
              type: data.type || 'text',
              content: data.content,
              metadata: {
                method: req.method,
                path: parsedUrl.pathname,
                headers: req.headers,
                query: parsedUrl.query,
                ip: req.socket.remoteAddress
              }
            };

            await this.receiveMessage(context);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              messageId: context.id,
              timestamp: context.timestamp
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

  /**
   * 健康检查
   */
  public async healthCheck(): Promise<boolean> {
    if (!this.server || !this.server.listening) {
      return false;
    }

    try {
      // 可以添加更复杂的健康检查逻辑
      return true;
    } catch (error) {
      Logger.error('HTTP适配器健康检查失败', error);
      return false;
    }
  }

  /**
   * 获取HTTP服务器实例
   */
  public getServer(): http.Server | undefined {
    return this.server;
  }

  /**
   * 更新配置
   */
  public updateConfig(config: Partial<HttpAdapterConfig>): void {
    const currentConfig = this.getHttpConfig();
    this.httpConfig = { ...currentConfig, ...config };
    this.setConfig(this.httpConfig);
    Logger.info('HTTP适配器配置已更新', config);
  }

  /**
   * 获取HTTP配置（公共方法）
   */
  public getHttpConfigPublic(): HttpAdapterConfig {
    return { ...this.getHttpConfig() };
  }
}

// 设置默认导出
export default HttpAdapter;
