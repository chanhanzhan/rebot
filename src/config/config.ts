import { Logger } from './log';
import { FrameworkEventBus } from '../common/event-bus';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import * as chokidar from 'chokidar';
import { defaultValidationRules } from './validation-rules';

// 配置验证规则
export interface ConfigValidationRule {
  path: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  default?: any;
  validator?: (value: any) => boolean | string;
  description?: string;
}

// 配置模板
export interface ConfigTemplate {
  name: string;
  description: string;
  version: string;
  config: any;
  createdAt: string;
  author: string;
}

// 配置变更历史
export interface ConfigChange {
  timestamp: number;
  path: string;
  oldValue: any;
  newValue: any;
  source: 'file' | 'api' | 'env' | 'default';
  user?: string;
}

// 配置环境
export type ConfigEnvironment = 'development' | 'production' | 'testing' | 'staging';

// 配置源
export interface ConfigSource {
  name: string;
  type: 'file' | 'env' | 'remote' | 'database';
  priority: number;
  path?: string;
  url?: string;
  enabled: boolean;
}

// 配置监控
export interface ConfigMonitor {
  enabled: boolean;
  checkInterval: number;
  alertOnChange: boolean;
  backupOnChange: boolean;
  maxBackups: number;
}

// 扩展的机器人配置接口
export interface BotConfig {
  name: string;
  version: string;
  environment: ConfigEnvironment;
  
  // HTTP服务配置
  http?: {
    enabled: boolean;
    port: number;
    host: string;
    cors?: {
      enabled: boolean;
      origins: string[];
    };
  };
  
  // 适配器配置
  adapters: {
    [key: string]: any;
  };
  
  // 数据库配置
  database: {
    type: 'sqlite' | 'redis' | 'mongodb' | 'mysql' | 'postgresql';
    sqlite?: {
      path: string;
      options?: any;
    };
    redis?: {
      host: string;
      port: number;
      password?: string;
      db?: number;
      cluster?: boolean;
      nodes?: string[];
    };
    mongodb?: {
      url: string;
      database: string;
      options?: any;
    };
    mysql?: {
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
      options?: any;
    };
    postgresql?: {
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
      options?: any;
    };
  };
  
  // 插件配置
  plugins: {
    directory: string;
    autoLoad: boolean;
    hotReload: boolean;
    whitelist?: string[];
    blacklist?: string[];
    loadOrder?: string[];
  };
  
  // 日志配置
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: {
      enabled: boolean;
      path: string;
      maxSize: string;
      maxFiles: number;
    };
    console?: {
      enabled: boolean;
      colorize: boolean;
    };
  };
  
  // 安全配置
  security: {
    encryption: {
      enabled: boolean;
      algorithm: string;
      key?: string;
    };
    rateLimit: {
      enabled: boolean;
      windowMs: number;
      maxRequests: number;
    };
    cors: {
      enabled: boolean;
      origins: string[];
      methods: string[];
    };
  };
  
  // 性能配置
  performance: {
    maxConcurrentTasks: number;
    taskTimeout: number;
    memoryLimit: string;
    cpuLimit: number;
  };
  
  // 监控配置
  monitoring: {
    enabled: boolean;
    metrics: {
      enabled: boolean;
      interval: number;
      retention: number;
    };
    health: {
      enabled: boolean;
      interval: number;
      endpoints: string[];
    };
    alerts: {
      enabled: boolean;
      channels: string[];
      thresholds: {
        [key: string]: number;
      };
    };
  };
  
  // 自定义配置
  custom?: {
    [key: string]: any;
  };
  
  // 消息处理器配置
  messageHandlers?: {
    [key: string]: any;
  };
}

// 配置管理器类
export class ConfigManager {
  private static instance: ConfigManager;
  private config: BotConfig;
  private configSources: Map<string, ConfigSource> = new Map();
  private validationRules: Map<string, ConfigValidationRule> = new Map();
  private configTemplates: Map<string, ConfigTemplate> = new Map();
  private changeHistory: ConfigChange[] = [];
  private configBackups: Map<string, BotConfig> = new Map();
  private eventBus: FrameworkEventBus;
  private configWatcher: chokidar.FSWatcher | null = null;
  private monitorInterval: NodeJS.Timeout | null = null;
  private configPath: string;
  private environment: ConfigEnvironment;

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
    this.environment = (process.env.NODE_ENV as ConfigEnvironment) || 'development';
    this.configPath = process.env.CONFIG_PATH || './config';
    this.config = this.getDefaultConfig();
    this.initializeValidationRules();
    this.setupEventListeners();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  // 初始化验证规则
  private initializeValidationRules(): void {
    for (const rule of defaultValidationRules) {
      this.validationRules.set(rule.path, rule);
    }
  }

