import { Logger } from './log';
import { ConfigLoader } from '../listener/loader';

export class ConfigInitializer {
  private static instance: ConfigInitializer;
  private configLoader: ConfigLoader;

  private constructor() {
    this.configLoader = ConfigLoader.getInstance();
  }

  public static getInstance(): ConfigInitializer {
    if (!ConfigInitializer.instance) {
      ConfigInitializer.instance = new ConfigInitializer();
    }
    return ConfigInitializer.instance;
  }

  public async initialize(): Promise<void> {
    try {
      Logger.info('Initializing configuration...');

      // 加载主配置文件
      await this.loadBotConfig();
      await this.loadDatabaseConfig();
      await this.loadPluginConfig();

      Logger.info('Configuration initialized successfully');
    } catch (error) {
      Logger.error('Failed to initialize configuration:', error);
      throw error;
    }
  }

  private async loadBotConfig(): Promise<void> {
    const config = this.configLoader.loadConfig('bot', './config/default_config/bot.yaml', true);
    Logger.info('Bot configuration loaded');
  }

  private async loadDatabaseConfig(): Promise<void> {
    const config = this.configLoader.loadConfig('database', './config/default_config/bot.yaml', true);
    Logger.info('Database configuration loaded');
  }

  private async loadPluginConfig(): Promise<void> {
    const config = this.configLoader.loadConfig('other', './config/default_config/other.yaml', true);
    Logger.info('Plugin configuration loaded');
  }

  public getConfig(name: string): any {
    return this.configLoader.getConfig(name);
  }
}