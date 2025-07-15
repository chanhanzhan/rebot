import { BasePlugin, IPlugin } from '../../src/plugins/plugin';
import { PluginFunction, Message, PermissionLevel } from '../../src/common/types';
import { Logger } from '../../src/config/log';
import { HelloApp } from './apps/hello';
import { PingApp } from './apps/ping';
import { StatusApp } from './apps/status';

/**
 * 示例插件主入口
 * 继承 BasePlugin，apps 子模块全部注册到主类，命令注册、权限、帮助、配置、数据全部标准化
 */
export class ExamplePlugin extends BasePlugin implements IPlugin {
  public name = 'example-plugin';
  public version = '2.0.0';
  public description = '示例插件，展示插件开发的最佳实践';

  private functions: PluginFunction[] = [];
  private apps: Map<string, any> = new Map();

  constructor() {
    super();
    this.initializeApps();
    this.initializeFunctions();
  }

  private initializeApps(): void {
    this.apps.set('hello', new HelloApp(this));
    this.apps.set('ping', new PingApp(this));
    this.apps.set('status', new StatusApp(this));
  }

  private initializeFunctions(): void {
    this.functions = [
      {
        name: 'hello',
        description: '问候功能',
        permission: PermissionLevel.USER,
        triggers: ['hello', '你好', 'hi', '哈喽'],
        handler: this.apps.get('hello').handle.bind(this.apps.get('hello'))
      },
      {
        name: 'ping',
        description: '测试连接响应',
        permission: PermissionLevel.USER,
        triggers: ['ping', 'pong', '测试'],
        handler: this.apps.get('ping').handle.bind(this.apps.get('ping'))
      },
      {
        name: 'status',
        description: '查看系统状态',
        permission: PermissionLevel.ADMIN,
        triggers: ['status', '状态', 'info', '信息'],
        handler: this.apps.get('status').handle.bind(this.apps.get('status'))
      },
      {
        name: 'plugin-help',
        description: '插件帮助信息',
        permission: PermissionLevel.USER,
        triggers: ['help', '帮助', 'commands', '命令'],
        handler: this.handleHelp.bind(this)
      }
    ];
  }

  public async load(): Promise<void> {
    Logger.info(`加载插件: ${this.name} v${this.version}`);
    for (const [name, app] of this.apps) {
      if (app.initialize) {
        await app.initialize();
        Logger.debug(`初始化子模块: ${name}`);
      }
    }
    Logger.info(`插件加载完成: ${this.name}`);
  }

  public async unload(): Promise<void> {
    Logger.info(`卸载插件: ${this.name}`);
    for (const [name, app] of this.apps) {
      if (app.cleanup) {
        await app.cleanup();
        Logger.debug(`清理子模块: ${name}`);
      }
    }
    Logger.info(`插件卸载完成: ${this.name}`);
  }

  public getFunctions(): PluginFunction[] {
    return this.enabled ? this.functions : [];
  }

  public async onHotReload(): Promise<void> {
    Logger.info(`插件 ${this.name} 热重载`);
    // 可在此处实现配置/数据热重载逻辑
  }

  private async handleHelp(message: Message, args: string[]): Promise<void> {
    let helpText = `📋 ${this.name} v${this.version} 帮助信息\n`;
    helpText += `📝 ${this.description}\n\n`;
    helpText += `📚 可用命令:\n`;
    for (const func of this.functions) {
      helpText += `• ${func.name} - ${func.description} [${this.getPermissionName(func.permission)}]\n`;
      helpText += `  触发词: ${func.triggers.join(', ')}\n`;
    }
    await this.sendMessage(message, helpText);
  }

  private getPermissionName(level: PermissionLevel): string {
    switch (level) {
      case PermissionLevel.USER: return '用户';
      case PermissionLevel.ADMIN: return '管理员';
      case PermissionLevel.OWNER: return '主人';
      default: return '未知';
    }
  }

  // Redis 缓存示例
  public async setCache(key: string, value: string) {
    await this.pluginManager.setRedisCache(`example-plugin:${key}`, value);
  }
  public async getCache(key: string) {
    return await this.pluginManager.getRedisCache(`example-plugin:${key}`);
  }
  public async delCache(key: string) {
    await this.pluginManager.delRedisCache(`example-plugin:${key}`);
  }
  // 上下文缓存（内存+redis）
  private contextCache: Map<string, any[]> = new Map();
  public cacheContext(chatId: string, message: any) {
    if (!this.contextCache.has(chatId)) this.contextCache.set(chatId, []);
    this.contextCache.get(chatId)!.push(message);
    if (this.contextCache.get(chatId)!.length > 100) this.contextCache.get(chatId)!.shift();
    // 可选：同步到 redis
    this.setCache(`context:${chatId}`, JSON.stringify(this.contextCache.get(chatId)));
  }
  public async getCachedContext(chatId: string, limit: number = 20) {
    const redisVal = await this.getCache(`context:${chatId}`);
    if (redisVal) return JSON.parse(redisVal).slice(-limit);
    return (this.contextCache.get(chatId) || []).slice(-limit);
  }
}

export default ExamplePlugin;
