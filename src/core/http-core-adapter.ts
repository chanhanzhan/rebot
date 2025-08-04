import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';

export interface RouteHandler {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
  handler: (req: http.IncomingMessage, res: http.ServerResponse, params?: any) => Promise<void> | void;
  middleware?: Array<(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void>;
  metadata?: {
    pluginName: string;
    description?: string;
    requireAuth?: boolean;
    rateLimit?: number;
  };
}

export interface RouteRegistration {
  path: string;
  pluginName: string;
  routes: Map<string, RouteHandler>; // method -> handler
  registeredAt: number;
  priority: number;
}

export interface HttpCoreConfig {
  host: string;
  port: number;
  maxConnections?: number;
  timeout?: number;
  keepAliveTimeout?: number;
  headersTimeout?: number;
  requestTimeout?: number;
  bodyLimit?: number;
  cors?: {
    enabled: boolean;
    origins?: string[];
    methods?: string[];
    headers?: string[];
  };
  ssl?: {
    enabled: boolean;
    cert: string;
    key: string;
    ca?: string;
  };
}

/**
 * HTTP核心适配器 - 框架最底层的HTTP服务
 * 负责路由管理、请求分发、中间件处理
 */
export class HttpCoreAdapter {
  private static instance: HttpCoreAdapter;
  private server: http.Server | https.Server | null = null;
  private routes: Map<string, RouteRegistration> = new Map();
  private pathTree: Map<string, string[]> = new Map(); // 路径树，用于快速查找
  private eventBus: FrameworkEventBus;
  private config: HttpCoreConfig;
  private isRunning = false;
  private middleware: Array<(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void> = [];

  private constructor(config: HttpCoreConfig) {
    this.config = config;
    this.eventBus = FrameworkEventBus.getInstance();
    this.setupDefaultMiddleware();
  }

  public static getInstance(config?: HttpCoreConfig): HttpCoreAdapter {
    if (!HttpCoreAdapter.instance) {
      if (!config) {
        throw new Error('HttpCoreAdapter requires config on first initialization');
      }
      HttpCoreAdapter.instance = new HttpCoreAdapter(config);
    }
    return HttpCoreAdapter.instance;
  }

  private setupDefaultMiddleware(): void {
    // CORS中间件
    if (this.config.cors?.enabled) {
      this.middleware.push((req, res, next) => {
        const origin = req.headers.origin as string;
        const allowedOrigins = this.config.cors?.origins || ['*'];
        
        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin || '*');
        }
        
        res.setHeader('Access-Control-Allow-Methods', this.config.cors?.methods?.join(', ') || 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', this.config.cors?.headers?.join(', ') || 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }
        
        next();
      });
    }

    // 请求日志中间件
    this.middleware.push((req, res, next) => {
      const start = Date.now();
      const originalEnd = res.end;
      
      res.end = function(chunk?: any, encoding?: any): http.ServerResponse {
        const duration = Date.now() - start;
        Logger.info(`HTTP ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
        return originalEnd.call(this, chunk, encoding);
      };
      
      next();
    });

    // 请求体解析中间件
    this.middleware.push((req, res, next) => {
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
          if (body.length > (this.config.bodyLimit || 1024 * 1024)) { // 1MB默认限制
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request body too large' }));
            return;
          }
        });
        
        req.on('end', () => {
          try {
            (req as any).body = body ? JSON.parse(body) : {};
          } catch (error) {
            (req as any).body = body;
          }
          next();
        });
      } else {
        next();
      }
    });
  }

  /**
   * 启动HTTP服务器
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      Logger.warn('HTTP核心适配器已在运行');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // 创建服务器
        if (this.config.ssl?.enabled) {
          const fs = require('fs');
          const options = {
            cert: fs.readFileSync(this.config.ssl.cert),
            key: fs.readFileSync(this.config.ssl.key),
            ca: this.config.ssl.ca ? fs.readFileSync(this.config.ssl.ca) : undefined
          };
          this.server = https.createServer(options, this.handleRequest.bind(this));
        } else {
          this.server = http.createServer(this.handleRequest.bind(this));
        }

        // 配置服务器参数
        if (this.config.maxConnections) {
          this.server.maxConnections = this.config.maxConnections;
        }
        if (this.config.timeout) {
          this.server.timeout = this.config.timeout;
        }
        if (this.config.keepAliveTimeout) {
          this.server.keepAliveTimeout = this.config.keepAliveTimeout;
        }
        if (this.config.headersTimeout) {
          this.server.headersTimeout = this.config.headersTimeout;
        }
        if (this.config.requestTimeout) {
          this.server.requestTimeout = this.config.requestTimeout;
        }

        // 监听端口
        this.server.listen(this.config.port, this.config.host, () => {
          this.isRunning = true;
          Logger.info(`🌐 HTTP核心适配器已启动: ${this.config.ssl?.enabled ? 'https' : 'http'}://${this.config.host}:${this.config.port}`);
          this.eventBus.emit('http-core-started', { host: this.config.host, port: this.config.port });
          resolve();
        });

        this.server.on('error', (error) => {
          Logger.error('HTTP核心适配器启动失败:', error);
          reject(error);
        });

      } catch (error) {
        Logger.error('HTTP核心适配器启动异常:', error);
        reject(error);
      }
    });
  }

