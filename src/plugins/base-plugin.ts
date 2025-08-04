import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';
import { HttpCoreAdapter, RouteHandler } from '../core/http-core-adapter';
import * as http from 'http';

export interface PluginConfig {
  [key: string]: any;
}

export interface PluginFunction {
  name: string;
  description: string;
  parameters: any[];
  handler: (...args: any[]) => Promise<any> | any;
}

export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  dependencies: string[];
  permissions: string[];
  config?: PluginConfig;
}

export interface RouteDefinition {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL';
  handler: (req: http.IncomingMessage, res: http.ServerResponse, params?: any) => Promise<void> | void;
  middleware?: Array<(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void>;
  description?: string;
}

export interface PluginLifecycleState {
  isLoaded: boolean;
  isInitialized: boolean;
  isStarted: boolean;
  isStopped: boolean;
  isUnloaded: boolean;
  lastError?: Error;
  loadTime?: number;
  startTime?: number;
}

/**
 * 插件基类 - 重构版本
 * 支持自管理生命周期和路由申请
 */
export abstract class BasePlugin {
  protected eventBus: FrameworkEventBus;
  protected httpCore: HttpCoreAdapter;
  protected config: PluginConfig = {};
  protected lifecycleState: PluginLifecycleState;
  protected allocatedPaths: string[] = [];
  protected registeredRoutes: RouteDefinition[] = [];
  protected healthCheckInterval?: NodeJS.Timeout;
  protected errorCount: number = 0;
  protected maxErrors: number = 10;

  // 插件元数据（子类必须实现）
  public abstract readonly metadata: PluginMetadata;

  constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
    this.httpCore = HttpCoreAdapter.getInstance();
    this.lifecycleState = {
      isLoaded: false,
      isInitialized: false,
      isStarted: false,
      isStopped: false,
      isUnloaded: false
    };

    // 延迟到下一个事件循环，确保子类的metadata已初始化
    process.nextTick(() => {
      this.setupErrorHandling();
    });
  }

  /**
   * 设置错误处理
   */
  private setupErrorHandling(): void {
    // 监听插件相关错误
    this.eventBus.on(`plugin-error-${this.metadata.name}`, (error: Error) => {
      this.handleError(error);
    });
  }

  /**
   * 插件生命周期：加载
   * 框架调用此方法来加载插件
   */
  public async load(): Promise<void> {
    if (this.lifecycleState.isLoaded) {
      Logger.warn(`插件 ${this.metadata.name} 已加载`);
      return;
    }

    try {
      const startTime = Date.now();
      Logger.info(`🔄 加载插件: ${this.metadata.name}`);

      // 检查依赖
      await this.checkDependencies();

      // 调用子类的加载逻辑
      await this.onLoad();

      // 初始化插件
      await this.initialize();

      this.lifecycleState.isLoaded = true;
      this.lifecycleState.loadTime = Date.now() - startTime;

      Logger.info(`✅ 插件加载成功: ${this.metadata.name} (${this.lifecycleState.loadTime}ms)`);

      this.eventBus.emit('plugin-loaded', {
        name: this.metadata.name,
        plugin: this,
        loadTime: this.lifecycleState.loadTime
      });

    } catch (error) {
      this.lifecycleState.lastError = error instanceof Error ? error : new Error(String(error));
      Logger.error(`❌ 插件加载失败: ${this.metadata.name}`, error);
      
      this.eventBus.emit('plugin-load-failed', {
        name: this.metadata.name,
        error: this.lifecycleState.lastError
      });

      throw error;
    }
  }

  /**
   * 插件生命周期：初始化
   */
  private async initialize(): Promise<void> {
    if (this.lifecycleState.isInitialized) {
      return;
    }

    try {
      Logger.debug(`初始化插件: ${this.metadata.name}`);

      // 申请路由路径
      await this.requestRoutes();

      // 注册路由
      await this.registerRoutes();

      // 调用子类的初始化逻辑
      await this.onInitialize();

      this.lifecycleState.isInitialized = true;

      Logger.debug(`插件初始化完成: ${this.metadata.name}`);

    } catch (error) {
      Logger.error(`插件初始化失败: ${this.metadata.name}`, error);
      throw error;
    }
  }

