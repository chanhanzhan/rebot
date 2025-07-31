import { BasePlugin } from '../plugin';
import { Message } from '../../common/types';
import { Logger } from '../../config/log';
import { FrameworkEventBus } from '../../common/event-bus';
import { AdapterManager } from '../../adapter/adapter-manager';
import { PluginManager } from '../../plugins/plugin-manager';
import * as http from 'http';
import * as path from 'path';

interface HTTPRoute {
  method: string;
  path: string;
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body?: any) => Promise<void>;
  middleware?: Array<(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void>;
}

interface PluginHTTPService {
  pluginName: string;
  routes: HTTPRoute[];
  baseUrl: string;
}

export default class FrameworkHTTPService extends BasePlugin {
  public name = 'framework-http-service';
  public version = '1.0.0';
  public description = '框架HTTP服务插件，提供核心HTTP接口和插件路由注册';

  private httpServer?: http.Server;
  private port: number = 3000;
  private host: string = '0.0.0.0';
  private pluginServices = new Map<string, PluginHTTPService>();
  private coreRoutes = new Map<string, HTTPRoute>();

  public async load(): Promise<void> {
    Logger.info(`[${this.name}] 正在加载框架HTTP服务...`);
    
    // 初始化核心路由
    this.initializeCoreRoutes();
    
    // 启动HTTP服务器
    await this.startHTTPServer();
    
    // 监听插件HTTP服务注册事件
    this.setupEventListeners();
    
    Logger.info(`[${this.name}] 框架HTTP服务已启动: http://${this.host}:${this.port}`);
  }

  public async unload(): Promise<void> {
    if (this.httpServer) {
      this.httpServer.close();
      Logger.info(`[${this.name}] HTTP服务器已关闭`);
    }
  }

