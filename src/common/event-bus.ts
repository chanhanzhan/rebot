import { EventEmitter } from 'events';
import { EventType, FrameworkEvent, LogEntry, LogLevel, LogCategory } from './event-types';
import { Logger } from '../config/log';

export interface EventListener {
  id: string;
  event: string;
  listener: Function;
  once?: boolean;
  priority?: number;
  context?: any;
  createdAt: number;
}

export interface EventStats {
  totalEvents: number;
  totalListeners: number;
  eventCounts: Record<string, number>;
  errorCounts: Record<string, number>;
  lastEventTime: number;
}

export class EventBus extends EventEmitter {
  private static instance: EventBus;
  private eventHistory: FrameworkEvent[] = [];
  private logHistory: LogEntry[] = [];
  private maxHistorySize = 1000;

  private constructor() {
    super();
    this.setMaxListeners(100); // 增加最大监听器数量
  }

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  // 发送框架事件
  public emitFrameworkEvent(event: FrameworkEvent): boolean {
    // 添加到历史记录
    this.addToHistory(event);
    
    // 记录日志
    this.logEvent(event);
    
    // 发送事件
    return super.emit(event.type, event);
  }

  // 发送日志事件
  public emitLog(level: LogLevel, category: LogCategory, source: string, message: string, data?: any, error?: Error): void {
    const logEntry: LogEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      level,
      category,
      source,
      message,
      data,
      error,
      tags: this.generateTags(level, category, source)
    };

    // 添加到日志历史
    this.addToLogHistory(logEntry);
    
    // 发送日志事件
    super.emit('log', logEntry);
    
