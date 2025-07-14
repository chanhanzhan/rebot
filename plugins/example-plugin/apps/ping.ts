import { Message, PermissionLevel } from '../../../src/common/types';
import { Logger } from '../../../src/config/log';

/**
 * Ping应用 - 处理连接测试功能
 */
export class PingApp {
  private plugin: any;
  private startTime: number;
  private pingCount: number = 0;

  constructor(plugin: any) {
    this.plugin = plugin;
    this.startTime = Date.now();
  }

  /**
   * 初始化应用
   */
  public async initialize(): Promise<void> {
    Logger.debug('PingApp initialized');
    this.startTime = Date.now();
  }

  /**
   * 清理应用资源
   */
  public async cleanup(): Promise<void> {
    Logger.debug(`PingApp cleaned up. Total pings: ${this.pingCount}`);
  }

  /**
   * 处理Ping命令
   */
  public async handle(message: Message, args: string[]): Promise<void> {
    try {
      Logger.info(`Ping command executed by ${message.sender.name}`);
      
      const startTime = Date.now();
      
      // 增加ping计数
      this.pingCount++;
      
      // 计算响应时间（模拟）
      const responseTime = Date.now() - startTime;
      
      // 获取系统信息
      const systemInfo = await this.getSystemInfo();
      
      // 构建响应消息
      let response = '🏓 Pong!\n';
      response += `📡 响应时间: ${responseTime}ms\n`;
      response += `🔢 Ping次数: ${this.pingCount}\n`;
      response += `⏱️ 运行时间: ${this.getUptime()}\n`;
      
      // 如果有额外参数，显示回声
      if (args.length > 0) {
        response += `📢 回声: ${args.join(' ')}\n`;
      }
      
      // 添加系统信息
      response += `💾 内存使用: ${systemInfo.memory}\n`;
      response += `🔧 系统状态: ${systemInfo.status}`;
      
      // 发送回复
      await this.sendReply(message, response);
      
      // 记录ping统计
      await this.recordPing(message.sender.id, responseTime);
      
    } catch (error) {
      Logger.error('Error in PingApp.handle:', error);
      await this.sendReply(message, '❌ Ping失败，系统可能存在问题');
    }
  }

  /**
   * 获取系统信息
   */
  private async getSystemInfo(): Promise<any> {
    try {
      // 模拟获取系统信息
      const used = process.memoryUsage();
      const memory = `${Math.round(used.rss / 1024 / 1024 * 100) / 100} MB`;
      
      return {
        memory: memory,
        status: '正常',
        platform: process.platform,
        nodeVersion: process.version
      };
    } catch (error) {
      Logger.error('Error getting system info:', error);
      return {
        memory: '未知',
        status: '异常'
      };
    }
  }

  /**
   * 获取运行时间
   */
  private getUptime(): string {
    const uptime = Date.now() - this.startTime;
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}天${hours % 24}小时${minutes % 60}分钟`;
    } else if (hours > 0) {
      return `${hours}小时${minutes % 60}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟${seconds % 60}秒`;
    } else {
      return `${seconds}秒`;
    }
  }

  /**
   * 发送回复消息
   */
  private async sendReply(message: Message, content: string): Promise<void> {
    try {
      // 通过事件总线发送回复消息
      const { FrameworkEventBus } = require('../../../src/common/event-bus');
      const eventBus = FrameworkEventBus.getInstance();
      
      // 构建目标地址
      let target = message.sender.id;
      if (message.platform === 'telegram' && message.extra?.chatId) {
        target = message.extra.chatId;
      } else if (message.platform === 'qq') {
        if (message.extra?.messageType === 'group') {
          target = `group:${message.extra.groupId}`;
        } else {
          target = `private:${message.sender.id}`;
        }
      }
      
      // 发送回复事件
      eventBus.emit('send_message', {
        platform: message.platform,
        target: target,
        content: content
      });
      
      Logger.debug(`[PingApp] 发送回复到 ${message.platform}:${target}`);
    } catch (error) {
      Logger.error('[PingApp] 发送回复失败:', error);
      // 降级到控制台输出
      console.log(`[PingApp -> ${message.sender.name}]: ${content}`);
    }
  }

  /**
   * 记录ping统计
   */
  private async recordPing(userId: string, responseTime: number): Promise<void> {
    try {
      Logger.debug(`Ping recorded: user=${userId}, time=${responseTime}ms`);
      // 这里可以保存ping统计到数据文件
    } catch (error) {
      Logger.error('Error recording ping:', error);
    }
  }

  /**
   * 获取ping统计
   */
  public getPingStats(): any {
    return {
      totalPings: this.pingCount,
      uptime: this.getUptime(),
      startTime: this.startTime
    };
  }

  /**
   * 重置ping计数
   */
  public resetPingCount(): void {
    this.pingCount = 0;
    Logger.info('Ping count reset');
  }
}