  public getFunctions() {
    return [];
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

    // 插件HTTP服务注册接口
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
      Logger.error(`[${this.name}] HTTP请求处理错误:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        url: req.url,
        method: req.method
      });
      this.sendError(res, 500, 'Internal Server Error');
    } finally {
      const duration = Date.now() - startTime;
      Logger.debug(`[${this.name}] HTTP请求: ${req.method} ${req.url} (${duration}ms)`);
    }
  }

  private findPluginRoute(method: string, pathname: string): HTTPRoute | null {
    for (const [pluginName, service] of this.pluginServices) {
      for (const route of service.routes) {
        if ((route.method === method || route.method === 'ALL') && 
            pathname.startsWith(service.baseUrl + route.path)) {
          return route;
        }
      }
    }
    return null;
  }

  private async parseRequestBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : null);
        } catch (error) {
          resolve(null);
        }
      });
      
      req.on('error', reject);
    });
  }

  private setCORSHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  }

  private sendJSON(res: http.ServerResponse, data: any, status: number = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendError(res: http.ServerResponse, status: number, message: string): void {
    this.sendJSON(res, {
      error: true,
      status,
      message,
      timestamp: new Date().toISOString()
    }, status);
  }

  // 核心路由处理器
  private async handleFrameworkInfo(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const adapters = this.adapterManager.getAdapterStats();
    const plugins = this.pluginManager.getAllPlugins();

    const info = {
      framework: {
        name: 'ReBOT Framework',
        version: '1.0.0',
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage()
      },
      adapters: {
        count: Array.isArray(adapters) ? adapters.length : Object.keys(adapters).length,
        list: Array.isArray(adapters) ? adapters : [adapters]
      },
      plugins: {
        count: plugins.length,
        list: plugins.map(p => ({
          name: p.name,
          version: p.version,
          description: p.description
        }))
      },
      http_services: {
        count: this.pluginServices.size,
        services: Array.from(this.pluginServices.values()).map(s => ({
          plugin: s.pluginName,
          baseUrl: s.baseUrl,
          routes: s.routes.length
        }))
      }
    };

    this.sendJSON(res, info);
  }

  private async handleFrameworkStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const adapters = this.adapterManager.getAdapterStats();
    const plugins = this.pluginManager.getAllPlugins();

    const status = {
      running: true,
      uptime: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      adapters: {
        count: Array.isArray(adapters) ? adapters.length : Object.keys(adapters).length,
        connected: Array.isArray(adapters) ? 
          adapters.filter(a => a.connected).length : 
          (adapters.connected ? 1 : 0)
      },
      plugins: {
        count: plugins.length,
        loaded: plugins.filter(p => p.enabled).length
      },
      http_services: {
        count: this.pluginServices.size,
        port: this.port,
        host: this.host
      },
      timestamp: new Date().toISOString()
    };

    this.sendJSON(res, status);
  }

  private async handlePluginsList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const plugins = this.pluginManager.getAllPlugins();
    
    const pluginList = plugins.map(plugin => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      enabled: plugin.enabled,
      hasHTTPService: this.pluginServices.has(plugin.name)
    }));

    this.sendJSON(res, {
      count: pluginList.length,
      plugins: pluginList
    });
  }

  private async handleAdaptersList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const adapters = this.adapterManager.getAdapterStats();
    
    this.sendJSON(res, {
      count: Array.isArray(adapters) ? adapters.length : 1,
      adapters: Array.isArray(adapters) ? adapters : [adapters]
    });
  }

  private async handlePluginHTTPRegistration(req: http.IncomingMessage, res: http.ServerResponse, body: any): Promise<void> {
    try {
      const { pluginName, routes, baseUrl } = body;
      
      if (!pluginName || !routes || !Array.isArray(routes)) {
        this.sendError(res, 400, 'Invalid registration data');
        return;
      }

      // 验证插件是否存在
      const plugin = this.pluginManager.getAllPlugins().find(p => p.name === pluginName);
      if (!plugin) {
        this.sendError(res, 404, 'Plugin not found');
        return;
      }

      // 注册插件HTTP服务
      const service: PluginHTTPService = {
        pluginName,
        routes: routes.map((route: any) => ({
          method: route.method || 'GET',
          path: route.path || '/',
          handler: route.handler,
          middleware: route.middleware
        })),
        baseUrl: baseUrl || `/plugins/${pluginName}`
      };

      this.pluginServices.set(pluginName, service);
      
      Logger.info(`[${this.name}] 插件HTTP服务已注册: ${pluginName} -> ${service.baseUrl}`);
      
      this.sendJSON(res, {
        success: true,
        message: 'Plugin HTTP service registered successfully',
        service: {
          plugin: pluginName,
          baseUrl: service.baseUrl,
          routes: service.routes.length
        }
      });

    } catch (error) {
      Logger.error(`[${this.name}] 插件HTTP服务注册失败:`, error);
      this.sendError(res, 500, 'Registration failed');
    }
  }

  private async handlePluginHTTPServicesList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const services = Array.from(this.pluginServices.values()).map(service => ({
      plugin: service.pluginName,
      baseUrl: service.baseUrl,
      routes: service.routes.map(route => ({
        method: route.method,
        path: route.path
      }))
    }));

    this.sendJSON(res, {
      count: services.length,
      services
    });
  }

  private setupEventListeners(): void {
    const eventBus = FrameworkEventBus.getInstance();
    
    // 监听插件HTTP服务注册事件
    eventBus.on('plugin-http-register', (data: any) => {
      this.handlePluginHTTPRegistration(data.req, data.res, data.body);
    });
  }

  private async handleHTTPCommand(message: Message): Promise<void> {
    const args = message.content.split(' ');
    const command = args[1];

    switch (command) {
      case 'info':
        await this.sendReply(message, this.getHTTPServiceInfo());
        break;
      case 'services':
        await this.sendReply(message, this.getPluginServicesInfo());
        break;
      case 'status':
        await this.sendReply(message, this.getHTTPStatusInfo());
        break;
      default:
        await this.sendReply(message, `🌐 框架HTTP服务命令:
/http info - 查看HTTP服务信息
/http services - 查看插件HTTP服务
/http status - 查看HTTP服务状态`);
    }
  }

  private getHTTPServiceInfo(): string {
    return `🌐 框架HTTP服务信息

🔗 服务地址: http://${this.host}:${this.port}
📊 核心路由: ${this.coreRoutes.size} 个
🔌 插件服务: ${this.pluginServices.size} 个
⏱️ 运行时间: ${Math.floor(process.uptime())} 秒

📋 核心接口:
• GET /api/framework/info - 框架信息
• GET /api/framework/status - 框架状态
• GET /api/plugins - 插件列表
• GET /api/adapters - 适配器列表
• POST /api/plugins/register-http - 注册插件HTTP服务
• GET /api/plugins/http-services - 插件HTTP服务列表`;
  }

  private getPluginServicesInfo(): string {
    if (this.pluginServices.size === 0) {
      return '📋 当前没有注册的插件HTTP服务';
    }

    let info = `📋 插件HTTP服务列表 (${this.pluginServices.size} 个):\n\n`;
    
    for (const [pluginName, service] of this.pluginServices) {
      info += `🔌 ${pluginName}\n`;
      info += `   📍 基础路径: ${service.baseUrl}\n`;
      info += `   🛣️ 路由数量: ${service.routes.length}\n`;
      
      for (const route of service.routes) {
        info += `   • ${route.method} ${service.baseUrl}${route.path}\n`;
      }
      info += '\n';
    }

    return info.trim();
  }

  private getHTTPStatusInfo(): string {
    const memory = process.memoryUsage();
    
    return `📊 HTTP服务状态

🟢 服务状态: 运行中
🔗 监听地址: ${this.host}:${this.port}
⏱️ 运行时间: ${Math.floor(process.uptime())} 秒
💾 内存使用: ${Math.round(memory.heapUsed / 1024 / 1024)} MB

📊 服务统计:
• 核心路由: ${this.coreRoutes.size} 个
• 插件服务: ${this.pluginServices.size} 个
• 总路由数: ${this.coreRoutes.size + Array.from(this.pluginServices.values()).reduce((sum, s) => sum + s.routes.length, 0)} 个`;
  }

  private async sendReply(message: Message, content: string): Promise<void> {
    const eventBus = FrameworkEventBus.getInstance();
    eventBus.emit('send_message', {
      target: message.sender.id,
      content,
      platform: message.platform
    });
  }

  // 公共方法供其他插件调用
  public registerPluginHTTPService(pluginName: string, routes: HTTPRoute[], baseUrl?: string): boolean {
    try {
      const service: PluginHTTPService = {
        pluginName,
        routes,
        baseUrl: baseUrl || `/plugins/${pluginName}`
      };

      this.pluginServices.set(pluginName, service);
      Logger.info(`[${this.name}] 插件HTTP服务已注册: ${pluginName} -> ${service.baseUrl}`);
      return true;
    } catch (error) {
      Logger.error(`[${this.name}] 插件HTTP服务注册失败:`, error);
      return false;
    }
  }

  public unregisterPluginHTTPService(pluginName: string): boolean {
    if (this.pluginServices.has(pluginName)) {
      this.pluginServices.delete(pluginName);
      Logger.info(`[${this.name}] 插件HTTP服务已注销: ${pluginName}`);
      return true;
    }
    return false;
  }

  public getHTTPServerInfo(): { host: string; port: number; url: string } {
    return {
      host: this.host,
      port: this.port,
      url: `http://${this.host}:${this.port}`
    };
  }
}