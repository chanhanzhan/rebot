import { Message, PermissionLevel } from '../../../src/common/types';
import { Logger } from '../../../src/config/log';
import { MessageHandler } from '../../../src/core/message-handler';
import { FrameworkEventBus } from '../../../src/common/event-bus';

/**
 * 系统信息应用
 */
export class SystemInfoApp {
  private plugin: any;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  public async initialize(): Promise<void> {
    Logger.debug('SystemInfoApp initialized');
  }

  public async cleanup(): Promise<void> {
    Logger.debug('SystemInfoApp cleaned up');
  }

  /**
   * 显示系统信息
   */
  public async showSystemInfo(message: Message, args: string[]): Promise<void> {
    try {
      Logger.info(`System info command executed by ${message.sender.name}`);
      
      const systemInfo = await this.getDetailedSystemInfo();
      const messageStats = MessageHandler.getInstance().getProcessingStats();
      
      let response = '🖥️ 系统信息\n';
      response += '═══════════════════\n\n';
      
      response += '💻 硬件信息:\n';
      response += `├─ 平台: ${systemInfo.platform}\n`;
      response += `├─ 架构: ${systemInfo.arch}\n`;
      response += `├─ CPU 核心: ${systemInfo.cpus}\n`;
      response += `└─ 总内存: ${systemInfo.totalMemory}\n\n`;
      
      response += '🚀 运行时信息:\n';
      response += `├─ Node.js: ${systemInfo.nodeVersion}\n`;
      response += `├─ V8 引擎: ${systemInfo.v8Version}\n`;
      response += `├─ 进程ID: ${systemInfo.pid}\n`;
      response += `└─ 运行时间: ${systemInfo.uptime}\n\n`;
      
      response += '📊 内存使用:\n';
      response += `├─ RSS: ${systemInfo.memory.rss}\n`;
      response += `├─ Heap Used: ${systemInfo.memory.heapUsed}\n`;
      response += `├─ Heap Total: ${systemInfo.memory.heapTotal}\n`;
      response += `└─ External: ${systemInfo.memory.external}\n\n`;
      
      response += '📨 消息处理:\n';
      response += `├─ 正在处理: ${messageStats.processing} 条\n`;
      response += `├─ 最大并发: ${messageStats.maxConcurrent} 条\n`;
      response += `└─ 处理能力: ${messageStats.processing < messageStats.maxConcurrent ? '正常' : '接近上限'}\n\n`;
      
      response += '🌐 网络信息:\n';
      response += `└─ 主机名: ${systemInfo.hostname}`;
      
      await this.sendReply(message, response);
      
    } catch (error) {
      Logger.error('Error showing system info:', error);
      await this.sendReply(message, '❌ 获取系统信息时发生错误');
    }
  }

  /**
   * 显示性能信息
   */
  public async showPerformance(message: Message, args: string[]): Promise<void> {
    try {
      Logger.info(`Performance command executed by ${message.sender.name}`);
      
      const perfInfo = await this.getPerformanceInfo();
      
      let response = '📈 性能监控\n';
      response += '═══════════════════\n\n';
      
      response += '⚡ CPU 使用率:\n';
      response += `├─ 用户时间: ${perfInfo.cpu.user}μs\n`;
      response += `├─ 系统时间: ${perfInfo.cpu.system}μs\n`;
      response += `└─ 总计: ${perfInfo.cpu.total}μs\n\n`;
      
      response += '💾 内存使用:\n';
      response += `├─ 当前: ${perfInfo.memory.current}\n`;
      response += `├─ 峰值: ${perfInfo.memory.peak}\n`;
      response += `└─ 使用率: ${perfInfo.memory.usage}%\n\n`;
      
      response += '🔧 系统负载:\n';
      response += `├─ 1分钟: ${perfInfo.load.oneMinute}\n`;
      response += `├─ 5分钟: ${perfInfo.load.fiveMinutes}\n`;
      response += `└─ 15分钟: ${perfInfo.load.fifteenMinutes}\n\n`;
      
      response += '📁 文件描述符:\n';
      response += `└─ 已使用: ${perfInfo.fileDescriptors}`;
      
      await this.sendReply(message, response);
      
    } catch (error) {
      Logger.error('Error showing performance info:', error);
      await this.sendReply(message, '❌ 获取性能信息时发生错误');
    }
  }

  /**
   * 获取详细系统信息
   */
  private async getDetailedSystemInfo(): Promise<any> {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    // 格式化运行时间
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const uptimeStr = `${hours}时${minutes}分${seconds}秒`;
    
    return {
      platform: process.platform,
      arch: process.arch,
      cpus: 'N/A', // 在浏览器环境中无法获取
      totalMemory: 'N/A',
      nodeVersion: process.version,
      v8Version: process.versions.v8,
      pid: process.pid,
      uptime: uptimeStr,
      hostname: 'N/A',
      memory: {
        rss: `${Math.round(memUsage.rss / 1024 / 1024 * 100) / 100} MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100} MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100} MB`,
        external: `${Math.round(memUsage.external / 1024 / 1024 * 100) / 100} MB`
      }
    };
  }

  /**
   * 获取性能信息
   */
  private async getPerformanceInfo(): Promise<any> {
    const cpuUsage = process.cpuUsage();
    const memUsage = process.memoryUsage();
    
    return {
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
        total: cpuUsage.user + cpuUsage.system
      },
      memory: {
        current: `${Math.round(memUsage.rss / 1024 / 1024 * 100) / 100} MB`,
        peak: `${Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100} MB`,
        usage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
      },
      load: {
        oneMinute: 'N/A',
        fiveMinutes: 'N/A',
        fifteenMinutes: 'N/A'
      },
      fileDescriptors: 'N/A'
    };
  }

  private async sendReply(message: Message, content: string): Promise<void> {
    // 通过事件总线发送回复消息
    const eventBus = FrameworkEventBus.getInstance();
    eventBus.safeEmit('send_message', {
      platform: message.platform,
      target: message.sender.id,
      content: content
    });
  }
}
