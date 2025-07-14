import { Plugin, PluginFunction, Message, PermissionLevel } from '../../src/common/types';
import { Logger } from '../../src/config/log';
import { HelloApp } from './apps/hello';
import { PingApp } from './apps/ping';
import { StatusApp } from './apps/status';

/**
 * 示例插件主入口
 * 演示插件的标准结构和功能实现
 */
export class ExamplePlugin implements Plugin {
  public name = 'example-plugin';
  public version = '1.0.0';
  public description = '示例插件，展示插件开发的最佳实践';

  private functions: PluginFunction[] = [];
  private apps: Map<string, any> = new Map();
  private configPath = './plugins/example-plugin/config/config.yaml';
  private dataPath = './plugins/example-plugin/data';

  constructor() {
    this.initializeApps();
    this.initializeFunctions();
  }

  /**
   * 初始化应用模块
   */
  private initializeApps(): void {
    // 创建应用实例
    this.apps.set('hello', new HelloApp(this));
    this.apps.set('ping', new PingApp(this));
    this.apps.set('status', new StatusApp(this));
  }

  /**
   * 初始化插件功能
   */
  private initializeFunctions(): void {
    this.functions = [
      // Hello应用的功能
      {
        name: 'hello',
        description: '问候功能',
        permission: PermissionLevel.USER,
        triggers: ['hello', '你好', 'hi', '哈喽'],
        handler: this.apps.get('hello').handle.bind(this.apps.get('hello'))
      },
      // Ping应用的功能
      {
        name: 'ping',
        description: '测试连接响应',
        permission: PermissionLevel.USER,
        triggers: ['ping', 'pong', '测试'],
        handler: this.apps.get('ping').handle.bind(this.apps.get('ping'))
      },
      // Status应用的功能
      {
        name: 'status',
        description: '查看系统状态',
        permission: PermissionLevel.ADMIN,
        triggers: ['status', '状态', 'info', '信息'],
        handler: this.apps.get('status').handle.bind(this.apps.get('status'))
      },
      // 插件管理功能
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
    try {
      Logger.info(`Loading plugin: ${this.name} v${this.version}`);
      
      // 加载插件配置
      await this.loadConfig();
      
      // 初始化应用
      for (const [name, app] of this.apps) {
        if (app.initialize) {
          await app.initialize();
          Logger.debug(`Initialized app: ${name}`);
        }
      }
      
      // 创建数据目录
      await this.ensureDataDirectory();
      
      Logger.info(`Plugin loaded successfully: ${this.name}`);
    } catch (error) {
      Logger.error(`Failed to load plugin ${this.name}:`, error);
      throw error;
    }
  }

  public async unload(): Promise<void> {
    try {
      Logger.info(`Unloading plugin: ${this.name}`);
      
      // 清理应用
      for (const [name, app] of this.apps) {
        if (app.cleanup) {
          await app.cleanup();
          Logger.debug(`Cleaned up app: ${name}`);
        }
      }
      
      // 保存数据
      await this.saveData();
      
      Logger.info(`Plugin unloaded successfully: ${this.name}`);
    } catch (error) {
      Logger.error(`Failed to unload plugin ${this.name}:`, error);
      throw error;
    }
  }

  public async reload(): Promise<void> {
    Logger.info(`Reloading plugin: ${this.name}`);
    
    try {
      await this.unload();
      
      // 重新初始化
      this.initializeApps();
      this.initializeFunctions();
      
      await this.load();
      Logger.info(`Plugin reloaded successfully: ${this.name}`);
    } catch (error) {
      Logger.error(`Failed to reload plugin ${this.name}:`, error);
      throw error;
    }
  }

  public getFunctions(): PluginFunction[] {
    return this.functions;
  }

  public getConfigPath(): string {
    return this.configPath;
  }

  /**
   * 获取数据存储路径
   */
  public getDataPath(): string {
    return this.dataPath;
  }

  /**
   * 获取应用实例
   */
  public getApp(name: string): any {
    return this.apps.get(name);
  }

  /**
   * 帮助命令处理
   */
  private async handleHelp(message: Message, args: string[]): Promise<void> {
    Logger.info(`Help command executed by ${message.sender.name}`);
    
    let helpText = `📋 ${this.name} v${this.version} 帮助信息\n`;
    helpText += `📝 ${this.description}\n\n`;
    helpText += `📚 可用命令:\n`;
    
    for (const func of this.functions) {
      const permissionName = this.getPermissionName(func.permission);
      helpText += `• ${func.name} - ${func.description} [${permissionName}]\n`;
      helpText += `  触发词: ${func.triggers.join(', ')}\n`;
    }
    
    console.log(`[Bot -> ${message.sender.name}]: ${helpText}`);
  }

  /**
   * 获取权限名称
   */
  private getPermissionName(level: PermissionLevel): string {
    switch (level) {
      case PermissionLevel.USER: return '用户';
      case PermissionLevel.ADMIN: return '管理员';
      case PermissionLevel.OWNER: return '主人';
      default: return '未知';
    }
  }

  /**
   * 加载插件配置
   */
  private async loadConfig(): Promise<void> {
    try {
      // 这里应该从配置文件加载配置
      // 为了演示，使用默认配置
      Logger.debug(`Loading config from: ${this.configPath}`);
    } catch (error) {
      Logger.warn(`Failed to load config for plugin ${this.name}, using defaults:`, error);
    }
  }

  /**
   * 确保数据目录存在
   */
  private async ensureDataDirectory(): Promise<void> {
    try {
      // 这里应该检查并创建数据目录
      Logger.debug(`Ensuring data directory exists: ${this.dataPath}`);
    } catch (error) {
      Logger.error(`Failed to create data directory for plugin ${this.name}:`, error);
    }
  }

  /**
   * 保存插件数据
   */
  private async saveData(): Promise<void> {
    try {
      // 这里应该保存插件数据
      Logger.debug(`Saving plugin data to: ${this.dataPath}`);
    } catch (error) {
      Logger.error(`Failed to save data for plugin ${this.name}:`, error);
    }
  }
}

// 设置默认导出
export default ExamplePlugin;
