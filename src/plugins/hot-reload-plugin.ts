import { Plugin, PluginFunction } from '../common/types';
import { Logger } from '../config/log';
import { FileWatcher } from '../listener/listener';

export interface PluginConfig {
  name: string;
  enabled: boolean;
  autoReload: boolean;
  configPath?: string;
}

export class HotReloadPlugin implements Plugin {
  public name: string;
  public version: string;
  public description: string;
  
  private config: PluginConfig;
  private functions: PluginFunction[] = [];
  private fileWatcher: FileWatcher;
  private pluginPath: string;

  constructor(name: string, version: string, description: string, pluginPath: string) {
    this.name = name;
    this.version = version;
    this.description = description;
    this.pluginPath = pluginPath;
    this.fileWatcher = FileWatcher.getInstance();
    
    this.config = {
      name: this.name,
      enabled: true,
      autoReload: true
    };
  }

  public async load(): Promise<void> {
    try {
      Logger.info(`Loading hot-reload plugin: ${this.name}`);
      
      // 加载插件配置
      await this.loadConfig();
      
      // 初始化插件功能
      await this.initializeFunctions();
      
      // 如果启用了自动重载，监听文件变化
      if (this.config.autoReload) {
        this.setupFileWatcher();
      }
      
      Logger.info(`Hot-reload plugin loaded: ${this.name}`);
    } catch (error) {
      Logger.error(`Failed to load hot-reload plugin ${this.name}:`, error);
      throw error;
    }
  }

  public async unload(): Promise<void> {
    try {
      Logger.info(`Unloading hot-reload plugin: ${this.name}`);
      
      // 停止文件监听
      this.fileWatcher.unwatchFile(`plugin-${this.name}`);
      this.fileWatcher.unwatchFile(`config-${this.name}`);
      
      // 清理资源
      this.functions = [];
      
      Logger.info(`Hot-reload plugin unloaded: ${this.name}`);
    } catch (error) {
      Logger.error(`Failed to unload hot-reload plugin ${this.name}:`, error);
      throw error;
    }
  }

  public async reload(): Promise<void> {
    Logger.info(`Reloading hot-reload plugin: ${this.name}`);
    
    try {
      await this.unload();
      await this.load();
      Logger.info(`Hot-reload plugin reloaded successfully: ${this.name}`);
    } catch (error) {
      Logger.error(`Failed to reload hot-reload plugin ${this.name}:`, error);
      throw error;
    }
  }

  public getFunctions(): PluginFunction[] {
    return this.functions.filter(() => this.config.enabled);
  }

  public getConfigPath(): string {
    return this.config.configPath || `./plugins/${this.name}/config.yaml`;
  }

  private async loadConfig(): Promise<void> {
    try {
      // 这里应该从配置文件加载配置
      // 为了演示，使用默认配置
      Logger.debug(`Loading config for plugin: ${this.name}`);
    } catch (error) {
      Logger.warn(`Failed to load config for plugin ${this.name}, using defaults:`, error);
    }
  }

  private async initializeFunctions(): Promise<void> {
    // 这里应该动态加载插件的功能函数
    // 为了演示，添加一个示例函数
    this.functions = [
      {
        name: 'reload',
        description: '重载插件',
        permission: 2, // 管理员权限
        triggers: [`reload ${this.name}`, `重载 ${this.name}`],
        handler: async (message, args) => {
          Logger.info(`Reload command triggered for plugin: ${this.name}`);
          await this.reload();
        }
      }
    ];
  }

  private setupFileWatcher(): void {
    // 监听插件文件变化
    this.fileWatcher.watchFile(`plugin-${this.name}`, this.pluginPath, () => {
      Logger.info(`Plugin file changed, reloading: ${this.name}`);
      this.reload().catch(error => {
        Logger.error(`Auto-reload failed for plugin ${this.name}:`, error);
      });
    });

    // 监听配置文件变化
    const configPath = this.getConfigPath();
    this.fileWatcher.watchFile(`config-${this.name}`, configPath, () => {
      Logger.info(`Config file changed, reloading config: ${this.name}`);
      this.loadConfig().catch(error => {
        Logger.error(`Config reload failed for plugin ${this.name}:`, error);
      });
    });
  }

  public setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    Logger.info(`Plugin ${this.name} ${enabled ? 'enabled' : 'disabled'}`);
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public setAutoReload(autoReload: boolean): void {
    this.config.autoReload = autoReload;
    
    if (autoReload) {
      this.setupFileWatcher();
    } else {
      this.fileWatcher.unwatchFile(`plugin-${this.name}`);
      this.fileWatcher.unwatchFile(`config-${this.name}`);
    }
    
    Logger.info(`Plugin ${this.name} auto-reload ${autoReload ? 'enabled' : 'disabled'}`);
  }
}