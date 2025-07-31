import { BasePlugin } from '../plugin';
import { PluginFunction } from '../../common/types';
import { Message, PermissionLevel } from '../../common/types';
import { Logger } from '../../config/log';
import * as http from 'http';

/**
 * HTTP服务示例插件
 * 展示如何注册HTTP路由和启动独立HTTP服务器
 */
export class HttpExamplePlugin extends BasePlugin {
  public name = 'http-example';
  public version = '1.0.0';
  public description = 'HTTP服务示例插件，展示OneBot v11适配器的HTTP功能';

  public async load(): Promise<void> {
    Logger.info(`[${this.name}] 插件加载中...`);

    // 方式1: 注册路由到OneBot HTTP适配器
    this.registerHttpRoute('/hello', 'GET', this.handleHello.bind(this));
    this.registerHttpRoute('/echo', 'POST', this.handleEcho.bind(this));
    this.registerHttpRoute('/user/:id', 'GET', this.handleGetUser.bind(this));
    
    // 带中间件的路由
    this.registerHttpRoute('/protected', 'GET', this.handleProtected.bind(this), [
      this.authMiddleware.bind(this)
    ]);

    // 方式2: 启动独立的HTTP服务器（可选）
    if (this.getConfig('plugins.http_example.standalone_server.enabled')) {
      const port = this.getConfig('plugins.http_example.standalone_server.port') || 8080;
      await this.startHttpServer(port, [
        {
          path: '/api/status',
          method: 'GET',
          handler: this.handleStatus.bind(this)
        },
        {
          path: '/api/webhook',
          method: 'POST',
          handler: this.handleWebhook.bind(this)
        }
      ]);
    }

    Logger.info(`[${this.name}] 插件加载完成`);
  }

  public async unload(): Promise<void> {
    Logger.info(`[${this.name}] 插件卸载中...`);

    // 注销所有HTTP路由
    this.unregisterHttpRoute('/hello', 'GET');
    this.unregisterHttpRoute('/echo', 'POST');
    this.unregisterHttpRoute('/user/:id', 'GET');
    this.unregisterHttpRoute('/protected', 'GET');

    // 停止独立HTTP服务器
    await this.stopHttpServer();

    Logger.info(`[${this.name}] 插件卸载完成`);
  }

  public getFunctions(): PluginFunction[] {
    return [
      {
        name: 'http-info',
        description: '显示HTTP服务信息',
        triggers: ['http', 'http信息'],
        permission: PermissionLevel.USER,
        handler: this.handleHttpInfo.bind(this)
      }
    ];
  }

  // HTTP路由处理器
  private async handleHello(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const response = {
      message: 'Hello from HTTP Example Plugin!',
      timestamp: new Date().toISOString(),
      plugin: this.name,
      version: this.version
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  private async handleEcho(req: http.IncomingMessage, res: http.ServerResponse, body: any): Promise<void> {
    const response = {
      echo: body,
      received_at: new Date().toISOString(),
      plugin: this.name
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  private async handleGetUser(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const userId = url.pathname.split('/').pop();

    const response = {
      user_id: userId,
      name: `User ${userId}`,
      status: 'active',
      plugin: this.name
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  private async handleProtected(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const response = {
      message: 'This is a protected endpoint',
      user: (req as any).user,
      timestamp: new Date().toISOString()
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  private async handleStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const httpService = this.getHttpServiceInfo();
    
    const response = {
      plugin: this.name,
      version: this.version,
      status: 'running',
      http_service: {
        port: httpService?.port,
        routes_count: httpService?.routes.length || 0
      },
      framework_status: this.getFrameworkStatus(),
      timestamp: new Date().toISOString()
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  private async handleWebhook(req: http.IncomingMessage, res: http.ServerResponse, body: any): Promise<void> {
    Logger.info(`[${this.name}] 收到Webhook: ${JSON.stringify(body)}`);

    // 处理webhook数据
    this.emitEvent('webhook_received', {
      plugin: this.name,
      data: body,
      timestamp: new Date().toISOString()
    });

    const response = {
      status: 'received',
      message: 'Webhook processed successfully',
      timestamp: new Date().toISOString()
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  // 中间件
  private authMiddleware(req: http.IncomingMessage, res: http.ServerResponse, next: () => void): void {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    
    if (!token || token !== 'example-token') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // 添加用户信息到请求对象
    (req as any).user = { id: 1, name: 'Example User' };
    next();
  }

  // 插件命令处理器
  private async handleHttpInfo(message: Message): Promise<void> {
    const httpService = this.getHttpServiceInfo();
    const allServices = this.pluginManager.getPluginHttpServices();
    
    let info = `📡 HTTP服务信息\n\n`;
    info += `🔧 插件: ${this.name} v${this.version}\n`;
    
    if (httpService) {
      info += `🌐 独立服务器: ${httpService.port ? `端口 ${httpService.port}` : '未启动'}\n`;
      info += `📋 注册路由: ${httpService.routes.length} 个\n\n`;
      
      if (httpService.routes.length > 0) {
        info += `路由列表:\n`;
        for (const route of httpService.routes) {
          info += `  ${route.method} ${route.path}\n`;
        }
      }
    } else {
      info += `❌ 未找到HTTP服务信息\n`;
    }

    info += `\n🌍 全局HTTP服务: ${allServices.length} 个插件注册了服务`;

    await this.sendMessage(message, info);
  }
}

export default HttpExamplePlugin;