    // 同时使用原有的Logger输出
    switch (level) {
      case LogLevel.DEBUG:
        Logger.debug(`[${category}] ${message}`, data);
        break;
      case LogLevel.INFO:
        Logger.info(`[${category}] ${message}`, data);
        break;
      case LogLevel.WARN:
        Logger.warn(`[${category}] ${message}`, data);
        break;
      case LogLevel.ERROR:
        Logger.error(`[${category}] ${message}`, error || data);
        break;
      case LogLevel.FATAL:
        Logger.error(`[FATAL][${category}] ${message}`, error || data);
        break;
    }
  }

  // 发送事件
  public emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  // 监听事件
  public on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  // 监听一次事件
  public once(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  // 移除监听器
  public off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  // 移除所有监听器
  public removeAllListeners(event?: string | symbol): this {
    return super.removeAllListeners(event);
  }

  // 获取事件历史
  public getEventHistory(limit?: number): FrameworkEvent[] {
    if (limit) {
      return this.eventHistory.slice(-limit);
    }
    return [...this.eventHistory];
  }

  // 获取日志历史
  public getLogHistory(level?: LogLevel, category?: LogCategory, limit?: number): LogEntry[] {
    let logs = this.logHistory;
    
    if (level) {
      logs = logs.filter(log => log.level === level);
    }
    
    if (category) {
      logs = logs.filter(log => log.category === category);
    }
    
    if (limit) {
      return logs.slice(-limit);
    }
    
    return [...logs];
  }

  // 清空历史记录
  public clearHistory(): void {
    this.eventHistory = [];
    this.logHistory = [];
  }

  private addToHistory(event: FrameworkEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  private addToLogHistory(logEntry: LogEntry): void {
    this.logHistory.push(logEntry);
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }
  }

  private logEvent(event: FrameworkEvent): void {
    const message = this.formatEventMessage(event);
    const level = this.getEventLogLevel(event.type);
    const category = this.getEventCategory(event.type);
    
    // 不使用emitLog避免循环
    switch (level) {
      case LogLevel.DEBUG:
        Logger.debug(`[EVENT] ${message}`);
        break;
      case LogLevel.INFO:
        Logger.info(`[EVENT] ${message}`);
        break;
      case LogLevel.WARN:
        Logger.warn(`[EVENT] ${message}`);
        break;
      case LogLevel.ERROR:
        Logger.error(`[EVENT] ${message}`);
        break;
    }
  }

  private formatEventMessage(event: FrameworkEvent): string {
    switch (event.type) {
      case EventType.SYSTEM_START:
        return `系统启动 - 版本: ${event.data?.version || 'unknown'}`;
      case EventType.SYSTEM_STOP:
        return '系统停止';
      case EventType.ADAPTER_CONNECT:
        return `适配器连接: ${event.data?.adapterId} (${event.data?.adapterType})`;
      case EventType.ADAPTER_DISCONNECT:
        return `适配器断开: ${event.data?.adapterId}`;
      case EventType.PLUGIN_LOAD:
        return `插件加载: ${event.data?.pluginName} v${event.data?.version}`;
      case EventType.PLUGIN_UNLOAD:
        return `插件卸载: ${event.data?.pluginName}`;
      default:
        return `事件: ${event.type}`;
    }
  }

  private getEventLogLevel(eventType: EventType): LogLevel {
    if (eventType.includes('error')) return LogLevel.ERROR;
    if (eventType.includes('warn')) return LogLevel.WARN;
    if (eventType.includes('debug')) return LogLevel.DEBUG;
    return LogLevel.INFO;
  }

  private getEventCategory(eventType: EventType): LogCategory {
    if (eventType.startsWith('system')) return LogCategory.SYSTEM;
    if (eventType.startsWith('adapter')) return LogCategory.ADAPTER;
    if (eventType.startsWith('plugin')) return LogCategory.PLUGIN;
    if (eventType.startsWith('message')) return LogCategory.MESSAGE;
    if (eventType.startsWith('config')) return LogCategory.CONFIG;
    if (eventType.startsWith('database')) return LogCategory.DATABASE;
    if (eventType.startsWith('onebot')) return LogCategory.ONEBOT;
    return LogCategory.SYSTEM;
  }

  private generateTags(level: LogLevel, category: LogCategory, source: string): string[] {
    const tags: string[] = [level, category];
    if (source) {
      tags.push(source);
    }
    return tags;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

export class FrameworkEventBus {
  private static instance: FrameworkEventBus;
  private listeners: Map<string, EventListener[]> = new Map();
  private stats: EventStats = {
    totalEvents: 0,
    totalListeners: 0,
    eventCounts: {},
    errorCounts: {},
    lastEventTime: 0
  };
  private maxListeners = 100;
  private enableLogging = false;
  private eventHistory: Array<{ event: string; timestamp: number; args: any[] }> = [];
  private maxHistorySize = 1000;

  private constructor() {
    // 定期清理过期的一次性监听器
    setInterval(() => this.cleanup(), 60000);
  }

  public static getInstance(): FrameworkEventBus {
    if (!FrameworkEventBus.instance) {
      FrameworkEventBus.instance = new FrameworkEventBus();
    }
    return FrameworkEventBus.instance;
  }

  public on(event: string, listener: Function, options?: {
    once?: boolean;
    priority?: number;
    context?: any;
  }): string {
    const id = this.generateId();
    const eventListener: EventListener = {
      id,
      event,
      listener,
      once: options?.once || false,
      priority: options?.priority || 0,
      context: options?.context,
      createdAt: Date.now()
    };

    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    const eventListeners = this.listeners.get(event)!;
    
    // 检查监听器数量限制
    if (eventListeners.length >= this.maxListeners) {
      Logger.warn(`[事件总线] 事件 ${event} 的监听器数量已达到上限 ${this.maxListeners}`);
      return id;
    }

    eventListeners.push(eventListener);
    
    // 按优先级排序（高优先级先执行）
    eventListeners.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    this.stats.totalListeners++;
    
    if (this.enableLogging) {
      Logger.debug(`[事件总线] 添加监听器: ${event} (ID: ${id})`);
    }

    return id;
  }

  public once(event: string, listener: Function, options?: {
    priority?: number;
    context?: any;
  }): string {
    return this.on(event, listener, { ...options, once: true });
  }

  public off(event: string, listenerOrId?: Function | string): boolean {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return false;

    let removed = false;
    
    if (typeof listenerOrId === 'string') {
      // 通过ID移除
      const index = eventListeners.findIndex(l => l.id === listenerOrId);
      if (index > -1) {
        eventListeners.splice(index, 1);
        this.stats.totalListeners--;
        removed = true;
      }
    } else if (typeof listenerOrId === 'function') {
      // 通过函数引用移除
      const index = eventListeners.findIndex(l => l.listener === listenerOrId);
      if (index > -1) {
        eventListeners.splice(index, 1);
        this.stats.totalListeners--;
        removed = true;
      }
    } else {
      // 移除所有监听器
      const count = eventListeners.length;
      eventListeners.length = 0;
      this.stats.totalListeners -= count;
      removed = count > 0;
    }

    // 如果没有监听器了，删除事件
    if (eventListeners.length === 0) {
      this.listeners.delete(event);
    }

    if (removed && this.enableLogging) {
      Logger.debug(`[事件总线] 移除监听器: ${event}`);
    }

    return removed;
  }

  public removeAllListeners(event?: string): void {
    if (event) {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        this.stats.totalListeners -= eventListeners.length;
        this.listeners.delete(event);
      }
    } else {
      this.stats.totalListeners = 0;
      this.listeners.clear();
    }

    if (this.enableLogging) {
      Logger.debug(`[事件总线] 清除所有监听器${event ? ` (事件: ${event})` : ''}`);
    }
  }

  // 安全的事件触发，捕获异常
  public safeEmit(event: string, ...args: any[]): boolean {
    try {
      return this.emit(event, ...args);
    } catch (error) {
      this.stats.errorCounts[event] = (this.stats.errorCounts[event] || 0) + 1;
      Logger.error(`[事件总线] 触发事件 ${event} 时发生错误:`, error);
      return false;
    }
  }

  public emit(event: string, ...args: any[]): boolean {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners || eventListeners.length === 0) {
      return false;
    }

    this.stats.totalEvents++;
    this.stats.eventCounts[event] = (this.stats.eventCounts[event] || 0) + 1;
    this.stats.lastEventTime = Date.now();

    // 记录事件历史
    this.addToHistory(event, args);

    const listenersToRemove: string[] = [];
    let hasError = false;

    for (const eventListener of eventListeners) {
      try {
        if (eventListener.context) {
          eventListener.listener.call(eventListener.context, ...args);
        } else {
          eventListener.listener(...args);
        }

        // 标记一次性监听器待移除
        if (eventListener.once) {
          listenersToRemove.push(eventListener.id);
        }
      } catch (error) {
        hasError = true;
        this.stats.errorCounts[event] = (this.stats.errorCounts[event] || 0) + 1;
        Logger.error(`[事件总线] 事件 ${event} 的监听器执行出错:`, error);
      }
    }

    // 移除一次性监听器
    for (const id of listenersToRemove) {
      this.off(event, id);
    }

    if (this.enableLogging) {
      Logger.debug(`[事件总线] 触发事件: ${event} (监听器数量: ${eventListeners.length})`);
    }

    return !hasError;
  }

  // 异步事件触发
  public async emitAsync(event: string, ...args: any[]): Promise<boolean> {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners || eventListeners.length === 0) {
      return false;
    }

    this.stats.totalEvents++;
    this.stats.eventCounts[event] = (this.stats.eventCounts[event] || 0) + 1;
    this.stats.lastEventTime = Date.now();

    // 记录事件历史
    this.addToHistory(event, args);

    const listenersToRemove: string[] = [];
    let hasError = false;

    for (const eventListener of eventListeners) {
      try {
        const result = eventListener.context 
          ? eventListener.listener.call(eventListener.context, ...args)
          : eventListener.listener(...args);

        // 如果返回Promise，等待完成
        if (result && typeof result.then === 'function') {
          await result;
        }

        // 标记一次性监听器待移除
        if (eventListener.once) {
          listenersToRemove.push(eventListener.id);
        }
      } catch (error) {
        hasError = true;
        this.stats.errorCounts[event] = (this.stats.errorCounts[event] || 0) + 1;
        Logger.error(`[事件总线] 异步事件 ${event} 的监听器执行出错:`, error);
      }
    }

    // 移除一次性监听器
    for (const id of listenersToRemove) {
      this.off(event, id);
    }

    if (this.enableLogging) {
      Logger.debug(`[事件总线] 异步触发事件: ${event} (监听器数量: ${eventListeners.length})`);
    }

    return !hasError;
  }

  // 并行异步事件触发
  public async emitParallel(event: string, ...args: any[]): Promise<boolean> {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners || eventListeners.length === 0) {
      return false;
    }

    this.stats.totalEvents++;
    this.stats.eventCounts[event] = (this.stats.eventCounts[event] || 0) + 1;
    this.stats.lastEventTime = Date.now();

    // 记录事件历史
    this.addToHistory(event, args);

    const promises: Promise<any>[] = [];
    const listenersToRemove: string[] = [];

    for (const eventListener of eventListeners) {
      const promise = new Promise<void>(async (resolve, reject) => {
        try {
          const result = eventListener.context 
            ? eventListener.listener.call(eventListener.context, ...args)
            : eventListener.listener(...args);

          // 如果返回Promise，等待完成
          if (result && typeof result.then === 'function') {
            await result;
          }

          // 标记一次性监听器待移除
          if (eventListener.once) {
            listenersToRemove.push(eventListener.id);
          }

          resolve();
        } catch (error) {
          reject(error);
        }
      });

      promises.push(promise);
    }

    const results = await Promise.allSettled(promises);
    const errors = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    
    if (errors.length > 0) {
      this.stats.errorCounts[event] = (this.stats.errorCounts[event] || 0) + errors.length;
      for (const error of errors) {
        Logger.error(`[事件总线] 并行事件 ${event} 的监听器执行出错:`, error.reason);
      }
    }

    // 移除一次性监听器
    for (const id of listenersToRemove) {
      this.off(event, id);
    }

    if (this.enableLogging) {
      Logger.debug(`[事件总线] 并行触发事件: ${event} (监听器数量: ${eventListeners.length})`);
    }

    return errors.length === 0;
  }

  // 获取事件监听器列表
  public getListeners(event: string): EventListener[] {
    return [...(this.listeners.get(event) || [])];
  }

  // 获取所有事件名称
  public getEventNames(): string[] {
    return Array.from(this.listeners.keys());
  }

  // 获取监听器数量
  public getListenerCount(event?: string): number {
    if (event) {
      return this.listeners.get(event)?.length || 0;
    }
    return this.stats.totalListeners;
  }

  // 获取统计信息
  public getStats(): EventStats {
    return { ...this.stats };
  }

  // 重置统计信息
  public resetStats(): void {
    this.stats = {
      totalEvents: 0,
      totalListeners: this.stats.totalListeners,
      eventCounts: {},
      errorCounts: {},
      lastEventTime: 0
    };
    this.eventHistory = [];
    Logger.info('[事件总线] 统计信息已重置');
  }

  // 设置配置
  public setConfig(config: {
    maxListeners?: number;
    enableLogging?: boolean;
    maxHistorySize?: number;
  }): void {
    if (config.maxListeners !== undefined) this.maxListeners = config.maxListeners;
    if (config.enableLogging !== undefined) this.enableLogging = config.enableLogging;
    if (config.maxHistorySize !== undefined) this.maxHistorySize = config.maxHistorySize;
    
    Logger.info('[事件总线] 配置已更新:', config);
  }

  // 获取事件历史
  public getEventHistory(limit?: number): Array<{ event: string; timestamp: number; args: any[] }> {
    const history = [...this.eventHistory];
    return limit ? history.slice(-limit) : history;
  }

  // 清理过期监听器和历史记录
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24小时

    for (const [event, listeners] of this.listeners) {
      const validListeners = listeners.filter(listener => {
        // 保留非一次性监听器或最近创建的监听器
        return !listener.once || (now - listener.createdAt) < maxAge;
      });

      if (validListeners.length !== listeners.length) {
        this.stats.totalListeners -= (listeners.length - validListeners.length);
        if (validListeners.length === 0) {
          this.listeners.delete(event);
        } else {
          this.listeners.set(event, validListeners);
        }
      }
    }

    // 清理事件历史
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  // 添加到事件历史
  private addToHistory(event: string, args: any[]): void {
    this.eventHistory.push({
      event,
      timestamp: Date.now(),
      args: args.map(arg => {
        // 简化复杂对象以避免内存泄漏
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.parse(JSON.stringify(arg));
          } catch {
            return '[复杂对象]';
          }
        }
        return arg;
      })
    });

    // 保持历史记录大小
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  // 生成唯一ID
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // 健康检查
  public healthCheck(): {
    status: string;
    totalListeners: number;
    totalEvents: number;
    memoryUsage: string;
    errors: number;
  } {
    const totalErrors = Object.values(this.stats.errorCounts).reduce((sum, count) => sum + count, 0);
    
    return {
      status: totalErrors > this.stats.totalEvents * 0.1 ? 'unhealthy' : 'healthy',
      totalListeners: this.stats.totalListeners,
      totalEvents: this.stats.totalEvents,
      memoryUsage: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      errors: totalErrors
    };
  }
}