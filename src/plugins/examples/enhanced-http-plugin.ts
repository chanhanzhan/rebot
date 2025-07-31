import { BasePlugin } from '../plugin';
import { Message, PluginFunction, PermissionLevel } from '../../common/types';
import { Logger } from '../../config/log';
import * as http from 'http';

/**
 * 增强HTTP插件 - 提供额外的HTTP API接口
 */
export class EnhancedHttpPlugin extends BasePlugin {
  public name = 'enhanced-http-plugin';
  public version = '1.0.0';
  public description = '增强HTTP插件，提供额外的API接口';

  private frameworkHTTPServiceUrl = 'http://localhost:3000';

  public async load(): Promise<void> {
    Logger.info(`[${this.name}] 正在加载增强HTTP插件...`);
    
    // 等待框架HTTP服务启动
    await this.waitForFrameworkHTTPService();
    
    // 注册到框架HTTP服务
    await this.registerToFrameworkHTTPService();
    
    Logger.info(`[${this.name}] 增强HTTP插件加载完成`);
  }

  public async unload(): Promise<void> {
    Logger.info(`[${this.name}] 增强HTTP插件已卸载`);
  }

  public getFunctions(): PluginFunction[] {
    return [];
  }

  private async waitForFrameworkHTTPService(): Promise<void> {
    // 等待框架HTTP服务启动
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      try {
        const response = await fetch('http://localhost:3000/api/framework/status');
        if (response.ok) {
          Logger.info(`[${this.name}] 框架HTTP服务已就绪`);
          return;
        }
      } catch (error) {
        // 服务还未启动，继续等待
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('框架HTTP服务启动超时');
  }

  private async registerToFrameworkHTTPService(): Promise<void> {
    const routes = [
      {
        method: 'GET',
        path: '/api/info',
        handler: this.handleApiInfo.bind(this)
      },
      {
        method: 'GET',
        path: '/api/status',
        handler: this.handleApiStatus.bind(this)
      },
      {
        method: 'POST',
        path: '/api/data',
        handler: this.handleApiData.bind(this)
      },
      {
        method: 'GET',
        path: '/api/config',
        handler: this.handleApiConfig.bind(this)
      },
      {
        method: 'PUT',
        path: '/api/config',
        handler: this.handleApiConfigUpdate.bind(this)
      },
      {
        method: 'GET',
        path: '/health',
        handler: this.handleHealthCheck.bind(this)
      },
      {
        method: 'GET',
        path: '/metrics',
        handler: this.handleMetrics.bind(this)
      }
    ];

    try {
      const response = await fetch('http://localhost:3000/api/plugins/register-http', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          pluginName: this.name,
          routes: routes,
          baseUrl: `/plugins/${this.name}`
        })
      });

