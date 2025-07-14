import { Plugin, PluginFunction } from '../common/types';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';

export class PluginLoader {
  private static instance: PluginLoader;
  private plugins: Map<string, Plugin> = new Map();
  private pluginFunctions: Map<string, PluginFunction> = new Map();
  private eventBus: FrameworkEventBus;

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
  }

  public static getInstance(): PluginLoader {
    if (!PluginLoader.instance) {
      PluginLoader.instance = new PluginLoader();
    }
    return PluginLoader.instance;
  }

  public async loadPlugin(plugin: Plugin): Promise<void> {
    try {
      Logger.info(`Loading plugin: ${plugin.name}`);
      
      await plugin.load();
      this.plugins.set(plugin.name, plugin);
      
      const functions = plugin.getFunctions();
      for (const func of functions) {
        const key = `${plugin.name}.${func.name}`;
        this.pluginFunctions.set(key, func);
      }
      
      this.eventBus.safeEmit('plugin-loaded', plugin);
      Logger.info(`Plugin loaded successfully: ${plugin.name}`);
      
    } catch (error) {
      Logger.error(`Failed to load plugin ${plugin.name}:`, error);
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
      Logger.info(`Unloading plugin: ${pluginName}`);
      
      const functions = plugin.getFunctions();
      for (const func of functions) {
        const key = `${pluginName}.${func.name}`;
        this.pluginFunctions.delete(key);
      }
      
      await plugin.unload();
      this.plugins.delete(pluginName);
      
      this.eventBus.safeEmit('plugin-unloaded', plugin);
      Logger.info(`Plugin unloaded successfully: ${pluginName}`);
      
    } catch (error) {
      Logger.error(`Failed to unload plugin ${pluginName}:`, error);
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

  public getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  public getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  public getPluginFunction(trigger: string): PluginFunction | undefined {
    for (const func of this.pluginFunctions.values()) {
      if (func.triggers.some(t => trigger.includes(t))) {
        return func;
      }
    }
    return undefined;
  }

  public getAllFunctions(): PluginFunction[] {
    return Array.from(this.pluginFunctions.values());
  }
}