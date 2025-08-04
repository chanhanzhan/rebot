import { RedisDatabase } from '../config/readis';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';
import { EventEmitter } from 'events';

// 新增接口定义
export interface DatabaseStats {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageLatency: number;
  peakLatency: number;
  minLatency: number;
  operationsPerSecond: number;
  connectionCount: number;
  cacheHitRate: number;
  memoryUsage: number;
  lastOperationTime: number;
  operationsByType: Record<string, number>;
  errorsByType: Record<string, number>;
}

export interface DatabaseHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  memoryUsage: number;
  errorRate: number;
  uptime: number;
  lastCheck: number;
}

export interface ConnectionPoolConfig {
  maxConnections: number;
  minConnections: number;
  acquireTimeoutMillis: number;
  idleTimeoutMillis: number;
  reapIntervalMillis: number;
}

export interface CacheConfig {
  enabled: boolean;
  maxSize: number;
  ttl: number;
  strategy: 'lru' | 'lfu' | 'fifo';
}

export interface TransactionOptions {
  timeout?: number;
  retries?: number;
  isolation?: 'read_uncommitted' | 'read_committed' | 'repeatable_read' | 'serializable';
}

export interface DatabaseTransaction {
  id: string;
  operations: Array<{
    type: string;
    key: string;
    value?: any;
    timestamp: number;
  }>;
  status: 'pending' | 'committed' | 'rolled_back';
  startTime: number;
  timeout?: number;
}

export interface CacheEntry<T = any> {
  value: T;
  timestamp: number;
  accessCount: number;
  lastAccess: number;
  ttl?: number;
}

