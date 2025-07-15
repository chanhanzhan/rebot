import { Logger } from './log';
import { ConfigLoader } from '../listener/loader';
import * as fs from 'fs';
import * as path from 'path';

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

  /**
   * 初始化配置文件：如config/config/下无对应文件，则从config/default_config复制。
   * 路径始终以运行目录为基准，兼容源码和dist。
   */
  private ensureConfigFiles() {
    const defaultDir = path.resolve(process.cwd(), 'config/default_config');
    const configDir = path.resolve(process.cwd(), 'config/config');
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    for (const file of fs.readdirSync(defaultDir)) {
      const target = path.join(configDir, file);
      if (!fs.existsSync(target)) {
        fs.copyFileSync(path.join(defaultDir, file), target);
        Logger.info(`初始化配置文件: ${file} => config/config/`);
      }
    }
  }

  public async initialize(): Promise<void> {
    try {
      Logger.info('Initializing configuration...');
      this.ensureConfigFiles();
      // 只加载config/config/目录下的配置
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
    const config = this.configLoader.loadConfig('bot', './config/config/bot.yaml', true);
    Logger.info('Bot configuration loaded');
  }

  private async loadDatabaseConfig(): Promise<void> {
    // 注意：此处文件名为radis.yaml，建议后续统一为redis.yaml
    const config = this.configLoader.loadConfig('database', './config/config/radis.yaml', true);
    Logger.info('Database configuration loaded');
  }

  private async loadPluginConfig(): Promise<void> {
    const config = this.configLoader.loadConfig('other', './config/config/other.yaml', true);
    Logger.info('Plugin configuration loaded');
  }

  public getConfig(name: string): any {
    return this.configLoader.getConfig(name);
  }
}