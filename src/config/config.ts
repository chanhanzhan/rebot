import { Logger } from './log';

export interface BotConfig {
  name: string;
  adapters: {
    [key: string]: any;
  };
  database: {
    type: 'sqlite' | 'redis';
    sqlite?: {
      path: string;
    };
    redis?: {
      host: string;
      port: number;
      password?: string;
      db?: number;
    };
  };
  plugins: {
    directory: string;
    autoLoad: boolean;
  };
}

export class ConfigManager {
  private static instance: ConfigManager;
  private config: BotConfig;

  private constructor() {
    this.config = this.getDefaultConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private getDefaultConfig(): BotConfig {
    return {
      name: 'Bot Framework',
      adapters: {},
      database: {
        type: 'sqlite',
        sqlite: {
          path: './data/bot.db'
        }
      },
      plugins: {
        directory: './plugins',
        autoLoad: true
      }
    };
  }

  public getConfig(): BotConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<BotConfig>): void {
    this.config = { ...this.config, ...newConfig };
    Logger.info('Configuration updated');
  }

  public get<T>(path: string): T | undefined {
    const keys = path.split('.');
    let current: any = this.config;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    
    return current as T;
  }

  public set(path: string, value: any): void {
    const keys = path.split('.');
    let current: any = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[keys[keys.length - 1]] = value;
    Logger.info(`Configuration value set: ${path} = ${JSON.stringify(value)}`);
  }
}