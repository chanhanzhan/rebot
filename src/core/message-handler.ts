import { Message, PermissionLevel } from '../common/types';
import { PluginManager } from '../plugins/plugin-manager';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';
import { ConfigManager } from '../config/config';
import { DatabaseManager } from '../database/database-manager';
import * as os from 'os';

interface MessageStats {
  totalProcessed: number;
  totalErrors: number;
  averageProcessingTime: number;
  lastProcessedAt: number;
  peakProcessingTime: number;
  minProcessingTime: number;
  successRate: number;
  commandStats: Map<string, CommandStats>;
  hourlyStats: Map<string, number>; // 按小时统计
  userStats: Map<string, UserStats>;
}

interface CommandStats {
  command: string;
  count: number;
  totalTime: number;
  averageTime: number;
  errorCount: number;
  lastUsed: number;
}

interface UserStats {
  userId: string;
  messageCount: number;
  commandCount: number;
  errorCount: number;
  lastActivity: number;
  averageResponseTime: number;
  topCommands: Map<string, number>;
}

interface RateLimitInfo {
  count: number;
  resetTime: number;
  violations: number;
  lastViolation: number;
}

interface MessageQueue {
  id: string;
  message: Message;
  priority: number;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  delay: number;
}

interface ProcessingContext {
  messageId: string;
  startTime: number;
  userId: string;
  command: string;
  platform: string;
  retryCount: number;
}

interface MessageFilter {
  enabled: boolean;
  patterns: RegExp[];
  whitelist: string[];
  blacklist: string[];
  minLength: number;
  maxLength: number;
}

interface MessageCache {
  content: string;
  result: any;
  timestamp: number;
  hitCount: number;
}

export class MessageHandler {
  private static instance: MessageHandler;
  private pluginManager: PluginManager;
  private eventBus: FrameworkEventBus;
  private configManager: ConfigManager;
  private databaseManager: DatabaseManager;
  
  // 性能监控
  private stats: MessageStats = {
    totalProcessed: 0,
    totalErrors: 0,
    averageProcessingTime: 0,
    lastProcessedAt: 0,
    peakProcessingTime: 0,
    minProcessingTime: Infinity,
    successRate: 100,
    commandStats: new Map(),
    hourlyStats: new Map(),
    userStats: new Map()
  };
  
  // 限流控制
  private rateLimitMap: Map<string, RateLimitInfo> = new Map();
  private maxRetries: number = 3;
  private retryDelay: number = 1000;
  private enableRateLimit: boolean = true;
  private rateLimitWindow: number = 60000; // 1分钟
  private rateLimitMax: number = 30; // 每分钟最多30条消息
  
  // 消息队列和并发控制
  private messageQueue: MessageQueue[] = [];
  private processingQueue: Map<string, ProcessingContext> = new Map();
  private maxConcurrentMessages: number = 10;
  private currentProcessing: number = 0;
  private queueProcessor: NodeJS.Timeout | null = null;
  
  // 消息过滤和缓存
  private messageFilter: MessageFilter = {
    enabled: false,
    patterns: [],
    whitelist: [],
    blacklist: [],
    minLength: 1,
    maxLength: 10000
  };
  private messageCache: Map<string, MessageCache> = new Map();
  private cacheEnabled: boolean = false;
  private cacheMaxSize: number = 1000;
  private cacheTTL: number = 300000; // 5分钟
  
  // 性能监控
  private performanceMonitor: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private statsReportInterval: NodeJS.Timeout | null = null;
  
  // 中间件系统
  private middlewares: Array<{
    name: string;
    handler: (message: Message, next: () => Promise<void>) => Promise<void>;
    priority: number;
  }> = [];

  private constructor() {
    this.pluginManager = PluginManager.getInstance();
    this.eventBus = FrameworkEventBus.getInstance();
    this.configManager = ConfigManager.getInstance();
    this.databaseManager = DatabaseManager.getInstance();
    
    // 从配置加载设置
    this.loadConfiguration();
    
    // 注册事件监听器
    this.setupEventListeners();
    
    // 启动后台任务
    this.startBackgroundTasks();
  }

