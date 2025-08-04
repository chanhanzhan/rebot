import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';
import { DatabaseManager } from '../database/database-manager';
import { ConfigManager } from '../config/config';
import { HttpCoreAdapter } from './http-core-adapter';
import { AdapterLoader } from './adapter-loader';
import { PluginLoader } from './plugin-loader';
import * as path from 'path';

/**
 * 机器人框架核心类 - 重构版本
 * 职责：框架生命周期管理、组件协调、错误捕获
 */
export class BotFramework {
  private static instance: BotFramework;
  private eventBus: FrameworkEventBus;
  private databaseManager: DatabaseManager;
  private configManager: ConfigManager;
  private httpCoreAdapter?: HttpCoreAdapter;
  private adapterLoader: AdapterLoader;
  private pluginLoader: PluginLoader;
  private isStarted: boolean = false;
  private startupErrors: Error[] = [];

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
    this.databaseManager = DatabaseManager.getInstance();
    this.configManager = ConfigManager.getInstance();
    // HttpCoreAdapter 将在 startHttpCoreAdapter 方法中初始化
    this.adapterLoader = AdapterLoader.getInstance();
    this.pluginLoader = PluginLoader.getInstance();
    
    this.setupErrorHandling();
    this.setupLifecycleHooks();
  }

  public static getInstance(): BotFramework {
    if (!BotFramework.instance) {
      BotFramework.instance = new BotFramework();
    }
    return BotFramework.instance;
  }

  /**
   * 设置错误处理
   */
  private setupErrorHandling(): void {
    // 全局错误捕获
    process.on('uncaughtException', (error) => {
      Logger.error('未捕获的异常:', error);
      this.handleCriticalError(error);
    });

    process.on('unhandledRejection', (reason, promise) => {
      Logger.error('未处理的Promise拒绝:', reason);
      this.handleCriticalError(new Error(`Unhandled Promise Rejection: ${reason}`));
    });

    // 监听组件错误
    this.eventBus.on('adapter-error', (error: Error) => {
      Logger.error('适配器错误:', error);
      this.handleComponentError('adapter', error);
    });

    this.eventBus.on('plugin-error', (error: Error) => {
      Logger.error('插件错误:', error);
      this.handleComponentError('plugin', error);
    });

    this.eventBus.on('http-core-error', (error: Error) => {
      Logger.error('HTTP核心适配器错误:', error);
      this.handleComponentError('http-core', error);
    });
  }

  /**
   * 设置生命周期钩子
   */
  private setupLifecycleHooks(): void {
    // 插件生命周期钩子
    this.pluginLoader.setLifecycleHooks({
      beforeLoad: async (spec) => {
        Logger.debug(`准备加载插件: ${spec.name}`);
      },
      afterLoad: async (plugin, result) => {
        if (result.success) {
          Logger.info(`✅ 插件加载成功: ${plugin.name} (${result.loadTime}ms)`);
        }
      },
      onError: async (error, spec) => {
        Logger.error(`❌ 插件加载失败: ${spec.name}`, error);
        this.startupErrors.push(error);
      }
    });

    // 适配器生命周期钩子
    // this.adapterLoader.setLifecycleHooks({
    //   beforeLoad: async (spec: any) => {
    //     Logger.info(`准备加载适配器: ${spec.name}`);
    //   },
    //   afterLoad: async (adapter: any, result: any) => {
    //     Logger.info(`适配器加载完成: ${result.name}`);
    //     this.eventBus.emit('adapter-ready', { adapter, result });
    //   },
    //   onError: async (error: any, spec: any) => {
    //     Logger.error(`适配器加载失败: ${spec?.name}`, error);
    //     this.eventBus.emit('adapter-load-error', { error, spec });
    //   }
    // });
  }

  /**
   * 启动框架
   */
  public async start(): Promise<void> {
    if (this.isStarted) {
      Logger.warn('框架已启动');
      return;
    }

    try {
      Logger.info('🚀 启动机器人框架...');
      this.startupErrors = [];

      // 1. 连接数据库
      await this.connectDatabase();

      // 2. 启动HTTP核心适配器（最底层）
      await this.startHttpCoreAdapter();

      // 3. 加载适配器（异步多线程）
      await this.loadAdapters();

      // 4. 加载插件（异步多线程）
      await this.loadPlugins();

      // 5. 检查启动错误
      this.checkStartupErrors();

      this.isStarted = true;
      Logger.info('✅ 机器人框架启动完成');

      this.eventBus.emit('framework-started');

    } catch (error) {
      Logger.error('❌ 框架启动失败:', error);
      await this.handleStartupFailure(error as Error);
      throw error;
    }
  }

  /**
   * 停止框架
   */
  public async stop(): Promise<void> {
    if (!this.isStarted) {
      Logger.warn('框架未启动');
      return;
    }

    try {
      Logger.info('🛑 停止机器人框架...');

      this.eventBus.emit('framework-stopping');

      // 1. 卸载插件
      await this.unloadPlugins();

      // 2. 卸载适配器
      await this.unloadAdapters();

      // 3. 停止HTTP核心适配器
      await this.stopHttpCoreAdapter();

      // 4. 断开数据库
      await this.disconnectDatabase();

      this.isStarted = false;
      Logger.info('✅ 机器人框架已停止');

      this.eventBus.emit('framework-stopped');

    } catch (error) {
      Logger.error('❌ 框架停止失败:', error);
      throw error;
    }
  }

  /**
   * 连接数据库
   */
  private async connectDatabase(): Promise<void> {
    try {
      Logger.info('🔗 连接数据库...');
      await this.databaseManager.connect();
      Logger.info('✅ 数据库连接成功');
    } catch (error) {
      Logger.error('❌ 数据库连接失败:', error);
      throw error;
    }
  }

  /**
   * 断开数据库
   */
  private async disconnectDatabase(): Promise<void> {
    try {
      Logger.info('🔌 断开数据库连接...');
      await this.databaseManager.disconnect();
      Logger.info('✅ 数据库连接已断开');
    } catch (error) {
      Logger.error('❌ 数据库断开失败:', error);
      // 不抛出错误，允许继续关闭流程
    }
  }

  /**
   * 启动HTTP核心适配器
   */
  private async startHttpCoreAdapter(): Promise<void> {
    try {
      Logger.info('🌐 启动HTTP核心适配器...');
      
      const config = this.configManager.getConfig();
      
      // 启动HTTP服务器（如果配置了）
      if (config.http?.enabled) {
        this.httpCoreAdapter = HttpCoreAdapter.getInstance({
          host: config.http.host,
          port: config.http.port,
          cors: config.http.cors
        });
        await this.httpCoreAdapter.start();
        Logger.info('HTTP服务器启动成功');
      } else {
        // 使用默认配置启动
        const httpConfig = {
          host: '0.0.0.0',
          port: 3000,
          cors: { enabled: true }
        };
        this.httpCoreAdapter = HttpCoreAdapter.getInstance(httpConfig);
        await this.httpCoreAdapter.start();
        Logger.info(`✅ HTTP核心适配器启动成功 (${httpConfig.host}:${httpConfig.port})`);
      }
    } catch (error) {
      Logger.error('❌ HTTP核心适配器启动失败:', error);
      throw error;
    }
  }

  /**
   * 停止HTTP核心适配器
   */
  private async stopHttpCoreAdapter(): Promise<void> {
    try {
      Logger.info('🌐 停止HTTP核心适配器...');
      if (this.httpCoreAdapter) {
        await this.httpCoreAdapter.stop();
        Logger.info('✅ HTTP核心适配器已停止');
      }
    } catch (error) {
      Logger.error('❌ HTTP核心适配器停止失败:', error);
      // 不抛出错误，允许继续关闭流程
    }
  }

  /**
   * 加载适配器
   */
  private async loadAdapters(): Promise<void> {
    try {
      Logger.info('🔌 加载适配器...');
      
      // 在运行时使用编译后的dist目录
      const adaptersDir = path.join(process.cwd(), 'dist', 'src', 'adapter');
      const results = await this.adapterLoader.loadAdaptersFromDirectory(adaptersDir, {
        parallel: true,
        maxConcurrency: 4,
        timeout: 30000
      });

      const successCount = results.filter(r => r.success).length;
      Logger.info(`✅ 适配器加载完成: ${successCount}/${results.length}`);

      if (successCount === 0 && results.length > 0) {
        Logger.warn('⚠️ 没有适配器加载成功，框架功能可能受限');
      }

    } catch (error) {
      Logger.error('❌ 适配器加载失败:', error);
      // 不抛出错误，允许框架继续启动
    }
  }

  /**
   * 卸载适配器
   */
  private async unloadAdapters(): Promise<void> {
    try {
      Logger.info('🔌 卸载适配器...');
      await this.adapterLoader.unloadAllAdapters();
      Logger.info('✅ 适配器卸载完成');
    } catch (error) {
      Logger.error('❌ 适配器卸载失败:', error);
      // 不抛出错误，允许继续关闭流程
    }
  }

  /**
   * 加载插件
   */
  private async loadPlugins(): Promise<void> {
    try {
      Logger.info('🧩 加载插件...');
      
      // 在运行时使用编译后的dist目录
      const pluginsDir = path.join(process.cwd(), 'dist', 'plugins');
      const results = await this.pluginLoader.loadPluginsFromDirectory(pluginsDir, {
        parallel: true,
        maxConcurrency: 6,
        timeout: 30000,
        validateDependencies: true,
        hotReload: process.env.NODE_ENV === 'development'
      });

      const successCount = results.filter(r => r.success).length;
      Logger.info(`✅ 插件加载完成: ${successCount}/${results.length}`);

      if (successCount === 0 && results.length > 0) {
        Logger.warn('⚠️ 没有插件加载成功，框架功能可能受限');
      }

    } catch (error) {
      Logger.error('❌ 插件加载失败:', error);
      // 不抛出错误，允许框架继续启动
    }
  }

  /**
   * 卸载插件
   */
  private async unloadPlugins(): Promise<void> {
    try {
      Logger.info('🧩 卸载插件...');
      await this.pluginLoader.unloadAllPlugins();
      Logger.info('✅ 插件卸载完成');
    } catch (error) {
      Logger.error('❌ 插件卸载失败:', error);
      // 不抛出错误，允许继续关闭流程
    }
  }

  /**
   * 检查启动错误
   */
  private checkStartupErrors(): void {
    if (this.startupErrors.length > 0) {
      Logger.warn(`⚠️ 启动过程中发生 ${this.startupErrors.length} 个错误`);
      
      // 如果关键组件加载失败，可能需要停止框架
      const criticalErrors = this.startupErrors.filter(error => 
        error.message.includes('HTTP核心适配器') || 
        error.message.includes('数据库')
      );

      if (criticalErrors.length > 0) {
        throw new Error(`关键组件启动失败: ${criticalErrors.map(e => e.message).join(', ')}`);
      }
    }
  }

  /**
   * 处理启动失败
   */
  private async handleStartupFailure(error: Error): Promise<void> {
    Logger.error('框架启动失败，开始清理资源...');

    try {
      // 尝试清理已启动的组件
      try {
        if (this.httpCoreAdapter && this.httpCoreAdapter.getRunningStatus()) {
          await this.stopHttpCoreAdapter();
        }
      } catch (error) {
        // 忽略获取实例失败的错误
      }

      if (this.databaseManager.isConnected()) {
        await this.disconnectDatabase();
      }

      await this.unloadPlugins();
      await this.unloadAdapters();

    } catch (cleanupError) {
      Logger.error('资源清理失败:', cleanupError);
    }

    this.eventBus.emit('framework-startup-failed', { error });
  }

  /**
   * 处理关键错误
   */
  private handleCriticalError(error: Error): void {
    Logger.error('发生关键错误，框架可能需要重启:', error);
    
    this.eventBus.emit('framework-critical-error', { error });

    // 可以在这里实现自动重启逻辑
    // 或者优雅关闭框架
  }

  /**
   * 处理组件错误
   */
  private handleComponentError(component: string, error: any): void {
    Logger.error(`组件 ${component} 发生错误:`, error);
    
    this.eventBus.emit('component-error', { component, error });

    // 可以在这里实现组件重启逻辑
  }

  /**
   * 获取框架状态
   */
  public getStatus(): {
    isRunning: boolean;
    startupErrors: number;
    components: {
      database: boolean;
      httpCore: boolean;
      adapters: number;
      plugins: number;
    };
  } {
    return {
      isRunning: this.isStarted,
      startupErrors: this.startupErrors.length,
      components: {
        database: this.databaseManager.isConnected(),
        httpCore: this.httpCoreAdapter?.getRunningStatus() || false,
        adapters: this.adapterLoader.getLoadedAdapters().size,
        plugins: this.pluginLoader.getLoadedPlugins().size
      }
    };
  }

  /**
   * 获取事件总线
   */
  public getEventBus(): FrameworkEventBus {
    return this.eventBus;
  }

  /**
   * 获取HTTP核心适配器
   */
  public getHttpCoreAdapter(): HttpCoreAdapter | undefined {
    return this.httpCoreAdapter;
  }

  /**
   * 获取适配器加载器
   */
  public getAdapterLoader(): AdapterLoader {
    return this.adapterLoader;
  }

  /**
   * 获取插件加载器
   */
  public getPluginLoader(): PluginLoader {
    return this.pluginLoader;
  }

  /**
   * 获取数据库管理器
   */
  public getDatabaseManager(): DatabaseManager {
    return this.databaseManager;
  }

  /**
   * 获取配置管理器
   */
  public getConfigManager(): ConfigManager {
    return this.configManager;
  }

  /**
   * 检查框架是否已启动
   */
  public isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * 重启框架
   */
  public async restart(): Promise<void> {
    Logger.info('🔄 重启框架...');
    
    if (this.isStarted) {
      await this.stop();
    }
    
    // 等待一段时间确保资源完全释放
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await this.start();
    
    Logger.info('✅ 框架重启完成');
  }
}