  // 设置事件监听器
  private setupEventListeners(): void {
    this.eventBus.on('config-update-request', (data: any) => {
      this.updateConfig(data.updates, data.source, data.user);
    });

    this.eventBus.on('config-reload-request', () => {
      this.reload();
    });

    this.eventBus.on('config-backup-request', (data: any) => {
      this.createBackup(data.name);
    });

    this.eventBus.on('config-restore-request', (data: any) => {
      this.restoreBackup(data.name);
    });
  }

  // 初始化配置
  public async initialize(): Promise<void> {
    try {
      Logger.info('开始初始化配置管理器');
      
      // 创建配置目录
      await this.ensureConfigDirectories();
      
      // 加载配置源
      await this.loadConfigSources();
      
      // 加载配置
      await this.loadConfiguration();
      
      // 验证配置
      this.validateConfiguration();
      
      // 启动监控
      this.startMonitoring();
      
      Logger.info('配置管理器初始化完成');
    } catch (error) {
      Logger.error('配置管理器初始化失败:', error);
      throw error;
    }
  }

  // 确保配置目录存在
  private async ensureConfigDirectories(): Promise<void> {
    const directories = [
      this.configPath,
      path.join(this.configPath, 'backups'),
      path.join(this.configPath, 'templates'),
      path.join(this.configPath, 'environments')
    ];

    for (const dir of directories) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        Logger.debug(`创建配置目录: ${dir}`);
      }
    }
  }

  // 加载配置源
  private async loadConfigSources(): Promise<void> {
    // 默认配置源
    const defaultSources: ConfigSource[] = [
      {
        name: 'environment',
        type: 'env',
        priority: 1,
        enabled: true
      },
      {
        name: 'config-file',
        type: 'file',
        priority: 2,
        path: path.join(this.configPath, `${this.environment}.yaml`),
        enabled: true
      },
      {
        name: 'default-config',
        type: 'file',
        priority: 3,
        path: path.join(this.configPath, 'default.yaml'),
        enabled: true
      }
    ];

    // 如果配置了数据库，添加数据库配置源
    if (process.env.DATABASE_TYPE) {
      defaultSources.push({
        name: 'database',
        type: 'database',
        priority: 0,
        enabled: true
      });
    }

    for (const source of defaultSources) {
      this.configSources.set(source.name, source);
    }

    Logger.debug(`加载了 ${this.configSources.size} 个配置源`);
  }

  // 加载配置
  private async loadConfiguration(): Promise<void> {
    let mergedConfig = this.getDefaultConfig();
    
    // 按优先级排序配置源
    const sortedSources = Array.from(this.configSources.values())
      .filter(source => source.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const source of sortedSources) {
      try {
        let sourceConfig: any = {};
        
        switch (source.type) {
          case 'file':
            sourceConfig = await this.loadConfigFromFile(source.path!);
            break;
          case 'env':
            sourceConfig = this.loadConfigFromEnv();
            break;
          case 'database':
            sourceConfig = await this.loadConfigFromDatabase();
            break;
          case 'remote':
            sourceConfig = await this.loadConfigFromRemote(source.url!);
            break;
        }

        if (sourceConfig && Object.keys(sourceConfig).length > 0) {
          mergedConfig = this.deepMerge(mergedConfig, sourceConfig);
          Logger.debug(`从 ${source.name} 加载配置成功`);
        }
      } catch (error) {
        Logger.warn(`从 ${source.name} 加载配置失败:`, error);
      }
    }

    this.config = mergedConfig;
  }

  // 从文件加载配置
  private async loadConfigFromFile(filePath: string): Promise<any> {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.yaml':
      case '.yml':
        return YAML.parse(content) as any;
      case '.json':
        return JSON.parse(content);
      default:
        throw new Error(`不支持的配置文件格式: ${ext}`);
    }
  }

  // 从环境变量加载配置
  private loadConfigFromEnv(): any {
    const envConfig: any = {};
    
    // 映射环境变量到配置路径
    const envMappings = {
      'BOT_NAME': 'name',
      'BOT_VERSION': 'version',
      'NODE_ENV': 'environment',
      'DATABASE_TYPE': 'database.type',
      'DATABASE_HOST': 'database.host',
      'DATABASE_PORT': 'database.port',
      'DATABASE_USER': 'database.user',
      'DATABASE_PASSWORD': 'database.password',
      'DATABASE_NAME': 'database.database',
      'REDIS_HOST': 'database.redis.host',
      'REDIS_PORT': 'database.redis.port',
      'REDIS_PASSWORD': 'database.redis.password',
      'REDIS_DB': 'database.redis.db',
      'LOG_LEVEL': 'logging.level',
      'PLUGIN_DIR': 'plugins.directory',
      'PLUGIN_AUTO_LOAD': 'plugins.autoLoad',
      'PLUGIN_HOT_RELOAD': 'plugins.hotReload'
    };

    for (const [envKey, configPath] of Object.entries(envMappings)) {
      const envValue = process.env[envKey];
      if (envValue !== undefined) {
        this.setNestedValue(envConfig, configPath, this.parseEnvValue(envValue));
      }
    }

    return envConfig;
  }

  // 从数据库加载配置
  private async loadConfigFromDatabase(): Promise<any> {
    const dbType = process.env.DATABASE_TYPE;
    
    switch (dbType) {
      case 'redis':
        return this.loadConfigFromRedis();
      case 'mongodb':
        return this.loadConfigFromMongoDB();
      case 'mysql':
      case 'postgresql':
        return this.loadConfigFromSQL();
      default:
        return {};
    }
  }

  // 从Redis加载配置
  private async loadConfigFromRedis(): Promise<any> {
    try {
      const redis = require('redis');
      const client = redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0')
      });

      await client.connect();
      const configData = await client.get('bot:config');
      await client.quit();

      return configData ? JSON.parse(configData) : {};
    } catch (error) {
      Logger.warn('从Redis加载配置失败:', error);
      return {};
    }
  }

  // 从MongoDB加载配置
  private async loadConfigFromMongoDB(): Promise<any> {
    // MongoDB配置加载实现
    return {};
  }

  // 从SQL数据库加载配置
  private async loadConfigFromSQL(): Promise<any> {
    // SQL数据库配置加载实现
    return {};
  }

  // 从远程URL加载配置
  private async loadConfigFromRemote(url: string): Promise<any> {
    // 远程配置加载实现
    return {};
  }

  // 解析环境变量值
  private parseEnvValue(value: string): any {
    // 尝试解析为数字
    if (/^\d+$/.test(value)) {
      return parseInt(value);
    }
    
    // 尝试解析为浮点数
    if (/^\d+\.\d+$/.test(value)) {
      return parseFloat(value);
    }
    
    // 尝试解析为布尔值
    if (value.toLowerCase() === 'true') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
    
    // 尝试解析为JSON
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        return JSON.parse(value);
      } catch {
        // 解析失败，返回原字符串
      }
    }
    
    return value;
  }

  // 验证配置
  private validateConfiguration(): void {
    const errors: string[] = [];
    
    for (const [path, rule] of this.validationRules) {
      const value = this.getNestedValue(this.config, path);
      
      // 检查必需字段
      if (rule.required && (value === undefined || value === null)) {
        errors.push(`必需配置项缺失: ${path}`);
        continue;
      }
      
      // 如果值不存在且有默认值，设置默认值
      if (value === undefined && rule.default !== undefined) {
        this.setNestedValue(this.config, path, rule.default);
        continue;
      }
      
      // 跳过未定义的可选字段
      if (value === undefined) {
        continue;
      }
      
      // 类型验证
      if (!this.validateType(value, rule.type)) {
        errors.push(`配置项类型错误: ${path} 应为 ${rule.type}`);
        continue;
      }
      
      // 自定义验证器
      if (rule.validator) {
        const result = rule.validator(value);
        if (result !== true) {
          errors.push(`配置项验证失败: ${path} - ${result}`);
        }
      }
    }
    
    if (errors.length > 0) {
      throw new Error(`配置验证失败:\n${errors.join('\n')}`);
    }
    
    Logger.debug('配置验证通过');
  }

  // 类型验证
  private validateType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return true;
    }
  }

  // 启动监控
  private startMonitoring(): void {
    // 文件监控
    if (this.configSources.has('config-file')) {
      const configFile = this.configSources.get('config-file')!.path!;
      if (fs.existsSync(configFile)) {
        this.configWatcher = chokidar.watch(configFile);
        this.configWatcher.on('change', () => {
          Logger.info('检测到配置文件变更，重新加载配置');
          this.reload();
        });
      }
    }

    // 定期检查
    this.monitorInterval = setInterval(() => {
      this.checkConfigHealth();
    }, 60000); // 每分钟检查一次

    Logger.debug('配置监控已启动');
  }

  // 检查配置健康状态
  private checkConfigHealth(): void {
    try {
      this.validateConfiguration();
      this.eventBus.emit('config-health-check', { status: 'healthy', timestamp: Date.now() });
    } catch (error) {
      Logger.warn('配置健康检查失败:', error);
      this.eventBus.emit('config-health-check', { 
        status: 'unhealthy', 
        error: error instanceof Error ? error.message : String(error), 
        timestamp: Date.now() 
      });
    }
  }

  // 获取配置值
  public get(path: string): any {
    return this.getNestedValue(this.config, path);
  }

  // 设置配置值
  public set(path: string, value: any, source: string = 'api', user?: string): void {
    const oldValue = this.getNestedValue(this.config, path);
    this.setNestedValue(this.config, path, value);
    
    // 记录变更
    this.recordConfigChange(source, oldValue, value, user);
    
    // 验证配置
    try {
      this.validateConfiguration();
    } catch (error) {
      // 回滚变更
      this.setNestedValue(this.config, path, oldValue);
      throw error;
    }
    
    // 发送变更事件
    this.eventBus.emit('config-changed', {
      path,
      oldValue,
      newValue: value,
      source,
      user,
      timestamp: Date.now()
    });
    
    Logger.debug(`配置已更新: ${path}`);
  }

  // 获取完整配置
  public getConfig(): BotConfig {
    return JSON.parse(JSON.stringify(this.config));
  }

  // 更新配置
  public updateConfig(updates: Partial<BotConfig>, source: string = 'api', user?: string): void {
    const oldConfig = this.getConfig();
    
    try {
      // 应用更新
      this.config = this.deepMerge(this.config, updates);
      
      // 验证配置
      this.validateConfiguration();
      
      // 记录变更
      this.recordConfigChange(source, oldConfig, this.config, user);
      
      // 发送变更事件
      this.eventBus.emit('config-updated', {
        oldConfig,
        newConfig: this.config,
        updates,
        source,
        user,
        timestamp: Date.now()
      });
      
      Logger.info('配置已更新');
    } catch (error) {
      // 回滚配置
      this.config = oldConfig;
      throw error;
    }
  }

  // 重新加载配置
  public async reload(): Promise<void> {
    try {
      const oldConfig = this.getConfig();
      await this.loadConfiguration();
      this.validateConfiguration();
      
      this.eventBus.emit('config-reloaded', {
        oldConfig,
        newConfig: this.config,
        timestamp: Date.now()
      });
      
      Logger.info('配置已重新加载');
    } catch (error) {
      Logger.error('重新加载配置失败:', error);
      throw error;
    }
  }

  // 保存配置到文件
  public async saveToFile(filePath?: string): Promise<void> {
    const targetPath = filePath || path.join(this.configPath, `${this.environment}.yaml`);
    const configYaml = YAML.stringify(this.config, { indent: 2 });
    
    fs.writeFileSync(targetPath, configYaml, 'utf8');
    Logger.info(`配置已保存到: ${targetPath}`);
  }

  // 创建配置备份
  public createBackup(name?: string): string {
    const backupName = name || `backup_${Date.now()}`;
    const backupConfig = this.getConfig();
    
    this.configBackups.set(backupName, backupConfig);
    
    // 保存到文件
    const backupPath = path.join(this.configPath, 'backups', `${backupName}.yaml`);
    const configYaml = YAML.stringify(backupConfig, { indent: 2 });
    fs.writeFileSync(backupPath, configYaml, 'utf8');
    
    Logger.info(`配置备份已创建: ${backupName}`);
    return backupName;
  }

  // 恢复配置备份
  public restoreBackup(name: string): void {
    const backupConfig = this.configBackups.get(name);
    if (!backupConfig) {
      // 尝试从文件加载
      const backupPath = path.join(this.configPath, 'backups', `${name}.yaml`);
      if (fs.existsSync(backupPath)) {
        const content = fs.readFileSync(backupPath, 'utf8');
        const restoredConfig = YAML.parse(content) as BotConfig;
        this.updateConfig(restoredConfig, 'backup-restore');
        Logger.info(`从文件恢复配置备份: ${name}`);
        return;
      }
      throw new Error(`配置备份不存在: ${name}`);
    }
    
    this.updateConfig(backupConfig, 'backup-restore');
    Logger.info(`配置备份已恢复: ${name}`);
  }

  // 获取配置备份列表
  public getBackups(): string[] {
    const memoryBackups = Array.from(this.configBackups.keys());
    const fileBackups: string[] = [];
    
    const backupDir = path.join(this.configPath, 'backups');
    if (fs.existsSync(backupDir)) {
      const files = fs.readdirSync(backupDir);
      for (const file of files) {
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          fileBackups.push(path.basename(file, path.extname(file)));
        }
      }
    }
    
    return [...new Set([...memoryBackups, ...fileBackups])];
  }

  // 添加验证规则
  public addValidationRule(rule: ConfigValidationRule): void {
    this.validationRules.set(rule.path, rule);
    Logger.debug(`添加验证规则: ${rule.path}`);
  }

  // 移除验证规则
  public removeValidationRule(path: string): void {
    this.validationRules.delete(path);
    Logger.debug(`移除验证规则: ${path}`);
  }

  // 获取验证规则
  public getValidationRules(): ConfigValidationRule[] {
    return Array.from(this.validationRules.values());
  }

  // 添加配置模板
  public addTemplate(template: ConfigTemplate): void {
    this.configTemplates.set(template.name, template);
    
    // 保存到文件
    const templatePath = path.join(this.configPath, 'templates', `${template.name}.yaml`);
    const templateYaml = YAML.stringify(template, { indent: 2 });
    fs.writeFileSync(templatePath, templateYaml, 'utf8');
    
    Logger.info(`配置模板已添加: ${template.name}`);
  }

  // 应用配置模板
  public applyTemplate(name: string): void {
    const template = this.configTemplates.get(name);
    if (!template) {
      throw new Error(`配置模板不存在: ${name}`);
    }
    
    this.updateConfig(template.config, 'template');
    Logger.info(`配置模板已应用: ${name}`);
  }

  // 获取配置模板列表
  public getTemplates(): ConfigTemplate[] {
    return Array.from(this.configTemplates.values());
  }

  // 获取变更历史
  public getChangeHistory(limit?: number): ConfigChange[] {
    const history = [...this.changeHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  // 获取配置统计信息
  public getStats(): any {
    return {
      configSize: JSON.stringify(this.config).length,
      sourceCount: this.configSources.size,
      ruleCount: this.validationRules.size,
      templateCount: this.configTemplates.size,
      changeCount: this.changeHistory.length,
      backupCount: this.configBackups.size,
      environment: this.environment,
      lastModified: this.changeHistory.length > 0 ? 
        this.changeHistory[this.changeHistory.length - 1].timestamp : null
    };
  }

  // 导出配置
  public exportConfig(format: 'json' | 'yaml' = 'yaml'): string {
    switch (format) {
      case 'json':
        return JSON.stringify(this.config, null, 2);
      case 'yaml':
        return YAML.stringify(this.config, { indent: 2 });
      default:
        throw new Error(`不支持的导出格式: ${format}`);
    }
  }

  // 导出配置（别名方法）
  public export(format: 'json' | 'yaml' = 'yaml'): string {
    return this.exportConfig(format);
  }

  // 保存配置到文件
  public save(filePath?: string): void {
    const targetPath = filePath || this.configPath;
    try {
      const configData = this.exportConfig('yaml');
      fs.writeFileSync(targetPath, configData, 'utf8');
      Logger.info(`配置已保存到: ${targetPath}`);
    } catch (error) {
      Logger.error('保存配置失败:', error);
      throw error;
    }
  }

  // 导入配置（别名方法）
  public import(data: string, format: 'json' | 'yaml' = 'yaml'): void {
    return this.importConfig(data, format);
  }

  // 列出备份（别名方法）
  public listBackups(): string[] {
    return this.getBackups();
  }

  // 获取模板（别名方法）
  public getTemplate(name: string): ConfigTemplate | undefined {
    return this.configTemplates.get(name);
  }

  // 创建模板（别名方法）
  public createTemplate(name: string, description: string, template: any): void {
    const configTemplate: ConfigTemplate = {
      name,
      description,
      config: template,
      version: '1.0.0',
      author: 'system',
      createdAt: new Date().toISOString()
    };
    this.configTemplates.set(name, configTemplate);
    Logger.info(`配置模板已创建: ${name}`);
  }

  // 更新配置（别名方法）
  public update(updates: any): void {
    this.updateConfig(updates, 'update');
  }

  // 列出模板（别名方法）
  public listTemplates(): ConfigTemplate[] {
    return this.getTemplates();
  }

  // 从备份恢复（别名方法）
  public restoreFromBackup(backupId: string): void {
    return this.restoreBackup(backupId);
  }

  // 备份配置（别名方法）
  public backupConfiguration(): string {
    return this.createBackup();
  }

  // 导入配置
  public importConfig(data: string, format: 'json' | 'yaml' = 'yaml'): void {
    let importedConfig: any;
    
    try {
      switch (format) {
        case 'json':
          importedConfig = JSON.parse(data);
          break;
        case 'yaml':
          importedConfig = YAML.parse(data);
          break;
        default:
          throw new Error(`不支持的导入格式: ${format}`);
      }
      
      // 验证导入的配置
      this.validateConfigurationObject(importedConfig);
      
      // 应用配置
      this.updateConfig(importedConfig, 'import');
      
      Logger.info('配置导入成功');
    } catch (error) {
      Logger.error('配置导入失败:', error);
      throw error;
    }
  }

  // 重置配置为默认值
  public resetToDefault(): void {
    const defaultConfig = this.getDefaultConfig();
    this.updateConfig(defaultConfig, 'reset');
    Logger.info('配置已重置为默认值');
  }

  // 获取配置差异
  public getDiff(otherConfig: BotConfig): any {
    // 简单的差异比较实现
    const diff: any = {};
    
    const compare = (obj1: any, obj2: any, path: string = '') => {
      for (const key in obj1) {
        const currentPath = path ? `${path}.${key}` : key;
        
        if (!(key in obj2)) {
          diff[currentPath] = { type: 'removed', value: obj1[key] };
        } else if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
          compare(obj1[key], obj2[key], currentPath);
        } else if (obj1[key] !== obj2[key]) {
          diff[currentPath] = { 
            type: 'changed', 
            oldValue: obj1[key], 
            newValue: obj2[key] 
          };
        }
      }
      
      for (const key in obj2) {
        const currentPath = path ? `${path}.${key}` : key;
        if (!(key in obj1)) {
          diff[currentPath] = { type: 'added', value: obj2[key] };
        }
      }
    };
    
    compare(this.config, otherConfig);
    return diff;
  }

  // 获取配置源
  public getConfigSources(): ConfigSource[] {
    return Array.from(this.configSources.values());
  }

  // 添加配置源
  public addConfigSource(source: ConfigSource): void {
    this.configSources.set(source.name, source);
    Logger.info(`添加配置源: ${source.name}`);
  }

  // 移除配置源
  public removeConfigSource(name: string): void {
    if (this.configSources.delete(name)) {
      Logger.info(`移除配置源: ${name}`);
    }
  }

  // 获取环境
  public getEnvironment(): ConfigEnvironment {
    return this.environment;
  }

  // 设置环境
  public setEnvironment(env: ConfigEnvironment): void {
    this.environment = env;
    Logger.info(`设置环境: ${env}`);
  }

  // 获取监控配置
  public getMonitorConfig(): ConfigMonitor {
    return {
      enabled: this.monitorInterval !== null,
      checkInterval: 5000, // 默认5秒
      alertOnChange: true,
      backupOnChange: true,
      maxBackups: 10
    };
  }

  // 更新监控配置（旧方法，保持兼容性）
  public updateMonitorConfig(config: ConfigMonitor): void {
    // 停止当前监控
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
    }
    
    // 如果启用监控，重新启动
    if (config.enabled) {
      this.startMonitoring();
    }
    
    Logger.info('监控配置已更新');
  }

  // 更新监控配置
  public updateMonitoring(config: ConfigMonitor): void {
    // 停止当前监控
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
    }
    
    this.startMonitoring();
    
    Logger.info('监控配置已更新');
  }

  // 工具方法
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  private setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    
    let current = obj;
    for (const key of keys) {
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[lastKey] = value;
  }

  private deepMerge(target: any, source: any): any {
    if (!source || typeof source !== 'object') {
      return target;
    }
    
    const result = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (
          source[key] &&
          typeof source[key] === 'object' &&
          !Array.isArray(source[key]) &&
          target[key] &&
          typeof target[key] === 'object' &&
          !Array.isArray(target[key])
        ) {
          result[key] = this.deepMerge(target[key], source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    
    return result;
  }

  private recordConfigChange(
    source: string,
    oldConfig: any,
    newConfig: any,
    user?: string
  ): void {
    const change: ConfigChange = {
      timestamp: Date.now(),
      path: 'multiple',
      oldValue: oldConfig,
      newValue: newConfig,
      source: source as any,
      user
    };
    
    this.changeHistory.push(change);
    
    // 保持历史记录数量限制
    const maxHistory = 1000;
    if (this.changeHistory.length > maxHistory) {
      this.changeHistory.splice(0, this.changeHistory.length - maxHistory);
    }
    
    Logger.debug(`记录配置变更`);
  }

  private validateConfigurationObject(config: any): void {
    // 临时保存当前配置
    const originalConfig = this.config;
    
    try {
      // 临时设置配置进行验证
      this.config = config;
      this.validateConfiguration();
    } finally {
      // 恢复原始配置
      this.config = originalConfig;
    }
  }

  // 清理方法
  public destroy(): void {
    // 停止监控
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    // 关闭文件监控
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
    }
    
    // 清理事件监听器
    this.eventBus.removeAllListeners('config-update-request');
    this.eventBus.removeAllListeners('config-reload-request');
    this.eventBus.removeAllListeners('config-backup-request');
    this.eventBus.removeAllListeners('config-restore-request');
    
    // 清理数据
    this.configSources.clear();
    this.validationRules.clear();
    this.configTemplates.clear();
    this.changeHistory.length = 0;
    this.configBackups.clear();
    
    Logger.info('配置管理器已销毁');
  }

  private getDefaultConfig(): BotConfig {
    return {
      name: 'Bot Framework',
      version: '1.0.0',
      environment: 'development',
      adapters: {},
      database: {
        type: 'sqlite',
        sqlite: {
          path: './data/bot.db'
        }
      },
      plugins: {
        directory: './plugins',
        autoLoad: true,
        hotReload: false
      },
      logging: {
        level: 'info',
        console: {
          enabled: true,
          colorize: true
        }
      },
      security: {
        encryption: {
          enabled: false,
          algorithm: 'aes-256-gcm'
        },
        rateLimit: {
          enabled: false,
          windowMs: 60000,
          maxRequests: 100
        },
        cors: {
          enabled: false,
          origins: ['*'],
          methods: ['GET', 'POST']
        }
      },
      performance: {
        maxConcurrentTasks: 10,
        taskTimeout: 30000,
        memoryLimit: '512MB',
        cpuLimit: 80
      },
      monitoring: {
        enabled: false,
        metrics: {
          enabled: false,
          interval: 60000,
          retention: 86400000
        },
        health: {
          enabled: false,
          interval: 30000,
          endpoints: []
        },
        alerts: {
          enabled: false,
          channels: [],
          thresholds: {}
        }
      }
    };
  }

  // 添加redis配置的getter方法
  public get redis() {
    return {
      enabled: this.config.database?.type === 'redis',
      required: false,
      host: this.config.database?.redis?.host || 'localhost',
      port: this.config.database?.redis?.port || 6379,
      password: this.config.database?.redis?.password,
      db: this.config.database?.redis?.db || 0
    };
  }
}

export class Config {
  private static instance: Config;
  private configManager: ConfigManager;

  private constructor() {
    this.configManager = ConfigManager.getInstance();
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  // 代理ConfigManager的方法
  public get(path: string): any {
    return this.configManager.get(path);
  }

  public set(path: string, value: any): void {
    this.configManager.set(path, value);
  }

  public getConfig(): BotConfig {
    return this.configManager.getConfig();
  }

  public updateConfig(updates: Partial<BotConfig>): void {
    this.configManager.updateConfig(updates);
  }

  public reload(): void {
    this.configManager.reload();
  }

  // 添加redis配置的getter方法
  public get redis() {
    return this.configManager.redis;
  }
}