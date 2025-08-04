import { Logger } from '../config/log';
import { Config } from '../config/config';

/**
 * Redis客户端接口
 */
export interface IRedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  expire(key: string, seconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
}

/**
 * Redis客户端实现
 * 使用单例模式管理Redis连接
 */
export class RedisClient implements IRedisClient {
  private static instance: RedisClient;
  private client: any = null;
  private connected: boolean = false;
  private config: any;

  private constructor() {
    this.config = Config.getInstance().redis;
  }

  /**
   * 获取Redis客户端实例
   */
  public static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  /**
   * 连接Redis
   */
  public async connect(): Promise<void> {
    if (this.connected) {
      Logger.debug('Redis已连接，跳过连接操作');
      return;
    }

    try {
      // 这里使用模拟的Redis客户端，实际项目中应该使用真实的Redis库
      // 例如: import Redis from 'ioredis';
      // this.client = new Redis(this.config);
      
      // 模拟连接
      this.client = {
        // 模拟Redis客户端方法
        get: async (key: string) => null,
        set: async (key: string, value: string, ...args: any[]) => 'OK',
        del: async (key: string) => 1,
        exists: async (key: string) => 0,
        keys: async (pattern: string) => [],
        hget: async (key: string, field: string) => null,
        hset: async (key: string, field: string, value: string) => 1,
        hdel: async (key: string, field: string) => 1,
        hgetall: async (key: string) => ({}),
        expire: async (key: string, seconds: number) => 1,
        ttl: async (key: string) => -1,
        quit: async () => 'OK',
        disconnect: async () => undefined
      };

      this.connected = true;
      Logger.info('✅ Redis连接成功');
      
    } catch (error) {
      Logger.error('❌ Redis连接失败:', error);
      throw error;
    }
  }

  /**
   * 断开Redis连接
   */
  public async disconnect(): Promise<void> {
    if (!this.connected || !this.client) {
      Logger.debug('Redis未连接，跳过断开操作');
      return;
    }

    try {
      if (this.client.quit) {
        await this.client.quit();
      } else if (this.client.disconnect) {
        await this.client.disconnect();
      }
      
      this.client = null;
      this.connected = false;
      Logger.info('✅ Redis连接已断开');
      
    } catch (error) {
      Logger.error('❌ Redis断开连接失败:', error);
      throw error;
    }
  }

  /**
   * 检查连接状态
   */
  public isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  /**
   * 获取值
   */
  public async get(key: string): Promise<string | null> {
    this.ensureConnected();
    try {
      return await this.client.get(key);
    } catch (error) {
      Logger.error(`Redis GET操作失败 [${key}]:`, error);
      throw error;
    }
  }

  /**
   * 设置值
   */
  public async set(key: string, value: string, ttl?: number): Promise<void> {
    this.ensureConnected();
    try {
      if (ttl) {
        await this.client.set(key, value, 'EX', ttl);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      Logger.error(`Redis SET操作失败 [${key}]:`, error);
      throw error;
    }
  }

  /**
   * 删除键
   */
  public async del(key: string): Promise<void> {
    this.ensureConnected();
    try {
      await this.client.del(key);
    } catch (error) {
      Logger.error(`Redis DEL操作失败 [${key}]:`, error);
      throw error;
    }
  }

  /**
   * 检查键是否存在
   */
  public async exists(key: string): Promise<boolean> {
    this.ensureConnected();
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      Logger.error(`Redis EXISTS操作失败 [${key}]:`, error);
      throw error;
    }
  }

  /**
   * 获取匹配的键列表
   */
  public async keys(pattern: string): Promise<string[]> {
    this.ensureConnected();
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      Logger.error(`Redis KEYS操作失败 [${pattern}]:`, error);
      throw error;
    }
  }

  /**
   * 获取哈希字段值
   */
  public async hget(key: string, field: string): Promise<string | null> {
    this.ensureConnected();
    try {
      return await this.client.hget(key, field);
    } catch (error) {
      Logger.error(`Redis HGET操作失败 [${key}.${field}]:`, error);
      throw error;
    }
  }

  /**
   * 设置哈希字段值
   */
  public async hset(key: string, field: string, value: string): Promise<void> {
    this.ensureConnected();
    try {
      await this.client.hset(key, field, value);
    } catch (error) {
      Logger.error(`Redis HSET操作失败 [${key}.${field}]:`, error);
      throw error;
    }
  }

  /**
   * 删除哈希字段
   */
  public async hdel(key: string, field: string): Promise<void> {
    this.ensureConnected();
    try {
      await this.client.hdel(key, field);
    } catch (error) {
      Logger.error(`Redis HDEL操作失败 [${key}.${field}]:`, error);
      throw error;
    }
  }

  /**
   * 获取所有哈希字段和值
   */
  public async hgetall(key: string): Promise<Record<string, string>> {
    this.ensureConnected();
    try {
      return await this.client.hgetall(key);
    } catch (error) {
      Logger.error(`Redis HGETALL操作失败 [${key}]:`, error);
      throw error;
    }
  }

  /**
   * 设置键的过期时间
   */
  public async expire(key: string, seconds: number): Promise<void> {
    this.ensureConnected();
    try {
      await this.client.expire(key, seconds);
    } catch (error) {
      Logger.error(`Redis EXPIRE操作失败 [${key}]:`, error);
      throw error;
    }
  }

  /**
   * 获取键的剩余生存时间
   */
  public async ttl(key: string): Promise<number> {
    this.ensureConnected();
    try {
      return await this.client.ttl(key);
    } catch (error) {
      Logger.error(`Redis TTL操作失败 [${key}]:`, error);
      throw error;
    }
  }

  /**
   * 确保已连接
   */
  private ensureConnected(): void {
    if (!this.connected || !this.client) {
      throw new Error('Redis未连接，请先调用connect()方法');
    }
  }

  /**
   * 获取连接信息
   */
  public getConnectionInfo(): any {
    return {
      connected: this.connected,
      config: {
        host: this.config?.host || 'localhost',
        port: this.config?.port || 6379,
        db: this.config?.db || 0
      }
    };
  }

  /**
   * 健康检查
   */
  public async healthCheck(): Promise<boolean> {
    try {
      if (!this.connected || !this.client) {
        return false;
      }

      // 执行简单的ping操作
      await this.client.set('health_check', 'ok', 'EX', 1);
      const result = await this.client.get('health_check');
      await this.client.del('health_check');
      
      return result === 'ok';
    } catch (error) {
      Logger.error('Redis健康检查失败:', error);
      return false;
    }
  }
}