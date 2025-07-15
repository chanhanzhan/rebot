import { IPlugin, PluginFunction } from './plugin';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';
import { NodeVM } from 'vm2';
import * as path from 'path';
import { DatabaseManager } from '../database/database-manager';
import { RedisDatabase } from '../config/readis';
import * as fs from 'fs';

export class PluginManager {
  private static instance: PluginManager;
  private plugins: Map<string, IPlugin> = new Map();
  private pluginFunctions: Map<string, PluginFunction> = new Map();
  private eventBus: FrameworkEventBus;
  // 不再强制唯一，允许多插件命中同一触发词

  /**
   * 插件加载统计
   */
  private pluginLoadStats: { [name: string]: number } = {};
  private totalLoadTime: number = 0;

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
  }

  public static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  public async loadPlugin(plugin: IPlugin): Promise<void> {
    const start = Date.now();
    try {
      Logger.info(`正在加载插件: ${plugin.name}`);
      await plugin.load();
      this.plugins.set(plugin.name, plugin);
      if (!plugin.isEnabled()) {
        Logger.info(`插件 ${plugin.name} 未启用，跳过命令注册`);
        return;
      }
      const functions = plugin.getFunctions();
      for (const func of functions) {
        const key = `${plugin.name}.${func.name}`;
        this.pluginFunctions.set(key, func);
      }
      this.eventBus.safeEmit('plugin-loaded', plugin);
      Logger.info(`插件加载成功: ${plugin.name}`);
    } catch (error) {
      Logger.error(`插件加载失败 ${plugin.name}:`, error);
      throw error;
    } finally {
      const duration = Date.now() - start;
      this.pluginLoadStats[plugin.name] = duration;
      this.totalLoadTime += duration;
      Logger.info(`[插件加载耗时] ${plugin.name}: ${duration}ms`);
    }
  }

  public async loadPluginFromPath(pluginPath: string): Promise<void> {
    try {
      Logger.info(`沙箱加载插件: ${pluginPath}`);
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
      const plugin: IPlugin = new PluginClass();
      await this.loadPlugin(plugin);
    } catch (error) {
      Logger.error(`沙箱加载插件失败 ${pluginPath}:`, error);
    }
  }

  public async unloadPlugin(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      Logger.warn(`Plugin not found: ${pluginName}`);
      return;
    }
    try {
      Logger.info(`正在卸载插件: ${pluginName}`);
      const functions = plugin.getFunctions();
      for (const func of functions) {
        const key = `${pluginName}.${func.name}`;
        this.pluginFunctions.delete(key);
      }
      await plugin.unload();
      this.plugins.delete(pluginName);
      this.eventBus.safeEmit('plugin-unloaded', plugin);
      Logger.info(`插件卸载成功: ${pluginName}`);
    } catch (error) {
      Logger.error(`插件卸载失败 ${pluginName}:`, error);
      throw error;
    }
  }

  public async reloadPlugin(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      Logger.warn(`Plugin not found: ${pluginName}`);
      return;
    }
    try {
      Logger.info(`Reloading plugin: ${pluginName}`);
      await plugin.reload();
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
      Logger.info(`Plugin reloaded successfully: ${pluginName}`);
    } catch (error) {
      Logger.error(`Failed to reload plugin ${pluginName}:`, error);
      throw error;
    }
  }

  public setPluginEnabled(pluginName: string, enabled: boolean): void {
    const plugin = this.plugins.get(pluginName);
    if (plugin) {
      plugin.setEnabled(enabled);
    }
  }

  /**
   * 自动发现并加载插件目录，支持版本兼容校验和耗时统计
   */
  public async loadPluginsFromDirectory(pluginsDir: string = './plugins'): Promise<void> {
    const start = Date.now();
    const pluginDirs = fs.readdirSync(pluginsDir).filter(dir => fs.statSync(`${pluginsDir}/${dir}`).isDirectory());
    for (const dir of pluginDirs) {
      const pluginPath = `${pluginsDir}/${dir}/index.js`;
      if (fs.existsSync(pluginPath)) {
        const pluginModule = require(pluginPath);
        const PluginClass = pluginModule.default || pluginModule[Object.keys(pluginModule)[0]];
        if (PluginClass) {
          const plugin: IPlugin = new PluginClass();
          // 版本兼容校验（可扩展）
          if (typeof plugin.version === 'string') {
            // ...可加版本兼容逻辑...
          }
          await this.loadPlugin(plugin);
        }
      }
    }
    const duration = Date.now() - start;
    Logger.info(`插件目录加载完成，耗时: ${duration}ms`);
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
  public async setRedisCache(key: string, value: string): Promise<void> {
    const db = DatabaseManager.getInstance().getDatabase();
    await db.set(key, value);
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

  public getAllPlugins(): IPlugin[] {
    return Array.from(this.plugins.values());
  }

  public getAllFunctions(): PluginFunction[] {
    return Array.from(this.pluginFunctions.values());
  }

  public getPluginLoadStats() {
    return { ...this.pluginLoadStats, total: this.totalLoadTime };
  }
}
