import { Message, PermissionLevel } from '../../../src/common/types';
import { Logger } from '../../../src/config/log';

/**
 * Status应用 - 处理系统状态查询功能
 */
export class StatusApp {
  private plugin: any;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  /**
   * 初始化应用
   */
  public async initialize(): Promise<void> {
    Logger.debug('StatusApp initialized');
  }

  /**
   * 清理应用资源
   */
  public async cleanup(): Promise<void> {
    Logger.debug('StatusApp cleaned up');
  }

  /**
   * 处理Status命令
   */
  public async handle(message: Message, args: string[]): Promise<void> {
    try {
      Logger.info(`Status command executed by ${message.sender.name}`);
      
      // 检查权限
      if (message.sender.permission < PermissionLevel.ADMIN) {
        await this.sendReply(message, '❌ 权限不足，需要管理员权限才能查看系统状态');
        return;
      }
      
      // 获取系统状态
      const systemStatus = await this.getSystemStatus();
      const pluginStatus = await this.getPluginStatus();
      const frameworkStatus = await this.getFrameworkStatus();
      
      // 构建状态报告
      let statusReport = '📊 系统状态报告\n';
      statusReport += '═══════════════════\n\n';
      
      // 框架状态
      statusReport += '🤖 框架状态:\n';
      statusReport += `├─ 状态: ${frameworkStatus.isRunning ? '✅ 运行中' : '❌ 停止'}\n`;
      statusReport += `├─ 适配器: ${frameworkStatus.adapterCount} 个\n`;
      statusReport += `├─ 插件: ${frameworkStatus.pluginCount} 个\n`;
      statusReport += `└─ 运行时间: ${frameworkStatus.uptime}\n\n`;
      
      // 系统资源
      statusReport += '💻 系统资源:\n';
      statusReport += `├─ CPU: ${systemStatus.cpu}%\n`;
      statusReport += `├─ 内存: ${systemStatus.memory}\n`;
      statusReport += `├─ 平台: ${systemStatus.platform}\n`;
      statusReport += `└─ Node.js: ${systemStatus.nodeVersion}\n\n`;
      
      // 插件状态
      statusReport += '🧩 插件状态:\n';
      statusReport += `├─ 总数: ${pluginStatus.total}\n`;
      statusReport += `├─ 运行中: ${pluginStatus.running}\n`;
      statusReport += `├─ 错误: ${pluginStatus.errors}\n`;
      statusReport += `└─ 最近重载: ${pluginStatus.lastReload}\n\n`;
      
      // 根据参数显示详细信息
      if (args.includes('详细') || args.includes('detail')) {
        statusReport += await this.getDetailedStatus();
      }
      
      statusReport += '📝 使用 "status 详细" 查看详细信息';
      
      // 发送状态报告
      await this.sendReply(message, statusReport);
      
    } catch (error) {
      Logger.error('Error in StatusApp.handle:', error);
      await this.sendReply(message, '❌ 获取系统状态时发生错误');
    }
  }

  /**
   * 获取系统状态
   */
  private async getSystemStatus(): Promise<any> {
    try {
      const memUsage = process.memoryUsage();
      const memoryMB = Math.round(memUsage.rss / 1024 / 1024 * 100) / 100;
      
      return {
        cpu: this.getCpuUsage(),
        memory: `${memoryMB} MB`,
        platform: process.platform,
        nodeVersion: process.version,
        pid: process.pid,
        uptime: Math.floor(process.uptime())
      };
    } catch (error) {
      Logger.error('Error getting system status:', error);
      return {
        cpu: '未知',
        memory: '未知',
        platform: '未知',
        nodeVersion: '未知'
      };
    }
  }

  /**
   * 获取CPU使用率（模拟）
   */
  private getCpuUsage(): number {
    // 简单模拟CPU使用率
    return Math.floor(Math.random() * 30) + 10;
  }

  /**
   * 获取插件状态
   */
  private async getPluginStatus(): Promise<any> {
    try {
      // 这里应该从插件管理器获取实际状态
      return {
        total: 2,
        running: 2,
        errors: 0,
        lastReload: '刚刚'
      };
    } catch (error) {
      Logger.error('Error getting plugin status:', error);
      return {
        total: 0,
        running: 0,
        errors: 1,
        lastReload: '未知'
      };
    }
  }

  /**
   * 获取框架状态
   */
  private async getFrameworkStatus(): Promise<any> {
    try {
      // 这里应该从框架实例获取实际状态
      const uptime = Math.floor(process.uptime());
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;
      
      return {
        isRunning: true,
        adapterCount: 1,
        pluginCount: 2,
        uptime: `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      };
    } catch (error) {
      Logger.error('Error getting framework status:', error);
      return {
        isRunning: false,
        adapterCount: 0,
        pluginCount: 0,
        uptime: '未知'
      };
    }
  }

  /**
   * 获取详细状态
   */
  private async getDetailedStatus(): Promise<string> {
    let details = '🔍 详细信息:\n';
    details += '─────────────────\n';
    
    // 内存详细信息
    const memUsage = process.memoryUsage();
    details += '📈 内存详情:\n';
    details += `├─ RSS: ${Math.round(memUsage.rss / 1024 / 1024 * 100) / 100} MB\n`;
    details += `├─ Heap Used: ${Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100} MB\n`;
    details += `├─ Heap Total: ${Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100} MB\n`;
    details += `└─ External: ${Math.round(memUsage.external / 1024 / 1024 * 100) / 100} MB\n\n`;
    
    // 环境信息
    details += '🌍 环境信息:\n';
    details += `├─ 工作目录: ${process.cwd()}\n`;
    details += `├─ 执行路径: ${process.execPath}\n`;
    details += `└─ 进程ID: ${process.pid}\n\n`;
    
    return details;
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
      
      Logger.debug(`[StatusApp] 发送回复到 ${message.platform}:${target}`);
    } catch (error) {
      Logger.error('[StatusApp] 发送回复失败:', error);
      // 降级到控制台输出
      console.log(`[StatusApp -> ${message.sender.name}]: ${content}`);
    }
  }

  /**
   * 获取性能统计
   */
  public async getPerformanceStats(): Promise<any> {
    return {
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      uptime: process.uptime()
    };
  }

  // Redis 缓存示例
  public async setCache(key: string, value: string) {
    await this.plugin.pluginManager.setRedisCache(`status:${key}`, value);
  }
  public async getCache(key: string) {
    return await this.plugin.pluginManager.getRedisCache(`status:${key}`);
  }
  // 上下文缓存
  public cacheContext(chatId: string, message: any) {
    if (!this.plugin.contextCache) this.plugin.contextCache = new Map();
    if (!this.plugin.contextCache.has(chatId)) this.plugin.contextCache.set(chatId, []);
    this.plugin.contextCache.get(chatId)!.push(message);
    if (this.plugin.contextCache.get(chatId)!.length > 100) this.plugin.contextCache.get(chatId)!.shift();
    this.setCache(`context:${chatId}`, JSON.stringify(this.plugin.contextCache.get(chatId)));
  }
  public async getCachedContext(chatId: string, limit: number = 20) {
    const redisVal = await this.getCache(`context:${chatId}`);
    if (redisVal) return JSON.parse(redisVal).slice(-limit);
    return (this.plugin.contextCache.get(chatId) || []).slice(-limit);
  }
}
