import { Adapter, Message, PermissionLevel } from '../common/types';
import { Logger } from '../config/log';
import * as http from 'http';
import * as url from 'url';

export interface HTTPConfig {
  port: number;
  host?: string;
  
  // API认证
  apiKey?: string;
  allowedIPs?: string[];
  
  // 权限配置
  defaultPermission?: PermissionLevel;
  userPermissions?: { [userId: string]: PermissionLevel };
  
  // CORS配置
  cors?: {
    enabled: boolean;
    origin?: string | string[];
    methods?: string[];
  };
}

interface APIRequest {
  method: string;
  url: string;
  headers: { [key: string]: string };
  body: any;
  ip: string;
}

export class HTTPAdapter implements Adapter {
  public name = 'http';
  private config: HTTPConfig;
  private connected = false;
  private messageCallback?: (message: Message) => void;
  private server?: http.Server;

  constructor(config: HTTPConfig) {
    this.config = {
      host: '0.0.0.0',
      defaultPermission: PermissionLevel.USER,
      cors: {
        enabled: true,
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
      },
      ...config
    };
  }

  public async connect(): Promise<void> {
    try {
      Logger.info(`正在启动HTTP API服务器 ${this.config.host}:${this.config.port}...`);
      
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      await new Promise<void>((resolve, reject) => {
        this.server!.listen(this.config.port, this.config.host, (error?: Error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      
      this.connected = true;
      Logger.info(`HTTP API服务器已启动: http://${this.config.host}:${this.config.port}`);
      
    } catch (error) {
      Logger.error('HTTP API服务器启动失败:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    Logger.info('正在关闭HTTP API服务器...');
    
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          resolve();
        });
      });
      this.server = undefined;
    }
    
    this.connected = false;
    Logger.info('HTTP API服务器已关闭');
  }

  public async sendMessage(target: string, content: string): Promise<void> {
    if (!this.connected) {
      throw new Error('HTTP adapter 未连接');
    }

    // HTTP适配器的sendMessage主要用于记录日志
    // 实际的消息发送通过HTTP响应完成
    Logger.debug(`HTTP消息准备发送到 ${target}: ${content}`);
  }

  public onMessage(callback: (message: Message) => void): void {
    this.messageCallback = callback;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const startTime = Date.now();
    const clientIP = req.socket.remoteAddress || 'unknown';
    
    try {
      // 设置CORS头
      if (this.config.cors?.enabled) {
        this.setCORSHeaders(res);
      }
      
      // 处理OPTIONS预检请求
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // 检查IP白名单
      if (!this.isIPAllowed(clientIP)) {
        this.sendError(res, 403, 'IP地址不在允许列表中');
        return;
      }

      // 解析请求
      const request = await this.parseRequest(req);
      
      // 验证API密钥
      if (!this.verifyAPIKey(request)) {
        this.sendError(res, 401, 'API密钥无效');
        return;
      }

      // 路由处理
      const response = await this.routeRequest(request);
      
      // 发送响应
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      
      const duration = Date.now() - startTime;
      Logger.info(`HTTP请求: ${req.method} ${req.url} - 200 (${duration}ms)`);
      
    } catch (error) {
      Logger.error('HTTP请求处理错误:', error);
      this.sendError(res, 500, '服务器内部错误');
    }
  }

  private async parseRequest(req: http.IncomingMessage): Promise<APIRequest> {
    const parsedUrl = url.parse(req.url || '', true);
    
    return new Promise((resolve, reject) => {
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          const request: APIRequest = {
            method: req.method || 'GET',
            url: parsedUrl.pathname || '/',
            headers: req.headers as { [key: string]: string },
            body: body ? JSON.parse(body) : parsedUrl.query,
            ip: req.socket.remoteAddress || 'unknown'
          };
          resolve(request);
        } catch (error) {
          reject(new Error('请求体格式错误'));
        }
      });
      
      req.on('error', reject);
    });
  }

  private async routeRequest(request: APIRequest): Promise<any> {
    const { method, url: path, body } = request;
    
    switch (path) {
      case '/api/send':
        return this.handleSendMessage(request);
        
      case '/api/status':
        return this.handleGetStatus(request);
        
      case '/api/webhook':
        return this.handleWebhook(request);
        
      case '/health':
        return { status: 'ok', timestamp: Date.now() };
        
      default:
        throw new Error(`未找到路径: ${path}`);
    }
  }

  private async handleSendMessage(request: APIRequest): Promise<any> {
    const { content, target, userId, username } = request.body;
    
    if (!content) {
      throw new Error('消息内容不能为空');
    }

    // 模拟发送消息
    Logger.info(`通过HTTP API发送消息到 ${target || 'default'}: ${content}`);
    
    return {
      success: true,
      message: '消息发送成功',
      timestamp: Date.now()
    };
  }

  private async handleGetStatus(request: APIRequest): Promise<any> {
    return {
      adapter: this.name,
      connected: this.connected,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: Date.now()
    };
  }

  private async handleWebhook(request: APIRequest): Promise<any> {
    if (!this.messageCallback) {
      throw new Error('消息回调未设置');
    }

    const { content, userId, username, platform } = request.body;
    
    if (!content) {
      throw new Error('消息内容不能为空');
    }

    // 获取用户权限
    const permission = this.getUserPermission(userId);
    
    const message: Message = {
      id: Date.now().toString(),
      content: content,
      sender: {
        id: userId || 'http_user',
        name: username || 'HTTP用户',
        permission: permission
      },
      platform: platform || 'http',
      timestamp: Date.now(),
      extra: {
        source: 'webhook',
        ip: request.ip,
        userAgent: request.headers['user-agent']
      }
    };

    Logger.info(`收到HTTP Webhook消息: ${message.content} (来自: ${message.sender.name})`);
    
    // 异步处理消息
    setImmediate(() => {
      this.messageCallback!(message);
    });

    return {
      success: true,
      message: '消息已接收',
      messageId: message.id,
      timestamp: Date.now()
    };
  }

  private setCORSHeaders(res: http.ServerResponse): void {
    const cors = this.config.cors!;
    
    if (cors.origin) {
      res.setHeader('Access-Control-Allow-Origin', 
        Array.isArray(cors.origin) ? cors.origin.join(',') : cors.origin);
    }
    
    if (cors.methods) {
      res.setHeader('Access-Control-Allow-Methods', cors.methods.join(','));
    }
    
    res.setHeader('Access-Control-Allow-Headers', 
      'Content-Type, Authorization, X-API-Key');
  }

  private verifyAPIKey(request: APIRequest): boolean {
    if (!this.config.apiKey) {
      return true; // 没有配置API密钥，允许所有请求
    }

    const apiKey = request.headers['x-api-key'] || 
                   request.headers['authorization']?.replace('Bearer ', '') ||
                   request.body.apiKey;

    return apiKey === this.config.apiKey;
  }

  private isIPAllowed(ip: string): boolean {
    if (!this.config.allowedIPs || this.config.allowedIPs.length === 0) {
      return true; // 没有配置IP白名单，允许所有IP
    }

    return this.config.allowedIPs.includes(ip);
  }

  private getUserPermission(userId?: string): PermissionLevel {
    if (!userId) {
      return this.config.defaultPermission || PermissionLevel.USER;
    }

    return this.config.userPermissions?.[userId] || 
           this.config.defaultPermission || 
           PermissionLevel.USER;
  }

  private sendError(res: http.ServerResponse, code: number, message: string): void {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: true,
      code: code,
      message: message,
      timestamp: Date.now()
    }));
  }

  // 获取服务器统计信息
  public getServerStats(): any {
    return {
      adapter: this.name,
      connected: this.connected,
      host: this.config.host,
      port: this.config.port,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }
}

// 默认导出
export default HTTPAdapter;
