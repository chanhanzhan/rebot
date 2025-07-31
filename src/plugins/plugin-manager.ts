import { BasePlugin } from './plugin';
import { PluginFunction } from '../common/types';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';
import { ConfigManager } from '../config/config';
import { NodeVM } from 'vm2';
import * as path from 'path';
import { DatabaseManager } from '../database/database-manager';
import { RedisDatabase } from '../config/readis';
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import { OneBotHTTPAdapter, PluginHttpRoute } from '../adapter/onebot-http-adapter';
import * as http from 'http';
import * as url from 'url';
import { EventBus } from '../common/event-bus';
import { EventType, PluginEvent, LogLevel, LogCategory } from '../common/event-types';

export interface PluginStats {
  name: string;
  version: string;
  enabled: boolean;
  loaded: boolean;
  loadTime: number;
  lastReload: number;
  functionCount: number;
  executionCount: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  errorCount: number;
  lastError?: string;
  memoryUsage?: number;
}

export interface PluginHealth {
  name: string;
  status: 'healthy' | 'warning' | 'error' | 'disabled';
  issues: string[];
  performance: {
    averageExecutionTime: number;
    errorRate: number;
    memoryUsage?: number;
  };
}

export interface PluginDependency {
  name: string;
  version: string;
  required: boolean;
  satisfied: boolean;
}

// 插件HTTP服务接口
export interface PluginHttpService {
  pluginName: string;
  routes: PluginHttpRoute[];
  server?: http.Server;
  port?: number;
  directory?: string; // 插件申请的HTTP目录
}

export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  dependencies: PluginDependency[];
  permissions: string[];
  category: string;
  tags: string[];
}

export class PluginManager {
  private static instance: PluginManager;
  private plugins: Map<string, BasePlugin> = new Map();
  private pluginFunctions: Map<string, PluginFunction> = new Map();
  private pluginStats: Map<string, PluginStats> = new Map();
  private pluginMetadata: Map<string, PluginMetadata> = new Map();
  private eventBus: FrameworkEventBus;
  private configManager: ConfigManager;
  private fileWatcher: chokidar.FSWatcher | null = null;
  private hotReloadEnabled = false;
  private pluginLoadOrder: string[] = [];
  private dependencyGraph: Map<string, string[]> = new Map();
  private executionQueue: Array<{ pluginName: string; functionName: string; timestamp: number }> = [];
  private maxExecutionHistory = 1000;

  // 插件加载统计
  private pluginLoadStats: { [name: string]: number } = {};
  private totalLoadTime: number = 0;

  // HTTP服务管理
  private httpAdapter?: OneBotHTTPAdapter;
  private pluginHttpServices: Map<string, PluginHttpService> = new Map();

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
    this.configManager = ConfigManager.getInstance();
    