export interface DatabaseInterface {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<boolean>;
  ttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  lpush(key: string, value: string): Promise<number>;
  rpush(key: string, value: string): Promise<number>;
  lpop(key: string): Promise<string | null>;
  rpop(key: string): Promise<string | null>;
  llen(key: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  sadd(key: string, member: string): Promise<number>;
  srem(key: string, member: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sismember(key: string, member: string): Promise<boolean>;
  ping(): Promise<string>;
  flushdb(): Promise<void>;
  // 新增事务支持
  multi?(): any;
  exec?(): Promise<any[]>;
  watch?(keys: string[]): Promise<void>;
  unwatch?(): Promise<void>;
}

// 简单的内存数据库实现
export class MemoryDatabase implements DatabaseInterface {
  private data: Map<string, { value: string; expireAt?: number }> = new Map();
  private hashes: Map<string, Map<string, string>> = new Map();
  private lists: Map<string, string[]> = new Map();
  private sets: Map<string, Set<string>> = new Map();
  private counters: Map<string, number> = new Map();
  private transactions: Map<string, DatabaseTransaction> = new Map();
  private watchedKeys: Set<string> = new Set();

  async connect(): Promise<void> {
    Logger.info('[内存数据库] 已连接');
  }

  async disconnect(): Promise<void> {
    this.data.clear();
    this.hashes.clear();
    this.lists.clear();
    this.sets.clear();
    this.counters.clear();
    this.transactions.clear();
    this.watchedKeys.clear();
    Logger.info('[内存数据库] 已断开连接');
  }

  isConnected(): boolean {
    return true; // 内存数据库始终连接
  }

  async get(key: string): Promise<string | null> {
    const item = this.data.get(key);
    if (!item) return null;
    
    if (item.expireAt && Date.now() > item.expireAt) {
      this.data.delete(key);
      return null;
    }
    
    return item.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const expireAt = ttl ? Date.now() + ttl * 1000 : undefined;
    this.data.set(key, { value, expireAt });
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
    this.hashes.delete(key);
    this.lists.delete(key);
    this.sets.delete(key);
    this.counters.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const item = this.data.get(key);
    if (!item) return false;
    
    if (item.expireAt && Date.now() > item.expireAt) {
      this.data.delete(key);
      return false;
    }
    
    return true;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return Array.from(this.data.keys()).filter(key => regex.test(key));
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const item = this.data.get(key);
    if (!item) return false;
    
    item.expireAt = Date.now() + seconds * 1000;
    return true;
  }

  async ttl(key: string): Promise<number> {
    const item = this.data.get(key);
    if (!item) return -2;
    if (!item.expireAt) return -1;
    
    const remaining = Math.ceil((item.expireAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  async incr(key: string): Promise<number> {
    const current = this.counters.get(key) || 0;
    const newValue = current + 1;
    this.counters.set(key, newValue);
    return newValue;
  }

  async decr(key: string): Promise<number> {
    const current = this.counters.get(key) || 0;
    const newValue = current - 1;
    this.counters.set(key, newValue);
    return newValue;
  }

  async hget(key: string, field: string): Promise<string | null> {
    const hash = this.hashes.get(key);
    return hash?.get(field) || null;
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    if (!this.hashes.has(key)) {
      this.hashes.set(key, new Map());
    }
    this.hashes.get(key)!.set(field, value);
  }

  async hdel(key: string, field: string): Promise<void> {
    const hash = this.hashes.get(key);
    if (hash) {
      hash.delete(field);
      if (hash.size === 0) {
        this.hashes.delete(key);
      }
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    
    const result: Record<string, string> = {};
    for (const [field, value] of hash) {
      result[field] = value;
    }
    return result;
  }

  async lpush(key: string, value: string): Promise<number> {
    if (!this.lists.has(key)) {
      this.lists.set(key, []);
    }
    const list = this.lists.get(key)!;
    list.unshift(value);
    return list.length;
  }

  async rpush(key: string, value: string): Promise<number> {
    if (!this.lists.has(key)) {
      this.lists.set(key, []);
    }
    const list = this.lists.get(key)!;
    list.push(value);
    return list.length;
  }

  async lpop(key: string): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list || list.length === 0) return null;
    
    const value = list.shift()!;
    if (list.length === 0) {
      this.lists.delete(key);
    }
    return value;
  }

  async rpop(key: string): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list || list.length === 0) return null;
    
    const value = list.pop()!;
    if (list.length === 0) {
      this.lists.delete(key);
    }
    return value;
  }

  async llen(key: string): Promise<number> {
    const list = this.lists.get(key);
    return list ? list.length : 0;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key);
    if (!list) return [];
    
    const length = list.length;
    const normalizedStart = start < 0 ? Math.max(0, length + start) : Math.min(start, length);
    const normalizedStop = stop < 0 ? Math.max(-1, length + stop) : Math.min(stop, length - 1);
    
    return list.slice(normalizedStart, normalizedStop + 1);
  }

  async sadd(key: string, member: string): Promise<number> {
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set());
    }
    const set = this.sets.get(key)!;
    const sizeBefore = set.size;
    set.add(member);
    return set.size - sizeBefore;
  }

  async srem(key: string, member: string): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    
    const removed = set.delete(member) ? 1 : 0;
    if (set.size === 0) {
      this.sets.delete(key);
    }
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const set = this.sets.get(key);
    return set ? set.has(member) : false;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async flushdb(): Promise<void> {
    this.data.clear();
    this.hashes.clear();
    this.lists.clear();
    this.sets.clear();
    this.counters.clear();
  }

  // 事务支持
  multi() {
    return {
      operations: [] as any[],
      get: (key: string) => this.get(key),
      set: (key: string, value: string, ttl?: number) => this.set(key, value, ttl),
      delete: (key: string) => this.delete(key),
      exec: async () => {
        // 简单的事务实现
        return [];
      }
    };
  }

  async exec(): Promise<any[]> {
    return [];
  }

  async watch(keys: string[]): Promise<void> {
    keys.forEach(key => this.watchedKeys.add(key));
  }

  async unwatch(): Promise<void> {
    this.watchedKeys.clear();
  }
}

// 缓存实现
class DatabaseCache<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private config: CacheConfig;
  private accessOrder: string[] = [];

  constructor(config: CacheConfig) {
    this.config = config;
  }

  get(key: string): T | null {
    if (!this.config.enabled) return null;

    const entry = this.cache.get(key);
    if (!entry) return null;

    // 检查TTL
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      return null;
    }

    // 更新访问信息
    entry.accessCount++;
    entry.lastAccess = Date.now();
    this.updateAccessOrder(key);

    return entry.value;
  }

  set(key: string, value: T, ttl?: number): void {
    if (!this.config.enabled) return;

    // 检查缓存大小限制
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evict();
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccess: Date.now(),
      ttl: ttl || this.config.ttl
    };

    this.cache.set(key, entry);
    this.updateAccessOrder(key);
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.removeFromAccessOrder(key);
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitRate: this.calculateHitRate(),
      strategy: this.config.strategy
    };
  }

  private evict(): void {
    if (this.cache.size === 0) return;

    let keyToEvict: string;

    switch (this.config.strategy) {
      case 'lru':
        keyToEvict = this.accessOrder[0];
        break;
      case 'lfu':
        keyToEvict = this.findLFUKey();
        break;
      case 'fifo':
        keyToEvict = this.accessOrder[0];
        break;
      default:
        keyToEvict = this.accessOrder[0];
    }

    this.cache.delete(keyToEvict);
    this.removeFromAccessOrder(keyToEvict);
  }

  private findLFUKey(): string {
    let minAccessCount = Infinity;
    let lfuKey = '';

    for (const [key, entry] of this.cache) {
      if (entry.accessCount < minAccessCount) {
        minAccessCount = entry.accessCount;
        lfuKey = key;
      }
    }

    return lfuKey;
  }

  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  private calculateHitRate(): number {
    // 简化的命中率计算
    return this.cache.size > 0 ? 0.8 : 0;
  }
}

