import { Logger } from './log';
import { FrameworkEventBus } from '../common/event-bus';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
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
      thresholds: any;
    };
  };
  
  // 自定义配置
  custom?: {
    [key: string]: any;
  };
  
  // 消息处理器配置
  messageHandler?: {
    maxRetries: number;
    retryDelay: number;
    enableRateLimit: boolean;
    rateLimitWindow: number;
    rateLimitMax: number;
    maxConcurrentMessages: number;
    cacheEnabled: boolean;
    cacheMaxSize: number;
    cacheTTL: number;
    filter?: {
      enabled: boolean;
      patterns: string[];
      whitelist: string[];
      blacklist: string[];
      minLength: number;
      maxLength: number;
    };
  };
}

export class ConfigManager {
  private static instance: ConfigManager;
  private config: BotConfig;
  private eventBus: FrameworkEventBus;
  
  // 新增属性
  private configSources: Map<string, ConfigSource> = new Map();
  private validationRules: Map<string, ConfigValidationRule> = new Map();
  private configTemplates: Map<string, ConfigTemplate> = new Map();
  private changeHistory: ConfigChange[] = [];
  private configWatcher: chokidar.FSWatcher | null = null;
  private configBackups: Map<string, any[]> = new Map();
  
  // 配置
  private configDir: string = path.resolve(process.cwd(), 'config/config');
  private backupDir: string = path.resolve(process.cwd(), 'config/backups');
  private environment: ConfigEnvironment = 'development';
  private monitor: ConfigMonitor = {
    enabled: false,
    checkInterval: 30000,
    alertOnChange: true,
    backupOnChange: true,
    maxBackups: 10
  };
  
  // 定时器
  private monitorInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
    this.environment = (process.env.NODE_ENV as ConfigEnvironment) || 'development';
    
    // 初始化配置为默认值
    this.config = this.getDefaultConfig();
    
    // 初始化配置
    this.initializeConfig();
    
    // 设置验证规则
    this.setupValidationRules();
    
    // 加载配置模板
    this.loadConfigTemplates();
    
    // 启动监控
    this.startMonitoring();
    
    // 设置事件监听
    this.setupEventListeners();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private initializeConfig(): void {
    try {
      // 确保配置目录存在
      this.ensureDirectories();
      
      // 加载配置源
      this.loadConfigSources();
      
      // 合并配置
      this.config = this.mergeConfigurations();
      
      // 应用环境变量
      this.applyEnvironmentVariables();
      
      // 验证配置
      this.validateConfiguration();
      
      Logger.info(`配置管理器初始化完成 (环境: ${this.environment})`);
      
    } catch (error) {
      Logger.error('配置管理器初始化失败:', error);
      this.config = this.getDefaultConfig();
    }
  }

