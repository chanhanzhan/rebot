import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';
import { HttpCoreAdapter } from '../core/http-core-adapter';

export interface AdapterConfig {
  [key: string]: any;
}

export interface AdapterMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  type: 'input' | 'output' | 'bidirectional';
  protocol: string;
  dependencies: string[];
  priority: number;
  config?: AdapterConfig;
}

export interface AdapterLifecycleState {
  isLoaded: boolean;
  isInitialized: boolean;
  isConnected: boolean;
  isDisconnected: boolean;
  isUnloaded: boolean;
  lastError?: Error;
  loadTime?: number;
  connectTime?: number;
  messageCount: number;
  errorCount: number;
}

export interface AdapterStats {
  messagesSent: number;
  messagesReceived: number;
  errorsCount: number;
  uptime: number;
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastActivity: Date;
}

export interface MessageContext {
  id: string;
  timestamp: Date;
  source: string;
  target?: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'file' | 'command' | 'event';
  content: any;
  metadata?: { [key: string]: any };
}

/**
 * 适配器基类 - 重构版本
 * 支持规范化异步加载和生命周期管理
 */
export abstract class BaseAdapter {
  protected eventBus: FrameworkEventBus;
  protected httpCore: HttpCoreAdapter;
  protected config: AdapterConfig = {};
  protected lifecycleState: AdapterLifecycleState;
  protected stats: AdapterStats;
  protected healthCheckInterval?: NodeJS.Timeout;
  protected reconnectInterval?: NodeJS.Timeout;
  protected maxErrors: number = 20;
  protected reconnectAttempts: number = 0;
  protected maxReconnectAttempts: number = 5;
  protected reconnectDelay: number = 5000;

  // 适配器元数据（子类必须实现）
  public abstract readonly metadata: AdapterMetadata;

  constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
    this.httpCore = HttpCoreAdapter.getInstance();
    
    this.lifecycleState = {
      isLoaded: false,
      isInitialized: false,
      isConnected: false,
      isDisconnected: false,
      isUnloaded: false,
      messageCount: 0,
      errorCount: 0
    };

    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      errorsCount: 0,
      uptime: 0,
      connectionStatus: 'disconnected',
      lastActivity: new Date()
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
    // 监听适配器相关错误
    this.eventBus.on(`adapter-error-${this.metadata.name}`, (error: Error) => {
      this.handleError(error);
    });