  /**
   * 停止HTTP服务器
   */
  public async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.isRunning = false;
        Logger.info('HTTP核心适配器已停止');
        this.eventBus.emit('http-core-stopped');
        resolve();
      });
    });
  }

  /**
   * 检查是否正在运行
   */
  public getRunningStatus(): boolean {
    return this.isRunning;
  }

  /**
   * 申请路由路径 - 支持通配符路径归属
   * @param path 路径，如 /group 或 /group/*
   * @param pluginName 插件名称
   * @param priority 优先级，数字越小优先级越高
   */
  public requestPath(path: string, pluginName: string, priority: number = 100): boolean {
    // 标准化路径
    const normalizedPath = this.normalizePath(path);
    
    // 检查路径是否已被占用
    if (this.isPathOccupied(normalizedPath)) {
      Logger.warn(`路径 ${normalizedPath} 已被占用，插件 ${pluginName} 申请失败`);
      return false;
    }

    // 检查是否与现有路径冲突
    if (this.hasPathConflict(normalizedPath)) {
      Logger.warn(`路径 ${normalizedPath} 与现有路径冲突，插件 ${pluginName} 申请失败`);
      return false;
    }

    // 分配路径
    const registration: RouteRegistration = {
      path: normalizedPath,
      pluginName,
      routes: new Map(),
      registeredAt: Date.now(),
      priority
    };

    this.routes.set(normalizedPath, registration);
    this.updatePathTree(normalizedPath, pluginName);

    Logger.info(`✅ 路径 ${normalizedPath} 已分配给插件 ${pluginName}`);
    this.eventBus.emit('path-allocated', { path: normalizedPath, pluginName, priority });
    
    return true;
  }

  /**
   * 注册路由处理器
   */
  public registerRoute(path: string, method: string, handler: RouteHandler): boolean {
    const normalizedPath = this.normalizePath(path);
    const registration = this.routes.get(normalizedPath);
    
    if (!registration) {
      Logger.error(`路径 ${normalizedPath} 未分配，无法注册路由`);
      return false;
    }

    registration.routes.set(method.toUpperCase(), handler);
    Logger.info(`路由已注册: ${method.toUpperCase()} ${normalizedPath}`);
    
    return true;
  }

  /**
   * 注销路由处理器
   */
  public unregisterRoute(path: string, method: string): boolean {
    const normalizedPath = this.normalizePath(path);
    const registration = this.routes.get(normalizedPath);
    
    if (!registration) {
      Logger.debug(`路由 ${method.toUpperCase()} ${normalizedPath} 不存在，跳过注销`);
      return false;
    }

    const upperMethod = method.toUpperCase();
    if (!registration.routes.has(upperMethod)) {
      Logger.debug(`路由 ${upperMethod} ${normalizedPath} 不存在，跳过注销`);
      return false;
    }

    registration.routes.delete(upperMethod);
    Logger.info(`路由已注销: ${upperMethod} ${normalizedPath}`);
    
    return true;
  }

  /**
   * 释放路径
   */
  public releasePath(path: string, pluginName: string): boolean {
    const normalizedPath = this.normalizePath(path);
    const registration = this.routes.get(normalizedPath);
    
    if (!registration) {
      Logger.debug(`路径 ${normalizedPath} 不存在，跳过释放`);
      return false;
    }
    
    if (registration.pluginName !== pluginName) {
      Logger.debug(`插件 ${pluginName} 无权释放路径 ${normalizedPath}，跳过释放`);
      return false;
    }

    this.routes.delete(normalizedPath);
    this.removeFromPathTree(normalizedPath);
    
    Logger.info(`路径 ${normalizedPath} 已释放`);
    this.eventBus.emit('path-released', { path: normalizedPath, pluginName });
    
    return true;
  }

  /**
   * 处理HTTP请求
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      // 执行中间件
      await this.executeMiddleware(req, res);
      
      // 路由匹配
      const matchedRoute = this.matchRoute(req.url!, req.method!);
      
      if (!matchedRoute) {
        this.sendNotFound(res);
        return;
      }

      // 执行路由处理器
      await matchedRoute.handler.handler(req, res, matchedRoute.params);
      
    } catch (error) {
      Logger.error('HTTP请求处理错误:', error);
      this.sendInternalError(res, error);
    }
  }

  /**
   * 执行中间件
   */
  private async executeMiddleware(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    return new Promise((resolve, reject) => {
      let index = 0;
      
      const next = (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        
        if (index >= this.middleware.length) {
          resolve();
          return;
        }
        
        const middleware = this.middleware[index++];
        try {
          middleware(req, res, next);
        } catch (err) {
          reject(err);
        }
      };
      
      next();
    });
  }

  /**
   * 路由匹配
   */
  private matchRoute(url: string, method: string): { handler: RouteHandler; params: any } | null {
    const parsedUrl = new URL(url, `http://${this.config.host}:${this.config.port}`);
    const pathname = parsedUrl.pathname;
    
    // 精确匹配
    const exactMatch = this.routes.get(pathname);
    if (exactMatch && exactMatch.routes.has(method)) {
      return {
        handler: exactMatch.routes.get(method)!,
        params: Object.fromEntries(parsedUrl.searchParams)
      };
    }

    // 通配符匹配
    for (const [routePath, registration] of this.routes) {
      if (routePath.endsWith('/*')) {
        const basePath = routePath.slice(0, -2);
        if (pathname.startsWith(basePath) && registration.routes.has(method)) {
          return {
            handler: registration.routes.get(method)!,
            params: {
              ...Object.fromEntries(parsedUrl.searchParams),
              wildcard: pathname.slice(basePath.length)
            }
          };
        }
      }
    }

    return null;
  }

  /**
   * 标准化路径
   */
  private normalizePath(path: string): string {
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }

  /**
   * 检查路径是否被占用
   */
  private isPathOccupied(path: string): boolean {
    return this.routes.has(path);
  }

  /**
   * 检查路径冲突
   */
  private hasPathConflict(path: string): boolean {
    for (const existingPath of this.routes.keys()) {
      if (this.pathsConflict(path, existingPath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 检查两个路径是否冲突
   */
  private pathsConflict(path1: string, path2: string): boolean {
    // 如果其中一个是通配符路径
    if (path1.endsWith('/*') || path2.endsWith('/*')) {
      const basePath1 = path1.endsWith('/*') ? path1.slice(0, -2) : path1;
      const basePath2 = path2.endsWith('/*') ? path2.slice(0, -2) : path2;
      
      return basePath1.startsWith(basePath2) || basePath2.startsWith(basePath1);
    }
    
    return false;
  }

  /**
   * 更新路径树
   */
  private updatePathTree(path: string, pluginName: string): void {
    const segments = path.split('/').filter(s => s);
    let currentPath = '';
    
    for (const segment of segments) {
      currentPath += '/' + segment;
      if (!this.pathTree.has(currentPath)) {
        this.pathTree.set(currentPath, []);
      }
      if (!this.pathTree.get(currentPath)!.includes(pluginName)) {
        this.pathTree.get(currentPath)!.push(pluginName);
      }
    }
  }

  /**
   * 从路径树中移除
   */
  private removeFromPathTree(path: string): void {
    const segments = path.split('/').filter(s => s);
    let currentPath = '';
    
    for (const segment of segments) {
      currentPath += '/' + segment;
      this.pathTree.delete(currentPath);
    }
  }

  /**
   * 发送404响应
   */
  private sendNotFound(res: http.ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    const response = JSON.stringify({ error: 'Not Found', code: 404 });
    res.end(response);
  }

  /**
   * 发送500响应
   */
  private sendInternalError(res: http.ServerResponse, error: any): void {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    const response = JSON.stringify({ 
      error: 'Internal Server Error', 
      code: 500,
      message: error instanceof Error ? error.message : String(error)
    });
    res.end(response);
  }

  /**
   * 获取所有已分配的路径
   */
  public getAllocatedPaths(): Array<{ path: string; pluginName: string; priority: number }> {
    return Array.from(this.routes.values()).map(reg => ({
      path: reg.path,
      pluginName: reg.pluginName,
      priority: reg.priority
    }));
  }

  /**
   * 获取服务器状态
   */
  public getStatus(): { running: boolean; host: string; port: number; routeCount: number } {
    return {
      running: this.isRunning,
      host: this.config.host,
      port: this.config.port,
      routeCount: this.routes.size
    };
  }
}