  private ensureDirectories(): void {
    const dirs = [this.configDir, this.backupDir];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        Logger.info(`创建配置目录: ${dir}`);
      }
    }
  }

  private loadConfigSources(): void {
    // 默认配置源
    this.configSources.set('default', {
      name: 'default',
      type: 'file',
      priority: 0,
      enabled: true
    });
    
    // 主配置文件
    this.configSources.set('main', {
      name: 'main',
      type: 'file',
      priority: 10,
      path: path.join(this.configDir, 'bot.yaml'),
      enabled: true
    });
    
    // 环境特定配置
    this.configSources.set('environment', {
      name: 'environment',
      type: 'file',
      priority: 20,
      path: path.join(this.configDir, `bot.${this.environment}.yaml`),
      enabled: true
    });
    
    // 环境变量
    this.configSources.set('env', {
      name: 'env',
      type: 'env',
      priority: 30,
      enabled: true
    });
    
    Logger.info(`加载了 ${this.configSources.size} 个配置源`);
  }

  private mergeConfigurations(): BotConfig {
    let mergedConfig = this.getDefaultConfig();
    
    // 按优先级排序配置源
    const sortedSources = Array.from(this.configSources.values())
      .filter(source => source.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    for (const source of sortedSources) {
      try {
        const config = this.loadConfigFromSource(source);
        if (config) {
          mergedConfig = this.deepMerge(mergedConfig, config);
          Logger.debug(`合并配置源: ${source.name}`);
        }
      } catch (error) {
        Logger.warn(`加载配置源失败 ${source.name}:`, error);
      }
    }
    
    return mergedConfig;
  }

  private loadConfigFromSource(source: ConfigSource): any {
    switch (source.type) {
      case 'file':
        return this.loadConfigFromFile(source.path!);
      case 'env':
        return this.loadConfigFromEnv();
      case 'remote':
        return this.loadConfigFromRemote(source.url!);
      case 'database':
        return this.loadConfigFromDatabase();
      default:
        return null;
    }
  }

  private loadConfigFromFile(filePath: string): any {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      return yaml.load(content);
    } else if (filePath.endsWith('.json')) {
      return JSON.parse(content);
    }
    
    return null;
  }

  private loadConfigFromEnv(): any {
    const envConfig: any = {};
    
    // 映射环境变量到配置路径
    const envMappings = {
      'BOT_NAME': 'name',
      'BOT_VERSION': 'version',
      'BOT_ENVIRONMENT': 'environment',
      'DATABASE_TYPE': 'database.type',
      'DATABASE_HOST': 'database.redis.host',
      'DATABASE_PORT': 'database.redis.port',
      'DATABASE_PASSWORD': 'database.redis.password',
      'REDIS_URL': 'database.redis.url',
      'LOG_LEVEL': 'logging.level',
      'PLUGIN_DIR': 'plugins.directory',
      'SECURITY_KEY': 'security.encryption.key'
    };
    
    for (const [envVar, configPath] of Object.entries(envMappings)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        this.setNestedValue(envConfig, configPath, this.parseEnvValue(value));
      }
    }
    
    return envConfig;
  }

  private loadConfigFromRemote(url: string): any {
    // TODO: 实现远程配置加载
    Logger.warn('远程配置加载尚未实现');
    return null;
  }

  private loadConfigFromDatabase(): any {
    // TODO: 实现数据库配置加载
    Logger.warn('数据库配置加载尚未实现');
    return null;
  }

  private parseEnvValue(value: string): any {
    // 尝试解析为数字
    if (/^\d+$/.test(value)) {
      return parseInt(value, 10);
    }
    
    // 尝试解析为浮点数
    if (/^\d+\.\d+$/.test(value)) {
      return parseFloat(value);
    }
    
    // 尝试解析为布尔值
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    
    // 尝试解析为JSON
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        return JSON.parse(value);
      } catch {
        // 忽略解析错误，返回原始字符串
      }
    }
    
    return value;
  }

  private applyEnvironmentVariables(): void {
    // 应用特定环境的配置覆盖
    const envOverrides = this.getEnvironmentOverrides();
    if (envOverrides) {
      this.config = this.deepMerge(this.config, envOverrides);
    }
  }

  private getEnvironmentOverrides(): any {
    switch (this.environment) {
      case 'production':
        return {
          logging: { level: 'info' },
          plugins: { hotReload: false },
          monitoring: { enabled: true }
        };
      case 'development':
        return {
          logging: { level: 'debug' },
          plugins: { hotReload: true },
          monitoring: { enabled: true }
        };
      case 'testing':
        return {
          logging: { level: 'warn' },
          plugins: { hotReload: false },
          monitoring: { enabled: false }
        };
      default:
        return null;
    }
  }

  private setupValidationRules(): void {
    // 使用默认验证规则
    for (const rule of defaultValidationRules) {
      this.validationRules.set(rule.path, rule);
    }
    
    Logger.debug(`设置了 ${defaultValidationRules.length} 个验证规则`);
  }

  private validateConfiguration(): void {
    const errors: string[] = [];
    
    for (const [path, rule] of this.validationRules) {
      const value = this.get(path);
      
      // 检查必需字段
      if (rule.required && (value === undefined || value === null)) {
        errors.push(`必需配置项缺失: ${path}`);
        continue;
      }
      
      // 检查类型
      if (value !== undefined && !this.validateType(value, rule.type)) {
        errors.push(`配置项类型错误 ${path}: 期望 ${rule.type}, 实际 ${typeof value}`);
      }
      
      // 自定义验证器
      if (value !== undefined && rule.validator) {
        const result = rule.validator(value);
        if (result !== true) {
          errors.push(`配置项验证失败 ${path}: ${typeof result === 'string' ? result : '验证失败'}`);
        }
      }
    }
    
    if (errors.length > 0) {
      Logger.error('配置验证失败:', errors);
      throw new Error(`配置验证失败: ${errors.join(', ')}`);
    }
    
    Logger.info('配置验证通过');
  }

  private validateType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return false;
    }
  }

  private loadConfigTemplates(): void {
    const templatesDir = path.join(__dirname, '../templates');
    
    if (!fs.existsSync(templatesDir)) {
      Logger.debug('配置模板目录不存在');
      return;
    }
    
    try {
      const files = fs.readdirSync(templatesDir);
      
      for (const file of files) {
        if (file.endsWith('.template.yaml')) {
          const templatePath = path.join(templatesDir, file);
          const template = this.loadConfigFromFile(templatePath) as ConfigTemplate;
          
          if (template && template.name) {
            this.configTemplates.set(template.name, template);
            Logger.debug(`加载配置模板: ${template.name}`);
          }
        }
      }
      
      Logger.info(`加载了 ${this.configTemplates.size} 个配置模板`);
      
    } catch (error) {
      Logger.warn('加载配置模板失败:', error);
    }
  }

  private startMonitoring(): void {
    if (!this.monitor.enabled) return;
    
    // 启动文件监控
    this.startFileWatcher();
    
    // 启动定期检查
    this.monitorInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.monitor.checkInterval);
    
    Logger.info('配置监控已启动');
  }

  private startFileWatcher(): void {
    const watchPaths = [
      path.join(this.configDir, '*.yaml'),
      path.join(this.configDir, '*.yml'),
      path.join(this.configDir, '*.json')
    ];
    
    this.configWatcher = chokidar.watch(watchPaths, {
      ignored: /[\/\\]\./,
      persistent: true,
      ignoreInitial: true
    });
    
    this.configWatcher.on('change', (filePath) => {
      Logger.info(`配置文件变更: ${filePath}`);
      this.handleConfigFileChange(filePath);
    });
    
    this.configWatcher.on('add', (filePath) => {
      Logger.info(`新增配置文件: ${filePath}`);
      this.handleConfigFileChange(filePath);
    });
    
    this.configWatcher.on('unlink', (filePath) => {
      Logger.warn(`配置文件删除: ${filePath}`);
    });
  }

  private handleConfigFileChange(filePath: string): void {
    try {
      // 备份当前配置
      if (this.monitor.backupOnChange) {
        this.backupConfiguration();
      }
      
      // 重新加载配置
      const oldConfig = { ...this.config };
      this.config = this.mergeConfigurations();
      this.applyEnvironmentVariables();
      this.validateConfiguration();
      
      // 记录变更
      this.recordConfigChange('file', oldConfig, this.config);
      
      // 发送事件
      this.eventBus.safeEmit('config-reloaded', {
        source: 'file',
        path: filePath,
        config: this.config
      });
      
      if (this.monitor.alertOnChange) {
        Logger.info('配置已热重载');
      }
      
    } catch (error) {
      Logger.error('配置热重载失败:', error);
      
      // 尝试恢复备份
      this.restoreFromBackup();
    }
  }

  private performHealthCheck(): void {
    try {
      // 检查配置文件完整性
      this.validateConfiguration();
      
      // 检查配置源可用性
      for (const source of this.configSources.values()) {
        if (source.enabled && source.type === 'file' && source.path) {
          if (!fs.existsSync(source.path)) {
            Logger.warn(`配置文件不存在: ${source.path}`);
          }
        }
      }
      
      // 发送健康检查事件
      this.eventBus.safeEmit('config-health-check', {
        status: 'healthy',
        timestamp: Date.now()
      });
      
    } catch (error) {
      Logger.error('配置健康检查失败:', error);
      
      this.eventBus.safeEmit('config-health-check', {
        status: 'unhealthy',
        error: (error as Error).message,
        timestamp: Date.now()
      });
    }
  }

  private setupEventListeners(): void {
    this.eventBus.on('config-update-request', this.handleConfigUpdateRequest.bind(this));
    this.eventBus.on('config-reload-request', this.handleConfigReloadRequest.bind(this));
    this.eventBus.on('config-backup-request', this.handleConfigBackupRequest.bind(this));
    this.eventBus.on('config-restore-request', this.handleConfigRestoreRequest.bind(this));
  }

  private handleConfigUpdateRequest(data: { path: string; value: any; user?: string }): void {
    try {
      this.set(data.path, data.value, 'api', data.user);
      Logger.info(`配置更新请求处理成功: ${data.path}`);
    } catch (error) {
      Logger.error(`配置更新请求处理失败: ${data.path}`, error);
    }
  }

  private handleConfigReloadRequest(): void {
    try {
      this.reload();
      Logger.info('配置重载请求处理成功');
    } catch (error) {
      Logger.error('配置重载请求处理失败:', error);
    }
  }

  private handleConfigBackupRequest(): void {
    try {
      this.backupConfiguration();
      Logger.info('配置备份请求处理成功');
    } catch (error) {
      Logger.error('配置备份请求处理失败:', error);
    }
  }

  private handleConfigRestoreRequest(data: { backupId?: string }): void {
    try {
      this.restoreFromBackup(data.backupId);
      Logger.info('配置恢复请求处理成功');
    } catch (error) {
      Logger.error('配置恢复请求处理失败:', error);
    }
  }

  // 公共方法
  public getConfig(): BotConfig {
    return { ...this.config };
  }

  public get(path: string): any {
    return this.getNestedValue(this.config, path);
  }

  public set(path: string, value: any, source: string = 'api', user?: string): void {
    const oldValue = this.get(path);
    
    // 验证新值
    const rule = this.validationRules.get(path);
    if (rule) {
      if (!this.validateType(value, rule.type)) {
        throw new Error(`配置项类型错误 ${path}: 期望 ${rule.type}, 实际 ${typeof value}`);
      }
      
      if (rule.validator) {
        const result = rule.validator(value);
        if (result !== true) {
          throw new Error(`配置项验证失败 ${path}: ${typeof result === 'string' ? result : '验证失败'}`);
        }
      }
    }
    
    // 备份当前配置
    if (this.monitor.backupOnChange) {
      this.backupConfiguration();
    }
    
    // 设置新值
    this.setNestedValue(this.config, path, value);
    
    // 记录变更
    this.recordConfigChange(source, { [path]: oldValue }, { [path]: value }, user);
    
    // 发送事件
    this.eventBus.safeEmit('config-updated', {
      path,
      oldValue,
      newValue: value,
      source,
      user,
      timestamp: Date.now()
    });
    
    Logger.info(`配置项已更新: ${path} = ${JSON.stringify(value)}`);
  }

  public update(updates: Record<string, any>, source: string = 'api', user?: string): void {
    const oldConfig = { ...this.config };
    
    // 验证所有更新
    for (const [path, value] of Object.entries(updates)) {
      const rule = this.validationRules.get(path);
      if (rule) {
        if (!this.validateType(value, rule.type)) {
          throw new Error(`配置项类型错误 ${path}: 期望 ${rule.type}, 实际 ${typeof value}`);
        }
        
        if (rule.validator) {
          const result = rule.validator(value);
          if (result !== true) {
            throw new Error(`配置项验证失败 ${path}: ${typeof result === 'string' ? result : '验证失败'}`);
          }
        }
      }
    }
    
    // 备份当前配置
    if (this.monitor.backupOnChange) {
      this.backupConfiguration();
    }
    
    // 应用所有更新
    for (const [path, value] of Object.entries(updates)) {
      this.setNestedValue(this.config, path, value);
    }
    
    // 记录变更
    this.recordConfigChange(source, oldConfig, this.config, user);
    
    // 发送事件
    this.eventBus.safeEmit('config-batch-updated', {
      updates,
      source,
      user,
      timestamp: Date.now()
    });
    
    Logger.info(`批量更新了 ${Object.keys(updates).length} 个配置项`);
  }

  public reload(): void {
    const oldConfig = { ...this.config };
    
    try {
      // 重新加载配置
      this.config = this.mergeConfigurations();
      this.applyEnvironmentVariables();
      this.validateConfiguration();
      
      // 记录变更
      this.recordConfigChange('reload', oldConfig, this.config);
      
      // 发送事件
      this.eventBus.safeEmit('config-reloaded', {
        source: 'manual',
        config: this.config,
        timestamp: Date.now()
      });
      
      Logger.info('配置已手动重载');
      
    } catch (error) {
      Logger.error('配置重载失败:', error);
      this.config = oldConfig; // 恢复旧配置
      throw error;
    }
  }

  public reset(): void {
    const oldConfig = { ...this.config };
    
    // 重置为默认配置
    this.config = this.getDefaultConfig();
    
    // 记录变更
    this.recordConfigChange('reset', oldConfig, this.config);
    
    // 发送事件
    this.eventBus.safeEmit('config-reset', {
      oldConfig,
      newConfig: this.config,
      timestamp: Date.now()
    });
    
    Logger.info('配置已重置为默认值');
  }

  public save(filePath?: string): void {
    const targetPath = filePath || path.join(this.configDir, 'bot.yaml');
    
    try {
      // 确保目录存在
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // 保存配置
      const content = yaml.dump(this.config, {
        indent: 2,
        lineWidth: 120,
        noRefs: true
      });
      
      fs.writeFileSync(targetPath, content, 'utf8');
      
      // 发送事件
      this.eventBus.safeEmit('config-saved', {
        path: targetPath,
        config: this.config,
        timestamp: Date.now()
      });
      
      Logger.info(`配置已保存到: ${targetPath}`);
      
    } catch (error) {
      Logger.error(`配置保存失败: ${targetPath}`, error);
      throw error;
    }
  }

  public export(format: 'yaml' | 'json' = 'yaml'): string {
    switch (format) {
      case 'yaml':
        return yaml.dump(this.config, {
          indent: 2,
          lineWidth: 120,
          noRefs: true
        });
      case 'json':
        return JSON.stringify(this.config, null, 2);
      default:
        throw new Error(`不支持的导出格式: ${format}`);
    }
  }

  public import(content: string, format: 'yaml' | 'json' = 'yaml'): void {
    let importedConfig: any;
    
    try {
      switch (format) {
        case 'yaml':
          importedConfig = yaml.load(content);
          break;
        case 'json':
          importedConfig = JSON.parse(content);
          break;
        default:
          throw new Error(`不支持的导入格式: ${format}`);
      }
      
      // 验证导入的配置
      const tempConfig = this.deepMerge(this.getDefaultConfig(), importedConfig);
      this.validateConfigurationObject(tempConfig);
      
      // 备份当前配置
      if (this.monitor.backupOnChange) {
        this.backupConfiguration();
      }
      
      const oldConfig = { ...this.config };
      this.config = tempConfig;
      
      // 记录变更
      this.recordConfigChange('import', oldConfig, this.config);
      
      // 发送事件
      this.eventBus.safeEmit('config-imported', {
        format,
        config: this.config,
        timestamp: Date.now()
      });
      
      Logger.info(`配置已从 ${format} 格式导入`);
      
    } catch (error) {
      Logger.error(`配置导入失败 (${format}):`, error);
      throw error;
    }
  }

  // 配置模板相关方法
  public getTemplate(name: string): ConfigTemplate | undefined {
    return this.configTemplates.get(name);
  }

  public listTemplates(): ConfigTemplate[] {
    return Array.from(this.configTemplates.values());
  }

  public applyTemplate(name: string): void {
    const template = this.configTemplates.get(name);
    if (!template) {
      throw new Error(`配置模板不存在: ${name}`);
    }
    
    const oldConfig = { ...this.config };
    
    // 应用模板
    this.config = this.deepMerge(this.config, template.config);
    
    // 验证配置
    this.validateConfiguration();
    
    // 记录变更
    this.recordConfigChange('template', oldConfig, this.config);
    
    // 发送事件
    this.eventBus.safeEmit('config-template-applied', {
      templateName: name,
      template,
      config: this.config,
      timestamp: Date.now()
    });
    
    Logger.info(`已应用配置模板: ${name}`);
  }

  public createTemplate(name: string, description: string, config?: any): void {
    const template: ConfigTemplate = {
      name,
      description,
      version: '1.0.0',
      config: config || this.config,
      createdAt: new Date().toISOString(),
      author: 'system'
    };
    
    this.configTemplates.set(name, template);
    
    // 保存模板到文件
    const templatePath = path.join(__dirname, '../templates', `${name}.template.yaml`);
    try {
      const content = yaml.dump(template, { indent: 2 });
      fs.writeFileSync(templatePath, content, 'utf8');
      
      Logger.info(`配置模板已创建: ${name}`);
      
    } catch (error) {
      Logger.warn(`保存配置模板失败: ${name}`, error);
    }
  }

  // 备份和恢复方法
  public backupConfiguration(label?: string): string {
    const backupId = `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const backup = {
      id: backupId,
      label: label || `自动备份 ${new Date().toLocaleString()}`,
      config: { ...this.config },
      timestamp: Date.now(),
      environment: this.environment
    };
    
    // 添加到内存备份
    if (!this.configBackups.has('memory')) {
      this.configBackups.set('memory', []);
    }
    
    const memoryBackups = this.configBackups.get('memory')!;
    memoryBackups.push(backup);
    
    // 保持最大备份数量
    if (memoryBackups.length > this.monitor.maxBackups) {
      memoryBackups.splice(0, memoryBackups.length - this.monitor.maxBackups);
    }
    
    // 保存到文件
    try {
      const backupPath = path.join(this.backupDir, `${backupId}.yaml`);
      const content = yaml.dump(backup, { indent: 2 });
      fs.writeFileSync(backupPath, content, 'utf8');
      
      Logger.debug(`配置备份已保存: ${backupId}`);
      
    } catch (error) {
      Logger.warn(`保存配置备份失败: ${backupId}`, error);
    }
    
    return backupId;
  }

  public listBackups(): any[] {
    const memoryBackups = this.configBackups.get('memory') || [];
    const fileBackups: any[] = [];
    
    // 读取文件备份
    try {
      if (fs.existsSync(this.backupDir)) {
        const files = fs.readdirSync(this.backupDir);
        
        for (const file of files) {
          if (file.endsWith('.yaml')) {
            try {
              const backupPath = path.join(this.backupDir, file);
              const content = fs.readFileSync(backupPath, 'utf8');
              const backup = yaml.load(content);
              
              if (backup && typeof backup === 'object' && 'id' in backup) {
                fileBackups.push({
                  id: (backup as any).id,
                  label: (backup as any).label,
                  timestamp: (backup as any).timestamp,
                  environment: (backup as any).environment,
                  source: 'file'
                });
              }
            } catch (error) {
              Logger.warn(`读取备份文件失败: ${file}`, error);
            }
          }
        }
      }
    } catch (error) {
      Logger.warn('读取备份目录失败:', error);
    }
    
    // 合并并排序
    const allBackups = [
      ...memoryBackups.map(b => ({ ...b, source: 'memory' })),
      ...fileBackups
    ];
    
    return allBackups.sort((a, b) => b.timestamp - a.timestamp);
  }

  public restoreFromBackup(backupId?: string): void {
    let backup: any = null;
    
    if (backupId) {
      // 查找指定备份
      const memoryBackups = this.configBackups.get('memory') || [];
      backup = memoryBackups.find(b => b.id === backupId);
      
      if (!backup) {
        // 尝试从文件加载
        try {
          const backupPath = path.join(this.backupDir, `${backupId}.yaml`);
          if (fs.existsSync(backupPath)) {
            const content = fs.readFileSync(backupPath, 'utf8');
            backup = yaml.load(content);
          }
        } catch (error) {
          Logger.warn(`加载备份文件失败: ${backupId}`, error);
        }
      }
      
      if (!backup) {
        throw new Error(`备份不存在: ${backupId}`);
      }
    } else {
      // 使用最新备份
      const memoryBackups = this.configBackups.get('memory') || [];
      if (memoryBackups.length > 0) {
        backup = memoryBackups[memoryBackups.length - 1];
      } else {
        throw new Error('没有可用的备份');
      }
    }
    
    const oldConfig = { ...this.config };
    
    try {
      // 恢复配置
      this.config = { ...(backup as any).config };
      
      // 验证配置
      this.validateConfiguration();
      
      // 记录变更
      this.recordConfigChange('restore', oldConfig, this.config);
      
      // 发送事件
      this.eventBus.safeEmit('config-restored', {
        backupId: (backup as any).id,
        backup,
        config: this.config,
        timestamp: Date.now()
      });
      
      Logger.info(`配置已从备份恢复: ${(backup as any).id}`);
      
    } catch (error) {
      Logger.error(`配置恢复失败: ${(backup as any).id}`, error);
      this.config = oldConfig; // 恢复旧配置
      throw error;
    }
  }

  // 监控和统计方法
  public getChangeHistory(limit: number = 50): ConfigChange[] {
    return this.changeHistory.slice(-limit);
  }

  public getValidationRules(): Map<string, ConfigValidationRule> {
    return new Map(this.validationRules);
  }

  public addValidationRule(rule: ConfigValidationRule): void {
    this.validationRules.set(rule.path, rule);
    Logger.debug(`添加验证规则: ${rule.path}`);
  }

  public removeValidationRule(path: string): void {
    this.validationRules.delete(path);
    Logger.debug(`移除验证规则: ${path}`);
  }

  public getConfigSources(): Map<string, ConfigSource> {
    return new Map(this.configSources);
  }

  public addConfigSource(source: ConfigSource): void {
    this.configSources.set(source.name, source);
    Logger.info(`添加配置源: ${source.name}`);
  }

  public removeConfigSource(name: string): void {
    this.configSources.delete(name);
    Logger.info(`移除配置源: ${name}`);
  }

  public getEnvironment(): ConfigEnvironment {
    return this.environment;
  }

  public setEnvironment(env: ConfigEnvironment): void {
    if (this.environment !== env) {
      const oldEnv = this.environment;
      this.environment = env;
      
      // 重新加载配置
      this.reload();
      
      Logger.info(`环境已切换: ${oldEnv} -> ${env}`);
    }
  }

  public getMonitorConfig(): ConfigMonitor {
    return { ...this.monitor };
  }

  public updateMonitorConfig(config: Partial<ConfigMonitor>): void {
    this.monitor = { ...this.monitor, ...config };
    
    // 重启监控
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
}