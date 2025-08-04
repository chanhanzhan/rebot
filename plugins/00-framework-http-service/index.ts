import { BasePlugin, PluginMetadata } from '../../src/plugins/base-plugin';
import { Logger } from '../../src/config/log';
import { FrameworkEventBus } from '../../src/common/event-bus';
import { AdapterManager } from '../../src/adapter/adapter-manager';
import { PluginManager } from '../../src/plugins/plugin-manager';
import * as http from 'http';
import * as url from 'url';

interface PluginRouteAllocation {
  pluginName: string;
  allocatedPath: string;
  timestamp: number;
}

interface RouteDefinition {
  path: string;
  method: string;
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body?: any) => Promise<void>;
  description?: string;
}

interface PluginHTTPService {
  pluginName: string;
  baseUrl: string;
  routes: HTTPRoute[];
  metadata?: any;
}

interface HTTPRoute {
  method: string;
  path: string;
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body?: any) => Promise<void>;
  middleware?: Array<(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void>;
}

export default class FrameworkHTTPService extends BasePlugin {
  public readonly metadata: PluginMetadata = {
    name: 'framework-http-service',
    version: '1.0.0',
    description: '框架HTTP服务插件，提供核心HTTP功能',
    author: 'Framework Team',
    dependencies: [],
    permissions: ['http', 'admin']
  };

  private httpServer?: http.Server;
  private port: number = 3000;
  private host: string = '0.0.0.0';
  private coreRoutes = new Map<string, HTTPRoute>();
  private pluginServices = new Map<string, PluginHTTPService>();
  private pluginRouteAllocations = new Map<string, string>(); // 插件名 -> 分配的路径前缀

  constructor() {
    super();
  }

  protected async onLoad(): Promise<void> {
    Logger.info(`[${this.metadata.name}] 插件加载中...`);
  }

  protected async onInitialize(): Promise<void> {
    Logger.info(`[${this.metadata.name}] 插件初始化中...`);
  }

  protected async onStart(): Promise<void> {
    Logger.info(`[${this.metadata.name}] 插件启动中...`);
    await this.startHTTPService();
  }

  protected async onStop(): Promise<void> {
    Logger.info(`[${this.metadata.name}] 插件停止中...`);
    await this.stopHTTPService();
  }

  protected async onUnload(): Promise<void> {
    Logger.info(`[${this.metadata.name}] 插件卸载中...`);
  }

  protected getRoutes(): import('../../src/plugins/base-plugin').RouteDefinition[] {
    return [
      {
        path: '/api/plugins/allocate-path',
        method: 'POST',
        handler: this.handlePluginPathRequest.bind(this),
        description: '为插件分配HTTP路径'
      },
      {
        path: '/api/plugins/allocations',
        method: 'GET',
        handler: this.handlePluginPathAllocations.bind(this),
        description: '获取路径分配列表'
      },
      {
        path: '/api/plugins/register-service',
        method: 'POST',
        handler: this.handlePluginHTTPRegistration.bind(this),
        description: '注册插件HTTP服务'
      }
    ];
  }

  private async startHTTPService(): Promise<void> {
    Logger.info(`[${this.metadata.name}] 正在加载框架HTTP服务...`);
    
    // 初始化核心路由
    this.initializeCoreRoutes();
    
    // 启动HTTP服务器
    await this.startHTTPServer();
    
    // 监听插件HTTP服务注册事件
    this.setupEventListeners();
    
    Logger.info(`[${this.metadata.name}] 框架HTTP服务已启动: http://${this.host}:${this.port}`);
    Logger.info(`[${this.metadata.name}] 插件可通过声明式路由注册机制申请HTTP路径`);
  }

  private async stopHTTPService(): Promise<void> {
    if (this.httpServer) {
      this.httpServer.close();
      Logger.info(`[${this.metadata.name}] HTTP服务已停止`);
    }
  }

  protected async onMessage(): Promise<void> {
    // 此插件不处理消息
  }

