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

  /**
   * 只允许从config/config/目录加载配置，路径以启动目录为基准
   */
  public loadConfig(name: string, filePath?: string, watchForChanges: boolean = true): any {
    // 用启动目录为基准
    const configDir = path.resolve(process.cwd(), 'config/config');
    let file = filePath;
    if (!file) file = path.join(configDir, `${name}.yaml`);
    if (!file.startsWith(configDir)) file = path.join(configDir, path.basename(file));
    try {
      Logger.info(`Loading config: ${name} from ${file}`);
      if (!fs.existsSync(file)) {
        Logger.error(`Config file not found: ${file}`);
        return {};
      }
      const fileContent = fs.readFileSync(file, 'utf8');
      let configData: any;
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        configData = yaml.load(fileContent);
      } else if (file.endsWith('.json')) {
        configData = JSON.parse(fileContent);
      } else {
        throw new Error(`Unsupported config file format: ${file}`);
      }
      const configFile: ConfigFile = {
        path: file,
        data: configData,
        lastModified: fs.statSync(file).mtime.getTime()
      };
      this.configs.set(name, configFile);
      if (watchForChanges) {
        this.fileWatcher.watchFile(`config-${name}`, file, (changedPath) => {
          this.reloadConfig(name);
        });
      }
      Logger.info(`Config loaded: ${name}`);
      return configFile.data;
    } catch (error) {
      Logger.error(`Failed to load config ${name}:`, error);
      return {};
    }
  }

  public reloadConfig(name: string): void {
    const config = this.configs.get(name);
    if (config) {
      Logger.info(`Reloading config: ${name}`);
      try {
        // 重新读取文件内容
        const fileContent = fs.readFileSync(config.path, 'utf8');
        let configData: any;
        if (config.path.endsWith('.yaml') || config.path.endsWith('.yml')) {
          configData = yaml.load(fileContent);
        } else if (config.path.endsWith('.json')) {
          configData = JSON.parse(fileContent);
        } else {
          throw new Error(`Unsupported config file format: ${config.path}`);
        }
        config.data = configData;
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
}