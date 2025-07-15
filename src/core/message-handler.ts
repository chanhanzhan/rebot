import { Message, PermissionLevel } from '../common/types';
import { PluginManager } from '../plugins/plugin-manager';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';
// 移除 worker_threads 相关
// import { Worker } from 'worker_threads';
import * as path from 'path';

interface Task {
  message: Message;
  resolve: (value: void) => void;
  reject: (reason?: any) => void;
}

export class MessageHandler {
  private static instance: MessageHandler;
  private pluginManager: PluginManager;
  private eventBus: FrameworkEventBus;
  // 移除多线程相关属性
  // private maxConcurrentMessages: number = 10;
  // private workerPool: Worker[] = [];
  // private taskQueue: Task[] = [];
  // private busyWorkers: Set<Worker> = new Set();

  private constructor() {
    this.pluginManager = PluginManager.getInstance();
    this.eventBus = FrameworkEventBus.getInstance();
    this.eventBus.on('message', this.handleMessage.bind(this));
    // 移除 worker 池初始化
    // this.initWorkerPool();
  }

  public static getInstance(): MessageHandler {
    if (!MessageHandler.instance) {
      MessageHandler.instance = new MessageHandler();
    }
    return MessageHandler.instance;
  }

  // 移除 worker 池相关方法
  // private initWorkerPool(): void { ... }
  // private createWorker(): void { ... }

  private handleMessage(message: Message): void {
    // 直接主线程处理
    this.processMessage(message);
  }

  // 移除任务队列相关
  // private enqueueTask(message: Message): void { ... }
  // private processNextTask(): void { ... }

  // 兼容API，主线程直接处理消息
  public async processMessage(message: Message): Promise<void> {
    const start = Date.now();
    try {
      Logger.info(`[消息处理器] 开始处理消息: ${message.content} (来自: ${message.sender.name})`);
      const { command, args } = this.parseMessage(message.content);
      Logger.debug(`[消息处理器] 解析结果 - 命令: "${command}", 参数: [${args.join(', ')}]`);
      if (!command) {
        Logger.debug('[消息处理器] 消息中未找到命令');
        return;
      }
      // 多播：获取所有命中的插件函数
      const pluginFunctions = this.pluginManager.getPluginFunctions(command);
      if (!pluginFunctions || pluginFunctions.length === 0) {
        Logger.debug(`[消息处理器] 未找到命令对应的插件函数: ${command}`);
        const availableCommands = this.pluginManager.getAllFunctions();
        Logger.debug(`[消息处理器] 可用命令: ${availableCommands.map(f => f.name).join(', ')}`);
        return;
      }
      Logger.info(`[消息处理器] 命中插件函数: ${pluginFunctions.map(f => f.name).join(', ')}`);
      await Promise.all(pluginFunctions.map((pluginFunction) => {
        return (async () => {
          if (pluginFunction.adapters && !pluginFunction.adapters.includes(message.platform)) {
            Logger.info(`命令 ${pluginFunction.name} 不支持适配器 ${message.platform}，已跳过`);
            return;
          }
          if (!this.checkPermission(message.sender.permission, pluginFunction.permission)) {
            Logger.warn(`[消息处理器] 用户 ${message.sender.id} 权限不足 (${message.sender.permission})，无法执行 ${pluginFunction.name} (需要 ${pluginFunction.permission})`);
            return;
          }
          Logger.info(`正在执行插件函数: ${pluginFunction.name}`);
          await pluginFunction.handler(message, args);
        })();
      }));
    } catch (error) {
      Logger.error('处理消息时出错:', error);
      this.eventBus.safeEmit('error', error);
    } finally {
      const end = Date.now();
      Logger.info(`[消息处理器] 消息处理完成，耗时: ${end - start}ms`);
    }
  }

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

  // 移除多线程相关API
  public getProcessingStats(): { processing: number; maxConcurrent: number } {
    return {
      processing: 0,
      maxConcurrent: 1
    };
  }

  public setMaxConcurrentMessages(max: number): void {
    // 兼容API，无实际作用
    Logger.info(`[消息处理器] 最大并发数设置为: ${max} (单线程模式)`);
  }
}