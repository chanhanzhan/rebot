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

  constructor(config: RedisConfig) {
    this.config = config;
    if (!fs.existsSync(this.rdbDir)) {
      fs.mkdirSync(this.rdbDir, { recursive: true });
    }
  }

  public async connect(): Promise<void> {
    try {
      Logger.info(`Connecting to Redis at ${this.config.host}:${this.config.port}`);
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        db: this.config.db,
        retryStrategy: (times) => {
          Logger.warn(`Redis连接丢失，正在自动重连...（第${times}次）`);
          return Math.min(times * 100, 2000);
        },
        reconnectOnError: (err) => {
          Logger.error('Redis reconnectOnError:', err);
          return true;
        },
        lazyConnect: false,
      });
      this.client.on('connect', () => {
        this.connected = true;
        Logger.info('Connected to Redis successfully');
        this.enableRDBPersistence();
      });
      this.client.on('error', (err) => {
        this.connected = false;
        Logger.error('Redis connection error:', err);
        if (!this.reconnecting) {
          this.reconnecting = true;
          setTimeout(() => this.tryRestartRedis(), 2000);
        }
      });
      this.client.on('end', () => {
        this.connected = false;
        Logger.warn('Redis连接已断开');
      });
      await this.client.connect();
    } catch (error) {
      Logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
      Logger.info('Disconnected from Redis');
    }
  }

  public async get(key: string): Promise<string | null> {
    if (!this.client) throw new Error('Redis is not connected');
    return await this.client.get(key);
  }
  public async set(key: string, value: string): Promise<void> {
    if (!this.client) throw new Error('Redis is not connected');
    await this.client.set(key, value);
  }
  public async delete(key: string): Promise<void> {
    if (!this.client) throw new Error('Redis is not connected');
    await this.client.del(key);
  }
  public async exists(key: string): Promise<boolean> {
    if (!this.client) throw new Error('Redis is not connected');
    return (await this.client.exists(key)) > 0;
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
      if (fs.existsSync(redisExe)) {
        cmd = `start "" "${redisExe}" --dir ${this.rdbDir} --dbfilename dump.rdb`;
      } else {
        Logger.error('未找到 redis-server.exe，无法自动重启 Redis');
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
    if (!this.client) return;
    try {
      await this.client.config('SET', 'dir', this.rdbDir);
      await this.client.config('SET', 'dbfilename', 'dump.rdb');
      await this.client.config('SET', 'save', '900 1 300 10 60 10000'); // 常规RDB策略
      Logger.info('Redis RDB持久化已启用，数据目录:', this.rdbDir);
    } catch (e) {
      Logger.error('设置Redis持久化参数失败:', e);
    }
  }
}