import { Logger } from '../config/log';
import { ConfigManager } from '../config/config';
import { PluginManager } from '../plugins/plugin-manager';
import { AdapterManager } from '../adapter/adapter-manager';
import { MessageHandler } from './message-handler';
import { DatabaseManager } from '../database/database-manager';
import { FrameworkEventBus } from '../common/event-bus';
import { Adapter, Plugin } from '../common/types';

export class BotFramework {
  private static instance: BotFramework;
  private isRunning: boolean = false;
  
  private configManager: ConfigManager;
  private pluginManager: PluginManager;
  private adapterManager: AdapterManager;
  private messageHandler: MessageHandler;
  private databaseManager: DatabaseManager;
  private eventBus: FrameworkEventBus;

  private constructor() {
    this.configManager = ConfigManager.getInstance();
    this.pluginManager = PluginManager.getInstance();
    this.adapterManager = AdapterManager.getInstance();
    this.messageHandler = MessageHandler.getInstance();
    this.databaseManager = DatabaseManager.getInstance();
    this.eventBus = FrameworkEventBus.getInstance();
    
    // 监听框架事件
    this.setupEventListeners();
  }

  public static getInstance(): BotFramework {
    if (!BotFramework.instance) {
      BotFramework.instance = new BotFramework();
    }
    return BotFramework.instance;
  }

  private setupEventListeners(): void {
    // 监听错误事件
    this.eventBus.on('error', (error: Error) => {
      Logger.error('框架错误:', error);
    });

    // 监听插件加载事件
    this.eventBus.on('plugin-loaded', (plugin: Plugin) => {
      Logger.info(`插件已加载: ${plugin.name} v${plugin.version}`);
    });

    // 监听插件卸载事件
    this.eventBus.on('plugin-unloaded', (plugin: Plugin) => {
      Logger.info(`插件已卸载: ${plugin.name}`);
    });
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      Logger.warn('框架已在运行中');
      return;
    }

    try {
      Logger.info('正在启动机器人框架...');
      
      // 连接数据库
      await this.databaseManager.connect();
      Logger.info('数据库已连接');
      
      // 加载插件
      const config = this.configManager.getConfig();
      if (config.plugins && config.plugins.autoLoad) {
        await this.loadPluginsFromDirectory(config.plugins.directory);
      }
      
      // 从配置初始化器获取配置并自动加载适配器
      const { ConfigInitializer } = await import('../config/init');
      const configInit = ConfigInitializer.getInstance();
      const botConfig = configInit.getConfig('bot');
      
    //  Logger.info('框架启动时获取的bot配置:', JSON.stringify(botConfig, null, 2));
      
      if (botConfig) {
        await this.adapterManager.loadAdaptersFromConfig(botConfig);
      } else {
        Logger.warn('未找到bot配置，跳过适配器自动加载');
      }
      
      this.isRunning = true;
      Logger.info('机器人框架启动成功');
      
    } catch (error) {
      Logger.error('框架启动失败:', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      Logger.warn('框架未在运行中');
      return;
    }

    try {
      Logger.info('正在停止机器人框架...');
      
      // 卸载所有插件
      const plugins = this.pluginManager.getAllPlugins();
      for (const plugin of plugins) {
        await this.pluginManager.unloadPlugin(plugin.name);
      }
      
      // 断开所有适配器
      const adapters = this.adapterManager.getAllAdapters();
      for (const adapter of adapters) {
        await this.adapterManager.unregisterAdapter(adapter.name);
      }
      
      // 断开数据库连接
      await this.databaseManager.disconnect();
      
      this.isRunning = false;
      Logger.info('机器人框架停止成功');
      
    } catch (error) {
      Logger.error('停止框架时出错:', error);
      throw error;
    }
  }

  public async registerAdapter(adapter: Adapter): Promise<void> {
    await this.adapterManager.registerAdapter(adapter);
  }

  public async loadPlugin(plugin: Plugin): Promise<void> {
    await this.pluginManager.loadPlugin(plugin);
  }

  public async unloadPlugin(pluginName: string): Promise<void> {
    await this.pluginManager.unloadPlugin(pluginName);
  }

  public async reloadPlugin(pluginName: string): Promise<void> {
    await this.pluginManager.reloadPlugin(pluginName);
  }

  private async loadPluginsFromDirectory(directory: string): Promise<void> {
    try {
      Logger.info(`正在从目录自动加载插件: ${directory}`);
      
      const fs = await import('fs');
      const path = await import('path');
      
      // 检查插件目录是否存在
      if (!fs.existsSync(directory)) {
        Logger.warn(`插件目录不存在: ${directory}`);
        return;
      }
      
      // 读取插件目录
      const pluginDirs = fs.readdirSync(directory, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      Logger.info(`发现 ${pluginDirs.length} 个插件目录: ${pluginDirs.join(', ')}`);
      
      // 加载每个插件
      for (const pluginDir of pluginDirs) {
        await this.loadPluginFromDirectory(path.join(directory, pluginDir));
      }
      
    } catch (error) {
      Logger.error('自动加载插件失败:', error);
    }
  }

  private async loadPluginFromDirectory(pluginPath: string): Promise<void> {
    try {
      const path = await import('path');
      const fs = await import('fs');
      
      // 构建dist目录中的路径
      const pluginName = path.basename(pluginPath);
      const distPluginPath = path.join(process.cwd(), 'dist', 'plugins', pluginName);
      const indexJsPath = path.join(distPluginPath, 'index.js');
      
      if (!fs.existsSync(indexJsPath)) {
        Logger.warn(`插件编译文件不存在: ${indexJsPath}`);
        return;
      }
      
      // 动态导入插件
      const pluginModule = await import(path.resolve(indexJsPath));
      const PluginClass = pluginModule.default || pluginModule[Object.keys(pluginModule)[0]];
      
      if (!PluginClass) {
        Logger.warn(`无法从 ${pluginPath} 加载插件类`);
        return;
      }
      
      const plugin = new PluginClass();
      await this.loadPlugin(plugin);
      
      Logger.info(`自动加载插件成功: ${plugin.name}`);
      
    } catch (error) {
      Logger.error(`加载插件失败 ${pluginPath}:`, error);
    }
  }

  public getStatus(): { isRunning: boolean; pluginCount: number; adapterCount: number } {
    return {
      isRunning: this.isRunning,
      pluginCount: this.pluginManager.getAllPlugins().length,
      adapterCount: this.adapterManager.getAllAdapters().length
    };
  }
}