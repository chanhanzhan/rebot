import { Adapter, Message, PermissionLevel } from '../common/types';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';

export class AdapterManager {
  private static instance: AdapterManager;
  private adapters: Map<string, Adapter> = new Map();
  private eventBus: FrameworkEventBus;

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
    
    // 监听发送消息事件
    this.eventBus.on('send_message', this.handleSendMessage.bind(this));
  }

  public static getInstance(): AdapterManager {
    if (!AdapterManager.instance) {
      AdapterManager.instance = new AdapterManager();
    }
    return AdapterManager.instance;
  }

  public async registerAdapter(adapter: Adapter): Promise<void> {
    try {
      Logger.info(`正在注册适配器: ${adapter.name}`);
      
      // 设置消息监听
      adapter.onMessage((message: Message) => {
        this.handleMessage(message);
      });
      
      // 连接适配器
      await adapter.connect();
      
      // 注册适配器
      this.adapters.set(adapter.name, adapter);
      
      Logger.info(`适配器注册成功: ${adapter.name}`);
      
    } catch (error) {
      Logger.error(`注册适配器失败 ${adapter.name}:`, error);
      throw error;
    }
  }

  public async unregisterAdapter(adapterName: string): Promise<void> {
    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      Logger.warn(`适配器不存在: ${adapterName}`);
      return;
    }

    try {
      Logger.info(`正在注销适配器: ${adapterName}`);
      
      // 断开适配器连接
      await adapter.disconnect();
      
      // 移除适配器
      this.adapters.delete(adapterName);
      
      Logger.info(`适配器注销成功: ${adapterName}`);
      
    } catch (error) {
      Logger.error(`注销适配器失败 ${adapterName}:`, error);
      throw error;
    }
  }

  public getAdapter(name: string): Adapter | undefined {
    return this.adapters.get(name);
  }

  public getAllAdapters(): Adapter[] {
    return Array.from(this.adapters.values());
  }

  public async sendMessage(adapterName: string, target: string, content: string): Promise<void> {
    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      throw new Error(`Adapter not found: ${adapterName}`);
    }

    if (!adapter.isConnected()) {
      throw new Error(`Adapter not connected: ${adapterName}`);
    }

    await adapter.sendMessage(target, content);
  }

  private handleMessage(message: Message): void {
    try {
 //     Logger.info(`[适配器管理器] 收到消息: ${message.content} (来自: ${message.platform} - ${message.sender.name})`);
      const emitted = this.eventBus.safeEmit('message', message);
 //     Logger.debug(`[适配器管理器] 消息事件已发送, 是否有监听器: ${emitted}`);
      
    } catch (error) {
      Logger.error('[适配器管理器] 处理消息时出错:', error);
    }
  }

  private handleSendMessage(data: { platform: string; target: string; content: string }): void {
    try {
      Logger.info(`[适配器管理器] 准备发送消息到 ${data.platform}:${data.target}: ${data.content}`);
      
      // 根据平台找到对应的适配器
      const adapter = this.adapters.get(data.platform);
      if (!adapter) {
        Logger.error(`[适配器管理器] 未找到适配器: ${data.platform}`);
        return;
      }

      if (!adapter.isConnected()) {
        Logger.error(`[适配器管理器] 适配器未连接: ${data.platform}`);
        return;
      }

      // 发送消息
      adapter.sendMessage(data.target, data.content).catch((error) => {
        Logger.error(`[适配器管理器] 发送消息失败 (${data.platform}:${data.target}):`, error);
      });
      
    } catch (error) {
      Logger.error('[适配器管理器] 处理发送消息事件时出错:', error);
    }
  }

  /**
   * 自动加载适配器
   */
  public async loadAdaptersFromConfig(config: any): Promise<void> {
    try {
      Logger.info('正在从配置自动加载适配器...');
      //Logger.info('传入的配置:', JSON.stringify(config, null, 2));
      
      const adaptersConfig = config.adapters;
      if (!adaptersConfig) {
        Logger.warn('未找到适配器配置');
        return;
      }

      Logger.info('适配器配置:', JSON.stringify(adaptersConfig, null, 2));

      // 控制台适配器
      if (adaptersConfig.console?.enabled) {
        Logger.info('正在自动加载控制台适配器...');
        try {
          const ConsoleAdapterModule = await import('./console-adapter');
          const ConsoleAdapter = ConsoleAdapterModule.default || ConsoleAdapterModule.ConsoleAdapter;
          const adapter = new ConsoleAdapter();
          await this.registerAdapter(adapter);
          Logger.info('控制台适配器自动加载成功');
        } catch (error) {
          Logger.error('控制台适配器自动加载失败:', error);
        }
      } else {
        Logger.info('控制台适配器未启用');
      }

      if (adaptersConfig.qq?.enabled) {
        Logger.info('正在自动加载QQ适配器...');
        try {
          const QQAdapterModule = await import('./qq-adapter');
          const QQAdapter = QQAdapterModule.default || QQAdapterModule.QQAdapter;
          const adapter = new QQAdapter({
            uin: adaptersConfig.qq.uin || adaptersConfig.qq.account,
            password: adaptersConfig.qq.password,
            platform: adaptersConfig.qq.platform,
            allowedGroups: adaptersConfig.qq.allowedGroups,
            allowedUsers: adaptersConfig.qq.allowedUsers,
            adminUsers: adaptersConfig.qq.adminUsers,
            ownerUsers: adaptersConfig.qq.ownerUsers,
            autoAcceptFriend: adaptersConfig.qq.autoAcceptFriend,
            autoAcceptGroupInvite: adaptersConfig.qq.autoAcceptGroupInvite
          });
          await this.registerAdapter(adapter);
          Logger.info('QQ适配器自动加载成功');
        } catch (error) {
          Logger.error('QQ适配器自动加载失败:', error);
        }
      } else {
        Logger.info('QQ适配器未启用');
      }
      if (adaptersConfig.telegram?.enabled) {
        Logger.info('正在自动加载Telegram适配器...');
        try {
          const TelegramAdapterModule = await import('./telegram-adapter');
          const TelegramAdapter = TelegramAdapterModule.default || TelegramAdapterModule.TelegramAdapter;
          const adapter = new TelegramAdapter({
            token: adaptersConfig.telegram.token,
            allowedUsers: adaptersConfig.telegram.allowedUsers,
            adminUsers: adaptersConfig.telegram.adminUsers,
            ownerUsers: adaptersConfig.telegram.ownerUsers,
            polling: adaptersConfig.telegram.polling,
            webhook: adaptersConfig.telegram.webhook
          });
          await this.registerAdapter(adapter);
          Logger.info('Telegram适配器自动加载成功');
        } catch (error) {
          Logger.error('Telegram适配器自动加载失败:', error);
        }
      } else {
        Logger.info('Telegram适配器未启用');
      }

      if (adaptersConfig.http?.enabled) {
        Logger.info('正在自动加载HTTP API适配器...');
        try {
          const HTTPAdapterModule = await import('./http-adapter');
          const HTTPAdapter = HTTPAdapterModule.default || HTTPAdapterModule.HTTPAdapter;
          const adapter = new HTTPAdapter({
            port: adaptersConfig.http.port,
            host: adaptersConfig.http.host,
            apiKey: adaptersConfig.http.apiKey,
            allowedIPs: adaptersConfig.http.allowedIPs,
            defaultPermission: adaptersConfig.http.defaultPermission,
            userPermissions: adaptersConfig.http.userPermissions,
            cors: adaptersConfig.http.cors
          });
          await this.registerAdapter(adapter);
          Logger.info('HTTP API适配器自动加载成功');
        } catch (error) {
          Logger.error('HTTP API适配器自动加载失败:', error);
        }
      } else {
        Logger.info('HTTP API适配器未启用');
      }

      Logger.info('适配器自动加载完成');
    } catch (error) {
      Logger.error('自动加载适配器失败:', error);
    }
  }
}