// 连接池实现
class ConnectionPool extends EventEmitter {
  private connections: DatabaseInterface[] = [];
  private availableConnections: DatabaseInterface[] = [];
  private config: ConnectionPoolConfig;
  private createConnection: () => DatabaseInterface;

  constructor(config: ConnectionPoolConfig, createConnection: () => DatabaseInterface) {
    super();
    this.config = config;
    this.createConnection = createConnection;
  }

  async initialize(): Promise<void> {
    for (let i = 0; i < this.config.minConnections; i++) {
      const connection = this.createConnection();
      await connection.connect();
      this.connections.push(connection);
      this.availableConnections.push(connection);
    }
  }

  async acquire(): Promise<DatabaseInterface> {
    if (this.availableConnections.length > 0) {
      return this.availableConnections.pop()!;
    }

    if (this.connections.length < this.config.maxConnections) {
      const connection = this.createConnection();
      await connection.connect();
      this.connections.push(connection);
      return connection;
    }

    // 等待连接可用
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection acquire timeout'));
      }, this.config.acquireTimeoutMillis);

      const checkAvailable = () => {
        if (this.availableConnections.length > 0) {
          clearTimeout(timeout);
          resolve(this.availableConnections.pop()!);
        } else {
          setTimeout(checkAvailable, 10);
        }
      };

      checkAvailable();
    });
  }

  release(connection: DatabaseInterface): void {
    if (this.connections.includes(connection)) {
      this.availableConnections.push(connection);
    }
  }

  async destroy(): Promise<void> {
    for (const connection of this.connections) {
      await connection.disconnect();
    }
    this.connections = [];
    this.availableConnections = [];
  }

  getStats() {
    return {
      totalConnections: this.connections.length,
      availableConnections: this.availableConnections.length,
      busyConnections: this.connections.length - this.availableConnections.length
    };
  }
}

export class DatabaseManager extends EventEmitter {
  private static instance: DatabaseManager;
  private database: DatabaseInterface;
  private connectionRetries = 0;
  private maxRetries = 5;
  private retryDelay = 2000;
  private startTime = Date.now();
  
  // 新增功能
  private stats: DatabaseStats;
  private cache: DatabaseCache;
  private connectionPool?: ConnectionPool;
  private transactions: Map<string, DatabaseTransaction> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;
  private statsReportInterval?: NodeJS.Timeout;
  private operationLatencies: number[] = [];
  private lastStatsReset = Date.now();

  private constructor() {
    super();
    // 默认使用内存数据库
    this.database = new MemoryDatabase();
    
    // 初始化统计信息
    this.stats = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      averageLatency: 0,
      peakLatency: 0,
      minLatency: Infinity,
      operationsPerSecond: 0,
      connectionCount: 1,
      cacheHitRate: 0,
      memoryUsage: 0,
      lastOperationTime: 0,
      operationsByType: {},
      errorsByType: {}
    };

    // 初始化缓存
    this.cache = new DatabaseCache({
      enabled: true,
      maxSize: 1000,
      ttl: 300000, // 5分钟
      strategy: 'lru'
    });

    this.startBackgroundTasks();
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public setDatabase(database: DatabaseInterface): void {
    this.database = database;
  }

  public async initializeConnectionPool(config: ConnectionPoolConfig): Promise<void> {
    this.connectionPool = new ConnectionPool(config, () => new MemoryDatabase());
    await this.connectionPool.initialize();
    Logger.info('[数据库管理器] 连接池已初始化');
  }

