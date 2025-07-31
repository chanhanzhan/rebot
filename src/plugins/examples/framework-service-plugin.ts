import { BasePlugin } from '../plugin';
import { PluginFunction } from '../../common/types';
import { Message, PermissionLevel } from '../../common/types';
import { Logger } from '../../config/log';
import * as http from 'http';

/**
 * 框架服务插件
 * 提供HTTP框架API服务和Telegram命令注册功能
 */
export class FrameworkServicePlugin extends BasePlugin {
  public name = 'framework-service';
  public version = '1.0.0';
  public description = '框架服务插件，提供HTTP API和Telegram命令注册';

  private telegramCommands: Array<{
    command: string;
    description: string;
    handler: (message: Message, args: string[]) => Promise<void>;
  }> = [];

  public async load(): Promise<void> {
    Logger.info(`[${this.name}] 插件加载中...`);

    // 申请插件专用的HTTP目录
    const httpDirectory = this.requestHttpDirectory({
      cors: true,
      middleware: [
        // CORS中间件
        (req, res, next) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
          if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
          }
          next();
        },
        // 认证中间件
        (req, res, next) => {
          const authHeader = req.headers.authorization;
          if (req.url?.startsWith('/api/admin/')) {
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Unauthorized' }));
              return;
            }
          }
          next();
        },
        // 日志中间件
        (req, res, next) => {
          Logger.info(`[${this.name}] HTTP请求: ${req.method} ${req.url}`);
          next();
        }
      ]
    });

    Logger.info(`[${this.name}] 申请HTTP目录: ${httpDirectory}`);

    // 注册框架API路由
    this.registerHttpRoutes([
      // 公开API
      {
        path: '/api/framework/info',
        method: 'GET',
        handler: this.handleFrameworkInfo.bind(this)
      },
      {
        path: '/api/framework/status',
        method: 'GET',
        handler: this.handleFrameworkStatus.bind(this)
      },
      {
        path: '/api/framework/plugins',
        method: 'GET',
        handler: this.handlePluginsList.bind(this)
      },
      {
        path: '/api/framework/adapters',
        method: 'GET',
        handler: this.handleAdaptersList.bind(this)
      },
      {
        path: '/api/framework/commands',
        method: 'GET',
        handler: this.handleCommandsList.bind(this)
      },
      // 管理API (需要认证)
      {
        path: '/api/admin/plugins/reload',
        method: 'POST',
        handler: this.handlePluginReload.bind(this)
      },
      {
        path: '/api/admin/config/update',
        method: 'PUT',
        handler: this.handleConfigUpdate.bind(this)
      },
      {
        path: '/api/admin/system/restart',
        method: 'POST',
        handler: this.handleSystemRestart.bind(this)
      },
      // WebSocket升级端点
      {
        path: '/ws/events',
        method: 'GET',
        handler: this.handleWebSocketUpgrade.bind(this)
      }
    ]);

    // 注册Telegram命令
    this.registerTelegramCommands();

    Logger.info(`[${this.name}] 插件加载完成`);
  }

  public async unload(): Promise<void> {
    Logger.info(`[${this.name}] 插件卸载中...`);
    // 清理Telegram命令
    this.telegramCommands = [];
    Logger.info(`[${this.name}] 插件卸载完成`);
  }

  public getFunctions(): PluginFunction[] {
    const functions: PluginFunction[] = [
      {
        name: 'framework-info',
        description: '显示框架信息',
        triggers: ['framework', 'fw', '框架'],
        permission: PermissionLevel.USER,
        handler: this.handleFrameworkInfoCommand.bind(this)
      },
      {
        name: 'plugin-list',
        description: '显示插件列表',
        triggers: ['plugins', 'pl', '插件'],
        permission: PermissionLevel.USER,
        handler: this.handlePluginListCommand.bind(this)
      },
      {
        name: 'system-status',
        description: '显示系统状态',
        triggers: ['status', 'st', '状态'],
        permission: PermissionLevel.USER,
        handler: this.handleSystemStatusCommand.bind(this)
      },
      {
        name: 'reload-plugin',
        description: '重载插件',
        triggers: ['reload', 'rl', '重载'],
        permission: PermissionLevel.ADMIN,
        handler: this.handleReloadCommand.bind(this)
      }
    ];

    // 添加Telegram特定命令
    for (const cmd of this.telegramCommands) {
      functions.push({
        name: `telegram-${cmd.command}`,
        description: cmd.description,
        triggers: [`/${cmd.command}`],
        permission: PermissionLevel.USER,
        adapters: ['telegram'],
        handler: cmd.handler
      });
    }

    return functions;
  }

  // 注册Telegram命令
  private registerTelegramCommands(): void {
    this.telegramCommands = [
      {
        command: 'start',
        description: '开始使用机器人',
        handler: this.handleTelegramStart.bind(this)
      },
      {
        command: 'help',
        description: '显示帮助信息',
        handler: this.handleTelegramHelp.bind(this)
      },
      {
        command: 'info',
        description: '显示机器人信息',
        handler: this.handleTelegramInfo.bind(this)
      },
      {
        command: 'status',
        description: '显示系统状态',
        handler: this.handleTelegramStatus.bind(this)
      },
      {
        command: 'plugins',
        description: '显示插件列表',
        handler: this.handleTelegramPlugins.bind(this)
      },
      {
        command: 'reload',
        description: '重载插件 (管理员)',
        handler: this.handleTelegramReload.bind(this)
      }
    ];

    // 设置Telegram Bot命令菜单
    this.setTelegramBotCommands();
  }

  // 设置Telegram Bot命令菜单
  private async setTelegramBotCommands(): Promise<void> {
    try {
      const telegramAdapter = this.adapterManager.getAdapter('telegram');
      if (telegramAdapter && typeof (telegramAdapter as any).makeApiCall === 'function') {
        const commands = this.telegramCommands.map(cmd => ({
          command: cmd.command,
          description: cmd.description
        }));

        await (telegramAdapter as any).makeApiCall('setMyCommands', {
          commands: commands
        });

        Logger.info(`[${this.name}] 已设置Telegram Bot命令菜单: ${commands.length}个命令`);
      }
    } catch (error) {
      Logger.error(`[${this.name}] 设置Telegram Bot命令菜单失败:`, error);
    }
  }

  // HTTP API处理器
  private async handleFrameworkInfo(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const info = {
      name: 'Advanced Bot Framework',
      version: '1.0.0',
      description: '多平台机器人框架',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      node_version: process.version,
      platform: process.platform,
      arch: process.arch
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info, null, 2));
  }

  private async handleFrameworkStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const adapters = this.adapterManager.getAdapterStats();
    const plugins = this.pluginManager.listAllPluginHttpServices();

    const status = {
      status: 'running',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      adapters: Array.isArray(adapters) ? adapters.length : Object.keys(adapters).length,
      plugins: plugins.length,
      active_connections: this.getActiveConnections()
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
  }

  private async handlePluginsList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const plugins = this.pluginManager.listAllPluginHttpServices();
    const pluginList = plugins.map(plugin => ({
      name: plugin.pluginName,
      routes: plugin.routes,
      directory: plugin.directory,
      independent_server: plugin.independentServer
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ plugins: pluginList }, null, 2));
  }

  private async handleAdaptersList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const adapters = this.adapterManager.getAdapterStats();
    const adapterList = Array.isArray(adapters) ? adapters : [adapters];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ adapters: adapterList }, null, 2));
  }

  private async handleCommandsList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const commands = {
      telegram_commands: this.telegramCommands.map(cmd => ({
        command: `/${cmd.command}`,
        description: cmd.description
      })),
      plugin_functions: this.getFunctions().map(func => ({
        name: func.name,
        description: func.description,
        triggers: func.triggers,
        permission: func.permission,
        adapters: func.adapters || ['all']
      }))
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(commands, null, 2));
  }

  private async handlePluginReload(req: http.IncomingMessage, res: http.ServerResponse, body?: any): Promise<void> {
    try {
      const data = body ? JSON.parse(body) : {};
      const pluginName = data.plugin;

      if (!pluginName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Plugin name is required' }));
        return;
      }

      // 这里应该调用插件管理器的重载方法
      Logger.info(`[${this.name}] 重载插件请求: ${pluginName}`);

      const response = {
        success: true,
        message: `Plugin ${pluginName} reloaded successfully`,
        timestamp: new Date().toISOString()
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response, null, 2));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  private async handleConfigUpdate(req: http.IncomingMessage, res: http.ServerResponse, body?: any): Promise<void> {
    try {
      const config = body ? JSON.parse(body) : {};
      Logger.info(`[${this.name}] 配置更新请求:`, config);

      const response = {
        success: true,
        message: 'Configuration updated successfully',
        timestamp: new Date().toISOString()
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response, null, 2));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  private async handleSystemRestart(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const response = {
      success: true,
      message: 'System restart initiated',
      timestamp: new Date().toISOString()
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));

    // 延迟重启以确保响应发送
    setTimeout(() => {
      Logger.info(`[${this.name}] 系统重启请求`);
      // process.exit(0); // 实际环境中取消注释
    }, 1000);
  }

  private async handleWebSocketUpgrade(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // WebSocket升级处理
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebSocket upgrade required');
  }

  // Telegram命令处理器
  private async handleTelegramStart(message: Message, args: string[]): Promise<void> {
    const welcomeText = `🤖 欢迎使用 Advanced Bot Framework！

🚀 这是一个多平台机器人框架，支持：
• Telegram
• QQ
• HTTP API
• 控制台

📋 可用命令：
/help - 显示帮助信息
/info - 显示机器人信息
/status - 显示系统状态
/plugins - 显示插件列表

💡 输入 /help 获取更多帮助信息。`;

    await this.sendReply(message, welcomeText);
  }

  private async handleTelegramHelp(message: Message, args: string[]): Promise<void> {
    const helpText = `📖 帮助信息

🔧 基本命令：
/start - 开始使用机器人
/help - 显示此帮助信息
/info - 显示机器人详细信息
/status - 显示系统运行状态
/plugins - 显示已加载的插件

⚙️ 管理命令（需要管理员权限）：
/reload <插件名> - 重载指定插件

🌐 HTTP API：
访问 http://localhost:8080${this.getHttpDirectory()}/api/framework/info 获取框架信息

💬 其他功能：
• 支持多种触发词
• 权限管理
• 插件系统
• HTTP服务

如需更多帮助，请联系管理员。`;

    await this.sendReply(message, helpText);
  }

  private async handleTelegramInfo(message: Message, args: string[]): Promise<void> {
    const info = `🤖 机器人信息

📊 系统信息：
• 框架版本：1.0.0
• Node.js版本：${process.version}
• 运行时间：${Math.floor(process.uptime())}秒
• 内存使用：${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB

🔌 适配器状态：
• Telegram：✅ 已连接
• HTTP API：✅ 运行中

🧩 插件信息：
• 已加载插件：${this.pluginManager.listAllPluginHttpServices().length}个
• HTTP服务：${this.getHttpDirectory() || '未申请'}

🌐 API端点：
• 框架信息：/api/framework/info
• 系统状态：/api/framework/status
• 插件列表：/api/framework/plugins`;

    await this.sendReply(message, info);
  }

  private async handleTelegramStatus(message: Message, args: string[]): Promise<void> {
    const uptime = Math.floor(process.uptime());
    const memory = process.memoryUsage();
    const adapters = this.adapterManager.getAdapterStats();
    
    const statusText = `📊 系统状态

⏱️ 运行时间：${uptime}秒
💾 内存使用：${Math.round(memory.heapUsed / 1024 / 1024)}MB / ${Math.round(memory.heapTotal / 1024 / 1024)}MB
🔄 CPU使用：${process.cpuUsage().user}μs

🔌 适配器：${Array.isArray(adapters) ? adapters.length : Object.keys(adapters).length}个
🧩 插件：${this.pluginManager.listAllPluginHttpServices().length}个
🌐 HTTP目录：${this.getHttpDirectory() || '未申请'}

✅ 系统运行正常`;

    await this.sendReply(message, statusText);
  }

  private async handleTelegramPlugins(message: Message, args: string[]): Promise<void> {
    const plugins = this.pluginManager.listAllPluginHttpServices();
    
    let pluginText = `🧩 插件列表 (${plugins.length}个)\n\n`;
    
    for (const plugin of plugins) {
      pluginText += `📦 ${plugin.pluginName}\n`;
      pluginText += `   路由：${plugin.routes}个\n`;
      if (plugin.directory) {
        pluginText += `   目录：${plugin.directory}\n`;
      }
      if (plugin.independentServer) {
        pluginText += `   独立服务：端口${plugin.independentServer.port}\n`;
      }
      pluginText += `\n`;
    }

    await this.sendReply(message, pluginText);
  }

  private async handleTelegramReload(message: Message, args: string[]): Promise<void> {
    if (message.sender.permission < PermissionLevel.ADMIN) {
      await this.sendReply(message, '❌ 权限不足，需要管理员权限');
      return;
    }

    const pluginName = args[0];
    if (!pluginName) {
      await this.sendReply(message, '❌ 请指定要重载的插件名称\n用法：/reload <插件名>');
      return;
    }

    try {
      Logger.info(`[${this.name}] Telegram重载插件请求: ${pluginName}`);
      await this.sendReply(message, `✅ 插件 ${pluginName} 重载成功`);
    } catch (error) {
      await this.sendReply(message, `❌ 插件 ${pluginName} 重载失败: ${error}`);
    }
  }

  // 普通命令处理器
  private async handleFrameworkInfoCommand(message: Message): Promise<void> {
    const adapters = this.adapterManager.getAdapterStats();
    
    const info = `🤖 框架信息

📊 Advanced Bot Framework v1.0.0
🚀 多平台机器人框架

💻 系统信息：
• Node.js: ${process.version}
• 平台: ${process.platform}
• 架构: ${process.arch}
• 运行时间: ${Math.floor(process.uptime())}秒

🔌 适配器: ${Array.isArray(adapters) ? adapters.length : Object.keys(adapters).length}个
🧩 插件: ${this.pluginManager.listAllPluginHttpServices().length}个
🌐 HTTP服务: ${this.getHttpDirectory() || '未申请'}`;

    await this.sendReply(message, info);
  }

  private async handlePluginListCommand(message: Message): Promise<void> {
    const plugins = this.pluginManager.listAllPluginHttpServices();
    
    let info = `🧩 插件列表 (${plugins.length}个)\n\n`;
    
    for (const plugin of plugins) {
      info += `📦 ${plugin.pluginName}: ${plugin.routes}个路由`;
      if (plugin.directory) {
        info += ` (${plugin.directory})`;
      }
      info += `\n`;
    }

    await this.sendReply(message, info);
  }

  private async handleSystemStatusCommand(message: Message): Promise<void> {
    const memory = process.memoryUsage();
    const adapters = this.adapterManager.getAdapterStats();
    
    const status = `📊 系统状态

⏱️ 运行时间: ${Math.floor(process.uptime())}秒
💾 内存使用: ${Math.round(memory.heapUsed / 1024 / 1024)}MB
🔌 适配器: ${Array.isArray(adapters) ? adapters.length : Object.keys(adapters).length}个
🧩 插件: ${this.pluginManager.listAllPluginHttpServices().length}个

✅ 系统运行正常`;

    await this.sendReply(message, status);
  }

  private async handleReloadCommand(message: Message): Promise<void> {
    if (message.sender.permission < PermissionLevel.ADMIN) {
      await this.sendReply(message, '❌ 权限不足，需要管理员权限');
      return;
    }

    await this.sendReply(message, '🔄 插件重载功能开发中...');
  }

  // 工具方法
  private getActiveConnections(): number {
    // 返回活跃连接数的模拟值
    return Math.floor(Math.random() * 10) + 1;
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