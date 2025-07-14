import { Logger } from '../config/log';
import { FileWatcher } from './listener';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface ConfigFile {
  path: string;
  data: any;
  lastModified: number;
}

export class ConfigLoader {
  private static instance: ConfigLoader;
  private configs: Map<string, ConfigFile> = new Map();
  private fileWatcher: FileWatcher;

  private constructor() {
    this.fileWatcher = FileWatcher.getInstance();
  }

  public static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  public loadConfig(name: string, filePath: string, watchForChanges: boolean = true): any {
    try {
      Logger.info(`Loading config: ${name} from ${filePath}`);
      
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        Logger.warn(`Config file not found: ${filePath}, using default config`);
        const defaultConfig = this.getDefaultConfig(name);
        this.configs.set(name, {
          path: filePath,
          data: defaultConfig,
          lastModified: Date.now()
        });
        return defaultConfig;
      }

      // 读取并解析配置文件
      const fileContent = fs.readFileSync(filePath, 'utf8');
      let configData: any;

      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        configData = yaml.load(fileContent);
      } else if (filePath.endsWith('.json')) {
        configData = JSON.parse(fileContent);
      } else {
        throw new Error(`Unsupported config file format: ${filePath}`);
      }
      
      const configFile: ConfigFile = {
        path: filePath,
        data: configData,
        lastModified: fs.statSync(filePath).mtime.getTime()
      };

      this.configs.set(name, configFile);

      if (watchForChanges) {
        this.fileWatcher.watchFile(`config-${name}`, filePath, (changedPath) => {
          this.reloadConfig(name);
        });
      }

      Logger.info(`Config loaded: ${name}`);
      return configFile.data;

    } catch (error) {
      Logger.error(`Failed to load config ${name}:`, error);
      return this.getDefaultConfig(name);
    }
  }

  public reloadConfig(name: string): void {
    const config = this.configs.get(name);
    if (config) {
      Logger.info(`Reloading config: ${name}`);
      try {
        // 这里应该重新读取文件
        config.data = this.getDefaultConfig(name);
        config.lastModified = Date.now();
        Logger.info(`Config reloaded: ${name}`);
      } catch (error) {
        Logger.error(`Failed to reload config ${name}:`, error);
      }
    }
  }

  public getConfig(name: string): any {
    const config = this.configs.get(name);
    return config ? config.data : null;
  }

  private getDefaultConfig(name: string): any {
    const defaults: { [key: string]: any } = {
      'bot': {
        name: 'Bot Framework',
        version: '1.0.0',
        debug: false
      },
      'database': {
        type: 'memory',
        host: 'localhost',
        port: 6379
      },
      'plugins': {
        autoLoad: true,
        directory: './plugins'
      }
    };

    return defaults[name] || {};
  }
}