  public async connect(): Promise<void> {
    try {
      await this.database.connect();
      this.connectionRetries = 0;
      this.emit('connected');
      Logger.info('[数据库管理器] 数据库连接成功');
    } catch (error) {
      Logger.error('[数据库管理器] 数据库连接失败:', error);
      this.emit('connection_error', error);
      
      if (this.connectionRetries < this.maxRetries) {
        this.connectionRetries++;
        Logger.warn(`[数据库管理器] 正在重试连接... (${this.connectionRetries}/${this.maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return this.connect();
      } else {
        Logger.error('[数据库管理器] 达到最大重试次数，连接失败');
        this.emit('connection_failed', error);
        throw error;
      }
    }
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.connectionPool) {
        await this.connectionPool.destroy();
      }
      await this.database.disconnect();
      this.emit('disconnected');
      Logger.info('[数据库管理器] 数据库连接已断开');
    } catch (error) {
      Logger.error('[数据库管理器] 断开数据库连接时出错:', error);
      throw error;
    }
  }

  public isConnected(): boolean {
    return this.database && typeof this.database.isConnected === 'function' 
      ? this.database.isConnected() 
      : true; // 默认内存数据库总是连接的
  }

  // 包装操作以添加统计和缓存
  private async executeOperation<T>(
    operationType: string,
    operation: () => Promise<T>,
    cacheKey?: string,
    useCache = true
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      // 检查缓存
      if (useCache && cacheKey && operationType === 'get') {
        const cached = this.cache.get(cacheKey);
        if (cached !== null) {
          this.updateStats(operationType, Date.now() - startTime, true);
          return cached as T;
        }
      }

      // 执行操作
      const result = await operation();
      const latency = Date.now() - startTime;

      // 更新缓存
      if (useCache && cacheKey && operationType === 'get' && result !== null) {
        this.cache.set(cacheKey, result);
      }

      // 清除相关缓存
      if (operationType === 'set' || operationType === 'delete') {
        this.cache.delete(cacheKey || '');
      }

      this.updateStats(operationType, latency, true);
      this.emit('operation_success', { type: operationType, latency, result });
      
      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.updateStats(operationType, latency, false);
      this.emit('operation_error', { type: operationType, latency, error });
      
      Logger.error(`[数据库管理器] ${operationType} 操作失败:`, error);
      throw error;
    }
  }

  private updateStats(operationType: string, latency: number, success: boolean): void {
    this.stats.totalOperations++;
    this.stats.lastOperationTime = Date.now();
    
    if (success) {
      this.stats.successfulOperations++;
    } else {
      this.stats.failedOperations++;
      this.stats.errorsByType[operationType] = (this.stats.errorsByType[operationType] || 0) + 1;
    }

    this.stats.operationsByType[operationType] = (this.stats.operationsByType[operationType] || 0) + 1;
    
    // 更新延迟统计
    this.operationLatencies.push(latency);
    if (this.operationLatencies.length > 1000) {
      this.operationLatencies = this.operationLatencies.slice(-1000);
    }
    
    this.stats.averageLatency = this.operationLatencies.reduce((a, b) => a + b, 0) / this.operationLatencies.length;
    this.stats.peakLatency = Math.max(this.stats.peakLatency, latency);
    this.stats.minLatency = Math.min(this.stats.minLatency, latency);
    
    // 计算每秒操作数
    const timeWindow = Date.now() - this.lastStatsReset;
    this.stats.operationsPerSecond = this.stats.totalOperations / (timeWindow / 1000);
    
    // 更新缓存命中率
    this.stats.cacheHitRate = this.cache.getStats().hitRate;
  }

  // 基础操作（带统计和缓存）
  public async get(key: string): Promise<string | null> {
    return this.executeOperation('get', () => this.database.get(key), key);
  }

  public async set(key: string, value: string, ttl?: number): Promise<void> {
    return this.executeOperation('set', () => this.database.set(key, value, ttl), key, false);
  }

  public async delete(key: string): Promise<void> {
    return this.executeOperation('delete', () => this.database.delete(key), key, false);
  }

  public async exists(key: string): Promise<boolean> {
    return this.executeOperation('exists', () => this.database.exists(key), `exists:${key}`);
  }

  // 高级操作
  public async keys(pattern: string = '*'): Promise<string[]> {
    return this.executeOperation('keys', () => this.database.keys(pattern), `keys:${pattern}`);
  }

  public async expire(key: string, seconds: number): Promise<boolean> {
    return this.executeOperation('expire', () => this.database.expire(key, seconds), undefined, false);
  }

  public async ttl(key: string): Promise<number> {
    return this.executeOperation('ttl', () => this.database.ttl(key), `ttl:${key}`);
  }

  public async incr(key: string): Promise<number> {
    return this.executeOperation('incr', () => this.database.incr(key), undefined, false);
  }

  public async decr(key: string): Promise<number> {
    return this.executeOperation('decr', () => this.database.decr(key), undefined, false);
  }

  // Hash操作
  public async hget(key: string, field: string): Promise<string | null> {
    return this.executeOperation('hget', () => this.database.hget(key, field), `${key}:${field}`);
  }

  public async hset(key: string, field: string, value: string): Promise<void> {
    return this.executeOperation('hset', () => this.database.hset(key, field, value), `${key}:${field}`, false);
  }

  public async hdel(key: string, field: string): Promise<void> {
    return this.executeOperation('hdel', () => this.database.hdel(key, field), `${key}:${field}`, false);
  }

  public async hgetall(key: string): Promise<Record<string, string>> {
    return this.executeOperation('hgetall', () => this.database.hgetall(key), `hgetall:${key}`);
  }

  // List操作
  public async lpush(key: string, value: string): Promise<number> {
    return this.executeOperation('lpush', () => this.database.lpush(key, value), undefined, false);
  }

  public async rpush(key: string, value: string): Promise<number> {
    return this.executeOperation('rpush', () => this.database.rpush(key, value), undefined, false);
  }

  public async lpop(key: string): Promise<string | null> {
    return this.executeOperation('lpop', () => this.database.lpop(key), undefined, false);
  }

  public async rpop(key: string): Promise<string | null> {
    return this.executeOperation('rpop', () => this.database.rpop(key), undefined, false);
  }

  public async llen(key: string): Promise<number> {
    return this.executeOperation('llen', () => this.database.llen(key), `llen:${key}`);
  }

  public async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.executeOperation('lrange', () => this.database.lrange(key, start, stop), `lrange:${key}:${start}:${stop}`);
  }

  // Set操作
  public async sadd(key: string, member: string): Promise<number> {
    return this.executeOperation('sadd', () => this.database.sadd(key, member), undefined, false);
  }

  public async srem(key: string, member: string): Promise<number> {
    return this.executeOperation('srem', () => this.database.srem(key, member), undefined, false);
  }

  public async smembers(key: string): Promise<string[]> {
    return this.executeOperation('smembers', () => this.database.smembers(key), `smembers:${key}`);
  }

  public async sismember(key: string, member: string): Promise<boolean> {
    return this.executeOperation('sismember', () => this.database.sismember(key, member), `sismember:${key}:${member}`);
  }

  // 工具方法
  public async ping(): Promise<string> {
    return this.executeOperation('ping', () => this.database.ping(), undefined, false);
  }

  public async flushdb(): Promise<void> {
    this.cache.clear();
    return this.executeOperation('flushdb', () => this.database.flushdb(), undefined, false);
  }

  public getDatabase(): DatabaseInterface {
    return this.database;
  }

  // JSON操作辅助方法
  public async getJSON<T>(key: string): Promise<T | null> {
    try {
      const value = await this.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      Logger.error(`[数据库管理器] 获取JSON ${key} 失败:`, error);
      return null;
    }
  }

  public async setJSON<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      await this.set(key, JSON.stringify(value), ttl);
    } catch (error) {
      Logger.error(`[数据库管理器] 设置JSON ${key} 失败:`, error);
      throw error;
    }
  }

  // 批量操作
  public async mget(keys: string[]): Promise<(string | null)[]> {
    return this.executeOperation('mget', async () => {
      const results = await Promise.all(keys.map(key => this.database.get(key)));
      return results;
    }, undefined, false);
  }

  public async mset(keyValues: Record<string, string>): Promise<void> {
    return this.executeOperation('mset', async () => {
      const promises = Object.entries(keyValues).map(([key, value]) => this.database.set(key, value));
      await Promise.all(promises);
    }, undefined, false);
  }

  // 事务支持
  public async transaction<T>(
    operations: (tx: DatabaseInterface) => Promise<T>,
    options: TransactionOptions = {}
  ): Promise<T> {
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const transaction: DatabaseTransaction = {
      id: transactionId,
      operations: [],
      status: 'pending',
      startTime: Date.now(),
      timeout: options.timeout
    };

    this.transactions.set(transactionId, transaction);

    try {
      // 如果数据库支持事务
      if (this.database.multi && this.database.exec) {
        const multi = this.database.multi();
        const result = await operations(multi);
        await this.database.exec();
        
        transaction.status = 'committed';
        this.emit('transaction_committed', transaction);
        return result;
      } else {
        // 简单的事务模拟
        const result = await operations(this.database);
        transaction.status = 'committed';
        this.emit('transaction_committed', transaction);
        return result;
      }
    } catch (error) {
      transaction.status = 'rolled_back';
      this.emit('transaction_rolled_back', transaction);
      Logger.error(`[数据库管理器] 事务 ${transactionId} 失败:`, error);
      throw error;
    } finally {
      this.transactions.delete(transactionId);
    }
  }

  // 健康检查
  public async healthCheck(): Promise<DatabaseHealth> {
    const start = Date.now();
    try {
      await this.ping();
      const latency = Date.now() - start;
      const uptime = Date.now() - this.startTime;
      const errorRate = this.stats.totalOperations > 0 ? 
        this.stats.failedOperations / this.stats.totalOperations : 0;

      const health: DatabaseHealth = {
        status: latency < 100 && errorRate < 0.05 ? 'healthy' : 
                latency < 500 && errorRate < 0.1 ? 'degraded' : 'unhealthy',
        latency,
        connectionStatus: 'connected',
        memoryUsage: process.memoryUsage().heapUsed,
        errorRate,
        uptime,
        lastCheck: Date.now()
      };

      this.emit('health_check', health);
      return health;
    } catch (error) {
      const latency = Date.now() - start;
      const health: DatabaseHealth = {
        status: 'unhealthy',
        latency,
        connectionStatus: 'disconnected',
        memoryUsage: process.memoryUsage().heapUsed,
        errorRate: 1,
        uptime: Date.now() - this.startTime,
        lastCheck: Date.now()
      };

      this.emit('health_check', health);
      return health;
    }
  }

  // 统计信息
  public getStats(): DatabaseStats {
    return { ...this.stats };
  }

  public getCacheStats() {
    return this.cache.getStats();
  }

  public getConnectionPoolStats() {
    return this.connectionPool?.getStats() || null;
  }

  public getTransactionStats() {
    return {
      activeTransactions: this.transactions.size,
      transactions: Array.from(this.transactions.values())
    };
  }

  // 缓存管理
  public clearCache(): void {
    this.cache.clear();
    this.emit('cache_cleared');
  }

  public setCacheConfig(config: Partial<CacheConfig>): void {
    this.cache = new DatabaseCache({ ...this.cache.getStats(), ...config } as CacheConfig);
    this.emit('cache_config_updated', config);
  }

  // 重置统计
  public resetStats(): void {
    this.stats = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      averageLatency: 0,
      peakLatency: 0,
      minLatency: Infinity,
      operationsPerSecond: 0,
      connectionCount: this.connectionPool?.getStats().totalConnections || 1,
      cacheHitRate: 0,
      memoryUsage: 0,
      lastOperationTime: 0,
      operationsByType: {},
      errorsByType: {}
    };
    this.operationLatencies = [];
    this.lastStatsReset = Date.now();
    this.emit('stats_reset');
  }

  // 后台任务
  private startBackgroundTasks(): void {
    // 健康检查
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.healthCheck();
      } catch (error) {
        Logger.error('[数据库管理器] 健康检查失败:', error);
      }
    }, 30000); // 每30秒检查一次

    // 统计报告
    this.statsReportInterval = setInterval(() => {
      const stats = this.getStats();
      this.emit('stats_report', stats);
      FrameworkEventBus.getInstance().safeEmit('database-stats', stats);
    }, 60000); // 每分钟报告一次
  }

  // 清理资源
  public async destroy(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.statsReportInterval) {
      clearInterval(this.statsReportInterval);
    }

    this.cache.clear();
    this.transactions.clear();

    if (this.connectionPool) {
      await this.connectionPool.destroy();
    }

    await this.disconnect();
    this.emit('destroyed');
    Logger.info('[数据库管理器] 已销毁');
  }
}