  /**
   * 插件生命周期：启动
   */
  public async start(): Promise<void> {
    if (!this.lifecycleState.isLoaded || !this.lifecycleState.isInitialized) {
      throw new Error(`插件 ${this.metadata.name} 未正确加载或初始化`);
    }

    if (this.lifecycleState.isStarted) {
      Logger.warn(`插件 ${this.metadata.name} 已启动`);
      return;
    }

    try {
      const startTime = Date.now();
      Logger.info(`🚀 启动插件: ${this.metadata.name}`);

      // 调用子类的启动逻辑
      await this.onStart();

      // 启动健康检查
      this.startHealthCheck();

      this.lifecycleState.isStarted = true;
      this.lifecycleState.startTime = Date.now() - startTime;

      Logger.info(`✅ 插件启动成功: ${this.metadata.name} (${this.lifecycleState.startTime}ms)`);

      this.eventBus.emit('plugin-started', {
        name: this.metadata.name,
        plugin: this,
        startTime: this.lifecycleState.startTime
      });

    } catch (error) {
      this.lifecycleState.lastError = error instanceof Error ? error : new Error(String(error));
      Logger.error(`❌ 插件启动失败: ${this.metadata.name}`, error);
      
      this.eventBus.emit('plugin-start-failed', {
        name: this.metadata.name,
        error: this.lifecycleState.lastError
      });

      throw error;
    }
  }

  /**
   * 插件生命周期：停止
   */
  public async stop(): Promise<void> {
    if (!this.lifecycleState.isStarted || this.lifecycleState.isStopped) {
      return;
    }

    try {
      Logger.info(`🛑 停止插件: ${this.metadata.name}`);

      // 停止健康检查
      this.stopHealthCheck();

      // 调用子类的停止逻辑
      await this.onStop();

      this.lifecycleState.isStopped = true;
      this.lifecycleState.isStarted = false;

      Logger.info(`✅ 插件停止成功: ${this.metadata.name}`);

      this.eventBus.emit('plugin-stopped', {
        name: this.metadata.name,
        plugin: this
      });

    } catch (error) {
      this.lifecycleState.lastError = error instanceof Error ? error : new Error(String(error));
      Logger.error(`❌ 插件停止失败: ${this.metadata.name}`, error);
      throw error;
    }
  }

  /**
   * 插件生命周期：卸载
   */
  public async unload(): Promise<void> {
    if (this.lifecycleState.isUnloaded) {
      return;
    }

    try {
      Logger.info(`🗑️ 卸载插件: ${this.metadata.name}`);

      // 如果插件正在运行，先停止
      if (this.lifecycleState.isStarted) {
        await this.stop();
      }

      // 释放路由
      await this.releaseRoutes();

      // 调用子类的卸载逻辑
      await this.onUnload();

      this.lifecycleState.isUnloaded = true;
      this.lifecycleState.isLoaded = false;
      this.lifecycleState.isInitialized = false;

      Logger.info(`✅ 插件卸载成功: ${this.metadata.name}`);

      this.eventBus.emit('plugin-unloaded', {
        name: this.metadata.name,
        plugin: this
      });

    } catch (error) {
      this.lifecycleState.lastError = error instanceof Error ? error : new Error(String(error));
      Logger.error(`❌ 插件卸载失败: ${this.metadata.name}`, error);
      throw error;
    }
  }

  /**
   * 申请路由路径
   */
  protected async requestRoutes(): Promise<void> {
    const routes = this.getRoutes();
    
    for (const route of routes) {
      try {
        const success = await this.httpCore.requestPath(route.path, this.metadata.name);
        
        if (success) {
          this.allocatedPaths.push(route.path);
          Logger.debug(`路由申请成功: ${route.path} -> ${this.metadata.name}`);
        } else {
          Logger.warn(`路由申请失败: ${route.path} (可能已被占用)`);
        }
      } catch (error) {
        Logger.error(`路由申请异常: ${route.path}`, error);
      }
    }
  }

  /**
   * 注册路由
   */
  protected async registerRoutes(): Promise<void> {
    const routes = this.getRoutes();
    
    for (const route of routes) {
      if (this.allocatedPaths.includes(route.path)) {
        try {
          const routeHandler: RouteHandler = {
            method: route.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD',
            handler: route.handler,
            middleware: route.middleware,
            metadata: {
              pluginName: this.metadata.name,
              description: route.description
            }
          };
          
          await this.httpCore.registerRoute(route.path, route.method, routeHandler);
          this.registeredRoutes.push(route);
          Logger.debug(`路由注册成功: ${route.method} ${route.path}`);
        } catch (error) {
          Logger.error(`路由注册失败: ${route.method} ${route.path}`, error);
        }
      } else {
        Logger.warn(`路径未分配，跳过路由注册: ${route.path}`);
      }
    }
  }

  /**
   * 释放路由
   */
  protected async releaseRoutes(): Promise<void> {
    // 取消路由注册
    for (const route of this.registeredRoutes) {
      try {
        const success = await this.httpCore.unregisterRoute(route.path, route.method);
        if (success) {
          Logger.debug(`路由取消注册: ${route.method} ${route.path}`);
        }
      } catch (error) {
        Logger.error(`路由取消注册失败: ${route.method} ${route.path}`, error);
      }
    }

    // 释放路径
    for (const path of this.allocatedPaths) {
      try {
        const success = await this.httpCore.releasePath(path, this.metadata.name);
        if (success) {
          Logger.debug(`路径释放: ${path}`);
        }
      } catch (error) {
        Logger.error(`路径释放失败: ${path}`, error);
      }
    }

    this.registeredRoutes = [];
    this.allocatedPaths = [];
  }