      if (response.ok) {
        const result = await response.json() as any;
        Logger.info(`[${this.name}] HTTP服务注册成功: ${result.service?.baseUrl || 'unknown'}`);
      } else {
        throw new Error(`HTTP服务注册失败: ${response.status}`);
      }
    } catch (error) {
      Logger.error(`[${this.name}] HTTP服务注册失败:`, error);
      throw error;
    }
  }

  // API处理器
  private async handleApiInfo(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const info = {
      plugin: this.name,
      version: this.version,
      description: this.description,
      timestamp: new Date().toISOString(),
      directory: `/plugins/${this.name}`,
      endpoints: [
        'GET /api/info - 获取插件信息',
        'GET /api/status - 获取插件状态',
        'POST /api/data - 提交数据',
        'GET /api/config - 获取配置',
        'PUT /api/config - 更新配置',
        'GET /health - 健康检查',
        'GET /metrics - 获取指标'
      ]
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info, null, 2));
  }

  private async handleApiStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const status = {
      status: 'running',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
  }

  private async handleApiData(req: http.IncomingMessage, res: http.ServerResponse, body?: any): Promise<void> {
    try {
      const data = body ? JSON.parse(body) : {};
      Logger.info(`[${this.name}] 收到数据:`, data);

      const response = {
        success: true,
        message: '数据接收成功',
        received: data,
        timestamp: new Date().toISOString()
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response, null, 2));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false, 
        error: 'Invalid JSON data',
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  private async handleApiConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const config = {
      name: this.name,
      version: this.version,
      enabled: this.isEnabled(),
      settings: {
        cors: true,
        logging: true,
        rateLimit: false
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(config, null, 2));
  }

  private async handleApiConfigUpdate(req: http.IncomingMessage, res: http.ServerResponse, body?: any): Promise<void> {
    try {
      const newConfig = body ? JSON.parse(body) : {};
      Logger.info(`[${this.name}] 配置更新请求:`, newConfig);

      // 这里可以实现实际的配置更新逻辑
      const response = {
        success: true,
        message: '配置更新成功',
        config: newConfig,
        timestamp: new Date().toISOString()
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response, null, 2));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false, 
        error: 'Invalid configuration data',
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  private async handleHealthCheck(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const health = {
      status: 'healthy',
      plugin: this.name,
      version: this.version,
      timestamp: new Date().toISOString(),
      checks: {
        memory: process.memoryUsage().heapUsed < 100 * 1024 * 1024, // < 100MB
        uptime: process.uptime() > 0
      }
    };

    const statusCode = health.checks.memory && health.checks.uptime ? 200 : 503;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
  }

  private async handleMetrics(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const metrics = {
      plugin: this.name,
      timestamp: new Date().toISOString(),
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      },
      http: {
        directory: `/plugins/${this.name}`,
        routes: 7
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics, null, 2));
  }

  // 插件命令处理器
  private async handleHttpInfo(message: Message): Promise<void> {
    const httpDirectory = `/plugins/${this.name}`;
    
    let info = `🚀 增强HTTP服务信息\n\n`;
    info += `🔧 插件: ${this.name} v${this.version}\n`;
    info += `📁 HTTP目录: ${httpDirectory}\n`;
    info += `🌐 可用端点:\n`;
    info += `  GET ${httpDirectory}/api/info - 获取插件信息\n`;
    info += `  GET ${httpDirectory}/api/status - 获取插件状态\n`;
    info += `  POST ${httpDirectory}/api/data - 提交数据\n`;
    info += `  GET ${httpDirectory}/api/config - 获取配置\n`;
    info += `  PUT ${httpDirectory}/api/config - 更新配置\n`;
    info += `  GET ${httpDirectory}/health - 健康检查\n`;
    info += `  GET ${httpDirectory}/metrics - 获取指标\n\n`;

    await this.sendReply(message, info);
  }

  private async handleHttpTest(message: Message): Promise<void> {
    const httpDirectory = `/plugins/${this.name}`;

    let testInfo = `🧪 HTTP服务测试\n\n`;
    testInfo += `测试以下端点:\n`;
    testInfo += `curl http://localhost:3000${httpDirectory}/api/info\n`;
    testInfo += `curl http://localhost:3000${httpDirectory}/api/status\n`;
    testInfo += `curl http://localhost:3000${httpDirectory}/health\n`;
    testInfo += `curl -X POST -H "Content-Type: application/json" -d '{"test":"data"}' http://localhost:3000${httpDirectory}/api/data\n`;

    await this.sendReply(message, testInfo);
  }

  /**
   * 发送回复消息
   */
  private async sendReply(message: Message, content: string): Promise<void> {
    try {
      // 通过事件总线发送回复消息
      const { FrameworkEventBus } = require('../../common/event-bus');
      const eventBus = FrameworkEventBus.getInstance();
      
      // 构建目标地址
      let target = message.sender.id;
      if (message.platform === 'telegram' && message.extra?.chatId) {
        target = message.extra.chatId;
      } else if (message.platform === 'qq') {
        if (message.extra?.messageType === 'group') {
          target = `group:${message.extra.groupId}`;
        } else {
          target = `private:${message.sender.id}`;
        }
      }

      eventBus.safeEmit('send_message', {
        platform: message.platform,
        target: target,
        content: content
      });

      Logger.info(`[${this.name}] 发送回复消息到 ${message.platform}:${target}`);
    } catch (error) {
      Logger.error(`[${this.name}] 发送回复消息失败:`, error);
    }
  }
}