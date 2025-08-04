import { DatabaseInterface } from '../database/database-manager';
import { Logger } from './log';
import Redis, { Redis as RedisClient } from 'ioredis';
import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export class RedisDatabase implements DatabaseInterface {
  private config: RedisConfig;
  private client: RedisClient | null = null;
  private connected = false;
  private reconnecting = false;
  private rdbDir: string = path.resolve('data/redis');
  private persistenceEnabled: boolean = false;

  constructor(config: RedisConfig) {
    this.config = config;
    try {
      if (!fs.existsSync(this.rdbDir)) {
        fs.mkdirSync(this.rdbDir, { recursive: true });
      }
    } catch (error) {
      Logger.warn('无法创建Redis数据目录:', error);
    }
  }

  public async connect(): Promise<void> {
    // 检查是否已经连接或正在连接
    if (this.connected || this.reconnecting) {
      Logger.warn('Redis已连接或正在连接中，跳过重复连接');
      return;
    }
    
    // 检查是否已有客户端实例
    if (this.client) {
      Logger.warn('Redis客户端已存在，先断开连接');
      await this.disconnect();
    }

    this.reconnecting = true;
    
    try {
      Logger.info(`Connecting to Redis at ${this.config.host}:${this.config.port}`);
      
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        db: this.config.db,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });

      this.client.on('connect', () => {
        this.connected = true;
        this.reconnecting = false;
        Logger.info('Connected to Redis');
      });
      
      this.client.on('error', (error: Error) => {
        Logger.error('Redis error:', error);
        this.connected = false;
        // 清理客户端引用，避免后续操作出错
        this.client = null;
        this.reconnecting = false;
      });
      
      this.client.on('end', () => {
        this.connected = false;
        Logger.warn('Redis连接已断开');
        // 清理客户端引用，避免后续操作出错
        this.client = null;
        this.reconnecting = false;
      });
      
      this.client.on('close', () => {
        this.connected = false;
        Logger.info('Redis连接已关闭');
        this.client = null;
        this.reconnecting = false;
      });
      
      await this.client.connect();
      
    } catch (error) {
      this.reconnecting = false;
      Logger.error('Failed to connect to Redis:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        host: this.config.host,
        port: this.config.port
      });
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch (error) {
        Logger.warn('Redis断开连接时出错:', error);
      } finally {
        this.client = null;
        this.connected = false;
        this.reconnecting = false;
        Logger.info('Disconnected from Redis');
      }
    }
  }

  public isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  public async get(key: string): Promise<string | null> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.get(key);
  }
  public async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.client) throw new Error('Redis is not connected');
    if (ttl) {
      await this.client.setex(key, ttl, value);
    } else {
      await this.client.set(key, value);
    }
  }

  public async delete(key: string): Promise<void> {
    if (!this.client) throw new Error('Redis is not connected');
    await this.client.del(key);
  }

  public async exists(key: string): Promise<boolean> {
    if (!this.client) throw new Error('Redis is not connected');
    return (await this.client.exists(key)) > 0;
  }

  public async keys(pattern: string): Promise<string[]> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.keys(pattern);
  }

  public async expire(key: string, seconds: number): Promise<boolean> {
    if (!this.client) throw new Error('Redis is not connected');
    return (await this.client.expire(key, seconds)) === 1;
  }

  public async ttl(key: string): Promise<number> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.ttl(key);
  }

  public async incr(key: string): Promise<number> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.incr(key);
  }

  public async decr(key: string): Promise<number> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.decr(key);
  }

  public async hget(key: string, field: string): Promise<string | null> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.hget(key, field);
  }

  public async hset(key: string, field: string, value: string): Promise<void> {
    if (!this.client) throw new Error('Redis is not connected');
    await this.client.hset(key, field, value);
  }

  public async hdel(key: string, field: string): Promise<void> {
    if (!this.client) throw new Error('Redis is not connected');
    await this.client.hdel(key, field);
  }

  public async hgetall(key: string): Promise<Record<string, string>> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.hgetall(key);
  }

  public async lpush(key: string, value: string): Promise<number> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.lpush(key, value);
  }

  public async rpush(key: string, value: string): Promise<number> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.rpush(key, value);
  }

  public async lpop(key: string): Promise<string | null> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.lpop(key);
  }

  public async rpop(key: string): Promise<string | null> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.rpop(key);
  }

  public async llen(key: string): Promise<number> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.llen(key);
  }

  public async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.lrange(key, start, stop);
  }

  public async sadd(key: string, member: string): Promise<number> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.sadd(key, member);
  }

  public async srem(key: string, member: string): Promise<number> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.srem(key, member);
  }

  public async smembers(key: string): Promise<string[]> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.smembers(key);
  }

  public async sismember(key: string, member: string): Promise<boolean> {
    if (!this.client) throw new Error('Redis is not connected');
    return (await this.client.sismember(key, member)) === 1;
  }

  public async ping(): Promise<string> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.ping();
  }

  public async flushdb(): Promise<void> {
    if (!this.client) throw new Error('Redis is not connected');
    await this.client.flushdb();
  }
  public getClient(): RedisClient | null {
    return this.client;
  }

  // 自动重启 Redis 服务（Linux/Windows）
  private tryRestartRedis() {
    Logger.warn('尝试自动重启 Redis 服务...');
    const isWin = process.platform === 'win32';
    let cmd = '';
    if (isWin) {
      // Windows: 需提前配置 redis-server.exe 路径
      const redisExe = path.resolve('data/redis/redis-server.exe');
      try {
        if (fs.existsSync(redisExe)) {
          cmd = `start "" "${redisExe}" --dir ${this.rdbDir} --dbfilename dump.rdb`;
        } else {
          Logger.error('未找到 redis-server.exe，无法自动重启 Redis');
          return;
        }
      } catch (error) {
        Logger.error('检查Redis可执行文件时出错:', error);
        return;
      }
    } else {
      // Linux: 需已安装 redis-server
      cmd = `redis-server --dir ${this.rdbDir} --dbfilename dump.rdb`;
    }
    try {
      child_process.exec(cmd, (err, stdout, stderr) => {
        if (err) {
          Logger.error('自动重启 Redis 失败:', err);
        } else {
          Logger.info('已尝试自动重启 Redis:', stdout || stderr);
        }
        this.reconnecting = false;
      });
    } catch (e) {
      Logger.error('自动重启 Redis 进程异常:', e);
      this.reconnecting = false;
    }
  }

  // 启用 RDB 持久化，数据保存到 data/redis
  private async enableRDBPersistence() {
    if (!this.client || this.persistenceEnabled) return;
    
    try {
      // 检查Redis是否支持CONFIG命令
      const info = await this.client.info('server');
      if (!info) {
        Logger.info('无法获取Redis服务器信息，数据库功能正常，但无法设置持久化');
        this.persistenceEnabled = true;
        return;
      }

      // 尝试设置持久化参数
      await this.client.config('SET', 'dir', this.rdbDir);
      await this.client.config('SET', 'dbfilename', 'dump.rdb');
      await this.client.config('SET', 'save', '900 1 300 10 60 10000'); // 常规RDB策略
      
      this.persistenceEnabled = true;
      Logger.info('Redis RDB持久化已启用，数据目录:', this.rdbDir);
    } catch (e) {
      Logger.info('Redis数据库连接正常，但无法设置持久化参数（可能是服务器配置限制）');
      Logger.info('数据库功能完全可用，只是数据不会自动保存到磁盘');
      Logger.info('如需持久化，请在Redis服务器配置文件中手动设置');
      this.persistenceEnabled = true; // 标记为已尝试，避免重复尝试
    }
  }
}