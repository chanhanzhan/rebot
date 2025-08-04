import { Adapter, Message, PermissionLevel } from '../common/types';
import { Logger } from '../config/log';
import { BaseAdapter, AdapterMetadata, MessageContext } from './base-adapter';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { AdapterManager } from './adapter-manager';

export interface OneBotConfig {
  // HTTP服务配置
  http: {
    enabled: boolean;
    host: string;
    port: number;
    timeout: number;
    post_timeout: number;
  };
  
  // 正向WebSocket配置
  ws: {
    enabled: boolean;
    host: string;
    port: number;
  };
  
  // 反向WebSocket配置
  ws_reverse: {
    enabled: boolean;
    universal: string;
    api: string;
    event: string;
    reconnect_interval: number;
  };
  
  // 认证配置
  access_token?: string;
  secret?: string;
  
  // 插件HTTP服务注册
  plugin_routes: {
    enabled: boolean;
    base_path: string;
  };
  
  // 重试配置
  retry: {
    enabled: boolean;
    max_attempts: number;
    delay: number;
    backoff_factor: number;
  };
  
  // 其他配置
  post_message_format: 'string' | 'array';
  enable_cors: boolean;
  cors_origin: string | string[];
  
  // 日志配置
  logging: {
    request_log: boolean;
    response_log: boolean;
    error_log: boolean;
    performance_log: boolean;
  };
}

export interface PluginHttpRoute {
  pluginName: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'ALL';
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body?: any) => Promise<void>;
  middleware?: Array<(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void>;
}

export interface OneBotEvent {
  time: number;
  self_id: number;
  post_type: 'message' | 'notice' | 'request' | 'meta_event';
  [key: string]: any;
}

export interface OneBotAPI {
  action: string;
  params: any;
  echo?: string;
}

export interface RetryOptions {
  maxAttempts: number;
  delay: number;
  backoffFactor: number;
}

export class OneBotHTTPAdapter extends BaseAdapter {
  public readonly metadata: AdapterMetadata = {
    name: 'onebot-http',
    version: '1.0.0',
    description: 'OneBot HTTP协议适配器',
    author: 'Rebot Framework',
    type: 'bidirectional',
    protocol: 'onebot-v11',
    dependencies: ['ws'],
    priority: 100
  };

  // 删除 name 属性，使用 metadata.name
  protected config: OneBotConfig;
  private connected = false;
  private messageCallback?: (message: Message) => void;
  private adapterManager?: AdapterManager;
  
  // HTTP服务器（独立模式）
  private httpServer?: http.Server;
  
  // 共享HTTP服务器引用
  private sharedHttpServer?: http.Server;
  
  // 声明式路由分配路径
  private allocatedPath?: string;
  
  // WebSocket服务器（正向）
  private wsServer?: WebSocket.Server;
  
  // WebSocket客户端（反向）
  private wsClients: Map<string, WebSocket> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  
  // 插件路由注册
  private pluginRoutes: Map<string, PluginHttpRoute> = new Map();
  
  // API处理器
  private apiHandlers: Map<string, (params: any) => Promise<any>> = new Map();
  
