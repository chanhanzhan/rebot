import { Message, PermissionLevel } from '../../../src/common/types';
import { Logger } from '../../../src/config/log';

/**
 * Hello应用 - 处理问候相关功能
 */
export class HelloApp {
  private plugin: any;
  private greetings: string[] = [
    '你好！',
    'Hello!',
    'Hi there!',
    '嗨！',
    '您好！',
    '早上好！',
    '下午好！',
    '晚上好！'
  ];

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  /**
   * 初始化应用
   */
  public async initialize(): Promise<void> {
    Logger.debug('HelloApp initialized');
    // 可以在这里加载特定的配置或数据
  }

  /**
   * 清理应用资源
   */
  public async cleanup(): Promise<void> {
    Logger.debug('HelloApp cleaned up');
    // 清理资源，保存数据等
  }

  /**
   * 处理Hello命令
   */
  public async handle(message: Message, args: string[]): Promise<void> {
    try {
      Logger.info(`Hello command executed by ${message.sender.name}`);
      
      // 获取随机问候语
      const greeting = this.getRandomGreeting();
      
      // 个性化问候
      let response = `${greeting} ${message.sender.name}！`;
      
      // 根据时间调整问候语
      const timeGreeting = this.getTimeBasedGreeting();
      if (timeGreeting) {
        response += ` ${timeGreeting}`;
      }
      
      // 如果有参数，添加额外信息
      if (args.length > 0) {
        response += ` 你说的"${args.join(' ')}"我收到了！`;
      }
      
      // 添加表情符号
      response += ' 😊';
      
      // 发送回复
      await this.sendReply(message, response);
      
      // 记录统计信息
      await this.recordUsage(message.sender.id);
      
    } catch (error) {
      Logger.error('Error in HelloApp.handle:', error);
      await this.sendReply(message, '抱歉，处理问候时出现了错误 😅');
    }
  }

  /**
   * 获取随机问候语
   */
  private getRandomGreeting(): string {
    const randomIndex = Math.floor(Math.random() * this.greetings.length);
    return this.greetings[randomIndex];
  }

  /**
   * 根据时间获取问候语
   */
  private getTimeBasedGreeting(): string {
    const hour = new Date().getHours();
    
    if (hour >= 5 && hour < 12) {
      return '早上好！新的一天开始了！';
    } else if (hour >= 12 && hour < 17) {
      return '下午好！今天过得怎么样？';
    } else if (hour >= 17 && hour < 22) {
      return '晚上好！今天辛苦了！';
    } else {
      return '夜深了，注意休息哦！';
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
      
      Logger.debug(`[HelloApp] 发送回复到 ${message.platform}:${target}`);
    } catch (error) {
      Logger.error('[HelloApp] 发送回复失败:', error);
      // 降级到控制台输出
      console.log(`[HelloApp -> ${message.sender.name}]: ${content}`);
    }
  }

  /**
   * 记录使用统计
   */
  private async recordUsage(userId: string): Promise<void> {
    try {
      // 这里可以记录用户使用统计
      // 例如保存到插件的数据文件中
      Logger.debug(`HelloApp usage recorded for user: ${userId}`);
    } catch (error) {
      Logger.error('Error recording HelloApp usage:', error);
    }
  }

  /**
   * 获取使用统计
   */
  public async getUsageStats(): Promise<any> {
    try {
      // 返回使用统计数据
      return {
        totalUsage: 0,
        recentUsers: []
      };
    } catch (error) {
      Logger.error('Error getting HelloApp usage stats:', error);
      return null;
    }
  }
}