  private initializeCoreRoutes(): void {
    // 框架信息接口
    this.coreRoutes.set('GET:/api/framework/info', {
      method: 'GET',
      path: '/api/framework/info',
      handler: this.handleFrameworkInfo.bind(this)
    });

    // 框架状态接口
    this.coreRoutes.set('GET:/api/framework/status', {
      method: 'GET',
      path: '/api/framework/status',
      handler: this.handleFrameworkStatus.bind(this)
    });

    // 插件列表接口
    this.coreRoutes.set('GET:/api/plugins', {
      method: 'GET',
      path: '/api/plugins',
      handler: this.handlePluginsList.bind(this)
    });

    // 适配器列表接口
    this.coreRoutes.set('GET:/api/adapters', {
      method: 'GET',
      path: '/api/adapters',
      handler: this.handleAdaptersList.bind(this)
    });

    // 插件HTTP路径申请接口（声明式路由注册）
    this.coreRoutes.set('POST:/api/plugins/request-path', {
      method: 'POST',
      path: '/api/plugins/request-path',
      handler: this.handlePluginPathRequest.bind(this)
    });

    // 插件HTTP服务注册接口（兼容旧版）
    this.coreRoutes.set('POST:/api/plugins/register-http', {
      method: 'POST',
      path: '/api/plugins/register-http',
      handler: this.handlePluginHTTPRegistration.bind(this)
    });

    // 插件HTTP服务列表接口
    this.coreRoutes.set('GET:/api/plugins/http-services', {
      method: 'GET',
      path: '/api/plugins/http-services',
      handler: this.handlePluginHTTPServicesList.bind(this)
    });

    // 插件路径分配列表接口
    this.coreRoutes.set('GET:/api/plugins/path-allocations', {
      method: 'GET',
      path: '/api/plugins/path-allocations',
      handler: this.handlePluginPathAllocations.bind(this)
    });
  }