    // 监听插件相关事件
    this.eventBus.on('plugin_reload_request', this.handlePluginReloadRequest.bind(this));
    this.eventBus.on('plugin_enable_request', this.handlePluginEnableRequest.bind(this));
    this.eventBus.on('plugin_disable_request', this.handlePluginDisableRequest.bind(this));
  }

  public static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  public async loadPlugin(plugin: BasePlugin, options?: {
    force?: boolean;
    skipDependencyCheck?: boolean;
  }): Promise<void> {
    const start = Date.now();
    
    try {
      Logger.info(`正在加载插件: ${plugin.name}`);
      
      // 检查插件是否已存在
      if (this.plugins.has(plugin.name) && !options?.force) {
        Logger.warn(`插件 ${plugin.name} 已存在，跳过加载`);
        return;
      }
      
      // 检查依赖关系
      if (!options?.skipDependencyCheck) {
        await this.checkPluginDependencies(plugin);
      }
      
      // 初始化插件统计
      this.initializePluginStats(plugin);
      
      // 加载插件
      await plugin.load();
      this.plugins.set(plugin.name, plugin);
      
      if (!plugin.isEnabled()) {
        Logger.info(`插件 ${plugin.name} 未启用，跳过命令注册`);
        this.updatePluginStats(plugin.name, { loaded: true, enabled: false });
        return;
      }
      
      // 注册插件函数
      const functions = plugin.getFunctions();
      for (const func of functions) {
        const key = `${plugin.name}.${func.name}`;
        this.pluginFunctions.set(key, func);
      }
      
      // 更新统计信息
      this.updatePluginStats(plugin.name, {
        loaded: true,
        enabled: true,
        functionCount: functions.length
      });
      
      // 添加到加载顺序
      if (!this.pluginLoadOrder.includes(plugin.name)) {
        this.pluginLoadOrder.push(plugin.name);
      }
      
      this.eventBus.safeEmit('plugin-loaded', plugin);
      Logger.info(`插件加载成功: ${plugin.name}`);
      
    } catch (error) {
      this.updatePluginStats(plugin.name, { 
        errorCount: (this.pluginStats.get(plugin.name)?.errorCount || 0) + 1,
        lastError: error instanceof Error ? error.message : String(error)
      });
      Logger.error(`插件加载失败 ${plugin.name}:`, error);
      throw error;
    } finally {
      const duration = Date.now() - start;
      this.pluginLoadStats[plugin.name] = duration;
      this.totalLoadTime += duration;
      this.updatePluginStats(plugin.name, { loadTime: duration });
      Logger.info(`[插件加载耗时] ${plugin.name}: ${duration}ms`);
    }
  }

  public async loadPluginFromPath(pluginPath: string, options?: {
    sandbox?: boolean;
    force?: boolean;
  }): Promise<void> {
    try {
      Logger.info(`${options?.sandbox ? '沙箱' : '直接'}加载插件: ${pluginPath}`);
      
      let plugin: BasePlugin;
      
      if (options?.sandbox) {
        // 沙箱模式加载
        const vm = new NodeVM({
          console: 'inherit',
          sandbox: {},
          require: {
            external: true,
            builtin: ['*'],
            root: './',
            mock: {},
          },
        });
        const pluginModule = vm.require(path.resolve(pluginPath));
        const PluginClass = pluginModule.default || pluginModule[Object.keys(pluginModule)[0]];
        if (!PluginClass) {
          Logger.warn(`无法从 ${pluginPath} 加载插件类`);
          return;
        }
        plugin = new PluginClass();
      } else {
        // 直接加载
        delete require.cache[require.resolve(path.resolve(pluginPath))];
        const pluginModule = require(path.resolve(pluginPath));
        const PluginClass = pluginModule.default || pluginModule[Object.keys(pluginModule)[0]];
        if (!PluginClass) {
          Logger.warn(`无法从 ${pluginPath} 加载插件类`);
          return;
        }
        plugin = new PluginClass();
      }
      
      // 加载插件元数据
      await this.loadPluginMetadata(plugin, pluginPath);
      
      await this.loadPlugin(plugin, options);
      
    } catch (error) {
      Logger.error(`加载插件失败 ${pluginPath}:`, error);
      throw error;
    }
  }

  public async unloadPlugin(pluginName: string, options?: {
    force?: boolean;
    skipDependencyCheck?: boolean;
  }): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      Logger.warn(`Plugin not found: ${pluginName}`);
      return;
    }
    
    try {
      Logger.info(`正在卸载插件: ${pluginName}`);
      
      // 检查依赖关系
      if (!options?.skipDependencyCheck) {
        const dependents = this.getPluginDependents(pluginName);
        if (dependents.length > 0 && !options?.force) {
          throw new Error(`无法卸载插件 ${pluginName}，以下插件依赖它: ${dependents.join(', ')}`);
        }
      }
      
      // 移除插件函数
      const functions = plugin.getFunctions();
      for (const func of functions) {
        const key = `${pluginName}.${func.name}`;
        this.pluginFunctions.delete(key);
      }
      
      // 卸载插件
      await plugin.unload();
      this.plugins.delete(pluginName);
      
      // 更新统计信息
      this.updatePluginStats(pluginName, { loaded: false, enabled: false });
      
      // 从加载顺序中移除
      const index = this.pluginLoadOrder.indexOf(pluginName);
      if (index > -1) {
        this.pluginLoadOrder.splice(index, 1);
      }
      
      this.eventBus.safeEmit('plugin-unloaded', plugin);
      Logger.info(`插件卸载成功: ${pluginName}`);
      
    } catch (error) {
      this.updatePluginStats(pluginName, { 
        errorCount: (this.pluginStats.get(pluginName)?.errorCount || 0) + 1,
        lastError: error instanceof Error ? error.message : String(error)
      });
      Logger.error(`插件卸载失败 ${pluginName}:`, error);
      throw error;
    }
  }

  public async reloadPlugin(pluginName: string, options?: {
    force?: boolean;
    preserveState?: boolean;
  }): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      Logger.warn(`Plugin not found: ${pluginName}`);
      return;
    }
    
    try {
      Logger.info(`重新加载插件: ${pluginName}`);
      
      // 保存状态
      let savedState: any = null;
      if (options?.preserveState && typeof (plugin as any).getState === 'function') {
        savedState = (plugin as any).getState();
      }
      
      // 重新加载插件
      await plugin.reload();
      
      // 恢复状态
      if (savedState && typeof (plugin as any).setState === 'function') {
        (plugin as any).setState(savedState);
      }
      
      // 重新注册插件函数
      const functions = plugin.getFunctions();
      
      // 清除旧的函数注册
      for (const [key] of this.pluginFunctions) {
        if (key.startsWith(`${pluginName}.`)) {
          this.pluginFunctions.delete(key);
        }
      }
      
      // 注册新的函数
      for (const func of functions) {
        const key = `${pluginName}.${func.name}`;
        this.pluginFunctions.set(key, func);
      }
      
      // 更新统计信息
      this.updatePluginStats(pluginName, {
        lastReload: Date.now(),
        functionCount: functions.length
      });
      
      this.eventBus.safeEmit('plugin-reloaded', plugin);
      Logger.info(`插件重新加载成功: ${pluginName}`);
      
    } catch (error) {
      this.updatePluginStats(pluginName, { 
        errorCount: (this.pluginStats.get(pluginName)?.errorCount || 0) + 1,
        lastError: error instanceof Error ? error.message : String(error)
      });
      Logger.error(`插件重新加载失败 ${pluginName}:`, error);
      throw error;
    }
  }

  public setPluginEnabled(pluginName: string, enabled: boolean): void {
    const plugin = this.plugins.get(pluginName);
    if (plugin) {
      plugin.setEnabled(enabled);
      this.updatePluginStats(pluginName, { enabled });
      
      if (enabled) {
        // 重新注册函数
        const functions = plugin.getFunctions();
        for (const func of functions) {
          const key = `${pluginName}.${func.name}`;
          this.pluginFunctions.set(key, func);
        }
      } else {
        // 移除函数注册
        for (const [key] of this.pluginFunctions) {
          if (key.startsWith(`${pluginName}.`)) {
            this.pluginFunctions.delete(key);
          }
        }
      }
      
      Logger.info(`插件 ${pluginName} ${enabled ? '已启用' : '已禁用'}`);
      this.eventBus.safeEmit('plugin-status-changed', { name: pluginName, enabled });
    }
  }

  // 批量操作
  public async loadPluginsBatch(plugins: BasePlugin[], options?: {
    parallel?: boolean;
    maxConcurrency?: number;
    continueOnError?: boolean;
  }): Promise<void> {
    if (options?.parallel) {
      const promises = plugins.map(plugin => 
        this.loadPlugin(plugin).catch(error => {
          if (!options.continueOnError) throw error;
          Logger.error(`批量加载插件 ${plugin.name} 失败:`, error);
          return error;
        })
      );
      await Promise.allSettled(promises);
    } else {
      for (const plugin of plugins) {
        try {
          await this.loadPlugin(plugin);
        } catch (error) {
          if (!options?.continueOnError) throw error;
          Logger.error(`批量加载插件 ${plugin.name} 失败:`, error);
        }
      }
    }
  }

  public async unloadPluginsBatch(pluginNames: string[], options?: {
    parallel?: boolean;
    continueOnError?: boolean;
  }): Promise<void> {
    if (options?.parallel) {
      const promises = pluginNames.map(name => 
        this.unloadPlugin(name).catch(error => {
          if (!options.continueOnError) throw error;
          Logger.error(`批量卸载插件 ${name} 失败:`, error);
          return error;
        })
      );
      await Promise.allSettled(promises);
    } else {
      for (const name of pluginNames) {
        try {
          await this.unloadPlugin(name);
        } catch (error) {
          if (!options?.continueOnError) throw error;
          Logger.error(`批量卸载插件 ${name} 失败:`, error);
        }
      }
    }
  }

  // 热重载功能
  public enableHotReload(pluginsDir: string): void {
    if (this.fileWatcher) {
      Logger.warn('热重载已启用');
      return;
    }
    
    this.hotReloadEnabled = true;
    this.fileWatcher = chokidar.watch(pluginsDir, {
      ignored: /node_modules/,
      persistent: true,
      ignoreInitial: true
    });
    
    this.fileWatcher.on('change', async (filePath) => {
      const pluginName = this.getPluginNameFromPath(filePath);
      if (pluginName && this.plugins.has(pluginName)) {
        Logger.info(`检测到插件文件变化: ${filePath}，正在热重载插件: ${pluginName}`);
        try {
          await this.reloadPlugin(pluginName, { preserveState: true });
        } catch (error) {
          Logger.error(`热重载插件 ${pluginName} 失败:`, error);
        }
      }
    });
    
    Logger.info(`热重载已启用，监控目录: ${pluginsDir}`);
  }

  public disableHotReload(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
      this.hotReloadEnabled = false;
      Logger.info('热重载已禁用');
    }
  }

  // 插件依赖管理
  private async checkPluginDependencies(plugin: BasePlugin): Promise<void> {
    const metadata = this.pluginMetadata.get(plugin.name);
    if (!metadata || !metadata.dependencies.length) return;
    
    for (const dep of metadata.dependencies) {
      if (dep.required && !dep.satisfied) {
        throw new Error(`插件 ${plugin.name} 缺少必需依赖: ${dep.name} (${dep.version})`);
      }
    }
  }

  private getPluginDependents(pluginName: string): string[] {
    const dependents: string[] = [];
    
    for (const [name, deps] of this.dependencyGraph) {
      if (deps.includes(pluginName)) {
        dependents.push(name);
      }
    }
    
    return dependents;
  }

  // 插件统计和健康检查
  public getPluginStats(pluginName?: string): PluginStats | PluginStats[] {
    if (pluginName) {
      const stats = this.pluginStats.get(pluginName);
      if (!stats) throw new Error(`Plugin not found: ${pluginName}`);
      return { ...stats };
    }
    
    return Array.from(this.pluginStats.values()).map(stats => ({ ...stats }));
  }

  public async getPluginHealth(pluginName?: string): Promise<PluginHealth | PluginHealth[]> {
    const checkHealth = (name: string, stats: PluginStats): PluginHealth => {
      const issues: string[] = [];
      let status: 'healthy' | 'warning' | 'error' | 'disabled' = 'healthy';
      
      if (!stats.enabled) {
        status = 'disabled';
      } else if (!stats.loaded) {
        status = 'error';
        issues.push('插件未加载');
      } else {
        // 检查错误率
        const errorRate = stats.executionCount > 0 ? stats.errorCount / stats.executionCount : 0;
        if (errorRate > 0.3) {
          status = 'error';
          issues.push(`错误率过高: ${(errorRate * 100).toFixed(1)}%`);
        } else if (errorRate > 0.1) {
          status = 'warning';
          issues.push(`错误率较高: ${(errorRate * 100).toFixed(1)}%`);
        }
        
        // 检查执行时间
        if (stats.averageExecutionTime > 5000) {
          status = status === 'error' ? 'error' : 'warning';
          issues.push(`平均执行时间过长: ${stats.averageExecutionTime}ms`);
        }
        
        // 检查内存使用
        if (stats.memoryUsage && stats.memoryUsage > 100 * 1024 * 1024) { // 100MB
          status = status === 'error' ? 'error' : 'warning';
          issues.push(`内存使用过高: ${(stats.memoryUsage / 1024 / 1024).toFixed(1)}MB`);
        }
      }
      
      return {
        name,
        status,
        issues,
        performance: {
          averageExecutionTime: stats.averageExecutionTime,
          errorRate: stats.executionCount > 0 ? stats.errorCount / stats.executionCount : 0,
          memoryUsage: stats.memoryUsage
        }
      };
    };
    
    if (pluginName) {
      const stats = this.pluginStats.get(pluginName);
      if (!stats) throw new Error(`Plugin not found: ${pluginName}`);
      return checkHealth(pluginName, stats);
    }
    
    return Array.from(this.pluginStats.entries()).map(([name, stats]) => 
      checkHealth(name, stats)
    );
  }

  public resetPluginStats(pluginName?: string): void {
    if (pluginName) {
      const stats = this.pluginStats.get(pluginName);
      if (stats) {
        stats.executionCount = 0;
        stats.totalExecutionTime = 0;
        stats.averageExecutionTime = 0;
        stats.errorCount = 0;
        stats.lastError = undefined;
      }
    } else {
      for (const stats of this.pluginStats.values()) {
        stats.executionCount = 0;
        stats.totalExecutionTime = 0;
        stats.averageExecutionTime = 0;
        stats.errorCount = 0;
        stats.lastError = undefined;
      }
    }
    
    Logger.info(`插件统计已重置${pluginName ? ` (${pluginName})` : ''}`);
  }

  // 插件执行统计
  public recordPluginExecution(pluginName: string, functionName: string, executionTime: number, success: boolean): void {
    const stats = this.pluginStats.get(pluginName);
    if (!stats) return;
    
    stats.executionCount++;
    stats.totalExecutionTime += executionTime;
    stats.averageExecutionTime = stats.totalExecutionTime / stats.executionCount;
    
    if (!success) {
      stats.errorCount++;
    }
    
    // 记录执行历史
    this.executionQueue.push({
      pluginName,
      functionName,
      timestamp: Date.now()
    });
    
    // 限制历史记录数量
    if (this.executionQueue.length > this.maxExecutionHistory) {
      this.executionQueue.shift();
    }
  }

  // 获取插件执行历史
  public getExecutionHistory(pluginName?: string, limit = 100): Array<{
    pluginName: string;
    functionName: string;
    timestamp: number;
  }> {
    let history = this.executionQueue;
    
    if (pluginName) {
      history = history.filter(item => item.pluginName === pluginName);
    }
    
    return history.slice(-limit);
  }

  /**
   * 自动发现并加载插件目录，支持版本兼容校验和耗时统计
   */
  public async loadPluginsFromDirectory(pluginsDir: string = './plugins', options?: {
    recursive?: boolean;
    pattern?: RegExp;
    parallel?: boolean;
  }): Promise<void> {
    const start = Date.now();
    
    try {
      Logger.info(`开始从目录加载插件: ${pluginsDir}`);
      
      if (!fs.existsSync(pluginsDir)) {
        Logger.warn(`插件目录不存在: ${pluginsDir}`);
        return;
      }
      
      const pluginPaths = this.discoverPlugins(pluginsDir, options);
      Logger.info(`发现 ${pluginPaths.length} 个插件文件`);
      
      if (options?.parallel) {
        const promises = pluginPaths.map(pluginPath => 
          this.loadPluginFromPath(pluginPath).catch(error => {
            Logger.error(`加载插件 ${pluginPath} 失败:`, error);
            return error;
          })
        );
        await Promise.allSettled(promises);
      } else {
        for (const pluginPath of pluginPaths) {
          try {
            await this.loadPluginFromPath(pluginPath);
          } catch (error) {
            Logger.error(`加载插件 ${pluginPath} 失败:`, error);
          }
        }
      }
      
      const duration = Date.now() - start;
      Logger.info(`插件目录加载完成，耗时: ${duration}ms，成功加载 ${this.plugins.size} 个插件`);
      
    } catch (error) {
      Logger.error(`加载插件目录失败:`, error);
      throw error;
    }
  }

  private discoverPlugins(dir: string, options?: {
    recursive?: boolean;
    pattern?: RegExp;
  }): string[] {
    const pluginPaths: string[] = [];
    const pattern = options?.pattern || /index\.(js|ts)$/;
    
    const scanDirectory = (currentDir: string) => {
      const items = fs.readdirSync(currentDir);
      
      for (const item of items) {
        const itemPath = path.join(currentDir, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory()) {
          if (options?.recursive) {
            scanDirectory(itemPath);
          } else {
            // 检查目录中是否有插件入口文件
            const entryFile = path.join(itemPath, 'index.js');
            const entryFileTs = path.join(itemPath, 'index.ts');
            
            if (fs.existsSync(entryFile)) {
              pluginPaths.push(entryFile);
            } else if (fs.existsSync(entryFileTs)) {
              pluginPaths.push(entryFileTs);
            }
          }
        } else if (stat.isFile() && pattern.test(item)) {
          pluginPaths.push(itemPath);
        }
      }
    };
    
    scanDirectory(dir);
    return pluginPaths;
  }

  private async loadPluginMetadata(plugin: BasePlugin, pluginPath: string): Promise<void> {
    try {
      const packageJsonPath = path.join(path.dirname(pluginPath), 'package.json');
      
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        const metadata: PluginMetadata = {
          name: plugin.name,
          version: packageJson.version || '1.0.0',
          description: packageJson.description || '',
          author: packageJson.author || '',
          dependencies: this.parseDependencies(packageJson.dependencies || {}),
          permissions: packageJson.permissions || [],
          category: packageJson.category || 'general',
          tags: packageJson.tags || []
        };
        
        this.pluginMetadata.set(plugin.name, metadata);
      }
    } catch (error) {
      Logger.warn(`加载插件元数据失败 ${plugin.name}:`, error);
    }
  }

  private parseDependencies(deps: Record<string, string>): PluginDependency[] {
    return Object.entries(deps).map(([name, version]) => ({
      name,
      version,
      required: true,
      satisfied: this.checkDependencySatisfied(name, version)
    }));
  }

  private checkDependencySatisfied(name: string, version: string): boolean {
    // 简单的依赖检查，可以扩展为更复杂的版本匹配
    return this.plugins.has(name);
  }

  private getPluginNameFromPath(filePath: string): string | null {
    // 从文件路径推断插件名称
    const parts = filePath.split(path.sep);
    const pluginDirIndex = parts.findIndex(part => part === 'plugins');
    
    if (pluginDirIndex >= 0 && pluginDirIndex < parts.length - 1) {
      return parts[pluginDirIndex + 1];
    }
    
    return null;
  }

  private initializePluginStats(plugin: BasePlugin): void {
    if (!this.pluginStats.has(plugin.name)) {
      this.pluginStats.set(plugin.name, {
        name: plugin.name,
        version: (plugin as any).version || '1.0.0',
        enabled: false,
        loaded: false,
        loadTime: 0,
        lastReload: 0,
        functionCount: 0,
        executionCount: 0,
        totalExecutionTime: 0,
        averageExecutionTime: 0,
        errorCount: 0
      });
    }
  }

  private updatePluginStats(pluginName: string, updates: Partial<PluginStats>): void {
    const stats = this.pluginStats.get(pluginName);
    if (stats) {
      Object.assign(stats, updates);
    }
  }

  // 事件处理器
  private handlePluginReloadRequest(data: { pluginName: string }): void {
    this.reloadPlugin(data.pluginName).catch(error => {
      Logger.error(`处理插件重载请求失败:`, error);
    });
  }

  private handlePluginEnableRequest(data: { pluginName: string }): void {
    this.setPluginEnabled(data.pluginName, true);
  }

  private handlePluginDisableRequest(data: { pluginName: string }): void {
    this.setPluginEnabled(data.pluginName, false);
  }

  /**
   * 为插件提供 Redis 缓存能力
   */
  public getRedisClient() {
    const db = DatabaseManager.getInstance().getDatabase();
    if (db instanceof RedisDatabase) {
      return db.getClient();
    }
    throw new Error('当前数据库不是 Redis，无法提供缓存能力');
  }

  /**
   * 插件消息处理耗时统计（在消息处理器中调用）
   */
  public static logMessageProcessingTime(pluginName: string, start: number, end: number) {
    Logger.info(`[插件耗时] ${pluginName} 处理消息耗时: ${end - start}ms`);
  }

  /**
   * 提供安全的 Redis 缓存接口，防止争抢
   */
  public async getRedisCache(key: string): Promise<string | null> {
    const db = DatabaseManager.getInstance().getDatabase();
    return await db.get(key);
  }

  public async setRedisCache(key: string, value: string, ttl?: number): Promise<void> {
    const db = DatabaseManager.getInstance().getDatabase();
    await db.set(key, value, ttl);
  }

  public async delRedisCache(key: string): Promise<void> {
    const db = DatabaseManager.getInstance().getDatabase();
    await db.delete(key);
  }

  // 多播：返回所有命中的插件函数
  public getPluginFunctions(trigger: string): PluginFunction[] {
    const matched: PluginFunction[] = [];
    for (const func of this.pluginFunctions.values()) {
      if (func.triggers.some((t: string) => trigger.includes(t))) {
        matched.push(func);
      }
    }
    return matched;
  }

  public getPlugin(name: string): BasePlugin | undefined {
    return this.plugins.get(name);
  }

  public getAllPlugins(): BasePlugin[] {
    return Array.from(this.plugins.values());
  }

  public getEnabledPlugins(): BasePlugin[] {
    return Array.from(this.plugins.values()).filter(plugin => plugin.isEnabled());
  }

  public getDisabledPlugins(): BasePlugin[] {
    return Array.from(this.plugins.values()).filter(plugin => !plugin.isEnabled());
  }

  public getAllFunctions(): PluginFunction[] {
    return Array.from(this.pluginFunctions.values());
  }

  public getPluginLoadStats() {
    return { ...this.pluginLoadStats, total: this.totalLoadTime };
  }

  public getPluginMetadata(pluginName?: string): PluginMetadata | PluginMetadata[] {
    if (pluginName) {
      const metadata = this.pluginMetadata.get(pluginName);
      if (!metadata) throw new Error(`Plugin metadata not found: ${pluginName}`);
      return metadata;
    }
    
    return Array.from(this.pluginMetadata.values());
  }

  public getLoadOrder(): string[] {
    return [...this.pluginLoadOrder];
  }

  // 清理资源
  public destroy(): void {
    this.disableHotReload();
    
    // 卸载所有插件
    const pluginNames = Array.from(this.plugins.keys());
    for (const name of pluginNames) {
      this.unloadPlugin(name, { force: true, skipDependencyCheck: true }).catch(error => {
        Logger.error(`卸载插件 ${name} 时出错:`, error);
      });
    }
    
    // 清理HTTP服务
    this.cleanupAllPluginHttpServices();
    
    this.plugins.clear();
    this.pluginFunctions.clear();
    this.pluginStats.clear();
    this.pluginMetadata.clear();
    this.pluginLoadOrder = [];
    this.dependencyGraph.clear();
    this.executionQueue = [];
    
    Logger.info('[插件管理器] 已清理所有资源');
  }

  // HTTP服务管理方法
  public setHttpAdapter(adapter: OneBotHTTPAdapter): void {
    this.httpAdapter = adapter;
    Logger.info('HTTP适配器已设置到插件管理器');
  }

  /**
   * 注册插件HTTP路由到共享框架
   * 插件可以申请注册框架的HTTP目录以提供服务
   */
  public registerPluginHttpRoute(pluginName: string, route: Omit<PluginHttpRoute, 'pluginName'>): void {
    if (!this.httpAdapter) {
      throw new Error('HTTP适配器未设置，无法注册插件路由');
    }

    const fullRoute: PluginHttpRoute = {
      ...route,
      pluginName: pluginName
    };
    
    this.httpAdapter.registerPluginRoute(fullRoute);
    
    // 更新本地服务记录
    let service = this.pluginHttpServices.get(pluginName);
    if (!service) {
      service = {
        pluginName: pluginName,
        routes: []
      };
      this.pluginHttpServices.set(pluginName, service);
    }
    
    service.routes.push(fullRoute);
    Logger.info(`插件 ${pluginName} 注册HTTP路由: ${route.method} ${route.path}`);
  }

  /**
   * 批量注册插件HTTP路由到共享框架
   * 支持插件一次性注册多个路由
   */
  public registerPluginHttpRoutes(pluginName: string, routes: Omit<PluginHttpRoute, 'pluginName'>[]): void {
    if (!this.httpAdapter) {
      throw new Error('HTTP适配器未设置，无法注册插件路由');
    }

    for (const route of routes) {
      this.registerPluginHttpRoute(pluginName, route);
    }
    
    Logger.info(`插件 ${pluginName} 批量注册了 ${routes.length} 个HTTP路由`);
  }

  /**
   * 为插件申请专用的HTTP目录
   * 插件可以在 /plugins/{pluginName}/ 下注册任意路由
   */
  public requestPluginHttpDirectory(pluginName: string, options?: {
    middleware?: Array<(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void>;
    cors?: boolean;
    rateLimit?: { windowMs: number; max: number };
  }): string {
    if (!this.httpAdapter) {
      throw new Error('HTTP适配器未设置，无法申请插件HTTP目录');
    }

    const baseDirectory = `/plugins/${pluginName}`;
    
    // 注册通配符路由来处理该插件目录下的所有请求
    const wildcardRoute: PluginHttpRoute = {
      pluginName: pluginName,
      path: '/*',
      method: 'ALL',
      handler: async (req, res, body) => {
        // 默认处理器，插件可以通过注册具体路由来覆盖
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Route not found',
          message: `No handler registered for ${req.method} ${req.url}`,
          plugin: pluginName
        }));
      },
      middleware: options?.middleware
    };

    // 更新本地服务记录
    let service = this.pluginHttpServices.get(pluginName);
    if (!service) {
      service = {
        pluginName: pluginName,
        routes: [],
        directory: baseDirectory
      };
      this.pluginHttpServices.set(pluginName, service);
    } else {
      service.directory = baseDirectory;
    }

    Logger.info(`插件 ${pluginName} 申请HTTP目录: ${baseDirectory}`);
    return baseDirectory;
  }

  /**
   * 获取插件的HTTP目录信息
   */
  public getPluginHttpDirectory(pluginName: string): string | undefined {
    const service = this.pluginHttpServices.get(pluginName);
    return service?.directory;
  }

  /**
   * 列出所有插件的HTTP服务信息
   */
  public listAllPluginHttpServices(): Array<{
    pluginName: string;
    directory?: string;
    routes: number;
    independentServer?: { port: number; status: 'running' | 'stopped' };
  }> {
    return Array.from(this.pluginHttpServices.entries()).map(([name, service]) => ({
      pluginName: name,
      directory: service.directory,
      routes: service.routes.length,
      independentServer: service.server ? {
        port: service.port || 0,
        status: service.server.listening ? 'running' : 'stopped'
      } : undefined
    }));
  }

  public unregisterPluginHttpRoute(pluginName: string, method: string, path: string): void {
    if (!this.httpAdapter) {
      Logger.warn('HTTP适配器未设置，无法注销插件路由');
      return;
    }

    this.httpAdapter.unregisterPluginRoute(pluginName, method, path);

    // 从记录中移除
    const service = this.pluginHttpServices.get(pluginName);
    if (service) {
      service.routes = service.routes.filter((route: PluginHttpRoute) => 
        !(route.method === method && route.path === path)
      );
    }

    Logger.info(`插件 ${pluginName} 注销HTTP路由: ${method} ${path}`);
  }

  public unregisterAllPluginHttpRoutes(pluginName: string): void {
    if (!this.httpAdapter) {
      Logger.warn('HTTP适配器未设置，无法注销插件路由');
      return;
    }

    this.httpAdapter.unregisterPluginRoutes(pluginName);
    this.pluginHttpServices.delete(pluginName);
    Logger.info(`插件 ${pluginName} 的所有HTTP路由已注销`);
  }

  public async startPluginHttpServer(pluginName: string, port: number, routes: PluginHttpRoute[]): Promise<void> {
    const service = this.pluginHttpServices.get(pluginName);
    if (service?.server) {
      throw new Error(`插件 ${pluginName} 的HTTP服务器已在运行`);
    }

    const server = http.createServer(async (req, res) => {
      try {
        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = parsedUrl.pathname || '/';
        const method = req.method || 'GET';

        // 查找匹配的路由
        const route = routes.find(r => 
          (r.method === method || r.method === 'ALL') && 
          this.matchPath(pathname, r.path)
        );

        if (!route) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Route not found' }));
          return;
        }

        // 解析请求体
        const body = await this.parseRequestBody(req);

        // 执行中间件
        if (route.middleware) {
          for (const middleware of route.middleware) {
            await new Promise<void>((resolve, reject) => {
              middleware(req, res, () => resolve());
            });
          }
        }

        // 执行路由处理器
        await route.handler(req, res, body);

      } catch (error) {
        Logger.error(`插件HTTP服务器错误 ${pluginName}:`, error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(port, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    // 更新服务记录
    let pluginService = this.pluginHttpServices.get(pluginName);
    if (!pluginService) {
      pluginService = {
        pluginName: pluginName,
        routes: []
      };
      this.pluginHttpServices.set(pluginName, pluginService);
    }

    pluginService.server = server;
    pluginService.port = port;
    pluginService.routes = routes;

    Logger.info(`插件 ${pluginName} 的HTTP服务器已启动，端口: ${port}`);
  }

  public async stopPluginHttpServer(pluginName: string): Promise<void> {
    const service = this.pluginHttpServices.get(pluginName);
    if (!service?.server) {
      Logger.warn(`插件 ${pluginName} 的HTTP服务器未运行`);
      return;
    }

    await new Promise<void>((resolve) => {
      service.server!.close(() => resolve());
    });

    service.server = undefined;
    service.port = undefined;

    Logger.info(`插件 ${pluginName} 的HTTP服务器已停止`);
  }

  public getPluginHttpServices(): PluginHttpService[] {
    return Array.from(this.pluginHttpServices.values());
  }

  public getPluginHttpService(pluginName: string): PluginHttpService | undefined {
    return this.pluginHttpServices.get(pluginName);
  }

  private cleanupAllPluginHttpServices(): void {
    for (const [pluginName, service] of this.pluginHttpServices) {
      if (service.server) {
        service.server.close();
        Logger.info(`插件 ${pluginName} 的HTTP服务器已关闭`);
      }
    }
    this.pluginHttpServices.clear();
  }

  private matchPath(requestPath: string, routePath: string): boolean {
    // 简单的路径匹配，可以扩展为支持参数的路径匹配
    if (routePath.includes(':')) {
      // 支持参数路径，如 /api/:id
      const routePattern = routePath.replace(/:[\w]+/g, '[^/]+');
      const regex = new RegExp(`^${routePattern}$`);
      return regex.test(requestPath);
    }
    return requestPath === routePath;
  }

  private async parseRequestBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : null);
        } catch (error) {
          resolve(null);
        }
      });
      
      req.on('error', reject);
    });
  }
}
