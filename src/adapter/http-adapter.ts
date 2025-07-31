import { Adapter, Message, PermissionLevel } from '../common/types';
import { Logger } from '../config/log';
import * as http from 'http';
import * as url from 'url';
import { OneBotHTTPAdapter, OneBotConfig } from './onebot-http-adapter';

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
  
  // OneBot集成配置
  onebot?: Partial<OneBotConfig> & { enabled: boolean };
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
  private onebotAdapter?: OneBotHTTPAdapter;

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
    
    // 初始化OneBot适配器（如果启用）
    if (this.config.onebot?.enabled) {
      const onebotConfig: OneBotConfig = {
        http: {
          enabled: false, // 禁用独立HTTP服务器，使用共享端口
          host: this.config.onebot.http?.host || '127.0.0.1',
          port: this.config.onebot.http?.port || 5700,
          timeout: this.config.onebot.http?.timeout || 0,
          post_timeout: this.config.onebot.http?.post_timeout || 0
        },
        ws: {
          enabled: this.config.onebot.ws?.enabled || false,
          host: this.config.onebot.ws?.host || '127.0.0.1',
          port: this.config.onebot.ws?.port || 6700
        },
        ws_reverse: {
          enabled: this.config.onebot.ws_reverse?.enabled || false,
          universal: this.config.onebot.ws_reverse?.universal || '',
          api: this.config.onebot.ws_reverse?.api || '',
          event: this.config.onebot.ws_reverse?.event || '',
          reconnect_interval: this.config.onebot.ws_reverse?.reconnect_interval || 3000
        },
        plugin_routes: {
          enabled: this.config.onebot.plugin_routes?.enabled !== undefined ? this.config.onebot.plugin_routes.enabled : true,
          base_path: this.config.onebot.plugin_routes?.base_path || '/plugins'
        },
        post_message_format: this.config.onebot.post_message_format || 'string',
        enable_cors: this.config.onebot.enable_cors !== undefined ? this.config.onebot.enable_cors : true,
        cors_origin: this.config.onebot.cors_origin || '*',
        access_token: this.config.onebot.access_token,
        secret: this.config.onebot.secret
      };
      
      this.onebotAdapter = new OneBotHTTPAdapter(onebotConfig);
    }
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
      
      // 启动OneBot适配器（如果启用）
      if (this.onebotAdapter) {
        await this.onebotAdapter.connect();
      }
      
      this.connected = true;
      Logger.info(`HTTP API服务器已启动: http://${this.config.host}:${this.config.port}`);
      
    } catch (error) {
      Logger.error('HTTP API服务器启动失败:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    Logger.info('正在关闭HTTP API服务器...');
    
    // 关闭OneBot适配器
    if (this.onebotAdapter) {
      await this.onebotAdapter.disconnect();
    }
    
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
      Logger.error('HTTP请求处理错误:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        url: req.url,
        method: req.method,
        headers: req.headers
      });
      this.sendError(res, 500, '服务器内部错误');
    }
  }

  private async parseRequest(req: http.IncomingMessage): Promise<APIRequest> {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    
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
            body: body ? JSON.parse(body) : Object.fromEntries(parsedUrl.searchParams),
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
    
    // 处理OneBot路由
    if (path.startsWith('/onebot') && this.onebotAdapter) {
      return this.handleOneBotRequest(request);
    }
    
    switch (path) {
      case '/':
        // 根路径返回API文档或状态页面
        return {
          name: 'Bot Framework HTTP API',
          version: '1.0.0',
          status: 'running',
          endpoints: {
            '/api/send': 'POST - 发送消息',
            '/api/status': 'GET - 获取状态',
            '/api/webhook': 'POST - Webhook接收',
            '/health': 'GET - 健康检查',
            ...(this.onebotAdapter ? { '/onebot/*': 'OneBot协议API' } : {})
          },
          timestamp: Date.now()
        };
        
      case '/api/send':
        return this.handleSendMessage(request);
        
      case '/api/status':
        return this.handleGetStatus(request);
        
      case '/api/webhook':
        return this.handleWebhook(request);
        
      case '/health':
        return { status: 'ok', timestamp: Date.now() };
        
      case '/favicon.ico':
        // 返回一个简单的响应，避免404错误
        return { status: 'not found', message: 'favicon not available' };
        
      default:
        // 检查是否是Vite开发服务器相关请求
        if (path.startsWith('/@vite/') || path.startsWith('/node_modules/')) {
          return { status: 'not found', message: 'Development resource not available' };
        }
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

  // 处理OneBot请求
  private async handleOneBotRequest(request: APIRequest): Promise<any> {
    if (!this.onebotAdapter) {
      throw new Error('OneBot适配器未启用');
    }

    // 移除/onebot前缀
    const onebotPath = request.url.replace('/onebot', '') || '/';
    
    // 创建模拟的HTTP请求和响应对象
    const mockReq = {
      method: request.method,
      url: onebotPath,
      headers: request.headers,
      socket: { remoteAddress: request.ip }
    } as http.IncomingMessage;

    const mockRes = {
      writeHead: () => {},
      end: (data: string) => data,
      setHeader: () => {}
    } as unknown as http.ServerResponse;

    // 调用OneBot适配器的HTTP处理方法
    try {
      // 这里需要访问OneBot适配器的私有方法，我们需要修改OneBotHTTPAdapter
      // 暂时返回一个简单的响应
      return {
        status: 'ok',
        message: 'OneBot API endpoint',
        path: onebotPath,
        method: request.method
      };
    } catch (error) {
      throw new Error(`OneBot请求处理失败: ${error instanceof Error ? error.message : String(error)}`);
    }
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