  /**
   * 检查依赖
   */
  protected async checkDependencies(): Promise<void> {
    if (!this.metadata.dependencies || this.metadata.dependencies.length === 0) {
      return;
    }

    // 这里可以检查其他插件是否已加载
    // 暂时简化处理
    Logger.debug(`检查插件依赖: ${this.metadata.dependencies.join(', ')}`);
  }

  /**
   * 启动健康检查
   */
  protected startHealthCheck(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        const isHealthy = await this.healthCheck();
        if (!isHealthy) {
          Logger.warn(`插件健康检查失败: ${this.metadata.name}`);
          this.eventBus.emit('plugin-unhealthy', {
            name: this.metadata.name,
            plugin: this
          });
        }
      } catch (error) {
        Logger.error(`插件健康检查异常: ${this.metadata.name}`, error);
        this.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }, 30000); // 30秒检查一次
  }

  /**
   * 停止健康检查
   */
  protected stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  /**
   * 处理错误
   */
  protected handleError(error: Error): void {
    this.errorCount++;
    this.lifecycleState.lastError = error;

    Logger.error(`插件错误 (${this.errorCount}/${this.maxErrors}): ${this.metadata.name}`, error);

    if (this.errorCount >= this.maxErrors) {
      Logger.error(`插件错误次数过多，停止插件: ${this.metadata.name}`);
      this.stop().catch(stopError => {
        Logger.error(`停止插件失败: ${this.metadata.name}`, stopError);
      });
    }

    this.eventBus.emit('plugin-error', {
      name: this.metadata.name,
      plugin: this,
      error,
      errorCount: this.errorCount
    });
  }

  /**
   * 设置配置
   */
  public setConfig(config: PluginConfig): void {
    this.config = { ...this.config, ...config };
    Logger.debug(`插件配置已更新: ${this.metadata.name}`);
  }

  /**
   * 获取配置
   */
  public getConfig(path?: string): PluginConfig | any {
    if (path) {
      // 如果提供了路径，返回配置中的特定值
      const keys = path.split('.');
      let value: any = this.config;
      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          return undefined;
        }
      }
      return value;
    }
    return { ...this.config };
  }

  /**
   * 获取生命周期状态
   */
  public getLifecycleState(): PluginLifecycleState {
    return { ...this.lifecycleState };
  }

  /**
   * 获取已分配的路径
   */
  public getAllocatedPaths(): string[] {
    return [...this.allocatedPaths];
  }

  /**
   * 获取已注册的路由
   */
  public getRegisteredRoutes(): RouteDefinition[] {
    return [...this.registeredRoutes];
  }

  /**
   * 健康检查方法
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // 基本健康检查逻辑
      return this.lifecycleState.isStarted && !this.lifecycleState.isStopped;
    } catch (error) {
      Logger.error(`插件健康检查失败: ${this.metadata.name}`, error);
      return false;
    }
  }

  /**
   * 重置错误计数
   */
  public resetErrorCount(): void {
    this.errorCount = 0;
    Logger.debug(`插件错误计数已重置: ${this.metadata.name}`);
  }

  // 以下方法由子类实现

  /**
   * 插件加载时调用（子类实现）
   */
  protected abstract onLoad(): Promise<void>;

  /**
   * 插件初始化时调用（子类实现）
   */
  protected abstract onInitialize(): Promise<void>;

  /**
   * 插件启动时调用（子类实现）
   */
  protected abstract onStart(): Promise<void>;

  /**
   * 插件停止时调用（子类实现）
   */
  protected abstract onStop(): Promise<void>;

  /**
   * 插件卸载时调用（子类实现）
   */
  protected abstract onUnload(): Promise<void>;

  /**
   * 获取插件路由定义（子类实现）
   */
  protected abstract getRoutes(): RouteDefinition[];

  /**
   * 获取插件功能列表（子类可重写）
   */
  public getFunctions(): PluginFunction[] {
    return [];
  }

  /**
   * 获取插件统计信息（子类可重写）
   */
  public getStats(): { [key: string]: any } {
    return {
      errorCount: this.errorCount,
      allocatedPaths: this.allocatedPaths.length,
      registeredRoutes: this.registeredRoutes.length,
      uptime: this.lifecycleState.startTime ? Date.now() - this.lifecycleState.startTime : 0
    };
  }

  // 便利属性
  public get name(): string {
    return this.metadata.name;
  }

  public get version(): string {
    return this.metadata.version;
  }

  public get description(): string {
    return this.metadata.description;
  }

  public get author(): string {
    return this.metadata.author;
  }

  public get isLoaded(): boolean {
    return this.lifecycleState.isLoaded;
  }

  public get isRunning(): boolean {
    return this.lifecycleState.isStarted && !this.lifecycleState.isStopped;
  }
}