  private async startHTTPServer(): Promise<void> {
    this.httpServer = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.port, this.host, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const startTime = Date.now();
    
    try {
      // 设置CORS头
      this.setCORSHeaders(res);
      
      // 处理OPTIONS预检请求
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname || '/';
      const method = req.method || 'GET';
      const routeKey = `${method}:${pathname}`;

      // 解析请求体
      const body = await this.parseRequestBody(req);

      // 检查核心路由
      const coreRoute = this.coreRoutes.get(routeKey);
      if (coreRoute) {
        await coreRoute.handler(req, res, body);
        return;
      }

      // 检查插件路由
      const pluginRoute = this.findPluginRoute(method, pathname);
      if (pluginRoute) {
        await pluginRoute.handler(req, res, body);
        return;
      }

      // 404 Not Found
      this.sendError(res, 404, 'Not Found');

    } catch (error) {
      Logger.error(`[${this.metadata.name}] HTTP请求处理错误:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        url: req.url,
        method: req.method
      });
      this.sendError(res, 500, 'Internal Server Error');
    } finally {
      const duration = Date.now() - startTime;
      Logger.debug(`[${this.metadata.name}] HTTP请求: ${req.method} ${req.url} (${duration}ms)`);
    }
  }

  private findPluginRoute(method: string, pathname: string): HTTPRoute | null {
    // 首先检查直接路径匹配的插件服务
    for (const [pluginName, service] of this.pluginServices) {
      for (const route of service.routes) {
        if ((route.method === method || route.method === 'ALL') && 
            pathname.startsWith(service.baseUrl + route.path)) {
          return route;
        }
      }
    }

    // 然后检查声明式路径分配
    for (const [pluginName, allocatedPath] of this.pluginRouteAllocations) {
      if (pathname.startsWith(allocatedPath)) {
        // 这里应该转发到插件的处理器
        // 为简化，返回一个默认处理器
        return {
          method: 'ALL',
          path: allocatedPath,
          handler: async (req, res) => {
            this.sendJSON(res, {
              message: `Plugin ${pluginName} path allocation`,
              allocatedPath,
              requestPath: pathname
            });
          }
        };
      }
    }

    return null;
  }

  private async parseRequestBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  private setCORSHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  private setupEventListeners(): void {
    // 监听插件HTTP服务注册事件
    this.eventBus.on('plugin-http-register', (data: any) => {
      this.registerPluginHTTPService(data);
    });
  }

  private registerPluginHTTPService(data: PluginHTTPService): void {
    this.pluginServices.set(data.pluginName, data);
    Logger.info(`[${this.metadata.name}] 注册插件HTTP服务: ${data.pluginName} -> ${data.baseUrl}`);
  }

  // 处理框架信息请求
  private async handleFrameworkInfo(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const info = {
      name: 'Bot Framework',
      version: '1.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      platform: process.platform,
      nodeVersion: process.version
    };
    this.sendJSON(res, info);
  }

  // 处理框架状态请求
  private async handleFrameworkStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const pluginManager = PluginManager.getInstance();
    const adapterManager = AdapterManager.getInstance();
    
    const status = {
      status: 'running',
      plugins: {
        total: pluginManager.getAllPlugins().length,
        loaded: pluginManager.getAllPlugins().filter(p => p.enabled).length
      },
      adapters: {
        total: adapterManager.getAllAdapters().length,
        connected: adapterManager.getAllAdapters().filter(a => a.isConnected).length
      },
      httpServices: this.pluginServices.size,
      routeAllocations: this.pluginRouteAllocations.size
    };
    this.sendJSON(res, status);
  }

  // 处理插件列表请求
  private async handlePluginsList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const pluginManager = PluginManager.getInstance();
    const plugins = pluginManager.getAllPlugins();
    
    const pluginList = plugins.map(plugin => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      enabled: plugin.enabled,
      hasHTTPService: this.pluginServices.has(plugin.name)
    }));
    
    this.sendJSON(res, pluginList);
  }

  // 处理适配器列表请求
  private async handleAdaptersList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const adapterManager = AdapterManager.getInstance();
    const adapters = adapterManager.getAllAdapters();
    
    const adapterList = adapters.map(adapter => ({
      name: adapter.name,
      connected: adapter.isConnected()
    }));
    
    this.sendJSON(res, adapterList);
  }

  // 处理插件HTTP路径申请（声明式路由注册）
  private async handlePluginPathRequest(req: http.IncomingMessage, res: http.ServerResponse, body: any): Promise<void> {
    try {
      const { pluginName, requestedPath, description } = body;
      
      if (!pluginName || !requestedPath) {
        this.sendError(res, 400, 'Missing pluginName or requestedPath');
        return;
      }

      // 验证插件是否存在
      const pluginManager = PluginManager.getInstance();
      const plugin = pluginManager.getAllPlugins().find(p => p.name === pluginName);
      if (!plugin) {
        this.sendError(res, 404, `Plugin ${pluginName} not found`);
        return;
      }

      // 标准化路径
      const normalizedPath = requestedPath.startsWith('/') ? requestedPath : `/${requestedPath}`;
      
      // 检查插件是否已有分配的路径
      const existingPath = this.pluginRouteAllocations.get(pluginName);
      if (existingPath) {
        if (existingPath === normalizedPath) {
          // 相同路径，返回成功
          this.sendJSON(res, {
            success: true,
            message: `Plugin ${pluginName} already has path ${normalizedPath}`,
            allocatedPath: normalizedPath
          });
          return;
        } else {
          this.sendError(res, 409, `Plugin ${pluginName} already has allocated path: ${existingPath}`);
          return;
        }
      }

      // 检查路径是否与其他插件冲突
      for (const [otherPlugin, otherPath] of this.pluginRouteAllocations) {
        if (normalizedPath.startsWith(otherPath) || otherPath.startsWith(normalizedPath)) {
          this.sendError(res, 409, `Path conflict with plugin ${otherPlugin}: ${otherPath}`);
          return;
        }
      }

      // 分配路径
      this.pluginRouteAllocations.set(pluginName, normalizedPath);
      
      Logger.info(`[${this.metadata.name}] 为插件 ${pluginName} 分配路径: ${normalizedPath}`);
      
      this.sendJSON(res, {
        success: true,
        message: `Path allocated successfully`,
        allocatedPath: normalizedPath,
        plugin: pluginName,
        description
      });

    } catch (error) {
      Logger.error(`[${this.metadata.name}] 路径分配错误:`, error);
      this.sendError(res, 500, 'Internal server error');
    }
  }

  // 处理插件路径分配列表查询
  private async handlePluginPathAllocations(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const pluginManager = PluginManager.getInstance();
      const allocations = Array.from(this.pluginRouteAllocations.entries()).map(([pluginName, path]) => {
        const plugin = pluginManager.getAllPlugins().find(p => p.name === pluginName);
        return {
          pluginName,
          allocatedPath: path,
          pluginVersion: plugin?.version || 'unknown',
          pluginDescription: plugin?.description || 'No description',
          isActive: !!plugin
        };
      });

      this.sendJSON(res, allocations);
    } catch (error) {
        Logger.error(`[${this.metadata.name}] 获取路径分配列表错误:`, error);
        this.sendError(res, 500, 'Internal server error');
      }
  }

  // 处理插件HTTP服务注册（兼容旧版）
  private async handlePluginHTTPRegistration(req: http.IncomingMessage, res: http.ServerResponse, body: any): Promise<void> {
    try {
      const { pluginName, routes, baseUrl } = body;
      
      if (!pluginName || !routes || !Array.isArray(routes)) {
        this.sendError(res, 400, 'Invalid registration data');
        return;
      }

      // 验证插件是否存在
      const pluginManager = PluginManager.getInstance();
      const plugin = pluginManager.getAllPlugins().find(p => p.name === pluginName);
      if (!plugin) {
        this.sendError(res, 404, `Plugin ${pluginName} not found`);
        return;
      }

      // 注册插件HTTP服务
      const service: PluginHTTPService = {
        pluginName,
        routes,
        baseUrl: baseUrl || `/plugins/${pluginName}`
      };

      this.pluginServices.set(pluginName, service);
      
      Logger.info(`[${this.metadata.name}] 注册插件HTTP服务: ${pluginName} -> ${service.baseUrl}`);
      
      this.sendJSON(res, {
        success: true,
        message: 'Plugin HTTP service registered successfully',
        service: {
          pluginName: service.pluginName,
          baseUrl: service.baseUrl,
          routeCount: service.routes.length
        }
      });

    } catch (error) {
      Logger.error(`[${this.metadata.name}] 插件HTTP服务注册错误:`, error);
      this.sendError(res, 500, 'Internal server error');
    }
  }

  // 处理插件HTTP服务列表查询
  private async handlePluginHTTPServicesList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const services = Array.from(this.pluginServices.values()).map(service => ({
      plugin: service.pluginName,
      baseUrl: service.baseUrl,
      routes: service.routes.map(route => ({
        method: route.method,
        path: route.path
      }))
    }));
    
    this.sendJSON(res, services);
  }

  private sendJSON(res: http.ServerResponse, data: any): void {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify(data, null, 2));
  }

  private sendError(res: http.ServerResponse, statusCode: number, message: string): void {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(statusCode);
    res.end(JSON.stringify({ error: message }));
  }

  public async healthCheck(): Promise<boolean> {
    try {
      // 检查插件是否正常运行
      if (!this.lifecycleState.isLoaded || !this.lifecycleState.isInitialized) {
        return false;
      }
      
      // 检查HTTP服务器是否正在运行
      if (!this.httpServer || !this.httpServer.listening) {
        Logger.debug('FrameworkHTTPService: HTTP服务器未运行');
        return false;
      }
      
      return true;
    } catch (error) {
      Logger.error('FrameworkHTTPService 健康检查异常', error);
      return false;
    }
  }
}