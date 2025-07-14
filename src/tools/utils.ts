import { Logger } from '../config/log';

/**
 * 字符串工具类
 */
export class StringUtils {
  /**
   * 清理字符串，移除多余空格
   */
  public static clean(str: string): string {
    return str.trim().replace(/\s+/g, ' ');
  }

  /**
   * 检查字符串是否为空
   */
  public static isEmpty(str: string | null | undefined): boolean {
    return !str || str.trim().length === 0;
  }

  /**
   * 截断字符串
   */
  public static truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  /**
   * 转义HTML字符
   */
  public static escapeHtml(str: string): string {
    const htmlEscapes: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;'
    };
    
    return str.replace(/[&<>"']/g, (match) => htmlEscapes[match]);
  }
}

/**
 * 时间工具类
 */
export class TimeUtils {
  /**
   * 格式化时间戳
   */
  public static formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * 获取相对时间
   */
  public static getRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return `${seconds}秒前`;
  }

  /**
   * 睡眠函数
   */
  public static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 验证工具类
 */
export class ValidationUtils {
  /**
   * 验证邮箱格式
   */
  public static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * 验证QQ号格式
   */
  public static isValidQQ(qq: string): boolean {
    const qqRegex = /^[1-9][0-9]{4,10}$/;
    return qqRegex.test(qq);
  }

  /**
   * 验证URL格式
   */
  public static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 随机工具类
 */
export class RandomUtils {
  /**
   * 生成随机字符串
   */
  public static randomString(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * 生成随机数
   */
  public static randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 从数组中随机选择一个元素
   */
  public static randomChoice<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }
}
