import { Adapter, Message } from '../common/types';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';
import { ConfigManager } from '../config/config';

export interface AdapterStats {
  name: string;
  connected: boolean;
  messagesSent: number;
  messagesReceived: number;
  errors: number;
  lastActivity: number;
  uptime: number;
  connectedAt?: number;
  // 新增性能指标
  averageLatency: number;
  peakLatency: number;
  minLatency: number;
  throughput: number; // 每秒消息数
  successRate: number;
  lastErrorTime?: number;
  consecutiveErrors: number;
  totalConnections: number;
  connectionFailures: number;
  bytesTransferred: number;
  messagesPerMinute: number[];
  hourlyStats: { [hour: string]: { sent: number; received: number; errors: number } };
}

export interface AdapterHealth {
  name: string;
  status: 'healthy' | 'warning' | 'error' | 'disconnected' | 'maintenance';
  latency?: number;
  lastError?: string;
  errorCount: number;
  uptime: number;
  // 新增健康指标
  memoryUsage?: number;
  cpuUsage?: number;
  connectionCount?: number;
  queueSize?: number;
  lastHealthCheck: number;
  healthScore: number; // 0-100
  issues: string[];
}

export interface MessageQueue {
  id: string;
  adapterName: string;
  target: string;
  content: string;
  priority: number;
  retries: number;
  maxRetries: number;
  createdAt: number;
  scheduledAt?: number;
  // 新增字段
  size?: number;
  type: 'text' | 'image' | 'file' | 'audio' | 'video' | 'other';
  metadata?: any;
  callback?: (success: boolean, error?: Error) => void;
}

// 负载均衡策略
export type LoadBalanceStrategy = 'round-robin' | 'least-connections' | 'least-latency' | 'weighted' | 'random';

// 负载均衡配置
export interface LoadBalanceConfig {
  strategy: LoadBalanceStrategy;
  weights?: { [adapterName: string]: number };
  healthCheckInterval: number;
  failoverEnabled: boolean;
  maxFailures: number;
  circuitBreakerTimeout: number;
}

// 适配器组
export interface AdapterGroup {
  name: string;
  adapters: string[];
  loadBalanceConfig: LoadBalanceConfig;
  primary?: string;
  backup?: string[];
  enabled: boolean;
}

// 连接池配置
export interface ConnectionPoolConfig {
  maxConnections: number;
  minConnections: number;
  acquireTimeout: number;
  idleTimeout: number;
  maxRetries: number;
  retryDelay: number;
}

// 连接池状态
export interface ConnectionPoolStats {
  total: number;
  active: number;
  idle: number;
  pending: number;
  created: number;
  destroyed: number;
  borrowed: number;
  returned: number;
}

// 故障转移状态
export interface FailoverState {
  adapterName: string;
  failureCount: number;
  lastFailureTime: number;
  circuitBreakerOpen: boolean;
  circuitBreakerOpenTime?: number;
  backupAdapter?: string;
  isInMaintenance: boolean;
}

// 性能监控配置
export interface PerformanceMonitorConfig {
  enabled: boolean;
  sampleRate: number;
  alertThresholds: {
    latency: number;
    errorRate: number;
    throughput: number;
    memoryUsage: number;
  };
  retentionPeriod: number; // 数据保留天数
}

// 性能指标
export interface PerformanceMetrics {
  timestamp: number;
  adapterName: string;
  latency: number;
  throughput: number;
  errorRate: number;
  memoryUsage: number;
  cpuUsage: number;
  connectionCount: number;
  queueSize: number;
}

export class AdapterManager {
  private static instance: AdapterManager;
  private adapters: Map<string, Adapter> = new Map();
  private adapterStats: Map<string, AdapterStats> = new Map();
  private eventBus: FrameworkEventBus;
  private configManager: ConfigManager;
  private messageQueue: MessageQueue[] = [];
  private isProcessingQueue = false;
  private reconnectAttempts: Map<string, number> = new Map();
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private queueProcessInterval: NodeJS.Timeout | null = null;
  
  // 新增属性
  private adapterGroups: Map<string, AdapterGroup> = new Map();
  private failoverStates: Map<string, FailoverState> = new Map();
  private connectionPools: Map<string, ConnectionPoolStats> = new Map();
  private performanceMetrics: Map<string, PerformanceMetrics[]> = new Map();
  private loadBalanceCounters: Map<string, number> = new Map();
  
  private performanceConfig: PerformanceMonitorConfig = {
    enabled: true,
    sampleRate: 1.0,
    alertThresholds: {
      latency: 5000,
      errorRate: 0.1,
      throughput: 100,
      memoryUsage: 0.8
    },
    retentionPeriod: 7
  };
  
