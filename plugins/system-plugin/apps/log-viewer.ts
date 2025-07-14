import { Message, PermissionLevel } from '../../../src/common/types';
import { Logger } from '../../../src/config/log';

/**
 * 日志查看应用
 */
export class LogViewerApp {
  private plugin: any;
  private logHistory: Array<{level: string, message: string, timestamp: number}> = [];

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  public async initialize(): Promise<void> {
    Logger.debug('LogViewerApp initialized');
    this.startLogCapture();
  }

  public async cleanup(): Promise<void> {
    Logger.debug('LogViewerApp cleaned up');
  }

  /**
   * 查看系统日志
   */
  public async viewLogs(message: Message, args: string[]): Promise<void> {
    try {
      Logger.info(`View logs command executed by ${message.sender.name}`);
      
      const limit = args.length > 0 ? parseInt(args[0]) || 10 : 10;
      const recentLogs = this.getRecentLogs(limit);
      
      let response = `📋 最近 ${limit} 条日志\n`;
      response += '═══════════════════\n\n';
      
      if (recentLogs.length === 0) {
        response += '暂无日志记录';
      } else {
        recentLogs.forEach((log, index) => {
          const time = new Date(log.timestamp).toLocaleTimeString();
          const levelIcon = this.getLevelIcon(log.level);
          response += `${index + 1}. [${time}] ${levelIcon} ${log.level.toUpperCase()}\n`;
          response += `   ${log.message}\n\n`;
        });
      }
      
      response += `\n💡 使用 "logs <数量>" 查看指定数量的日志`;
      
      await this.sendReply(message, response);
      
    } catch (error) {
      Logger.error('Error viewing logs:', error);
      await this.sendReply(message, '❌ 查看日志时发生错误');
    }
  }

  /**
   * 查看错误日志
   */
  public async viewErrors(message: Message, args: string[]): Promise<void> {
    try {
      Logger.info(`View errors command executed by ${message.sender.name}`);
      
      const limit = args.length > 0 ? parseInt(args[0]) || 5 : 5;
      const errorLogs = this.getErrorLogs(limit);
      
      let response = `🚨 最近 ${limit} 条错误日志\n`;
      response += '═══════════════════\n\n';
      
      if (errorLogs.length === 0) {
        response += '✅ 暂无错误记录，系统运行正常';
      } else {
        errorLogs.forEach((log, index) => {
          const time = new Date(log.timestamp).toLocaleTimeString();
          response += `${index + 1}. [${time}] ❌ ERROR\n`;
          response += `   ${log.message}\n\n`;
        });
      }
      
      response += `\n💡 使用 "errors <数量>" 查看指定数量的错误日志`;
      
      await this.sendReply(message, response);
      
    } catch (error) {
      Logger.error('Error viewing error logs:', error);
      await this.sendReply(message, '❌ 查看错误日志时发生错误');
    }
  }

  /**
   * 开始捕获日志
   */
  private startLogCapture(): void {
    // 模拟日志捕获
    setInterval(() => {
      if (Math.random() > 0.8) {
        this.captureLog('info', 'System is running normally');
      }
      if (Math.random() > 0.95) {
        this.captureLog('warn', 'High memory usage detected');
      }
      if (Math.random() > 0.99) {
        this.captureLog('error', 'Connection timeout to external service');
      }
    }, 10000);
  }

  /**
   * 捕获日志
   */
  private captureLog(level: string, message: string): void {
    this.logHistory.push({
      level,
      message,
      timestamp: Date.now()
    });
    
    // 保持最多1000条日志
    if (this.logHistory.length > 1000) {
      this.logHistory = this.logHistory.slice(-1000);
    }
  }

  /**
   * 获取最近的日志
   */
  private getRecentLogs(limit: number): Array<{level: string, message: string, timestamp: number}> {
    return this.logHistory.slice(-limit).reverse();
  }

  /**
   * 获取错误日志
   */
  private getErrorLogs(limit: number): Array<{level: string, message: string, timestamp: number}> {
    return this.logHistory
      .filter(log => log.level === 'error')
      .slice(-limit)
      .reverse();
  }

  /**
   * 获取日志级别图标
   */
  private getLevelIcon(level: string): string {
    switch (level.toLowerCase()) {
      case 'error': return '❌';
      case 'warn': return '⚠️';
      case 'info': return 'ℹ️';
      case 'debug': return '🔧';
      default: return '📝';
    }
  }

  /**
   * 获取日志统计
   */
  public getLogStats(): any {
    const total = this.logHistory.length;
    const errors = this.logHistory.filter(log => log.level === 'error').length;
    const warnings = this.logHistory.filter(log => log.level === 'warn').length;
    const infos = this.logHistory.filter(log => log.level === 'info').length;
    
    return {
      total,
      errors,
      warnings,
      infos,
      errorRate: total > 0 ? Math.round((errors / total) * 100) : 0
    };
  }

  private async sendReply(message: Message, content: string): Promise<void> {
    console.log(`[LogViewerApp -> ${message.sender.name}]: ${content}`);
  }
}