    // 监听重连请求
    this.eventBus.on(`adapter-reconnect-${this.metadata.name}`, () => {
      this.reconnect().catch(error => {
        Logger.error(`适配器重连失败: ${this.metadata.name}`, error);
      });
    });
  }

  /**
   * 适配器生命周期：加载
   */
  public async load(): Promise<void> {
    if (this.lifecycleState.isLoaded) {
      Logger.warn(`适配器 ${this.metadata.name} 已加载`);
      return;
    }

    try {
      const startTime = Date.now();
      Logger.info(`🔄 加载适配器: ${this.metadata.name}`);

      // 检查依赖
      await this.checkDependencies();

      // 调用子类的加载逻辑
      await this.onLoad();

      // 初始化适配器
      await this.initialize();

      this.lifecycleState.isLoaded = true;
      this.lifecycleState.loadTime = Date.now() - startTime;

      Logger.info(`✅ 适配器加载成功: ${this.metadata.name} (${this.lifecycleState.loadTime}ms)`);

      this.eventBus.emit('adapter-loaded', {
        name: this.metadata.name,
        adapter: this,
        loadTime: this.lifecycleState.loadTime
      });

    } catch (error) {
      this.lifecycleState.lastError = error instanceof Error ? error : new Error(String(error));
      Logger.error(`❌ 适配器加载失败: ${this.metadata.name}`, error);
      
      this.eventBus.emit('adapter-load-failed', {
        name: this.metadata.name,
        error: this.lifecycleState.lastError
      });

      throw error;
    }
  }

  /**
   * 适配器生命周期：初始化
   */
  private async initialize(): Promise<void> {
    if (this.lifecycleState.isInitialized) {
      return;
    }

    try {
      Logger.debug(`初始化适配器: ${this.metadata.name}`);

      // 调用子类的初始化逻辑
      await this.onInitialize();

      this.lifecycleState.isInitialized = true;

      Logger.debug(`适配器初始化完成: ${this.metadata.name}`);

    } catch (error) {
      Logger.error(`适配器初始化失败: ${this.metadata.name}`, error);
      throw error;
    }
  }

  /**
   * 适配器生命周期：连接
   */
  public async connect(): Promise<void> {
    if (!this.lifecycleState.isLoaded || !this.lifecycleState.isInitialized) {
      throw new Error(`适配器 ${this.metadata.name} 未正确加载或初始化`);
    }

    if (this.lifecycleState.isConnected) {
      Logger.warn(`适配器 ${this.metadata.name} 已连接`);
      return;
    }

    try {
      const startTime = Date.now();
      Logger.info(`🔗 连接适配器: ${this.metadata.name}`);

      this.stats.connectionStatus = 'connecting';

      // 调用子类的连接逻辑
      await this.onConnect();

      // 启动健康检查
      this.startHealthCheck();

      this.lifecycleState.isConnected = true;
      this.lifecycleState.isDisconnected = false;
      this.lifecycleState.connectTime = Date.now() - startTime;
      this.stats.connectionStatus = 'connected';
      this.reconnectAttempts = 0;

      Logger.info(`✅ 适配器连接成功: ${this.metadata.name} (${this.lifecycleState.connectTime}ms)`);

      this.eventBus.emit('adapter-connected', {
        name: this.metadata.name,
        adapter: this,
        connectTime: this.lifecycleState.connectTime
      });

    } catch (error) {
      this.lifecycleState.lastError = error instanceof Error ? error : new Error(String(error));
      this.stats.connectionStatus = 'error';
      
      Logger.error(`❌ 适配器连接失败: ${this.metadata.name}`, error);
      
      this.eventBus.emit('adapter-connect-failed', {
        name: this.metadata.name,
        error: this.lifecycleState.lastError
      });

      // 尝试重连
      this.scheduleReconnect();

      throw error;
    }
  }

  /**
   * 适配器生命周期：断开连接
   */
  public async disconnect(): Promise<void> {
    if (!this.lifecycleState.isConnected || this.lifecycleState.isDisconnected) {
      return;
    }

    try {
      Logger.info(`🔌 断开适配器连接: ${this.metadata.name}`);

      // 停止健康检查
      this.stopHealthCheck();

      // 停止重连
      this.stopReconnect();

      // 调用子类的断开连接逻辑
      await this.onDisconnect();

      this.lifecycleState.isDisconnected = true;
      this.lifecycleState.isConnected = false;
      this.stats.connectionStatus = 'disconnected';

      Logger.info(`✅ 适配器断开连接成功: ${this.metadata.name}`);

      this.eventBus.emit('adapter-disconnected', {
        name: this.metadata.name,
        adapter: this
      });

    } catch (error) {
      this.lifecycleState.lastError = error instanceof Error ? error : new Error(String(error));
      Logger.error(`❌ 适配器断开连接失败: ${this.metadata.name}`, error);
      throw error;
    }
  }

  /**
   * 适配器生命周期：卸载
   */
  public async unload(): Promise<void> {
    if (this.lifecycleState.isUnloaded) {
      return;
    }

    try {
      Logger.info(`🗑️ 卸载适配器: ${this.metadata.name}`);

      // 如果适配器已连接，先断开连接
      if (this.lifecycleState.isConnected) {
        await this.disconnect();
      }

      // 调用子类的卸载逻辑
      await this.onUnload();

      this.lifecycleState.isUnloaded = true;
      this.lifecycleState.isLoaded = false;
      this.lifecycleState.isInitialized = false;

      Logger.info(`✅ 适配器卸载成功: ${this.metadata.name}`);

      this.eventBus.emit('adapter-unloaded', {
        name: this.metadata.name,
        adapter: this
      });

    } catch (error) {
      this.lifecycleState.lastError = error instanceof Error ? error : new Error(String(error));
      Logger.error(`❌ 适配器卸载失败: ${this.metadata.name}`, error);
      throw error;
    }
  }

  /**
   * 重连适配器
   */
  public async reconnect(): Promise<void> {
    Logger.info(`🔄 重连适配器: ${this.metadata.name}`);

    try {
      if (this.lifecycleState.isConnected) {
        await this.disconnect();
      }

      // 等待一段时间再重连
      await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));

      await this.connect();

      Logger.info(`✅ 适配器重连成功: ${this.metadata.name}`);

    } catch (error) {
      Logger.error(`❌ 适配器重连失败: ${this.metadata.name}`, error);
      throw error;
    }
  }

  /**
   * 安排重连
   */
  protected scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      Logger.error(`适配器重连次数已达上限: ${this.metadata.name}`);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // 指数退避

    Logger.info(`安排适配器重连: ${this.metadata.name} (第${this.reconnectAttempts}次，${delay}ms后)`);

    this.reconnectInterval = setTimeout(async () => {
      try {
        await this.reconnect();
      } catch (error) {
        Logger.error(`适配器重连失败: ${this.metadata.name}`, error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * 停止重连
   */
  protected stopReconnect(): void {
    if (this.reconnectInterval) {
      clearTimeout(this.reconnectInterval);
      this.reconnectInterval = undefined;
    }
  }

  /**
   * 检查依赖
   */
  protected async checkDependencies(): Promise<void> {
    if (!this.metadata.dependencies || this.metadata.dependencies.length === 0) {
      return;
    }

    // 这里可以检查其他适配器是否已加载
    // 暂时简化处理
    Logger.debug(`检查适配器依赖: ${this.metadata.dependencies.join(', ')}`);
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
          Logger.warn(`适配器健康检查失败: ${this.metadata.name}`);
          this.eventBus.emit('adapter-unhealthy', {
            name: this.metadata.name,
            adapter: this
          });

          // 尝试重连
          this.scheduleReconnect();
        }
      } catch (error) {
        Logger.error(`适配器健康检查异常: ${this.metadata.name}`, error);
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
    this.lifecycleState.errorCount++;
    this.stats.errorsCount++;
    this.lifecycleState.lastError = error;

    Logger.error(`适配器错误 (${this.lifecycleState.errorCount}/${this.maxErrors}): ${this.metadata.name}`, error);

    if (this.lifecycleState.errorCount >= this.maxErrors) {
      Logger.error(`适配器错误次数过多，断开连接: ${this.metadata.name}`);
      this.disconnect().catch(disconnectError => {
        Logger.error(`断开适配器连接失败: ${this.metadata.name}`, disconnectError);
      });
    }

    this.eventBus.emit('adapter-error', {
      name: this.metadata.name,
      adapter: this,
      error,
      errorCount: this.lifecycleState.errorCount
    });
  }

  /**
   * 发送消息
   */
  public async sendMessage(context: MessageContext): Promise<void> {
    if (!this.lifecycleState.isConnected) {
      throw new Error(`适配器 ${this.metadata.name} 未连接`);
    }

    try {
      await this.onSendMessage(context);
      
      this.stats.messagesSent++;
      this.stats.lastActivity = new Date();
      this.lifecycleState.messageCount++;

      this.eventBus.emit('message-sent', {
        adapter: this.metadata.name,
        context
      });

    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * 接收消息（由子类调用）
   */
  protected async receiveMessage(context: MessageContext): Promise<void> {
    try {
      this.stats.messagesReceived++;
      this.stats.lastActivity = new Date();
      this.lifecycleState.messageCount++;

      this.eventBus.emit('message-received', {
        adapter: this.metadata.name,
        context
      });

      // 调用子类的消息处理逻辑
      await this.onReceiveMessage(context);

    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 设置配置
   */
  public setConfig(config: AdapterConfig): void {
    this.config = { ...this.config, ...config };
    Logger.debug(`适配器配置已更新: ${this.metadata.name}`);
  }

  /**
   * 获取配置
   */
  public getConfig(): AdapterConfig {
    return { ...this.config };
  }

  /**
   * 获取生命周期状态
   */
  public getLifecycleState(): AdapterLifecycleState {
    return { ...this.lifecycleState };
  }

  /**
   * 获取统计信息
   */
  public getStats(): AdapterStats {
    return {
      ...this.stats,
      uptime: this.lifecycleState.connectTime ? Date.now() - this.lifecycleState.connectTime : 0
    };
  }

  /**
   * 重置错误计数
   */
  public resetErrorCount(): void {
    this.lifecycleState.errorCount = 0;
    Logger.info(`适配器错误计数已重置: ${this.metadata.name}`);
  }

  /**
   * 重置统计信息
   */
  public resetStats(): void {
    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      errorsCount: 0,
      uptime: 0,
      connectionStatus: this.stats.connectionStatus,
      lastActivity: new Date()
    };
    Logger.info(`适配器统计信息已重置: ${this.metadata.name}`);
  }

  // 以下方法由子类实现

  /**
   * 适配器加载时调用（子类实现）
   */
  protected abstract onLoad(): Promise<void>;

  /**
   * 适配器初始化时调用（子类实现）
   */
  protected abstract onInitialize(): Promise<void>;

  /**
   * 适配器连接时调用（子类实现）
   */
  protected abstract onConnect(): Promise<void>;

  /**
   * 适配器断开连接时调用（子类实现）
   */
  protected abstract onDisconnect(): Promise<void>;

  /**
   * 适配器卸载时调用（子类实现）
   */
  protected abstract onUnload(): Promise<void>;

  /**
   * 发送消息时调用（子类实现）
   */
  protected abstract onSendMessage(context: MessageContext): Promise<void>;

  /**
   * 接收消息时调用（子类可重写）
   */
  protected async onReceiveMessage(context: MessageContext): Promise<void> {
    // 默认实现：转发到事件总线
    this.eventBus.emit('adapter-message', {
      adapter: this.metadata.name,
      context
    });
  }

  /**
   * 健康检查（子类可重写）
   */
  public async healthCheck(): Promise<boolean> {
    return this.lifecycleState.isConnected && !this.lifecycleState.isDisconnected;
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

  public get type(): string {
    return this.metadata.type;
  }

  public get protocol(): string {
    return this.metadata.protocol;
  }

  public get isLoaded(): boolean {
    return this.lifecycleState.isLoaded;
  }

  public isConnected(): boolean {
    return this.lifecycleState.isConnected;
  }

  public get isRunning(): boolean {
    return this.lifecycleState.isConnected && !this.lifecycleState.isDisconnected;
  }
}