  private performanceMonitorInterval: NodeJS.Timeout | null = null;
  private metricsCleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
    this.configManager = ConfigManager.getInstance();
    this.setupEventListeners();
    this.startHealthCheck();
    this.startQueueProcessor();
    this.startPerformanceMonitor();
    this.startMetricsCleanup();
  }

  private setupEventListeners(): void {
    // 监听发送消息事件
    this.eventBus.on('send_message', this.handleSendMessage.bind(this));
    this.eventBus.on('adapter_error', this.handleAdapterError.bind(this));
    this.eventBus.on('adapter_reconnect', this.handleAdapterReconnect.bind(this));
    
    // 新增事件监听
    this.eventBus.on('adapter_maintenance', this.handleAdapterMaintenance.bind(this));
    this.eventBus.on('load_balance_config_update', this.handleLoadBalanceConfigUpdate.bind(this));
    this.eventBus.on('performance_alert', this.handlePerformanceAlert.bind(this));
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
      
      // 初始化统计信息
      this.initializeAdapterStats(adapter.name);
      
      // 初始化故障转移状态
      this.initializeFailoverState(adapter.name);
      
      // 初始化连接池
      this.initializeConnectionPool(adapter.name);
      
      // 如果是HTTP适配器，设置OneBot适配器的适配器管理器引用
      if (adapter.name === 'http' && typeof (adapter as any).onebotAdapter !== 'undefined') {
        const httpAdapter = adapter as any;
        if (httpAdapter.onebotAdapter && typeof httpAdapter.onebotAdapter.setAdapterManager === 'function') {
          httpAdapter.onebotAdapter.setAdapterManager(this);
          Logger.info('✅ OneBot适配器已设置适配器管理器引用');
        }
      }
      
      // 设置消息监听
      adapter.onMessage((message: Message) => {
        this.handleMessage(message);
        this.updateStats(adapter.name, 'messageReceived');
        this.recordPerformanceMetric(adapter.name, 'messageReceived');
      });
      
      // 设置错误监听
      if (typeof (adapter as any).onError === 'function') {
        (adapter as any).onError((error: Error) => {
          this.handleAdapterError({ adapterName: adapter.name, error });
        });
      }
      
      // 设置断线监听
      if (typeof (adapter as any).onDisconnect === 'function') {
        (adapter as any).onDisconnect(() => {
          this.handleAdapterDisconnect(adapter.name);
        });
      }
      
      // 连接适配器
      await adapter.connect();
      
      // 注册适配器
      this.adapters.set(adapter.name, adapter);
      
      // 更新连接状态
      const stats = this.adapterStats.get(adapter.name)!;
      stats.connected = true;
      stats.connectedAt = Date.now();
      stats.totalConnections++;
      
      // 重置重连计数
      this.reconnectAttempts.delete(adapter.name);
      
      Logger.info(`适配器注册成功: ${adapter.name}`);
      this.eventBus.safeEmit('adapter_registered', { name: adapter.name, adapter });
      
    } catch (error) {
      const stats = this.adapterStats.get(adapter.name);
      if (stats) {
        stats.connectionFailures++;
      }
      this.updateStats(adapter.name, 'error');
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
      this.adapterStats.delete(adapterName);
      this.reconnectAttempts.delete(adapterName);
      
      // 清理该适配器的消息队列
      this.messageQueue = this.messageQueue.filter(msg => msg.adapterName !== adapterName);
      
      Logger.info(`适配器注销成功: ${adapterName}`);
      this.eventBus.safeEmit('adapter_unregistered', { name: adapterName });
      
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

  public getAdapterNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  public async sendMessage(adapterName: string, target: string, content: string, options?: {
    priority?: number;
    delay?: number;
    maxRetries?: number;
  }): Promise<void> {
    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      throw new Error(`Adapter not found: ${adapterName}`);
    }

    if (!adapter.isConnected()) {
      // 如果适配器未连接，加入队列
      this.queueMessage(adapterName, target, content, options);
      Logger.warn(`适配器 ${adapterName} 未连接，消息已加入队列`);
      return;
    }

    try {
      if (options?.delay) {
        // 延迟发送
        setTimeout(async () => {
          await this.doSendMessage(adapter, target, content);
          this.updateStats(adapterName, 'messageSent');
        }, options.delay);
      } else {
        await this.doSendMessage(adapter, target, content);
        this.updateStats(adapterName, 'messageSent');
      }
    } catch (error) {
      this.updateStats(adapterName, 'error');
      
      // 如果发送失败且设置了重试，加入队列
      if (options?.maxRetries && options.maxRetries > 0) {
        this.queueMessage(adapterName, target, content, options);
      } else {
        throw error;
      }
    }
  }

  public async sendMessageBatch(messages: Array<{
    adapterName: string;
    target: string;
    content: string;
    options?: any;
  }>): Promise<void> {
    const promises = messages.map(msg => 
      this.sendMessage(msg.adapterName, msg.target, msg.content, msg.options)
        .catch(error => {
          Logger.error(`批量发送消息失败 (${msg.adapterName}:${msg.target}):`, error);
          return error;
        })
    );
    
    await Promise.allSettled(promises);
  }

  public getOnlineStatus(adapterName: string): boolean {
    const adapter = this.adapters.get(adapterName);
    return adapter ? adapter.isConnected() : false;
  }

  public getSessionList(adapterName: string): string[] {
    const adapter = this.adapters.get(adapterName);
    if (adapter && typeof (adapter as any).getSessionList === 'function') {
      return (adapter as any).getSessionList();
    }
    return [];
  }

  public async sendFile(adapterName: string, target: string, filePath: string, options?: any): Promise<void> {
    const adapter = this.adapters.get(adapterName);
    if (adapter && typeof (adapter as any).sendFile === 'function') {
      try {
        await (adapter as any).sendFile(target, filePath, options);
        this.updateStats(adapterName, 'messageSent');
      } catch (error) {
        this.updateStats(adapterName, 'error');
        throw error;
      }
    } else {
      throw new Error('sendFile not supported by adapter: ' + adapterName);
    }
  }

  public async getUserInfo(adapterName: string, userId: string): Promise<any> {
    const adapter = this.adapters.get(adapterName);
    if (adapter && typeof (adapter as any).getUserInfo === 'function') {
      try {
        return await (adapter as any).getUserInfo(userId);
      } catch (error) {
        this.updateStats(adapterName, 'error');
        throw error;
      }
    }
    return null;
  }

  public async broadcastMessage(content: string, excludeAdapters?: string[]): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const [name, adapter] of this.adapters) {
      if (excludeAdapters?.includes(name)) continue;
      
      if (adapter.isConnected() && typeof (adapter as any).broadcastMessage === 'function') {
        promises.push(
          (adapter as any).broadcastMessage(content).catch((error: Error) => {
            Logger.error(`广播消息失败 (${name}):`, error);
            this.updateStats(name, 'error');
          })
        );
      }
    }
    
    await Promise.allSettled(promises);
  }

  public async deleteMessage(adapterName: string, chatId: string, messageId: number): Promise<void> {
    const adapter = this.adapters.get(adapterName);
    if (adapter && typeof (adapter as any).deleteMessage === 'function') {
      try {
        await (adapter as any).deleteMessage(chatId, messageId);
      } catch (error) {
        this.updateStats(adapterName, 'error');
        throw error;
      }
    } else {
      throw new Error('deleteMessage not supported by adapter: ' + adapterName);
    }
  }

  public async editMessage(adapterName: string, chatId: string, messageId: number, text: string, options?: any): Promise<void> {
    const adapter = this.adapters.get(adapterName);
    if (adapter && typeof (adapter as any).editMessage === 'function') {
      try {
        await (adapter as any).editMessage(chatId, messageId, text, options);
      } catch (error) {
        this.updateStats(adapterName, 'error');
        throw error;
      }
    } else {
      throw new Error('editMessage not supported by adapter: ' + adapterName);
    }
  }

  public async revokeMessage(adapterName: string, chatId: string, messageId: number): Promise<void> {
    await this.deleteMessage(adapterName, chatId, messageId);
  }

  // 获取适配器统计信息
  public getAdapterStats(adapterName?: string): AdapterStats | AdapterStats[] {
    if (adapterName) {
      const stats = this.adapterStats.get(adapterName);
      if (!stats) throw new Error(`Adapter not found: ${adapterName}`);
      
      // 计算运行时间
      if (stats.connectedAt) {
        stats.uptime = Date.now() - stats.connectedAt;
      }
      
      return { ...stats };
    }
    
    return Array.from(this.adapterStats.values()).map(stats => {
      if (stats.connectedAt) {
        stats.uptime = Date.now() - stats.connectedAt;
      }
      return { ...stats };
    });
  }

  // 获取适配器健康状态
  public async getAdapterHealth(adapterName?: string): Promise<AdapterHealth | AdapterHealth[]> {
    const checkHealth = async (name: string, adapter: Adapter): Promise<AdapterHealth> => {
      const stats = this.adapterStats.get(name)!;
      let status: 'healthy' | 'warning' | 'error' | 'disconnected' = 'healthy';
      let latency: number | undefined;
      
      if (!adapter.isConnected()) {
        status = 'disconnected';
      } else {
        try {
          // 尝试ping适配器
          const startTime = Date.now();
          if (typeof (adapter as any).ping === 'function') {
            await (adapter as any).ping();
            latency = Date.now() - startTime;
            
            if (latency > 5000) status = 'warning';
            if (latency > 10000) status = 'error';
          }
          
          // 检查错误率
          const totalMessages = stats.messagesSent + stats.messagesReceived;
          if (totalMessages > 0 && stats.errors / totalMessages > 0.1) {
            status = 'warning';
          }
          if (totalMessages > 0 && stats.errors / totalMessages > 0.3) {
            status = 'error';
          }
        } catch (error) {
          status = 'error';
        }
      }
      
      return {
        name,
        status,
        latency,
        errorCount: stats.errors,
        uptime: stats.connectedAt ? Date.now() - stats.connectedAt : 0,
        lastHealthCheck: Date.now(),
        healthScore: this.calculateHealthScore(name),
        issues: this.getHealthIssues(name)
      };
    };
    
    if (adapterName) {
      const adapter = this.adapters.get(adapterName);
      if (!adapter) throw new Error(`Adapter not found: ${adapterName}`);
      return await checkHealth(adapterName, adapter);
    }
    
    const healthChecks = Array.from(this.adapters.entries()).map(([name, adapter]) =>
      checkHealth(name, adapter)
    );
    
    return await Promise.all(healthChecks);
  }

  // 重置适配器统计
  public resetAdapterStats(adapterName?: string): void {
    if (adapterName) {
      const stats = this.adapterStats.get(adapterName);
      if (stats) {
        stats.messagesSent = 0;
        stats.messagesReceived = 0;
        stats.errors = 0;
        stats.lastActivity = Date.now();
      }
    } else {
      for (const stats of this.adapterStats.values()) {
        stats.messagesSent = 0;
        stats.messagesReceived = 0;
        stats.errors = 0;
        stats.lastActivity = Date.now();
      }
    }
    
    Logger.info(`适配器统计已重置${adapterName ? ` (${adapterName})` : ''}`);
  }

  // 获取消息队列状态
  public getQueueStatus(): {
    totalMessages: number;
    messagesByAdapter: Record<string, number>;
    oldestMessage?: MessageQueue;
  } {
    const messagesByAdapter: Record<string, number> = {};
    
    for (const msg of this.messageQueue) {
      messagesByAdapter[msg.adapterName] = (messagesByAdapter[msg.adapterName] || 0) + 1;
    }
    
    const oldestMessage = this.messageQueue.length > 0 
      ? this.messageQueue.reduce((oldest, current) => 
          current.createdAt < oldest.createdAt ? current : oldest
        )
      : undefined;
    
    return {
      totalMessages: this.messageQueue.length,
      messagesByAdapter,
      oldestMessage
    };
  }

  // 清空消息队列
  public clearQueue(adapterName?: string): void {
    if (adapterName) {
      this.messageQueue = this.messageQueue.filter(msg => msg.adapterName !== adapterName);
      Logger.info(`已清空适配器 ${adapterName} 的消息队列`);
    } else {
      this.messageQueue = [];
      Logger.info('已清空所有消息队列');
    }
  }

  // 重连适配器
  public async reconnectAdapter(adapterName: string): Promise<void> {
    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      throw new Error(`Adapter not found: ${adapterName}`);
    }
    
    Logger.info(`正在重连适配器: ${adapterName}`);
    
    try {
      await adapter.disconnect();
      await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒
      await adapter.connect();
      
      const stats = this.adapterStats.get(adapterName)!;
      stats.connected = true;
      stats.connectedAt = Date.now();
      
      this.reconnectAttempts.delete(adapterName);
      Logger.info(`适配器重连成功: ${adapterName}`);
      
    } catch (error) {
      this.updateStats(adapterName, 'error');
      Logger.error(`适配器重连失败 ${adapterName}:`, error);
      throw error;
    }
  }

  // 重连所有断线的适配器
  public async reconnectAllDisconnected(): Promise<void> {
    const disconnectedAdapters = Array.from(this.adapters.entries())
      .filter(([_, adapter]) => !adapter.isConnected())
      .map(([name, _]) => name);
    
    if (disconnectedAdapters.length === 0) {
      Logger.info('所有适配器都已连接');
      return;
    }
    
    Logger.info(`正在重连 ${disconnectedAdapters.length} 个断线的适配器`);
    
    const promises = disconnectedAdapters.map(name =>
      this.reconnectAdapter(name).catch(error => {
        Logger.error(`重连适配器 ${name} 失败:`, error);
        return error;
      })
    );
    
    await Promise.allSettled(promises);
  }

  private async doSendMessage(adapter: Adapter, target: string, content: string): Promise<void> {
    await adapter.sendMessage(target, content);
  }

  private queueMessage(adapterName: string, target: string, content: string, options?: {
    priority?: number;
    maxRetries?: number;
  }): void {
    const message: MessageQueue = {
      id: this.generateMessageId(),
      adapterName,
      target,
      content,
      priority: options?.priority || 0,
      retries: 0,
      maxRetries: options?.maxRetries || 3,
      createdAt: Date.now(),
      type: 'text',
      size: content.length
    };
    
    this.messageQueue.push(message);
    this.messageQueue.sort((a, b) => b.priority - a.priority); // 高优先级在前
    
    Logger.debug(`消息已加入队列: ${adapterName}:${target}`);
  }

  private updateStats(adapterName: string, type: 'messageSent' | 'messageReceived' | 'error'): void {
    const stats = this.adapterStats.get(adapterName);
    if (!stats) return;
    
    switch (type) {
      case 'messageSent':
        stats.messagesSent++;
        break;
      case 'messageReceived':
        stats.messagesReceived++;
        break;
      case 'error':
        stats.errors++;
        break;
    }
    
    stats.lastActivity = Date.now();
  }

  private handleMessage(message: Message): void {
    try {
      const emitted = this.eventBus.safeEmit('message', message);
      
    } catch (error) {
      Logger.error('[适配器管理器] 处理消息时出错:', error);
    }
  }

  private handleSendMessage(data: { platform: string; target: string; content: string }): void {
    this.sendMessage(data.platform, data.target, data.content).catch(error => {
      Logger.error(`[适配器管理器] 发送消息失败 (${data.platform}:${data.target}):`, error);
    });
  }

  private handleAdapterError(data: { adapterName: string; error: Error }): void {
    Logger.error(`[适配器管理器] 适配器 ${data.adapterName} 发生错误:`, data.error);
    this.updateStats(data.adapterName, 'error');
  }

  private handleAdapterDisconnect(adapterName: string): void {
    Logger.warn(`[适配器管理器] 适配器 ${adapterName} 已断线`);
    
    const stats = this.adapterStats.get(adapterName);
    if (stats) {
      stats.connected = false;
    }
    
    // 尝试自动重连
    this.scheduleReconnect(adapterName);
  }

  private handleAdapterReconnect(data: { adapterName: string }): void {
    this.reconnectAdapter(data.adapterName).catch(error => {
      Logger.error(`手动重连适配器 ${data.adapterName} 失败:`, error);
    });
  }

  private scheduleReconnect(adapterName: string): void {
    const attempts = this.reconnectAttempts.get(adapterName) || 0;
    
    if (attempts >= this.maxReconnectAttempts) {
      Logger.error(`适配器 ${adapterName} 重连次数已达上限，停止重连`);
      return;
    }
    
    this.reconnectAttempts.set(adapterName, attempts + 1);
    
    const delay = this.reconnectDelay * Math.pow(2, attempts); // 指数退避
    Logger.info(`将在 ${delay}ms 后重连适配器 ${adapterName} (第 ${attempts + 1} 次尝试)`);
    
    setTimeout(() => {
      this.reconnectAdapter(adapterName).catch(error => {
        Logger.error(`自动重连适配器 ${adapterName} 失败:`, error);
        this.scheduleReconnect(adapterName); // 继续尝试
      });
    }, delay);
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getAdapterHealth() as AdapterHealth[];
        const unhealthyAdapters = health.filter(h => h.status === 'error' || h.status === 'disconnected');
        
        if (unhealthyAdapters.length > 0) {
          Logger.warn(`发现 ${unhealthyAdapters.length} 个不健康的适配器:`, 
            unhealthyAdapters.map(h => `${h.name}(${h.status})`).join(', '));
        }
      } catch (error) {
        Logger.error('[适配器管理器] 健康检查失败:', error);
      }
    }, 30000); // 每30秒检查一次
  }

  private startQueueProcessor(): void {
    this.queueProcessInterval = setInterval(async () => {
      if (this.isProcessingQueue || this.messageQueue.length === 0) return;
      
      this.isProcessingQueue = true;
      
      try {
        const messagesToProcess = this.messageQueue.splice(0, 10); // 每次处理10条消息
        
        for (const message of messagesToProcess) {
          const adapter = this.adapters.get(message.adapterName);
          
          if (!adapter || !adapter.isConnected()) {
            // 重新加入队列
            if (message.retries < message.maxRetries) {
              message.retries++;
              this.messageQueue.push(message);
            } else {
              Logger.warn(`消息发送失败，已达最大重试次数: ${message.adapterName}:${message.target}`);
            }
            continue;
          }
          
          try {
            await this.doSendMessage(adapter, message.target, message.content);
            this.updateStats(message.adapterName, 'messageSent');
            Logger.debug(`队列消息发送成功: ${message.adapterName}:${message.target}`);
          } catch (error) {
            if (message.retries < message.maxRetries) {
              message.retries++;
              this.messageQueue.push(message);
              Logger.warn(`队列消息发送失败，将重试: ${message.adapterName}:${message.target}`, error);
            } else {
              Logger.error(`队列消息发送失败，已达最大重试次数: ${message.adapterName}:${message.target}`, error);
            }
            this.updateStats(message.adapterName, 'error');
          }
        }
      } catch (error) {
        Logger.error('[适配器管理器] 处理消息队列时出错:', error);
      } finally {
        this.isProcessingQueue = false;
      }
    }, 1000); // 每秒处理一次队列
  }

  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // 清理资源
  public destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.queueProcessInterval) {
      clearInterval(this.queueProcessInterval);
      this.queueProcessInterval = null;
    }
    
    if (this.performanceMonitorInterval) {
      clearInterval(this.performanceMonitorInterval);
      this.performanceMonitorInterval = null;
    }
    
    if (this.metricsCleanupInterval) {
      clearInterval(this.metricsCleanupInterval);
      this.metricsCleanupInterval = null;
    }
    
    // 断开所有适配器
    for (const [name, adapter] of this.adapters) {
      adapter.disconnect().catch(error => {
        Logger.error(`断开适配器 ${name} 时出错:`, error);
      });
    }
    
    this.adapters.clear();
    this.adapterStats.clear();
    this.messageQueue = [];
    this.reconnectAttempts.clear();
    
    Logger.info('[适配器管理器] 已清理所有资源');
  }
  
  // 新增方法实现
  private initializeAdapterStats(name: string): void {
    this.adapterStats.set(name, {
      name,
      connected: false,
      messagesSent: 0,
      messagesReceived: 0,
      errors: 0,
      lastActivity: Date.now(),
      uptime: 0,
      averageLatency: 0,
      peakLatency: 0,
      minLatency: 0,
      throughput: 0,
      successRate: 1.0,
      consecutiveErrors: 0,
      totalConnections: 0,
      connectionFailures: 0,
      bytesTransferred: 0,
      messagesPerMinute: [],
      hourlyStats: {}
    });
  }
  
  private initializeFailoverState(name: string): void {
    this.failoverStates.set(name, {
      adapterName: name,
      failureCount: 0,
      lastFailureTime: 0,
      circuitBreakerOpen: false,
      isInMaintenance: false
    });
  }
  
  private initializeConnectionPool(name: string): void {
    this.connectionPools.set(name, {
      total: 0,
      active: 0,
      idle: 0,
      pending: 0,
      created: 0,
      destroyed: 0,
      borrowed: 0,
      returned: 0
    });
  }
  
  private recordPerformanceMetric(adapterName: string, type: string): void {
    if (!this.performanceConfig.enabled) return;
    
    const metrics = this.performanceMetrics.get(adapterName) || [];
    const metric: PerformanceMetrics = {
      timestamp: Date.now(),
      adapterName,
      latency: 0,
      throughput: 0,
      errorRate: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      connectionCount: 0,
      queueSize: this.messageQueue.filter(m => m.adapterName === adapterName).length
    };
    
    metrics.push(metric);
    this.performanceMetrics.set(adapterName, metrics);
  }
  
  private handleFailure(adapterName: string, error: Error): void {
    const failoverState = this.failoverStates.get(adapterName);
    if (failoverState) {
      failoverState.failureCount++;
      failoverState.lastFailureTime = Date.now();
      
      const stats = this.adapterStats.get(adapterName);
      if (stats) {
        stats.consecutiveErrors++;
      }
      
      if (failoverState.failureCount >= 5) {
        failoverState.circuitBreakerOpen = true;
        failoverState.circuitBreakerOpenTime = Date.now();
      }
    }
  }
  
  private calculateHealthScore(adapterName: string): number {
    const stats = this.adapterStats.get(adapterName);
    if (!stats) return 0;
    
    let score = 100;
    
    if (!stats.connected) score -= 50;
    if (stats.consecutiveErrors > 0) score -= stats.consecutiveErrors * 10;
    if (stats.averageLatency > 1000) score -= 20;
    
    return Math.max(0, score);
  }
  
  private getHealthIssues(adapterName: string): string[] {
    const issues: string[] = [];
    const stats = this.adapterStats.get(adapterName);
    
    if (!stats) return issues;
    
    if (!stats.connected) issues.push('适配器未连接');
    if (stats.consecutiveErrors > 3) issues.push('连续错误过多');
    if (stats.averageLatency > 5000) issues.push('延迟过高');
    
    return issues;
  }
  
  private handleAdapterMaintenance(data: { adapterName: string; maintenance: boolean }): void {
    const failoverState = this.failoverStates.get(data.adapterName);
    if (failoverState) {
      failoverState.isInMaintenance = data.maintenance;
    }
  }
  
  private handleLoadBalanceConfigUpdate(data: { groupName: string; config: LoadBalanceConfig }): void {
    const group = this.adapterGroups.get(data.groupName);
    if (group) {
      group.loadBalanceConfig = data.config;
    }
  }
  
  private handlePerformanceAlert(data: { adapterName: string; metric: string; value: number }): void {
    Logger.warn(`性能警告 [${data.adapterName}]: ${data.metric} = ${data.value}`);
  }
  
  private startPerformanceMonitor(): void {
    this.performanceMonitorInterval = setInterval(() => {
      if (!this.performanceConfig.enabled) return;
      
      for (const [name, adapter] of this.adapters) {
        this.recordPerformanceMetric(name, 'monitor');
      }
    }, 60000); // 每分钟记录一次
  }
  
  private startMetricsCleanup(): void {
    this.metricsCleanupInterval = setInterval(() => {
      const cutoff = Date.now() - (this.performanceConfig.retentionPeriod * 24 * 60 * 60 * 1000);
      
      for (const [name, metrics] of this.performanceMetrics) {
        const filtered = metrics.filter(m => m.timestamp > cutoff);
        this.performanceMetrics.set(name, filtered);
      }
    }, 24 * 60 * 60 * 1000); // 每天清理一次
  }
  
  // 负载均衡相关方法
  public createAdapterGroup(config: AdapterGroup): void {
    this.adapterGroups.set(config.name, config);
    Logger.info(`创建适配器组: ${config.name}`);
  }
  
  public removeAdapterGroup(name: string): void {
    this.adapterGroups.delete(name);
    Logger.info(`删除适配器组: ${name}`);
  }
  
  public async sendMessageWithLoadBalance(groupName: string, target: string, content: string): Promise<void> {
    const group = this.adapterGroups.get(groupName);
    if (!group || !group.enabled) {
      throw new Error(`Adapter group not found or disabled: ${groupName}`);
    }
    
    const adapter = this.selectAdapterByStrategy(group);
    if (!adapter) {
      throw new Error(`No available adapter in group: ${groupName}`);
    }
    
    await this.sendMessage(adapter, target, content);
  }
  
  private selectAdapterByStrategy(group: AdapterGroup): string | null {
    const availableAdapters = group.adapters.filter(name => {
      const adapter = this.adapters.get(name);
      const failoverState = this.failoverStates.get(name);
      return adapter && adapter.isConnected() && 
             (!failoverState || (!failoverState.circuitBreakerOpen && !failoverState.isInMaintenance));
    });
    
    if (availableAdapters.length === 0) return null;
    
    switch (group.loadBalanceConfig.strategy) {
      case 'round-robin':
        return this.selectRoundRobin(group.name, availableAdapters);
      case 'least-connections':
        return this.selectLeastConnections(availableAdapters);
      case 'least-latency':
        return this.selectLeastLatency(availableAdapters);
      case 'weighted':
        return this.selectWeighted(availableAdapters, group.loadBalanceConfig.weights);
      case 'random':
        return availableAdapters[Math.floor(Math.random() * availableAdapters.length)];
      default:
        return availableAdapters[0];
    }
  }
  
  private selectRoundRobin(groupName: string, adapters: string[]): string {
    const counter = this.loadBalanceCounters.get(groupName) || 0;
    const selected = adapters[counter % adapters.length];
    this.loadBalanceCounters.set(groupName, counter + 1);
    return selected;
  }
  
  private selectLeastConnections(adapters: string[]): string {
    return adapters.reduce((least, current) => {
      const leastPool = this.connectionPools.get(least);
      const currentPool = this.connectionPools.get(current);
      return (currentPool?.active || 0) < (leastPool?.active || 0) ? current : least;
    });
  }
  
  private selectLeastLatency(adapters: string[]): string {
    return adapters.reduce((least, current) => {
      const leastStats = this.adapterStats.get(least);
      const currentStats = this.adapterStats.get(current);
      return (currentStats?.averageLatency || 0) < (leastStats?.averageLatency || 0) ? current : least;
    });
  }
  
  private selectWeighted(adapters: string[], weights?: { [key: string]: number }): string {
    if (!weights) return adapters[0];
    
    const totalWeight = adapters.reduce((sum, name) => sum + (weights[name] || 1), 0);
    let random = Math.random() * totalWeight;
    
    for (const name of adapters) {
      random -= weights[name] || 1;
      if (random <= 0) return name;
    }
    
    return adapters[0];
  }
  
  // 获取性能指标
  public getPerformanceMetrics(adapterName?: string): PerformanceMetrics[] {
    if (adapterName) {
      return this.performanceMetrics.get(adapterName) || [];
    }
    
    const allMetrics: PerformanceMetrics[] = [];
    for (const metrics of this.performanceMetrics.values()) {
      allMetrics.push(...metrics);
    }
    return allMetrics;
  }
  
  // 获取连接池状态
  public getConnectionPoolStats(adapterName?: string): ConnectionPoolStats | ConnectionPoolStats[] {
    if (adapterName) {
      const stats = this.connectionPools.get(adapterName);
      if (!stats) throw new Error(`Adapter not found: ${adapterName}`);
      return stats;
    }
    
    return Array.from(this.connectionPools.values());
  }
  
  // 获取故障转移状态
  public getFailoverStates(adapterName?: string): FailoverState | FailoverState[] {
    if (adapterName) {
      const state = this.failoverStates.get(adapterName);
      if (!state) throw new Error(`Adapter not found: ${adapterName}`);
      return state;
    }
    
    return Array.from(this.failoverStates.values());
  }
  
  // 手动触发故障转移
  public triggerFailover(adapterName: string): void {
    const failoverState = this.failoverStates.get(adapterName);
    if (failoverState) {
      failoverState.circuitBreakerOpen = true;
      failoverState.circuitBreakerOpenTime = Date.now();
      Logger.info(`手动触发故障转移: ${adapterName}`);
    }
  }
  
  // 重置故障转移状态
  public resetFailoverState(adapterName: string): void {
    const failoverState = this.failoverStates.get(adapterName);
    if (failoverState) {
      failoverState.failureCount = 0;
      failoverState.circuitBreakerOpen = false;
      failoverState.circuitBreakerOpenTime = undefined;
      
      const stats = this.adapterStats.get(adapterName);
      if (stats) {
        stats.consecutiveErrors = 0;
      }
      
      Logger.info(`重置故障转移状态: ${adapterName}`);
    }
  }
  
  // 设置维护模式
  public setMaintenanceMode(adapterName: string, maintenance: boolean): void {
    const failoverState = this.failoverStates.get(adapterName);
    if (failoverState) {
      failoverState.isInMaintenance = maintenance;
      Logger.info(`设置维护模式 ${adapterName}: ${maintenance}`);
    }
  }
  
  // 更新性能配置
  public updatePerformanceConfig(config: Partial<PerformanceMonitorConfig>): void {
    this.performanceConfig = { ...this.performanceConfig, ...config };
    Logger.info('性能监控配置已更新');
  }
  
  // 获取适配器组列表
  public getAdapterGroups(): AdapterGroup[] {
    return Array.from(this.adapterGroups.values());
  }
  
  // 更新适配器组配置
  public updateAdapterGroup(name: string, config: Partial<AdapterGroup>): void {
    const group = this.adapterGroups.get(name);
    if (group) {
      Object.assign(group, config);
      Logger.info(`更新适配器组配置: ${name}`);
    }
  }

  /**
   * 自动加载适配器
   */
  public async loadAdaptersFromConfig(config: any): Promise<void> {
    try {
      Logger.info('正在从配置自动加载适配器...');
      
      const adaptersConfig = config.adapters;
      if (!adaptersConfig) {
        Logger.warn('未找到适配器配置');
        return;
      }

      // 控制台适配器
      if (adaptersConfig.console?.enabled) {
        Logger.info('正在自动加载控制台适配器...');
        try {
          const ConsoleAdapterModule = await import('./console-adapter');
          const ConsoleAdapter = ConsoleAdapterModule.ConsoleAdapter;
          const adapter = new ConsoleAdapter();
          await this.registerAdapter(adapter.getAdapterWrapper());
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
          await this.registerAdapter(adapter.getAdapterWrapper());
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
          await this.registerAdapter(adapter.getAdapterWrapper());
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
          const HTTPAdapterModule = await import('./http-adapter-standalone');
          const HTTPAdapter = HTTPAdapterModule.HttpAdapterStandalone;
          const adapter = new HTTPAdapter();
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