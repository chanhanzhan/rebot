
import { BotFramework } from '../core/bot-framework.js';
import { AdapterManager } from '../adapter/adapter-manager.js';
import { ConfigManager } from '../config/config.js';
import { DatabaseManager } from '../database/database-manager.js';
import { FrameworkEventBus } from '../common/event-bus.js';
import { Logger } from '../config/log.js';
import { Message, PermissionLevel, Plugin } from '../common/types.js';
import { PluginManager, PluginHttpService, PluginHttpRoute } from './plugin-manager.js';
import { PluginFunction } from '../common/types.js';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 插件接口，所有插件需实现
 */
export interface IPlugin extends Plugin {
  enabled: boolean;
  load(): Promise<void>;
  unload(): Promise<void>;
  reload(): Promise<void>;
  getFunctions(): PluginFunction[];
  getConfigPath(): string;
  getDataPath(): string;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  onHotReload?(): Promise<void>;
}

/**
 * 插件基类，推荐所有插件继承
 */
export abstract class BasePlugin implements IPlugin {
  public abstract name: string;
  public abstract version: string;
  public abstract description: string;
  public enabled: boolean = true;

  // 注入框架及核心API
  protected framework: BotFramework;
  protected adapterManager: AdapterManager;
  protected pluginManager: PluginManager;
  protected configManager: ConfigManager;
  protected databaseManager: DatabaseManager;
  protected eventBus: FrameworkEventBus;

  constructor() {
    this.framework = BotFramework.getInstance();
    this.adapterManager = AdapterManager.getInstance();
    this.pluginManager = PluginManager.getInstance();
    this.configManager = ConfigManager.getInstance();
    this.databaseManager = DatabaseManager.getInstance();
    this.eventBus = FrameworkEventBus.getInstance();
  }

  public abstract load(): Promise<void>;
  public abstract unload(): Promise<void>;
  public async reload(): Promise<void> {
    await this.unload();
    await this.load();
    if (this.onHotReload) {
      await this.onHotReload();
    }
  }
  public abstract getFunctions(): PluginFunction[];

  public getConfigPath(): string {
    return `./plugins/${this.name}/config/config.yaml`;
  }
  public getDataPath(): string {
    return `./plugins/${this.name}/data`;
  }
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    Logger.info(`插件 ${this.name} ${enabled ? '已启用' : '已禁用'}`);
  }
  public isEnabled(): boolean {
    return this.enabled;
  }
  public async onHotReload?(): Promise<void>;

  /**
   * 发送消息辅助
   */
  protected async sendMessage(message: Message, content: string): Promise<void> {
    Logger.info(`[${this.name}] 发送消息: ${content} -> ${message.sender.name}`);
    // 这里可集成事件总线或适配器
    this.eventBus.safeEmit('send_message', {
      platform: message.platform,
      target: message.sender.id,
      content
    });
  }
  /**
   * 权限检查辅助
   */
  protected checkPermission(userPermission: PermissionLevel, requiredPermission: PermissionLevel): boolean {
    return userPermission >= requiredPermission;
  }
  /**
   * 参数解析辅助
   */
  protected parseArgs(content: string): string[] {
    return content.trim().split(/\s+/).slice(1); 
  }
  /**
   * 插件API示例：获取全部适配器
   */
  public getAllAdapters() {
    return this.adapterManager.getAllAdapters();
  }
  /**
   * 插件API示例：获取全部插件
   */
  public getAllPlugins() {
    return this.pluginManager.getAllPlugins();
  }
  /**
   * 插件API示例：获取框架状态
   */
  public getFrameworkStatus() {
    return this.framework.getStatus();
  }
  /**
   * 插件API示例：发送自定义事件
   */
  public emitEvent(event: string, ...args: any[]) {
    this.eventBus.safeEmit(event, ...args);
  }
  /**
   * 插件API示例：获取配置
   */
  public getConfig(path: string) {
    return this.configManager.get(path);
  }
  /**
   * 插件API示例：获取数据库
   */
  public getDatabase() {
    return this.databaseManager;
  }
  /**
   * 撤回/删除消息（自动适配平台）
   */
  protected async revokeMessage(message: Message, messageId?: number): Promise<void> {
    const adapter = this.adapterManager.getAdapter(message.platform);
    if (!adapter) throw new Error(`未找到适配器: ${message.platform}`);
    const chatId = message.extra?.chatId || message.sender.id;
    const msgId = messageId || message.id;
    if (typeof (this.adapterManager as any).revokeMessage === 'function') {
      await (this.adapterManager as any).revokeMessage(message.platform, chatId, Number(msgId));
    } else {
      throw new Error('revokeMessage not supported by adapterManager');
    }
  }
  /**
   * 编辑消息（自动适配平台）
   */
  protected async editMessage(message: Message, newText: string, options?: any): Promise<void> {
    const adapter = this.adapterManager.getAdapter(message.platform);
    if (!adapter) throw new Error(`未找到适配器: ${message.platform}`);
    const chatId = message.extra?.chatId || message.sender.id;
    const msgId = message.id;
    if (typeof (this.adapterManager as any).editMessage === 'function') {
      await (this.adapterManager as any).editMessage(message.platform, chatId, Number(msgId), newText, options);
    } else {
      throw new Error('editMessage not supported by adapterManager');
    }
  }

  /**
   * 注册HTTP路由到OneBot适配器
   */
  protected registerHttpRoute(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'ALL', 
    handler: (req: http.IncomingMessage, res: http.ServerResponse, body?: any) => Promise<void>,
    middleware?: Array<(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void>): void {
    
    this.pluginManager.registerPluginHttpRoute(this.name, {
      path,
      method,
      handler,
      middleware
    });
  }

  /**
   * 批量注册HTTP路由到OneBot适配器
   */
  protected registerHttpRoutes(routes: Array<{
    path: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'ALL';
    handler: (req: http.IncomingMessage, res: http.ServerResponse, body?: any) => Promise<void>;
    middleware?: Array<(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void>;
  }>): void {
    this.pluginManager.registerPluginHttpRoutes(this.name, routes);
  }

  /**
   * 申请插件专用的HTTP目录
   * 插件可以在 /plugins/{pluginName}/ 下注册任意路由
   */
  protected requestHttpDirectory(options?: {
    middleware?: Array<(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void>;
    cors?: boolean;
    rateLimit?: { windowMs: number; max: number };
  }): string {
    return this.pluginManager.requestPluginHttpDirectory(this.name, options);
  }

  /**
   * 获取插件的HTTP目录路径
   */
  protected getHttpDirectory(): string | undefined {
    return this.pluginManager.getPluginHttpDirectory(this.name);
  }

  /**
   * 注销HTTP路由
   */
  protected unregisterHttpRoute(path: string, method: string): void {
    this.pluginManager.unregisterPluginHttpRoute(this.name, method, path);
  }

  /**
   * 启动独立的HTTP服务器
   */
  protected async startHttpServer(port: number, routes: Omit<PluginHttpRoute, 'pluginName'>[]): Promise<void> {
    const fullRoutes: PluginHttpRoute[] = routes.map(route => ({
      ...route,
      pluginName: this.name
    }));

    await this.pluginManager.startPluginHttpServerWithRoutes(this.name, port, fullRoutes);
  }

  /**
   * 停止独立的HTTP服务器
   */
  protected async stopHttpServer(): Promise<void> {
    await this.pluginManager.stopPluginHttpServer(this.name);
  }

  /**
   * 获取插件的HTTP服务信息
   */
  protected getHttpServiceInfo() {
    return this.pluginManager.getPluginHttpService(this.name);
  }
}