  public static getInstance(): MessageHandler {
    if (!MessageHandler.instance) {
      MessageHandler.instance = new MessageHandler();
    }
    return MessageHandler.instance;
  }

  private loadConfiguration(): void {
    const config = this.configManager.getConfig();
    if (config.messageHandler) {
      this.maxRetries = config.messageHandler.maxRetries || 3;
      this.retryDelay = config.messageHandler.retryDelay || 1000;
      this.enableRateLimit = config.messageHandler.enableRateLimit !== false;
      this.rateLimitWindow = config.messageHandler.rateLimitWindow || 60000;
      this.rateLimitMax = config.messageHandler.rateLimitMax || 30;
      this.maxConcurrentMessages = config.messageHandler.maxConcurrentMessages || 10;
      this.cacheEnabled = config.messageHandler.cacheEnabled || false;
      this.cacheMaxSize = config.messageHandler.cacheMaxSize || 1000;
      this.cacheTTL = config.messageHandler.cacheTTL || 300000;
      
      // 加载消息过滤配置
        if (config.messageHandler.filter) {
          this.messageFilter = { 
            ...this.messageFilter, 
            ...config.messageHandler.filter,
            patterns: config.messageHandler.filter.patterns.map(p => new RegExp(p))
          };
        }
    }
  }

  private setupEventListeners(): void {
    this.eventBus.on('message', this.handleMessage.bind(this));
    this.eventBus.on('message_priority', this.handlePriorityMessage.bind(this));
    this.eventBus.on('message_batch', this.handleBatchMessages.bind(this));
    this.eventBus.on('clear_message_cache', this.clearMessageCache.bind(this));
    this.eventBus.on('reload_message_config', this.reloadConfiguration.bind(this));
  }

  private startBackgroundTasks(): void {
    // 定期清理限流记录
    setInterval(() => this.cleanupRateLimit(), 60000);
    
    // 定期清理消息缓存
    if (this.cacheEnabled) {
      setInterval(() => this.cleanupMessageCache(), 60000);
    }
    
    // 启动队列处理器
    this.startQueueProcessor();
    
    // 启动性能监控
    this.startPerformanceMonitor();
    
    // 启动健康检查
    this.startHealthCheck();
    
    // 启动统计报告
    this.startStatsReport();
  }

  private startQueueProcessor(): void {
    if (this.queueProcessor) return;
    
    this.queueProcessor = setInterval(async () => {
      await this.processMessageQueue();
    }, 100); // 每100ms处理一次队列
  }

  private startPerformanceMonitor(): void {
    if (this.performanceMonitor) return;
    
    this.performanceMonitor = setInterval(() => {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      this.eventBus.safeEmit('performance_metrics', {
        memory: {
          rss: memUsage.rss,
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external
        },
        cpu: cpuUsage,
        messageHandler: {
          queueSize: this.messageQueue.length,
          processing: this.currentProcessing,
          cacheSize: this.messageCache.size,
          rateLimitUsers: this.rateLimitMap.size
        }
      });
    }, 30000); // 每30秒报告一次
  }

  private startHealthCheck(): void {
    if (this.healthCheckInterval) return;
    
    this.healthCheckInterval = setInterval(async () => {
      const health = await this.getHealthStatus();
      
      if (health.status !== 'healthy') {
        Logger.warn('[消息处理器] 健康检查发现问题:', health.issues);
        this.eventBus.safeEmit('message_handler_health_warning', health);
      }
    }, 60000); // 每分钟检查一次
  }

  private startStatsReport(): void {
    if (this.statsReportInterval) return;
    
    this.statsReportInterval = setInterval(() => {
      this.generateStatsReport();
    }, 300000); // 每5分钟生成一次统计报告
  }