  // 性能统计
  private onebotStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    lastRequestTime: 0
  };

  constructor(config?: OneBotConfig) {
    super();
    Logger.info('🔧 OneBot HTTP适配器初始化开始...');
    
    // 如果没有传入配置，使用默认配置
    const defaultConfig: OneBotConfig = {
      http: {
        enabled: true,
        host: '127.0.0.1',
        port: 5700,
        timeout: 0,
        post_timeout: 0
      },
      ws: {
        enabled: false,
        host: '127.0.0.1',
        port: 6700
      },
      ws_reverse: {
        enabled: false,
        universal: '',
        api: '',
        event: '',
        reconnect_interval: 3000
      },
      plugin_routes: {
        enabled: true,
        base_path: '/plugins'
      },
      retry: {
        enabled: true,
        max_attempts: 3,
        delay: 1000,
        backoff_factor: 2
      },
      post_message_format: 'string',
      enable_cors: true,
      cors_origin: '*',
      logging: {
        request_log: true,
        response_log: true,
        error_log: true,
        performance_log: true
      }
    };
    
    this.config = {
      http: {
        ...(config?.http || defaultConfig.http),
        enabled: config?.http?.enabled !== undefined ? config.http.enabled : defaultConfig.http.enabled,
        host: config?.http?.host || defaultConfig.http.host,
        port: config?.http?.port || defaultConfig.http.port,
        timeout: config?.http?.timeout || defaultConfig.http.timeout,
        post_timeout: config?.http?.post_timeout || defaultConfig.http.post_timeout
      },
      ws: {
        ...(config?.ws || defaultConfig.ws),
        enabled: config?.ws?.enabled !== undefined ? config.ws.enabled : defaultConfig.ws.enabled,
        host: config?.ws?.host || defaultConfig.ws.host,
        port: config?.ws?.port || defaultConfig.ws.port
      },
      ws_reverse: {
        ...(config?.ws_reverse || defaultConfig.ws_reverse),
        enabled: config?.ws_reverse?.enabled !== undefined ? config.ws_reverse.enabled : defaultConfig.ws_reverse.enabled,
        universal: config?.ws_reverse?.universal || defaultConfig.ws_reverse.universal,
        api: config?.ws_reverse?.api || defaultConfig.ws_reverse.api,
        event: config?.ws_reverse?.event || defaultConfig.ws_reverse.event,
        reconnect_interval: config?.ws_reverse?.reconnect_interval || defaultConfig.ws_reverse.reconnect_interval
      },
      plugin_routes: {
        ...(config?.plugin_routes || defaultConfig.plugin_routes),
        enabled: config?.plugin_routes?.enabled !== undefined ? config.plugin_routes.enabled : defaultConfig.plugin_routes.enabled,
        base_path: config?.plugin_routes?.base_path || defaultConfig.plugin_routes.base_path
      },
      retry: {
        ...(config?.retry || defaultConfig.retry),
        enabled: config?.retry?.enabled !== undefined ? config.retry.enabled : defaultConfig.retry.enabled,
        max_attempts: config?.retry?.max_attempts || defaultConfig.retry.max_attempts,
        delay: config?.retry?.delay || defaultConfig.retry.delay,
        backoff_factor: config?.retry?.backoff_factor || defaultConfig.retry.backoff_factor
      },
      post_message_format: config?.post_message_format || defaultConfig.post_message_format,
      enable_cors: config?.enable_cors !== undefined ? config.enable_cors : defaultConfig.enable_cors,
      cors_origin: config?.cors_origin || defaultConfig.cors_origin,
      access_token: config?.access_token,
      secret: config?.secret,
      logging: {
        ...(config?.logging || defaultConfig.logging),
        request_log: config?.logging?.request_log !== undefined ? config.logging.request_log : defaultConfig.logging.request_log,
        response_log: config?.logging?.response_log !== undefined ? config.logging.response_log : defaultConfig.logging.response_log,
        error_log: config?.logging?.error_log !== undefined ? config.logging.error_log : defaultConfig.logging.error_log,
        performance_log: config?.logging?.performance_log !== undefined ? config.logging.performance_log : defaultConfig.logging.performance_log
      }
    };
    
    Logger.info('📋 OneBot配置加载完成:', {
      http_enabled: this.config.http.enabled,
      ws_enabled: this.config.ws.enabled,
      ws_reverse_enabled: this.config.ws_reverse.enabled,
      retry_enabled: this.config.retry.enabled,
      logging_enabled: this.config.logging.request_log
    });
    
    this.initializeAPIHandlers();
    Logger.info('✅ OneBot HTTP适配器初始化完成');
  }

  // 设置共享HTTP服务器
  public async setSharedHttpServer(server: http.Server): Promise<void> {
    Logger.info('🔗 OneBot适配器设置共享HTTP服务器...');
    this.sharedHttpServer = server;
    
    // 注册共享路由
    await this.registerSharedRoutes();
    Logger.info('✅ OneBot适配器共享路由已注册');
  }

  // 连接适配器
  public async connect(): Promise<void> {
    Logger.info('🚀 OneBot HTTP适配器连接开始...');
    
    try {
      // 启动HTTP服务器（如果启用且没有共享服务器）
      if (this.config.http.enabled && !this.sharedHttpServer) {
        await this.startHTTPServer();
      }
      
      // 启动WebSocket服务器（如果启用）
      if (this.config.ws.enabled) {
        await this.startWSServer();
      }
      
      // 连接反向WebSocket（如果启用）
      if (this.config.ws_reverse.enabled) {
        await this.connectReverseWS();
      }
      
      this.connected = true;
      Logger.info('✅ OneBot HTTP适配器连接成功');
      
    } catch (error) {
      Logger.error('❌ OneBot HTTP适配器连接失败:', error);
      throw error;
    }
  }

  // 断开连接
  public async disconnect(): Promise<void> {
    Logger.info('🔌 OneBot HTTP适配器断开连接...');
    
    try {
      // 关闭HTTP服务器
      if (this.httpServer) {
        this.httpServer.close();
        this.httpServer = undefined;
      }
      
      // 关闭WebSocket服务器
      if (this.wsServer) {
        this.wsServer.close();
        this.wsServer = undefined;
      }
      
      // 关闭反向WebSocket连接
      for (const [name, ws] of this.wsClients) {
        ws.close();
      }
      this.wsClients.clear();
      
      // 清理重连定时器
      for (const [name, timer] of this.reconnectTimers) {
        clearTimeout(timer);
      }
      this.reconnectTimers.clear();
      
      this.connected = false;
      Logger.info('✅ OneBot HTTP适配器已断开连接');
      
    } catch (error) {
      Logger.error('❌ OneBot HTTP适配器断开连接失败:', error);
      throw error;
    }
  }

  // 注册共享路由（使用声明式路由分配）
  private async registerSharedRoutes(): Promise<void> {
    if (!this.sharedHttpServer) return;
    
    Logger.info('🔗 OneBot适配器申请声明式路由分配...');
    
    try {
      // 向框架HTTP服务申请路由路径
      const response = await this.requestRouteAllocation('/onebot', 'OneBot v11 API服务');
      
      if (response.success) {
        Logger.info(`✅ OneBot路由分配成功: ${response.allocatedPath}`);
        this.allocatedPath = response.allocatedPath;
      } else {
        Logger.warn('⚠️ OneBot路由分配失败，回退到传统路由拦截模式');
        this.registerLegacySharedRoutes();
      }
    } catch (error) {
      Logger.error('❌ OneBot路由分配请求失败:', error);
      Logger.warn('⚠️ 回退到传统路由拦截模式');
      this.registerLegacySharedRoutes();
    }
  }

  // 获取框架HTTP服务端口
  private getFrameworkHttpPort(): number {
    // 尝试从环境变量获取
    const envPort = process.env.FRAMEWORK_HTTP_PORT;
    if (envPort) {
      const port = parseInt(envPort, 10);
      if (!isNaN(port) && port > 0) {
        return port;
      }
    }
    
    // 默认端口
    return 3000;
  }

  // 申请路由分配
  private async requestRouteAllocation(requestedPath: string, description: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        pluginName: 'onebot-adapter',
        requestedPath,
        description
      });

      const options = {
         hostname: 'localhost',
         port: this.getFrameworkHttpPort(), // 动态获取框架HTTP服务端口
         path: '/api/plugins/request-path',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  // 传统路由拦截模式（兼容性回退）
  private registerLegacySharedRoutes(): void {
    if (!this.sharedHttpServer) return;
    
    Logger.info('🔗 注册OneBot传统共享路由处理器');
    
    // 保存原始的request事件监听器
    const originalListeners = this.sharedHttpServer.listeners('request');
    
    // 移除所有现有的request监听器
    this.sharedHttpServer.removeAllListeners('request');
    
    // 添加OneBot路由处理器
    this.sharedHttpServer.on('request', async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      
      // 检查是否是OneBot API请求
      if (this.isOneBotRequest(parsedUrl.pathname)) {
        await this.handleHTTPRequest(req, res);
        return;
      }
      
      // 如果不是OneBot请求，传递给原始处理器
      for (const listener of originalListeners) {
        if (typeof listener === 'function') {
          listener.call(this.sharedHttpServer, req, res);
          break;
        }
      }
    });
    
    Logger.info('✅ OneBot传统共享路由注册完成');
  }

  // 实现插件HTTP请求处理方法（用于声明式路由分配）
  public async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse, body: any, subPath: string): Promise<void> {
    Logger.debug(`🔗 OneBot适配器处理HTTP请求: ${req.method} ${subPath}`);
    
    // 重构URL以匹配OneBot API格式
    const originalUrl = req.url;
    req.url = subPath || '/';
    
    try {
      await this.handleHTTPRequest(req, res);
    } finally {
      // 恢复原始URL
      req.url = originalUrl;
    }
  }

  // 检查是否是OneBot请求
  public isOneBotRequest(pathname: string): boolean {
    // OneBot API路径格式: /:action 或 /:action/
    const onebotApiPattern = /^\/[a-zA-Z_][a-zA-Z0-9_]*\/?$/;
    
    // 插件路由路径
    const pluginRoutePattern = new RegExp(`^${this.config.plugin_routes.base_path}/`);
    
    return onebotApiPattern.test(pathname) || pluginRoutePattern.test(pathname);
  }

  // 启动HTTP服务器
  private async startHTTPServer(): Promise<void> {
    Logger.info(`🌐 启动OneBot独立HTTP服务器: ${this.config.http.host}:${this.config.http.port}`);
    
    this.httpServer = http.createServer((req, res) => {
      this.handleHTTPRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.config.http.port, this.config.http.host, (error?: Error) => {
        if (error) {
          Logger.error('❌ OneBot HTTP服务器启动失败:', error);
          reject(error);
        } else {
          Logger.info(`✅ OneBot HTTP服务器已启动: http://${this.config.http.host}:${this.config.http.port}`);
          resolve();
        }
      });
    });
  }

  // 启动WebSocket服务器
  private async startWSServer(): Promise<void> {
    Logger.info(`🔗 启动OneBot WebSocket服务器: ${this.config.ws.host}:${this.config.ws.port}`);
    
    this.wsServer = new WebSocket.Server({
      host: this.config.ws.host,
      port: this.config.ws.port
    });

    this.wsServer.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      const clientIP = req.socket.remoteAddress;
      Logger.info(`🔗 WebSocket客户端已连接: ${clientIP}`);
      
      ws.on('message', (data: WebSocket.Data) => {
        this.handleWSMessage(ws, data);
      });
      
      ws.on('close', () => {
        Logger.info(`🔌 WebSocket客户端已断开: ${clientIP}`);
      });
      
      ws.on('error', (error: Error) => {
        Logger.error(`❌ WebSocket错误 (${clientIP}):`, error);
      });
    });

    Logger.info(`✅ OneBot WebSocket服务器已启动: ws://${this.config.ws.host}:${this.config.ws.port}`);
  }

  // 连接反向WebSocket
  private async connectReverseWS(): Promise<void> {
    const connections = [
      { name: 'universal', url: this.config.ws_reverse.universal },
      { name: 'api', url: this.config.ws_reverse.api },
      { name: 'event', url: this.config.ws_reverse.event }
    ].filter(conn => conn.url);

    Logger.info(`🔄 启动反向WebSocket连接 (${connections.length}个)`);

    for (const conn of connections) {
      this.connectSingleReverseWS(conn.name, conn.url);
    }
  }

  private connectSingleReverseWS(name: string, wsUrl: string): void {
    try {
      Logger.info(`🔄 连接反向WebSocket: ${name} -> ${wsUrl}`);
      
      const headers: any = {};
      if (this.config.access_token) {
        headers['Authorization'] = `Bearer ${this.config.access_token}`;
      }

      const ws = new WebSocket(wsUrl, [], { headers });
      
      ws.on('open', () => {
        Logger.info(`✅ 反向WebSocket已连接: ${name} -> ${wsUrl}`);
        this.wsClients.set(name, ws);
      });
      
      ws.on('message', (data: WebSocket.Data) => {
        if (this.config.logging.request_log) {
          Logger.debug(`📨 反向WebSocket消息 (${name}):`, data.toString());
        }
        this.handleWSMessage(ws, data);
      });
      
      ws.on('close', () => {
        Logger.warn(`🔌 反向WebSocket已断开: ${name}`);
        this.wsClients.delete(name);
        this.scheduleReverseWSReconnect(name, wsUrl);
      });
      
      ws.on('error', (error: Error) => {
        Logger.error(`❌ 反向WebSocket错误 ${name}:`, error);
        this.scheduleReverseWSReconnect(name, wsUrl);
      });
      
    } catch (error) {
      Logger.error(`❌ 反向WebSocket连接失败 ${name}:`, error);
      this.scheduleReverseWSReconnect(name, wsUrl);
    }
  }

  private scheduleReverseWSReconnect(name: string, wsUrl: string): void {
    const existingTimer = this.reconnectTimers.get(name);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      Logger.info(`🔄 重连反向WebSocket: ${name}`);
      this.connectSingleReverseWS(name, wsUrl);
      this.reconnectTimers.delete(name);
    }, this.config.ws_reverse.reconnect_interval);

    this.reconnectTimers.set(name, timer);
    Logger.debug(`⏰ 反向WebSocket重连已调度: ${name} (${this.config.ws_reverse.reconnect_interval}ms)`);
  }

  // 处理HTTP请求
  private async handleHTTPRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const startTime = Date.now();
    const clientIP = req.socket.remoteAddress || 'unknown';
    const method = req.method || 'GET';
    const url = req.url || '/';
    
    this.onebotStats.totalRequests++;
    this.onebotStats.lastRequestTime = startTime;
    
    if (this.config.logging.request_log) {
      Logger.info(`📨 OneBot HTTP请求: ${method} ${url} from ${clientIP}`);
    }
    
    try {
      // 设置CORS头
      if (this.config.enable_cors) {
        this.setCORSHeaders(res);
      }
      
      // 处理OPTIONS预检请求
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // 验证访问令牌
      if (!this.verifyAccessToken(req)) {
        this.sendError(res, 403, 'Access token verification failed');
        this.onebotStats.failedRequests++;
        return;
      }

      const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
      
      // 处理插件路由
      if (parsedUrl.pathname.startsWith(this.config.plugin_routes.base_path)) {
        await this.handlePluginRoute(req, res, parsedUrl);
        return;
      }
      
      // 处理OneBot API
      await this.handleOneBotAPIInternal(req, res);
      
      this.onebotStats.successfulRequests++;
      
    } catch (error) {
      Logger.error(`❌ OneBot HTTP请求处理失败 (${method} ${url}):`, error);
      this.sendError(res, 500, 'Internal server error');
      this.onebotStats.failedRequests++;
    } finally {
      const duration = Date.now() - startTime;
      this.updatePerformanceStats(duration);
      
      if (this.config.logging.performance_log) {
        Logger.debug(`⏱️ OneBot请求处理完成: ${method} ${url} (${duration}ms)`);
      }
    }
  }

  // 更新性能统计
  private updatePerformanceStats(duration: number): void {
    const totalRequests = this.onebotStats.totalRequests;
      this.onebotStats.averageResponseTime =
        (this.onebotStats.averageResponseTime * (totalRequests - 1) + duration) / totalRequests;
  }

  // 处理插件路由
  private async handlePluginRoute(req: http.IncomingMessage, res: http.ServerResponse, parsedUrl: URL): Promise<void> {
    const pathParts = parsedUrl.pathname.split('/').filter(p => p);
    if (pathParts.length < 2) {
      this.sendError(res, 404, 'Plugin route not found');
      return;
    }
    
    const pluginName = pathParts[1];
    const routePath = '/' + pathParts.slice(2).join('/');
    const method = req.method || 'GET';
    
    const routeKey = `${pluginName}:${method}:${routePath}`;
    const route = this.pluginRoutes.get(routeKey) || this.pluginRoutes.get(`${pluginName}:ALL:${routePath}`);
    
    if (!route) {
      this.sendError(res, 404, `Plugin route not found: ${method} ${routePath}`);
      return;
    }
    
    Logger.info(`🔗 处理插件路由: ${pluginName} ${method} ${routePath}`);
    
    try {
      const body = await this.parseRequestBody(req);
      await route.handler(req, res, body);
    } catch (error) {
      Logger.error(`❌ 插件路由处理失败 (${pluginName}):`, error);
      this.sendError(res, 500, 'Plugin route handler error');
    }
  }

  // 公共方法：处理OneBot API请求（供HTTP适配器调用）
  public async handleOneBotAPI(request: any): Promise<any> {
    const apiRequest: OneBotAPI = {
      action: request.url.substring(1).replace(/\/$/, ''), // 移除开头的/和结尾的/
      params: request.body || {},
      echo: request.body?.echo
    };

    if (this.config.logging?.request_log) {
      Logger.info(`🎯 OneBot API调用: ${apiRequest.action}`, apiRequest.params);
    }

    try {
      const result = await this.executeAPIWithRetry(apiRequest);
      
      const response = {
        status: 'ok',
        retcode: 0,
        data: result,
        echo: apiRequest.echo
      };
      
      if (this.config.logging?.response_log) {
        Logger.info(`✅ OneBot API响应: ${apiRequest.action}`, response);
      }
      
      return response;
      
    } catch (error) {
      if (this.config.logging?.error_log) {
        Logger.error(`❌ OneBot API执行失败: ${apiRequest.action}`, error);
      }
      
      throw error;
    }
  }

  // 处理OneBot API（私有方法，用于内部HTTP服务器）
  private async handleOneBotAPIInternal(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.parseRequestBody(req);
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const action = parsedUrl.pathname?.substring(1).replace(/\/$/, '') || '';
    
    const apiRequest: OneBotAPI = {
      action: action,
      params: body || Object.fromEntries(parsedUrl.searchParams),
      echo: body?.echo || parsedUrl.searchParams.get('echo') as string
    };

    if (this.config.logging.request_log) {
      Logger.info(`🎯 OneBot API调用: ${action}`, apiRequest.params);
    }

    try {
      const result = await this.executeAPIWithRetry(apiRequest);
      
      const response = {
        status: 'ok',
        retcode: 0,
        data: result,
        echo: apiRequest.echo
      };
      
      if (this.config.logging.response_log) {
        Logger.info(`✅ OneBot API响应: ${action}`, response);
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      
    } catch (error) {
      if (this.config.logging.error_log) {
        Logger.error(`❌ OneBot API执行失败: ${action}`, error);
      }
      
      this.sendError(res, 500, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // 处理WebSocket消息
  private handleWSMessage(ws: WebSocket, data: WebSocket.Data): void {
    try {
      const rawMessage = data.toString();
      const message = JSON.parse(rawMessage) as OneBotAPI;
      
      if (this.config.logging.request_log) {
        Logger.info(`📨 OneBot WebSocket API: ${message.action}`, message.params);
      }
      
      this.executeAPIWithRetry(message).then(result => {
        const response = {
          status: 'ok',
          retcode: 0,
          data: result,
          echo: message.echo
        };
        
        if (this.config.logging.response_log) {
          Logger.debug(`📤 OneBot WebSocket响应: ${message.action}`, response);
        }
        
        ws.send(JSON.stringify(response));
      }).catch(error => {
        if (this.config.logging.error_log) {
          Logger.error(`❌ OneBot WebSocket API失败: ${message.action}`, {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            params: message.params
          });
        }
        
        const errorResponse = {
          status: 'failed',
          retcode: -1,
          data: null,
          echo: message.echo,
          msg: error instanceof Error ? error.message : 'Unknown error'
        };
        
        ws.send(JSON.stringify(errorResponse));
      });
      
    } catch (error) {
      Logger.error('❌ OneBot WebSocket消息解析失败:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        rawData: data.toString().substring(0, 200) + (data.toString().length > 200 ? '...' : ''),
        dataLength: data.toString().length
      });
      
      // 尝试发送错误响应
      try {
        const errorResponse = {
          status: 'failed',
          retcode: -1,
          data: null,
          echo: null,
          msg: 'Message parsing failed: ' + (error instanceof Error ? error.message : String(error))
        };
        
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(errorResponse));
        }
      } catch (sendError) {
        Logger.error('❌ 发送WebSocket错误响应失败:', sendError);
      }
    }
  }

  // 带重试的API执行
  private async executeAPIWithRetry(request: OneBotAPI): Promise<any> {
    if (!this.config.retry.enabled) {
      return await this.executeAPI(request);
    }

    const retryOptions: RetryOptions = {
      maxAttempts: this.config.retry.max_attempts,
      delay: this.config.retry.delay,
      backoffFactor: this.config.retry.backoff_factor
    };

    return await this.retryOperation(
      () => this.executeAPI(request),
      retryOptions,
      `API: ${request.action}`
    );
  }

  // 通用重试机制
  private async retryOperation<T>(
    operation: () => Promise<T>,
    options: RetryOptions,
    operationName: string
  ): Promise<T> {
    let lastError: Error;
    let delay = options.delay;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          Logger.info(`🔄 重试操作 (${attempt}/${options.maxAttempts}): ${operationName}`);
        }
        
        const result = await operation();
        
        if (attempt > 1) {
          Logger.info(`✅ 重试成功: ${operationName} (第${attempt}次尝试)`);
        }
        
        return result;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < options.maxAttempts) {
          Logger.warn(`⚠️ 操作失败，将在${delay}ms后重试 (${attempt}/${options.maxAttempts}): ${operationName}`, lastError.message);
          
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= options.backoffFactor;
        } else {
          Logger.error(`❌ 操作最终失败 (${attempt}/${options.maxAttempts}): ${operationName}`, lastError);
        }
      }
    }

    throw lastError!;
  }

  // 执行API
  private async executeAPI(request: OneBotAPI): Promise<any> {
    const handler = this.apiHandlers.get(request.action);
    if (!handler) {
      const availableActions = Array.from(this.apiHandlers.keys()).join(', ');
      throw new Error(`Unknown API action: ${request.action}. Available actions: ${availableActions}`);
    }
    
    try {
      const result = await handler(request.params || {});
      
      if (this.config.logging.response_log) {
        Logger.debug(`🎯 OneBot API执行成功: ${request.action}`, {
          params: request.params,
          result: result
        });
      }
      
      return result;
    } catch (error) {
      Logger.error(`❌ OneBot API执行异常: ${request.action}`, {
        params: request.params,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  // 广播事件到所有WebSocket连接
  private broadcastEvent(event: OneBotEvent): void {
    const eventData = JSON.stringify(event);
    
    if (this.config.logging.request_log) {
      Logger.debug(`📡 广播OneBot事件: ${event.post_type}`, event);
    }
    
    // 发送到正向WebSocket客户端
    if (this.wsServer) {
      this.wsServer.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(eventData);
        }
      });
    }
    
    // 发送到反向WebSocket连接
    for (const [name, ws] of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(eventData);
      }
    }
  }

  // 初始化API处理器
  private initializeAPIHandlers(): void {
    // 消息相关API
    this.apiHandlers.set('send_private_msg', async (params) => {
      const { user_id, message } = params;
      
      try {
        // 尝试通过底层适配器发送消息
        if (this.adapterManager) {
          const adapters = this.adapterManager.getAllAdapters();
          for (const adapter of adapters) {
            if (adapter.name.includes('qq') && adapter.isConnected()) {
              const result = await (adapter as any).sendPrivateMessage?.(user_id.toString(), message);
              if (result && result.messageId) {
                return { message_id: parseInt(result.messageId) || Date.now() };
              }
            }
          }
        }
        
        // 如果没有底层适配器，使用模拟发送
        await this.sendMessageToTarget(user_id.toString(), message);
        return { message_id: Date.now() };
      } catch (error) {
        Logger.error(`发送私聊消息失败 (${user_id}):`, error);
        throw error;
      }
    });
    
    this.apiHandlers.set('send_group_msg', async (params) => {
      const { group_id, message } = params;
      
      try {
        // 尝试通过底层适配器发送消息
        if (this.adapterManager) {
          const adapters = this.adapterManager.getAllAdapters();
          for (const adapter of adapters) {
            if (adapter.name.includes('qq') && adapter.isConnected()) {
              const result = await (adapter as any).sendGroupMessage?.(group_id.toString(), message);
              if (result && result.messageId) {
                return { message_id: parseInt(result.messageId) || Date.now() };
              }
            }
          }
        }
        
        // 如果没有底层适配器，使用模拟发送
        await this.sendMessageToTarget(group_id.toString(), message);
        return { message_id: Date.now() };
      } catch (error) {
        Logger.error(`发送群消息失败 (${group_id}):`, error);
        throw error;
      }
    });

    this.apiHandlers.set('send_msg', async (params) => {
      const { message_type, user_id, group_id, message } = params;
      
      try {
        if (message_type === 'private') {
          return await this.apiHandlers.get('send_private_msg')!({ user_id, message });
        } else if (message_type === 'group') {
          return await this.apiHandlers.get('send_group_msg')!({ group_id, message });
        } else {
          throw new Error(`不支持的消息类型: ${message_type}`);
        }
      } catch (error) {
        Logger.error(`发送消息失败 (${message_type}):`, error);
        throw error;
      }
    });

    this.apiHandlers.set('delete_msg', async (params) => {
      Logger.info(`删除消息: ${params.message_id}`);
      return {};
    });

    this.apiHandlers.set('get_msg', async (params) => {
      return {
        message_id: params.message_id,
        real_id: params.message_id,
        sender: {
          user_id: 0,
          nickname: 'Unknown',
          card: '',
          sex: 'unknown',
          age: 0,
          area: '',
          level: '1',
          role: 'member',
          title: ''
        },
        time: Math.floor(Date.now() / 1000),
        message_type: 'group',
        message_id_v2: params.message_id,
        message: '消息内容',
        raw_message: '消息内容'
      };
    });

    this.apiHandlers.set('get_forward_msg', async (params) => {
      try {
        const messageId = params.id || params.message_id;
        
        // 尝试从底层适配器获取合并转发消息
        if (this.adapterManager) {
          const adapters = this.adapterManager.getAllAdapters();
          for (const adapter of adapters) {
            if (adapter.name.includes('qq') && adapter.isConnected()) {
              const forwardMsg = await (adapter as any).getForwardMessage?.(messageId);
              if (forwardMsg && forwardMsg.messages) {
                return {
                  messages: forwardMsg.messages.map((msg: any) => ({
                    message_id: msg.id || Date.now(),
                    real_id: msg.realId || msg.id || Date.now(),
                    sender: {
                      user_id: parseInt(msg.sender?.id) || 0,
                      nickname: msg.sender?.nickname || 'Unknown',
                      card: msg.sender?.card || '',
                      sex: msg.sender?.sex || 'unknown',
                      age: msg.sender?.age || 0,
                      area: msg.sender?.area || '',
                      level: msg.sender?.level || '1',
                      role: msg.sender?.role || 'member',
                      title: msg.sender?.title || ''
                    },
                    time: msg.time || Math.floor(Date.now() / 1000),
                    message_type: msg.messageType || 'group',
                    message: msg.content || msg.message || '',
                    raw_message: msg.rawContent || msg.raw_message || msg.content || msg.message || ''
                  }))
                };
              }
            }
          }
        }

        // 如果无法获取真实数据，返回模拟数据用于测试
        Logger.warn(`无法获取消息 ${messageId} 的真实合并转发内容，返回模拟数据`);
        return {
          messages: [
            {
              message_id: Date.now(),
              real_id: Date.now(),
              sender: {
                user_id: 10001,
                nickname: '转发者1',
                card: '',
                sex: 'unknown',
                age: 0,
                area: '',
                level: '1',
                role: 'member',
                title: ''
              },
              time: Math.floor(Date.now() / 1000) - 3600,
              message_type: 'group',
              message: '这是一条转发的消息',
              raw_message: '这是一条转发的消息'
            },
            {
              message_id: Date.now() + 1,
              real_id: Date.now() + 1,
              sender: {
                user_id: 10002,
                nickname: '转发者2',
                card: '',
                sex: 'unknown',
                age: 0,
                area: '',
                level: '1',
                role: 'member',
                title: ''
              },
              time: Math.floor(Date.now() / 1000) - 1800,
              message_type: 'group',
              message: '这是另一条转发的消息',
              raw_message: '这是另一条转发的消息'
            }
          ]
        };
      } catch (error) {
        Logger.error(`获取合并转发消息 ${params.id || params.message_id} 失败:`, error);
        return { messages: [] };
      }
    });

    this.apiHandlers.set('send_like', async (params) => {
      Logger.info(`发送好友赞: ${params.user_id}, 次数: ${params.times || 1}`);
      return {};
    });

    // 群组相关API
    this.apiHandlers.set('set_group_kick', async (params) => {
      Logger.info(`踢出群成员: ${params.group_id}, ${params.user_id}`);
      return {};
    });

    this.apiHandlers.set('set_group_ban', async (params) => {
      Logger.info(`禁言群成员: ${params.group_id}, ${params.user_id}, 时长: ${params.duration || 0}`);
      return {};
    });

    this.apiHandlers.set('set_group_anonymous_ban', async (params) => {
      Logger.info(`禁言匿名用户: ${params.group_id}`);
      return {};
    });

    this.apiHandlers.set('set_group_whole_ban', async (params) => {
      Logger.info(`全群禁言: ${params.group_id}, 启用: ${params.enable}`);
      return {};
    });

    this.apiHandlers.set('set_group_admin', async (params) => {
      Logger.info(`设置群管理员: ${params.group_id}, ${params.user_id}, 启用: ${params.enable}`);
      return {};
    });

    this.apiHandlers.set('set_group_anonymous', async (params) => {
      Logger.info(`设置群匿名: ${params.group_id}, 启用: ${params.enable}`);
      return {};
    });

    this.apiHandlers.set('set_group_card', async (params) => {
      Logger.info(`设置群名片: ${params.group_id}, ${params.user_id}, 名片: ${params.card}`);
      return {};
    });

    this.apiHandlers.set('set_group_name', async (params) => {
      Logger.info(`设置群名: ${params.group_id}, 名称: ${params.group_name}`);
      return {};
    });

    this.apiHandlers.set('set_group_leave', async (params) => {
      Logger.info(`退出群聊: ${params.group_id}, 是否解散: ${params.is_dismiss}`);
      return {};
    });

    this.apiHandlers.set('set_group_special_title', async (params) => {
      Logger.info(`设置群特殊头衔: ${params.group_id}, ${params.user_id}, 头衔: ${params.special_title}`);
      return {};
    });

    // 好友相关API
    this.apiHandlers.set('set_friend_add_request', async (params) => {
      Logger.info(`处理加好友请求: ${params.flag}, 同意: ${params.approve}`);
      return {};
    });

    this.apiHandlers.set('set_group_add_request', async (params) => {
      Logger.info(`处理加群请求: ${params.flag}, 同意: ${params.approve}`);
      return {};
    });

    // 信息获取API
    this.apiHandlers.set('get_login_info', async () => {
      try {
        // 尝试从底层适配器获取登录信息
        if (this.adapterManager) {
          const adapters = this.adapterManager.getAllAdapters();
          for (const adapter of adapters) {
            if (adapter.name.includes('qq') && adapter.isConnected()) {
              const loginInfo = await (adapter as any).getLoginInfo?.();
              if (loginInfo) {
                return {
                  user_id: parseInt(loginInfo.id) || parseInt(loginInfo.user_id) || 0,
                  nickname: loginInfo.name || loginInfo.nickname || 'Unknown'
                };
              }
            }
          }
        }

        // 如果无法获取真实数据，返回模拟数据用于测试
        Logger.warn('无法获取真实登录信息，返回模拟数据');
        return {
          user_id: 10000,
          nickname: 'OneBot测试账号'
        };
      } catch (error) {
        Logger.error('获取登录信息失败:', error);
        return {
          user_id: 0,
          nickname: 'OneBot'
        };
      }
    });

    this.apiHandlers.set('get_stranger_info', async (params) => {
      try {
        const userId = params.user_id;
        
        // 尝试从底层适配器获取用户信息
        if (this.adapterManager) {
          const adapters = this.adapterManager.getAllAdapters();
          for (const adapter of adapters) {
            if (adapter.name.includes('qq') && adapter.isConnected()) {
              const userInfo = await (adapter as any).getUserInfo?.(userId);
              if (userInfo) {
                return {
                  user_id: parseInt(userInfo.id) || parseInt(userInfo.user_id) || userId,
                  nickname: userInfo.name || userInfo.nickname || 'Unknown',
                  sex: userInfo.sex || 'unknown',
                  age: userInfo.age || 0,
                  qid: userInfo.qid || '',
                  level: userInfo.level || 1,
                  login_days: userInfo.login_days || 0
                };
              }
            }
          }
        }

        // 如果无法获取真实数据，返回模拟数据
        Logger.warn(`无法获取用户 ${userId} 的真实信息，返回模拟数据`);
        return {
          user_id: userId,
          nickname: `用户${userId}`,
          sex: 'unknown',
          age: 0,
          qid: '',
          level: 1,
          login_days: 0
        };
      } catch (error) {
        Logger.error(`获取用户 ${params.user_id} 信息失败:`, error);
        return {
          user_id: params.user_id,
          nickname: 'Unknown',
          sex: 'unknown',
          age: 0,
          qid: '',
          level: 1,
          login_days: 0
        };
      }
    });

    this.apiHandlers.set('get_friend_list', async () => {
      try {
        // 尝试从底层适配器获取好友列表
        if (this.adapterManager) {
          const adapters = this.adapterManager.getAllAdapters();
          for (const adapter of adapters) {
            if (adapter.name.includes('qq') && adapter.isConnected()) {
              const friendList = await (adapter as any).getFriendList?.();
              if (friendList && Array.isArray(friendList)) {
                return friendList.map((friend: any) => ({
                  user_id: parseInt(friend.id) || 0,
                  nickname: friend.name || friend.nickname || 'Unknown',
                  remark: friend.remark || '',
                  sex: friend.sex || 'unknown',
                  age: friend.age || 0
                }));
              }
            }
          }
        }

        // 如果无法获取真实数据，返回模拟数据用于测试
        Logger.warn('无法获取真实好友列表，返回模拟数据');
        return [
          {
            user_id: 10001,
            nickname: '测试好友1',
            remark: '备注1',
            sex: 'unknown',
            age: 0
          },
          {
            user_id: 10002,
            nickname: '测试好友2',
            remark: '备注2',
            sex: 'unknown',
            age: 0
          }
        ];
      } catch (error) {
        Logger.error('获取好友列表失败:', error);
        return [];
      }
    });

    this.apiHandlers.set('get_group_list', async () => {
      try {
        // 尝试从底层适配器获取群组列表
        if (this.adapterManager) {
          const adapters = this.adapterManager.getAllAdapters();
          for (const adapter of adapters) {
            if (adapter.name.includes('qq') && adapter.isConnected()) {
              const groupList = await (adapter as any).getGroupList?.();
              if (groupList && Array.isArray(groupList)) {
                return groupList.map((group: any) => ({
                  group_id: parseInt(group.id) || 0,
                  group_name: group.name || 'Unknown Group',
                  member_count: group.memberCount || 0,
                  max_member_count: group.maxMemberCount || 0
                }));
              }
            }
          }
        }

        // 如果无法获取真实数据，返回模拟数据用于测试
        Logger.warn('无法获取真实群组列表，返回模拟数据');
        return [
          {
            group_id: 20001,
            group_name: '测试群组1',
            member_count: 50,
            max_member_count: 200
          },
          {
            group_id: 20002,
            group_name: '测试群组2',
            member_count: 100,
            max_member_count: 500
          }
        ];
      } catch (error) {
        Logger.error('获取群组列表失败:', error);
        return [];
      }
    });

    this.apiHandlers.set('get_group_info', async (params) => {
      try {
        const groupId = params.group_id;
        
        // 尝试从底层适配器获取群组信息
        if (this.adapterManager) {
          const adapters = this.adapterManager.getAllAdapters();
          for (const adapter of adapters) {
            if (adapter.name.includes('qq') && adapter.isConnected()) {
              const groupInfo = await (adapter as any).getGroupInfo?.(groupId);
              if (groupInfo) {
                return {
                  group_id: parseInt(groupInfo.id) || parseInt(groupInfo.group_id) || groupId,
                  group_name: groupInfo.name || groupInfo.group_name || 'Unknown Group',
                  member_count: groupInfo.memberCount || groupInfo.member_count || 0,
                  max_member_count: groupInfo.maxMemberCount || groupInfo.max_member_count || 0
                };
              }
            }
          }
        }

        // 如果无法获取真实数据，返回模拟数据
        Logger.warn(`无法获取群 ${groupId} 的真实信息，返回模拟数据`);
        return {
          group_id: groupId,
          group_name: `测试群组${groupId}`,
          member_count: 50,
          max_member_count: 200
        };
      } catch (error) {
        Logger.error(`获取群 ${params.group_id} 信息失败:`, error);
        return {
          group_id: params.group_id,
          group_name: 'Unknown Group',
          member_count: 0,
          max_member_count: 0
        };
      }
    });

    this.apiHandlers.set('get_group_member_list', async (params) => {
      try {
        const groupId = params.group_id;
        
        // 尝试从底层适配器获取群成员列表
        if (this.adapterManager) {
          const adapters = this.adapterManager.getAllAdapters();
          for (const adapter of adapters) {
            if (adapter.name.includes('qq') && adapter.isConnected()) {
              const memberList = await (adapter as any).getGroupMemberList?.(groupId);
              if (memberList && Array.isArray(memberList)) {
                return memberList.map((member: any) => ({
                  group_id: groupId,
                  user_id: parseInt(member.id) || parseInt(member.user_id) || 0,
                  nickname: member.nickname || member.name || 'Unknown',
                  card: member.card || member.group_card || '',
                  sex: member.sex || 'unknown',
                  age: member.age || 0,
                  area: member.area || '',
                  join_time: member.join_time || Math.floor(Date.now() / 1000),
                  last_sent_time: member.last_sent_time || 0,
                  level: member.level || '1',
                  role: member.role || 'member',
                  unfriendly: member.unfriendly || false,
                  title: member.title || '',
                  title_expire_time: member.title_expire_time || 0,
                  card_changeable: member.card_changeable !== false
                }));
              }
            }
          }
        }

        // 如果无法获取真实数据，返回模拟数据用于测试
        Logger.warn(`无法获取群 ${groupId} 的真实成员列表，返回模拟数据`);
        return [
          {
            group_id: groupId,
            user_id: 10001,
            nickname: '群成员1',
            card: '成员1',
            sex: 'unknown',
            age: 0,
            area: '',
            join_time: Math.floor(Date.now() / 1000) - 86400,
            last_sent_time: Math.floor(Date.now() / 1000) - 3600,
            level: '1',
            role: 'member',
            unfriendly: false,
            title: '',
            title_expire_time: 0,
            card_changeable: true
          },
          {
            group_id: groupId,
            user_id: 10002,
            nickname: '群成员2',
            card: '管理员',
            sex: 'unknown',
            age: 0,
            area: '',
            join_time: Math.floor(Date.now() / 1000) - 172800,
            last_sent_time: Math.floor(Date.now() / 1000) - 1800,
            level: '5',
            role: 'admin',
            unfriendly: false,
            title: '活跃成员',
            title_expire_time: Math.floor(Date.now() / 1000) + 2592000,
            card_changeable: true
          }
        ];
      } catch (error) {
        Logger.error(`获取群 ${params.group_id} 成员列表失败:`, error);
        return [];
      }
    });

    this.apiHandlers.set('get_group_member_info', async (params) => {
      try {
        const groupId = params.group_id;
        const userId = params.user_id;
        
        // 尝试从底层适配器获取群成员信息
        if (this.adapterManager) {
          const adapters = this.adapterManager.getAllAdapters();
          for (const adapter of adapters) {
            if (adapter.name.includes('qq') && adapter.isConnected()) {
              const memberInfo = await (adapter as any).getGroupMemberInfo?.(groupId, userId);
              if (memberInfo) {
                return {
                  group_id: groupId,
                  user_id: parseInt(memberInfo.id) || parseInt(memberInfo.user_id) || userId,
                  nickname: memberInfo.nickname || memberInfo.name || 'Unknown',
                  card: memberInfo.card || memberInfo.group_card || '',
                  sex: memberInfo.sex || 'unknown',
                  age: memberInfo.age || 0,
                  area: memberInfo.area || '',
                  join_time: memberInfo.join_time || Math.floor(Date.now() / 1000),
                  last_sent_time: memberInfo.last_sent_time || 0,
                  level: memberInfo.level || '1',
                  role: memberInfo.role || 'member',
                  unfriendly: memberInfo.unfriendly || false,
                  title: memberInfo.title || '',
                  title_expire_time: memberInfo.title_expire_time || 0,
                  card_changeable: memberInfo.card_changeable !== false
                };
              }
            }
          }
        }

        // 如果无法获取真实数据，返回模拟数据
        Logger.warn(`无法获取群 ${groupId} 成员 ${userId} 的真实信息，返回模拟数据`);
        return {
          group_id: groupId,
          user_id: userId,
          nickname: `成员${userId}`,
          card: '',
          sex: 'unknown',
          age: 0,
          area: '',
          join_time: Math.floor(Date.now() / 1000) - 86400,
          last_sent_time: Math.floor(Date.now() / 1000) - 3600,
          level: '1',
          role: 'member',
          unfriendly: false,
          title: '',
          title_expire_time: 0,
          card_changeable: true
        };
      } catch (error) {
        Logger.error(`获取群 ${params.group_id} 成员 ${params.user_id} 信息失败:`, error);
        return {
          group_id: params.group_id,
          user_id: params.user_id,
          nickname: 'Unknown',
          card: '',
          sex: 'unknown',
          age: 0,
          area: '',
          join_time: 0,
          last_sent_time: 0,
          level: '1',
          role: 'member',
          unfriendly: false,
          title: '',
          title_expire_time: 0,
          card_changeable: true
        };
      }
    });

    // 文件和媒体API
    this.apiHandlers.set('get_image', async (params) => {
      return { file: params.file };
    });

    this.apiHandlers.set('get_record', async (params) => {
      return { file: params.file };
    });

    this.apiHandlers.set('get_file', async (params) => {
      return { file: params.file };
    });

    // 系统相关API
    this.apiHandlers.set('get_status', async () => {
      try {
        let realStatus = {
          online: false,
          good: false
        };

        // 尝试从底层适配器获取真实状态
        if (this.adapterManager) {
          const adapters = this.adapterManager.getAllAdapters();
          for (const adapter of adapters) {
            if (adapter.name.includes('qq') && adapter.isConnected()) {
              const status = await (adapter as any).getStatus?.();
              if (status) {
                realStatus = {
                  online: status.online !== false,
                  good: status.good !== false
                };
                break;
              } else {
                // 如果没有getStatus方法，根据连接状态判断
                realStatus = {
                  online: true,
                  good: true
                };
                break;
              }
            }
          }
        }

        return {
          online: realStatus.online && this.connected,
          good: realStatus.good && this.connected,
          stat: {
            ...this.stats,
            packet_received: this.onebotStats.totalRequests,
        packet_sent: this.onebotStats.successfulRequests,
        packet_lost: this.onebotStats.failedRequests,
        message_received: this.onebotStats.totalRequests,
        message_sent: this.onebotStats.successfulRequests,
        disconnect_times: 0,
        lost_times: this.onebotStats.failedRequests,
        last_message_time: this.onebotStats.lastRequestTime
          }
        };
      } catch (error) {
        Logger.error('获取状态信息失败:', error);
        return {
          online: this.connected,
          good: false,
          stat: this.stats
        };
      }
    });

    this.apiHandlers.set('get_version_info', async () => {
      return {
        app_name: 'OneBot HTTP Adapter',
        app_version: '1.0.0',
        protocol_version: 'v11'
      };
    });

    this.apiHandlers.set('set_restart', async (params) => {
      Logger.info(`重启OneBot: 延迟 ${params.delay || 0}ms`);
      return {};
    });

    this.apiHandlers.set('clean_cache', async () => {
      Logger.info('清理缓存');
      return {};
    });

    // 扩展API
    this.apiHandlers.set('get_cookies', async (params) => {
      return { cookies: '' };
    });

    this.apiHandlers.set('get_csrf_token', async () => {
      return { token: Math.random().toString(36).substring(2) };
    });

    this.apiHandlers.set('get_credentials', async () => {
      return {
        cookies: '',
        csrf_token: Math.random().toString(36).substring(2)
      };
    });

    Logger.info(`✅ OneBot API处理器初始化完成 (${this.apiHandlers.size}个API)`);
  }

  // 验证访问令牌
  private verifyAccessToken(req: http.IncomingMessage): boolean {
    if (!this.config.access_token) {
      return true;
    }

    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const tokenFromQuery = urlObj.searchParams.get('access_token');

    const providedToken = tokenFromHeader || tokenFromQuery;
    
    return providedToken === this.config.access_token;
  }

  // 设置CORS头
  private setCORSHeaders(res: http.ServerResponse): void {
    const origin = Array.isArray(this.config.cors_origin) 
      ? this.config.cors_origin.join(', ') 
      : this.config.cors_origin;
      
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // 发送错误响应
  private sendError(res: http.ServerResponse, code: number, message: string): void {
    const response = {
      status: 'failed',
      retcode: code,
      data: null,
      message: message
    };
    
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  // 解析请求体
  private async parseRequestBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          if (body.trim()) {
            resolve(JSON.parse(body));
          } else {
            resolve({});
          }
        } catch (error) {
          resolve({});
        }
      });
      
      req.on('error', (error) => {
        reject(error);
      });
    });
  }

  // 发送消息（模拟发送，用于测试）
  public async sendMessageToTarget(target: string, content: string): Promise<void> {
    if (!this.connected) {
      throw new Error('OneBot HTTP适配器未连接');
    }

    Logger.info(`📤 OneBot模拟发送消息到 ${target}: ${content}`);

    // 注意：这里只是模拟发送，实际发送应该通过底层适配器
    // 这个方法主要用于测试和事件广播
    const event: OneBotEvent = {
      time: Math.floor(Date.now() / 1000),
      self_id: 0,
      post_type: 'message',
      message_type: 'private',
      sub_type: 'friend',
      message_id: Date.now(),
      user_id: parseInt(target) || 0,
      message: content,
      raw_message: content,
      font: 0,
      sender: {
        user_id: parseInt(target) || 0,
        nickname: 'User',
        card: '',
        sex: 'unknown',
        age: 0,
        area: '',
        level: '1',
        role: 'member',
        title: ''
      }
    };

    // 广播事件（用于测试客户端接收）
    this.broadcastEvent(event);
    Logger.debug(`✅ OneBot模拟消息发送完成: ${target}`);
  }

  // 注册消息回调
  public onMessage(callback: (message: Message) => void): void {
    Logger.info('📝 OneBot消息回调已注册');
    this.messageCallback = callback;
  }

  // 检查连接状态
  public getConnectionStatus(): boolean {
    return this.connected;
  }

  // 注册插件HTTP路由
  public registerPluginRoute(route: PluginHttpRoute): void {
    const key = `${route.pluginName}:${route.method}:${route.path}`;
    this.pluginRoutes.set(key, route);
    Logger.info(`🔗 插件路由已注册: ${route.method} ${this.config.plugin_routes.base_path}/${route.pluginName}${route.path}`);
  }

  // 注销插件HTTP路由
  public unregisterPluginRoute(pluginName: string, method: string, path: string): void {
    const key = `${pluginName}:${method}:${path}`;
    this.pluginRoutes.delete(key);
    Logger.info(`🔌 插件路由已注销: ${method} ${this.config.plugin_routes.base_path}/${pluginName}${path}`);
  }

  // 注销插件的所有路由
  public unregisterPluginRoutes(pluginName: string): void {
    const keysToDelete: string[] = [];
    for (const [key, route] of this.pluginRoutes) {
      if (route.pluginName === pluginName) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.pluginRoutes.delete(key);
    }
    
    Logger.info(`🔌 插件 ${pluginName} 的所有路由已注销 (${keysToDelete.length}个)`);
  }

  // 设置适配器管理器
  public setAdapterManager(adapterManager: AdapterManager): void {
    this.adapterManager = adapterManager;
    Logger.info('🔗 OneBot适配器已设置适配器管理器');
  }

  // 实现 BaseAdapter 的抽象方法

  /**
   * 适配器加载时调用
   */
  protected async onLoad(): Promise<void> {
    Logger.info(`🔄 OneBot HTTP适配器加载中...`);
    // 加载配置和初始化资源
    this.initializeAPIHandlers();
  }

  /**
   * 适配器初始化时调用
   */
  protected async onInitialize(): Promise<void> {
    Logger.info(`🔧 OneBot HTTP适配器初始化中...`);
    // 初始化完成，准备连接
  }

  /**
   * 适配器连接时调用
   */
  protected async onConnect(): Promise<void> {
    Logger.info(`🔗 OneBot HTTP适配器连接中...`);
    await this.connect();
  }

  /**
   * 适配器断开连接时调用
   */
  protected async onDisconnect(): Promise<void> {
    Logger.info(`🔌 OneBot HTTP适配器断开连接中...`);
    await this.disconnect();
  }

  /**
   * 适配器卸载时调用
   */
  protected async onUnload(): Promise<void> {
    Logger.info(`🗑️ OneBot HTTP适配器卸载中...`);
    await this.disconnect();
    this.pluginRoutes.clear();
    this.apiHandlers.clear();
  }

  /**
   * 发送消息时调用
   */
  protected async onSendMessage(context: MessageContext): Promise<void> {
    Logger.info(`📤 OneBot发送消息: ${context.id}`);
    
    // 转换 MessageContext 到 OneBot 格式
    const target = context.target || 'unknown';
    const content = typeof context.content === 'string' ? context.content : JSON.stringify(context.content);
    
    await this.sendMessageToTarget(target, content);
  }

  /**
   * 接收消息时调用
   */
  protected async onReceiveMessage(context: MessageContext): Promise<void> {
    Logger.info(`📥 OneBot接收消息: ${context.id}`);
    
    // 转换到框架消息格式
     if (this.messageCallback) {
       const message: Message = {
         id: context.id,
         content: context.content,
         sender: {
           id: context.source,
           name: context.source,
           permission: PermissionLevel.USER
         },
         timestamp: context.timestamp.getTime(),
         platform: 'onebot'
       };
       
       this.messageCallback(message);
     }
    
    // 调用父类方法进行事件广播
    await super.onReceiveMessage(context);
  }
}

// 设置默认导出
export default OneBotHTTPAdapter;