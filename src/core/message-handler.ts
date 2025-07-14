import { Message, PermissionLevel } from '../common/types';
import { PluginManager } from '../plugins/plugin-manager';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';

export class MessageHandler {
  private static instance: MessageHandler;
  private pluginManager: PluginManager;
  private eventBus: FrameworkEventBus;
  private processingMessages: Set<string> = new Set(); // 用于跟踪正在处理的消息
  private maxConcurrentMessages: number = 10; // 最大并发处理数量

  private constructor() {
    this.pluginManager = PluginManager.getInstance();
    this.eventBus = FrameworkEventBus.getInstance();
    
    // 监听消息事件
    this.eventBus.on('message', this.handleMessage.bind(this));
  }

  public static getInstance(): MessageHandler {
    if (!MessageHandler.instance) {
      MessageHandler.instance = new MessageHandler();
    }
    return MessageHandler.instance;
  }

  private async handleMessage(message: Message): Promise<void> {
    const messageId = `${message.platform}-${message.id}-${Date.now()}`;
    
    // 检查并发限制
    if (this.processingMessages.size >= this.maxConcurrentMessages) {
      Logger.warn(`[消息处理器] 达到最大并发限制 (${this.maxConcurrentMessages})，消息将被丢弃: ${message.content}`);
      return;
    }
    
    // 标记消息为正在处理
    this.processingMessages.add(messageId);
    
    try {
      await this.processMessage(message);
    } finally {
      // 处理完成后移除标记
      this.processingMessages.delete(messageId);
    }
  }

  private async processMessage(message: Message): Promise<void> {
    try {
      Logger.info(`[消息处理器] 开始处理消息: ${message.content} (来自: ${message.sender.name})`);
      
      // 解析消息内容，提取命令和参数
      const { command, args } = this.parseMessage(message.content);
      
      Logger.debug(`[消息处理器] 解析结果 - 命令: "${command}", 参数: [${args.join(', ')}]`);
      
      if (!command) {
        Logger.debug('[消息处理器] 消息中未找到命令');
        return;
      }
      
      // 查找匹配的插件函数
      const pluginFunction = this.pluginManager.getPluginFunction(command);
      
      if (!pluginFunction) {
        Logger.debug(`[消息处理器] 未找到命令对应的插件函数: ${command}`);
        // 列出所有可用的命令
        const availableCommands = this.pluginManager.getAllFunctions();
        Logger.debug(`[消息处理器] 可用命令: ${availableCommands.map(f => f.name).join(', ')}`);
        return;
      }
      
      Logger.info(`[消息处理器] 找到插件函数: ${pluginFunction.name} (权限要求: ${pluginFunction.permission})`);
      
      // 检查权限
      if (!this.checkPermission(message.sender.permission, pluginFunction.permission)) {
        Logger.warn(`[消息处理器] 用户 ${message.sender.id} 权限不足 (${message.sender.permission})，无法执行 ${pluginFunction.name} (需要 ${pluginFunction.permission})`);
        return;
      }
      
      // 执行插件函数
      Logger.info(`正在执行插件函数: ${pluginFunction.name}`);
      await pluginFunction.handler(message, args);
      
    } catch (error) {
      Logger.error('处理消息时出错:', error);
      // 框架异常处理，防止崩溃
      this.eventBus.safeEmit('error', error);
    }
  }

  private parseMessage(content: string): { command: string; args: string[] } {
    const trimmed = content.trim();
    
    // 简单的命令解析：第一个词作为命令，其余作为参数
    const parts = trimmed.split(/\s+/);
    const command = parts[0] || '';
    const args = parts.slice(1);
    
    return { command, args };
  }

  private checkPermission(userPermission: PermissionLevel, requiredPermission: PermissionLevel): boolean {
    return userPermission >= requiredPermission;
  }

  // 获取消息处理统计信息
  public getProcessingStats(): { processing: number; maxConcurrent: number } {
    return {
      processing: this.processingMessages.size,
      maxConcurrent: this.maxConcurrentMessages
    };
  }

  // 设置最大并发数
  public setMaxConcurrentMessages(max: number): void {
    this.maxConcurrentMessages = Math.max(1, max);
    Logger.info(`[消息处理器] 最大并发数设置为: ${this.maxConcurrentMessages}`);
  }
}