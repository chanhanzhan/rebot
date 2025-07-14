import { Logger } from '../config/log';

/**
 * 重试工具
 */
export class RetryUtils {
  public static async retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        Logger.warn(`Attempt ${attempt} failed:`, error);
        
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // 指数退避
        }
      }
    }
    
    throw lastError!;
  }
}

/**
 * 缓存工具
 */
export class CacheUtils {
  private static cache: Map<string, { value: any; expiry: number }> = new Map();

  public static set(key: string, value: any, ttlMs: number = 60000): void {
    const expiry = Date.now() + ttlMs;
    this.cache.set(key, { value, expiry });
  }

  public static get<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value as T;
  }

  public static delete(key: string): void {
    this.cache.delete(key);
  }

  public static clear(): void {
    this.cache.clear();
  }

  public static cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache) {
      if (now > item.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * 限流工具
 */
export class RateLimiter {
  private static limits: Map<string, { count: number; resetTime: number }> = new Map();

  public static isAllowed(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const limit = this.limits.get(key);

    if (!limit || now > limit.resetTime) {
      this.limits.set(key, { count: 1, resetTime: now + windowMs });
      return true;
    }

    if (limit.count >= maxRequests) {
      return false;
    }

    limit.count++;
    return true;
  }

  public static cleanup(): void {
    const now = Date.now();
    for (const [key, limit] of this.limits) {
      if (now > limit.resetTime) {
        this.limits.delete(key);
      }
    }
  }
}

/**
 * 事件防抖工具
 */
export class DebounceUtils {
  private static timers: Map<string, NodeJS.Timeout> = new Map();

  public static debounce(key: string, fn: Function, delay: number): void {
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      fn();
      this.timers.delete(key);
    }, delay);

    this.timers.set(key, timer);
  }
}

/**
 * 权限检查工具
 */
export class PermissionUtils {
  public static hasPermission(userLevel: number, requiredLevel: number): boolean {
    return userLevel >= requiredLevel;
  }

  public static getUserLevelName(level: number): string {
    const levels = ['未知', '用户', '管理员', '主人'];
    return levels[level] || '未知';
  }
}
