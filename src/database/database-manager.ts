export interface DatabaseInterface {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// 简单的内存数据库实现
export class MemoryDatabase implements DatabaseInterface {
  private data: Map<string, string> = new Map();

  async connect(): Promise<void> {
    // 内存数据库不需要连接
  }

  async disconnect(): Promise<void> {
    // 内存数据库不需要断开连接
  }

  async get(key: string): Promise<string | null> {
    return this.data.get(key) || null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.data.has(key);
  }
}

export class DatabaseManager {
  private static instance: DatabaseManager;
  private database: DatabaseInterface;

  private constructor() {
    // 默认使用内存数据库
    this.database = new MemoryDatabase();
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

  public async connect(): Promise<void> {
    await this.database.connect();
  }

  public async disconnect(): Promise<void> {
    await this.database.disconnect();
  }

  public async get(key: string): Promise<string | null> {
    return await this.database.get(key);
  }

  public async set(key: string, value: string): Promise<void> {
    await this.database.set(key, value);
  }

  public async delete(key: string): Promise<void> {
    await this.database.delete(key);
  }

  public async exists(key: string): Promise<boolean> {
    return await this.database.exists(key);
  }
}