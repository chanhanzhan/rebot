import { Plugin, PluginFunction } from '../common/types';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';

export class PluginManager {
  private static instance: PluginManager;
  private plugins: Map<string, Plugin> = new Map();
  private pluginFunctions: Map<string, PluginFunction> = new Map();
  private eventBus: FrameworkEventBus;

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
  }

  public static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  public async loadPlugin(plugin: Plugin): Promise<void> {
    try {
      Logger.info(`正在加载插件: ${plugin.name}`);
      
      await plugin.load();
      this.plugins.set(plugin.name, plugin);
      
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

  public getPluginFunction(trigger: string): PluginFunction | undefined {
    for (const func of this.pluginFunctions.values()) {
      if (func.triggers.some(t => trigger.includes(t))) {
        return func;
      }
    }
    return undefined;
  }

  public getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  public getAllFunctions(): PluginFunction[] {
    return Array.from(this.pluginFunctions.values());
  }
}