  // 中间件系统
  public addMiddleware(name: string, handler: (message: Message, next: () => Promise<void>) => Promise<void>, priority: number = 0): void {
    this.middlewares.push({ name, handler, priority });
    this.middlewares.sort((a, b) => b.priority - a.priority);
    Logger.info(`[消息处理器] 已添加中间件: ${name} (优先级: ${priority})`);
  }

  public removeMiddleware(name: string): void {
    const index = this.middlewares.findIndex(m => m.name === name);
    if (index >= 0) {
      this.middlewares.splice(index, 1);
      Logger.info(`[消息处理器] 已移除中间件: ${name}`);
    }
  }

  private async executeMiddlewares(message: Message): Promise<void> {
    let index = 0;
    
    const next = async (): Promise<void> => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index++];
        await middleware.handler(message, next);
      }
    };
    
    await next();
  }

  // 消息处理主流程
  private handleMessage(message: Message): void {
    this.queueMessage(message, 0); // 普通优先级
  }

  private handlePriorityMessage(data: { message: Message; priority: number }): void {
    this.queueMessage(data.message, data.priority);
  }

  private handleBatchMessages(data: { messages: Message[]; priority?: number }): void {
    for (const message of data.messages) {
      this.queueMessage(message, data.priority || 0);
    }
  }

  private queueMessage(message: Message, priority: number = 0): void {
    // 检查消息过滤
    if (!this.passMessageFilter(message)) {
      Logger.debug(`[消息处理器] 消息被过滤器拦截: ${message.content}`);
      return;
    }
    
    const queueItem: MessageQueue = {
      id: this.generateMessageId(),
      message,
      priority,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: this.maxRetries,
      delay: 0
    };
    
    // 按优先级插入队列
    const insertIndex = this.messageQueue.findIndex(item => item.priority < priority);
    if (insertIndex >= 0) {
      this.messageQueue.splice(insertIndex, 0, queueItem);
    } else {
      this.messageQueue.push(queueItem);
    }
    
    Logger.debug(`[消息处理器] 消息已加入队列 (优先级: ${priority}, 队列长度: ${this.messageQueue.length})`);
  }

  private async processMessageQueue(): Promise<void> {
    if (this.currentProcessing >= this.maxConcurrentMessages || this.messageQueue.length === 0) {
      return;
    }
    
    const queueItem = this.messageQueue.shift();
    if (!queueItem) return;
    
    // 检查延迟
    if (queueItem.delay > 0 && Date.now() < queueItem.timestamp + queueItem.delay) {
      this.messageQueue.unshift(queueItem); // 放回队列头部
      return;
    }
    
    this.currentProcessing++;
    
    try {
      await this.processMessageWithRetry(queueItem);
    } catch (error) {
      Logger.error(`[消息处理器] 处理队列消息失败:`, error);
    } finally {
      this.currentProcessing--;
    }
  }

  private async processMessageWithRetry(queueItem: MessageQueue): Promise<void> {
    const { message } = queueItem;
    
    try {
      // 检查限流
      if (this.enableRateLimit && !this.checkRateLimit(message.sender.id)) {
        Logger.warn(`[消息处理器] 用户 ${message.sender.id} 触发限流`);
        return;
      }

      await this.processMessage(message, queueItem.id);
      
    } catch (error) {
      queueItem.retryCount++;
      
      if (queueItem.retryCount < queueItem.maxRetries) {
        // 指数退避重试
        queueItem.delay = this.retryDelay * Math.pow(2, queueItem.retryCount - 1);
        queueItem.timestamp = Date.now();
        
        Logger.warn(`[消息处理器] 处理失败，${queueItem.delay}ms后重试 (${queueItem.retryCount}/${queueItem.maxRetries}):`, error);
        
        // 重新加入队列
        this.messageQueue.unshift(queueItem);
      } else {
        Logger.error(`[消息处理器] 处理失败，已达最大重试次数:`, error);
        this.updateStats(message.sender.id, '', 0, false);
        this.eventBus.safeEmit('message_processing_failed', { message, error, queueItem });
      }
    }
  }

  // 主要消息处理方法
  public async processMessage(message: Message, messageId?: string): Promise<void> {
    const start = Date.now();
    const id = messageId || this.generateMessageId();
    
    try {
      Logger.info(`[消息处理器] 开始处理消息 [${id}]: ${message.content} (来自: ${message.sender.name})`);
      
      // 创建处理上下文
      const context: ProcessingContext = {
        messageId: id,
        startTime: start,
        userId: message.sender.id,
        command: '',
        platform: message.platform,
        retryCount: 0
      };
      
      this.processingQueue.set(id, context);
      
      // 检查缓存
      if (this.cacheEnabled) {
        const cached = this.getFromCache(message.content);
        if (cached) {
          Logger.debug(`[消息处理器] 命中缓存: ${message.content}`);
          cached.hitCount++;
          this.updateStats(message.sender.id, '', Date.now() - start, true);
          return;
        }
      }
      
      // 执行中间件
      await this.executeMiddlewares(message);
      
      const { command, args } = this.parseMessage(message.content);
      context.command = command;
      
      Logger.debug(`[消息处理器] 解析结果 - 命令: "${command}", 参数: [${args.join(', ')}]`);
      
      if (!command) {
        Logger.debug('[消息处理器] 消息中未找到命令');
        return;
      }

      // 获取所有匹配的插件函数
      const pluginFunctions = this.pluginManager.getPluginFunctions(command);
      if (!pluginFunctions || pluginFunctions.length === 0) {
        Logger.debug(`[消息处理器] 未找到命令对应的插件函数: ${command}`);
        return;
      }

      Logger.info(`[消息处理器] 命中插件函数: ${pluginFunctions.map(f => f.name).join(', ')}`);

      // 并行执行所有匹配的插件函数
      const results = await Promise.allSettled(
        pluginFunctions.map(async (pluginFunction) => {
          const funcStart = Date.now();
          try {
            // 检查适配器兼容性
            if (pluginFunction.adapters && !pluginFunction.adapters.includes(message.platform)) {
              Logger.debug(`命令 ${pluginFunction.name} 不支持适配器 ${message.platform}，已跳过`);
              return;
            }

            // 检查权限
            if (!this.checkPermission(message.sender.permission, pluginFunction.permission)) {
              Logger.warn(`[消息处理器] 用户 ${message.sender.id} 权限不足 (${message.sender.permission})，无法执行 ${pluginFunction.name} (需要 ${pluginFunction.permission})`);
              return;
            }

            Logger.info(`正在执行插件函数: ${pluginFunction.name}`);
            const result = await pluginFunction.handler(message, args);
            
            const funcEnd = Date.now();
            Logger.debug(`[性能] 插件函数 ${pluginFunction.name} 执行耗时: ${funcEnd - funcStart}ms`);
            
            return result;
          } catch (error) {
            Logger.error(`插件函数 ${pluginFunction.name} 执行失败:`, error);
            throw error;
          }
        })
      );

      // 统计执行结果
      const failed = results.filter(result => result.status === 'rejected');
      const success = failed.length === 0;
      
      if (failed.length > 0) {
        Logger.warn(`[消息处理器] ${failed.length}/${results.length} 个插件函数执行失败`);
        failed.forEach((result, index) => {
          if (result.status === 'rejected') {
            Logger.error(`插件函数执行失败 [${index}]:`, result.reason);
          }
        });
      }
      
      // 缓存结果
      if (this.cacheEnabled && success) {
        this.addToCache(message.content, results);
      }
      
      // 更新统计信息
      const processingTime = Date.now() - start;
      this.updateStats(message.sender.id, command, processingTime, success);
      
      Logger.info(`[消息处理器] 消息处理完成 [${id}]，耗时: ${processingTime}ms`);

    } catch (error) {
      Logger.error(`处理消息时出错 [${id}]:`, error);
      this.eventBus.safeEmit('error', error);
      this.updateStats(message.sender.id, '', Date.now() - start, false);
      throw error;
    } finally {
      this.processingQueue.delete(id);
    }
  }

  // 统计信息更新
  private updateStats(userId: string, command: string, processingTime: number, success: boolean): void {
    const now = Date.now();
    
    // 更新总体统计
    this.stats.totalProcessed++;
    this.stats.lastProcessedAt = now;
    
    if (!success) {
      this.stats.totalErrors++;
    }
    
    // 更新成功率
    this.stats.successRate = ((this.stats.totalProcessed - this.stats.totalErrors) / this.stats.totalProcessed) * 100;
    
    // 更新处理时间统计
    if (processingTime > 0) {
      if (this.stats.totalProcessed === 1) {
        this.stats.averageProcessingTime = processingTime;
        this.stats.minProcessingTime = processingTime;
        this.stats.peakProcessingTime = processingTime;
      } else {
        this.stats.averageProcessingTime = 
          (this.stats.averageProcessingTime * (this.stats.totalProcessed - 1) + processingTime) / this.stats.totalProcessed;
        this.stats.minProcessingTime = Math.min(this.stats.minProcessingTime, processingTime);
        this.stats.peakProcessingTime = Math.max(this.stats.peakProcessingTime, processingTime);
      }
    }
    
    // 更新命令统计
    if (command) {
      this.updateCommandStats(command, processingTime, success);
    }
    
    // 更新用户统计
    this.updateUserStats(userId, command, processingTime, success);
    
    // 更新小时统计
    this.updateHourlyStats();
  }

  private updateCommandStats(command: string, processingTime: number, success: boolean): void {
    let commandStats = this.stats.commandStats.get(command);
    
    if (!commandStats) {
      commandStats = {
        command,
        count: 0,
        totalTime: 0,
        averageTime: 0,
        errorCount: 0,
        lastUsed: 0
      };
      this.stats.commandStats.set(command, commandStats);
    }
    
    commandStats.count++;
    commandStats.totalTime += processingTime;
    commandStats.averageTime = commandStats.totalTime / commandStats.count;
    commandStats.lastUsed = Date.now();
    
    if (!success) {
      commandStats.errorCount++;
    }
  }

  private updateUserStats(userId: string, command: string, processingTime: number, success: boolean): void {
    let userStats = this.stats.userStats.get(userId);
    
    if (!userStats) {
      userStats = {
        userId,
        messageCount: 0,
        commandCount: 0,
        errorCount: 0,
        lastActivity: 0,
        averageResponseTime: 0,
        topCommands: new Map()
      };
      this.stats.userStats.set(userId, userStats);
    }
    
    userStats.messageCount++;
    userStats.lastActivity = Date.now();
    
    if (command) {
      userStats.commandCount++;
      const commandCount = userStats.topCommands.get(command) || 0;
      userStats.topCommands.set(command, commandCount + 1);
    }
    
    if (!success) {
      userStats.errorCount++;
    }
    
    // 更新平均响应时间
    if (userStats.messageCount === 1) {
      userStats.averageResponseTime = processingTime;
    } else {
      userStats.averageResponseTime = 
        (userStats.averageResponseTime * (userStats.messageCount - 1) + processingTime) / userStats.messageCount;
    }
  }

  private updateHourlyStats(): void {
    const hour = new Date().getHours().toString().padStart(2, '0');
    const current = this.stats.hourlyStats.get(hour) || 0;
    this.stats.hourlyStats.set(hour, current + 1);
  }

  // 限流检查
  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const userLimit = this.rateLimitMap.get(userId);
    
    if (!userLimit || now > userLimit.resetTime) {
      // 重置或创建新的限流记录
      this.rateLimitMap.set(userId, {
        count: 1,
        resetTime: now + this.rateLimitWindow,
        violations: userLimit?.violations || 0,
        lastViolation: userLimit?.lastViolation || 0
      });
      return true;
    }
    
    if (userLimit.count >= this.rateLimitMax) {
      userLimit.violations++;
      userLimit.lastViolation = now;
      
      // 记录违规行为
      this.eventBus.safeEmit('rate_limit_violation', {
        userId,
        violations: userLimit.violations,
        timestamp: now
      });
      
      return false;
    }
    
    userLimit.count++;
    return true;
  }

  private cleanupRateLimit(): void {
    const now = Date.now();
    for (const [userId, limit] of this.rateLimitMap.entries()) {
      if (now > limit.resetTime) {
        this.rateLimitMap.delete(userId);
      }
    }
  }

  // 消息过滤
  private passMessageFilter(message: Message): boolean {
    if (!this.messageFilter.enabled) return true;
    
    const content = message.content;
    
    // 检查长度
    if (content.length < this.messageFilter.minLength || content.length > this.messageFilter.maxLength) {
      return false;
    }
    
    // 检查黑名单
    if (this.messageFilter.blacklist.some(word => content.includes(word))) {
      return false;
    }
    
    // 检查白名单（如果有）
    if (this.messageFilter.whitelist.length > 0 && 
        !this.messageFilter.whitelist.some(word => content.includes(word))) {
      return false;
    }
    
    // 检查正则表达式模式
    if (this.messageFilter.patterns.some(pattern => pattern.test(content))) {
      return false;
    }
    
    return true;
  }

  // 消息缓存
  private getFromCache(content: string): MessageCache | null {
    const cached = this.messageCache.get(content);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached;
    }
    
    if (cached) {
      this.messageCache.delete(content);
    }
    
    return null;
  }

  private addToCache(content: string, result: any): void {
    if (this.messageCache.size >= this.cacheMaxSize) {
      // 删除最旧的缓存项
      const oldestKey = Array.from(this.messageCache.keys())[0];
      this.messageCache.delete(oldestKey);
    }
    
    this.messageCache.set(content, {
      content,
      result,
      timestamp: Date.now(),
      hitCount: 0
    });
  }

  private cleanupMessageCache(): void {
    const now = Date.now();
    for (const [key, cache] of this.messageCache.entries()) {
      if (now - cache.timestamp > this.cacheTTL) {
        this.messageCache.delete(key);
      }
    }
  }

  private clearMessageCache(): void {
    this.messageCache.clear();
    Logger.info('[消息处理器] 消息缓存已清空');
  }

  // 工具方法
  private parseMessage(content: string): { command: string; args: string[] } {
    const trimmed = content.trim();
    const parts = trimmed.split(/\s+/);
    const command = parts[0] || '';
    const args = parts.slice(1);
    return { command, args };
  }

  private checkPermission(userPermission: PermissionLevel, requiredPermission: PermissionLevel): boolean {
    return userPermission >= requiredPermission;
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private reloadConfiguration(): void {
    this.loadConfiguration();
    Logger.info('[消息处理器] 配置已重新加载');
  }

  // 健康检查
  public async getHealthStatus(): Promise<{
    status: 'healthy' | 'warning' | 'error';
    issues: string[];
    metrics: any;
  }> {
    const issues: string[] = [];
    let status: 'healthy' | 'warning' | 'error' = 'healthy';
    
    // 检查队列长度
    if (this.messageQueue.length > 100) {
      status = 'warning';
      issues.push(`消息队列过长: ${this.messageQueue.length}`);
    }
    
    if (this.messageQueue.length > 500) {
      status = 'error';
      issues.push(`消息队列严重积压: ${this.messageQueue.length}`);
    }
    
    // 检查处理中的消息数量
    if (this.currentProcessing >= this.maxConcurrentMessages) {
      status = status === 'error' ? 'error' : 'warning';
      issues.push(`并发处理数已达上限: ${this.currentProcessing}/${this.maxConcurrentMessages}`);
    }
    
    // 检查错误率
    if (this.stats.successRate < 90) {
      status = 'error';
      issues.push(`成功率过低: ${this.stats.successRate.toFixed(1)}%`);
    } else if (this.stats.successRate < 95) {
      status = status === 'error' ? 'error' : 'warning';
      issues.push(`成功率较低: ${this.stats.successRate.toFixed(1)}%`);
    }
    
    // 检查内存使用
    const memUsage = process.memoryUsage();
    const memUsageMB = memUsage.heapUsed / 1024 / 1024;
    
    if (memUsageMB > 500) {
      status = 'error';
      issues.push(`内存使用过高: ${memUsageMB.toFixed(1)}MB`);
    } else if (memUsageMB > 200) {
      status = status === 'error' ? 'error' : 'warning';
      issues.push(`内存使用较高: ${memUsageMB.toFixed(1)}MB`);
    }
    
    return {
      status,
      issues,
      metrics: {
        queueLength: this.messageQueue.length,
        processing: this.currentProcessing,
        successRate: this.stats.successRate,
        memoryUsage: memUsageMB,
        cacheSize: this.messageCache.size,
        rateLimitUsers: this.rateLimitMap.size
      }
    };
  }

  // 统计报告
  private generateStatsReport(): void {
    const report = {
      timestamp: Date.now(),
      totalProcessed: this.stats.totalProcessed,
      totalErrors: this.stats.totalErrors,
      successRate: this.stats.successRate,
      averageProcessingTime: this.stats.averageProcessingTime,
      peakProcessingTime: this.stats.peakProcessingTime,
      minProcessingTime: this.stats.minProcessingTime === Infinity ? 0 : this.stats.minProcessingTime,
      topCommands: Array.from(this.stats.commandStats.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([command, stats]) => ({ command, count: stats.count, averageTime: stats.averageTime })),
      activeUsers: this.stats.userStats.size,
      queueLength: this.messageQueue.length,
      cacheHitRate: this.calculateCacheHitRate(),
      hourlyDistribution: Object.fromEntries(this.stats.hourlyStats)
    };
    
    this.eventBus.safeEmit('message_handler_stats_report', report);
    Logger.info('[消息处理器] 统计报告已生成');
  }

  private calculateCacheHitRate(): number {
    if (!this.cacheEnabled || this.messageCache.size === 0) return 0;
    
    const totalHits = Array.from(this.messageCache.values()).reduce((sum, cache) => sum + cache.hitCount, 0);
    const totalRequests = this.stats.totalProcessed;
    
    return totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;
  }

  // 公共API
  public getStats(): MessageStats {
    return {
      ...this.stats,
      commandStats: new Map(this.stats.commandStats),
      hourlyStats: new Map(this.stats.hourlyStats),
      userStats: new Map(this.stats.userStats)
    };
  }

  public getDetailedStats(): any {
    return {
      basic: this.getStats(),
      queue: {
        length: this.messageQueue.length,
        processing: this.currentProcessing,
        maxConcurrent: this.maxConcurrentMessages
      },
      cache: {
        enabled: this.cacheEnabled,
        size: this.messageCache.size,
        maxSize: this.cacheMaxSize,
        hitRate: this.calculateCacheHitRate()
      },
      rateLimit: {
        enabled: this.enableRateLimit,
        activeUsers: this.rateLimitMap.size,
        window: this.rateLimitWindow,
        max: this.rateLimitMax
      },
      filter: this.messageFilter
    };
  }

  public getRateLimitStatus(userId?: string): any {
    if (userId) {
      const limit = this.rateLimitMap.get(userId);
      return limit ? {
        count: limit.count,
        remaining: Math.max(0, this.rateLimitMax - limit.count),
        resetTime: limit.resetTime,
        resetIn: Math.max(0, limit.resetTime - Date.now()),
        violations: limit.violations,
        lastViolation: limit.lastViolation
      } : null;
    }
    
    return {
      totalUsers: this.rateLimitMap.size,
      windowMs: this.rateLimitWindow,
      maxRequests: this.rateLimitMax,
      enabled: this.enableRateLimit
    };
  }

  public getQueueStatus(): any {
    return {
      length: this.messageQueue.length,
      processing: this.currentProcessing,
      maxConcurrent: this.maxConcurrentMessages,
      items: this.messageQueue.slice(0, 10).map(item => ({
        id: item.id,
        priority: item.priority,
        timestamp: item.timestamp,
        retryCount: item.retryCount,
        command: this.parseMessage(item.message.content).command
      }))
    };
  }

  public getCacheStatus(): any {
    return {
      enabled: this.cacheEnabled,
      size: this.messageCache.size,
      maxSize: this.cacheMaxSize,
      hitRate: this.calculateCacheHitRate(),
      items: Array.from(this.messageCache.entries()).slice(0, 10).map(([key, cache]) => ({
        content: key.substring(0, 50),
        timestamp: cache.timestamp,
        hitCount: cache.hitCount
      }))
    };
  }

  // 配置管理
  public resetRateLimit(userId: string): void {
    this.rateLimitMap.delete(userId);
    Logger.info(`[消息处理器] 已重置用户 ${userId} 的限流状态`);
  }

  public setRateLimitConfig(config: {
    enabled?: boolean;
    windowMs?: number;
    maxRequests?: number;
  }): void {
    if (config.enabled !== undefined) this.enableRateLimit = config.enabled;
    if (config.windowMs !== undefined) this.rateLimitWindow = config.windowMs;
    if (config.maxRequests !== undefined) this.rateLimitMax = config.maxRequests;
    
    Logger.info('[消息处理器] 限流配置已更新:', config);
  }

  public setMaxConcurrentMessages(max: number): void {
    this.maxConcurrentMessages = Math.max(1, max);
    Logger.info(`[消息处理器] 最大并发数设置为: ${this.maxConcurrentMessages}`);
  }

  public setCacheConfig(config: {
    enabled?: boolean;
    maxSize?: number;
    ttl?: number;
  }): void {
    if (config.enabled !== undefined) this.cacheEnabled = config.enabled;
    if (config.maxSize !== undefined) this.cacheMaxSize = config.maxSize;
    if (config.ttl !== undefined) this.cacheTTL = config.ttl;
    
    if (!this.cacheEnabled) {
      this.clearMessageCache();
    }
    
    Logger.info('[消息处理器] 缓存配置已更新:', config);
  }

  public setMessageFilter(filter: Partial<MessageFilter>): void {
    this.messageFilter = { ...this.messageFilter, ...filter };
    
    if (filter.patterns) {
      this.messageFilter.patterns = filter.patterns.map(p => new RegExp(p));
    }
    
    Logger.info('[消息处理器] 消息过滤器已更新:', filter);
  }

  public resetStats(): void {
    this.stats = {
      totalProcessed: 0,
      totalErrors: 0,
      averageProcessingTime: 0,
      lastProcessedAt: 0,
      peakProcessingTime: 0,
      minProcessingTime: Infinity,
      successRate: 100,
      commandStats: new Map(),
      hourlyStats: new Map(),
      userStats: new Map()
    };
    Logger.info('[消息处理器] 统计信息已重置');
  }

  public clearQueue(): void {
    this.messageQueue = [];
    Logger.info('[消息处理器] 消息队列已清空');
  }

  // 清理资源
  public destroy(): void {
    // 停止所有定时器
    if (this.queueProcessor) {
      clearInterval(this.queueProcessor);
      this.queueProcessor = null;
    }
    
    if (this.performanceMonitor) {
      clearInterval(this.performanceMonitor);
      this.performanceMonitor = null;
    }
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.statsReportInterval) {
      clearInterval(this.statsReportInterval);
      this.statsReportInterval = null;
    }
    
    // 清理数据
    this.messageQueue = [];
    this.processingQueue.clear();
    this.messageCache.clear();
    this.rateLimitMap.clear();
    this.middlewares = [];
    
    Logger.info('[消息处理器] 已清理所有资源');
  }
}