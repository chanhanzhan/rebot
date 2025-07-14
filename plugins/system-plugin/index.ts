import { Plugin, PluginFunction, Message, PermissionLevel } from '../../src/common/types';
import { Logger } from '../../src/config/log';
import { PluginManagerApp } from './apps/plugin-manager';
import { SystemInfoApp } from './apps/system-info';
import { LogViewerApp } from './apps/log-viewer';

/**
 * 系统管理插件
 * 提供框架管理、插件管理、系统监控等功能
 */
export class SystemPlugin implements Plugin {
  public name = 'system-plugin';
  public version = '1.0.0';
  public description = '系统管理插件，提供框架管理和监控功能';

  private functions: PluginFunction[] = [];
  private apps: Map<string, any> = new Map();

  constructor() {
    this.initializeApps();
    this.initializeFunctions();
  }

  private initializeApps(): void {
    this.apps.set('plugin-manager', new PluginManagerApp(this));
    this.apps.set('system-info', new SystemInfoApp(this));
    this.apps.set('log-viewer', new LogViewerApp(this));
  }

  private initializeFunctions(): void {
    this.functions = [
      // 插件管理
      {
        name: 'list-plugins',
        description: '列出所有插件',
        permission: PermissionLevel.ADMIN,
        triggers: ['plugins', '插件列表', 'list-plugins'],
        handler: this.apps.get('plugin-manager').listPlugins.bind(this.apps.get('plugin-manager'))
      },
      {
        name: 'reload-plugin',
        description: '重载指定插件',
        permission: PermissionLevel.OWNER,
        triggers: ['reload', '重载插件'],
        handler: this.apps.get('plugin-manager').reloadPlugin.bind(this.apps.get('plugin-manager'))
      },
      {
        name: 'enable-plugin',
        description: '启用插件',
        permission: PermissionLevel.OWNER,
        triggers: ['enable', '启用插件'],
        handler: this.apps.get('plugin-manager').enablePlugin.bind(this.apps.get('plugin-manager'))
      },
      {
        name: 'disable-plugin',
        description: '禁用插件',
        permission: PermissionLevel.OWNER,
        triggers: ['disable', '禁用插件'],
        handler: this.apps.get('plugin-manager').disablePlugin.bind(this.apps.get('plugin-manager'))
      },
      // 系统信息
      {
        name: 'system-info',
        description: '显示系统信息',
        permission: PermissionLevel.ADMIN,
        triggers: ['sysinfo', '系统信息', 'system'],
        handler: this.apps.get('system-info').showSystemInfo.bind(this.apps.get('system-info'))
      },
      {
        name: 'performance',
        description: '显示性能信息',
        permission: PermissionLevel.ADMIN,
        triggers: ['performance', '性能', 'perf'],
        handler: this.apps.get('system-info').showPerformance.bind(this.apps.get('system-info'))
      },
      // 日志查看
      {
        name: 'logs',
        description: '查看系统日志',
        permission: PermissionLevel.ADMIN,
        triggers: ['logs', '日志', 'log'],
        handler: this.apps.get('log-viewer').viewLogs.bind(this.apps.get('log-viewer'))
      },
      {
        name: 'errors',
        description: '查看错误日志',
        permission: PermissionLevel.ADMIN,
        triggers: ['errors', '错误日志', 'error-log'],
        handler: this.apps.get('log-viewer').viewErrors.bind(this.apps.get('log-viewer'))
      }
    ];
  }

  public async load(): Promise<void> {
    try {
      Logger.info(`Loading system plugin: ${this.name} v${this.version}`);
      
      // 初始化所有应用
      for (const [name, app] of this.apps) {
        if (app.initialize) {
          await app.initialize();
        }
      }
      
      Logger.info(`System plugin loaded successfully: ${this.name}`);
    } catch (error) {
      Logger.error(`Failed to load system plugin ${this.name}:`, error);
      throw error;
    }
  }

  public async unload(): Promise<void> {
    try {
      Logger.info(`Unloading system plugin: ${this.name}`);
      
      // 清理所有应用
      for (const [name, app] of this.apps) {
        if (app.cleanup) {
          await app.cleanup();
        }
      }
      
      Logger.info(`System plugin unloaded successfully: ${this.name}`);
    } catch (error) {
      Logger.error(`Failed to unload system plugin ${this.name}:`, error);
      throw error;
    }
  }

  public async reload(): Promise<void> {
    Logger.info(`Reloading system plugin: ${this.name}`);
    await this.unload();
    this.initializeApps();
    this.initializeFunctions();
    await this.load();
  }

  public getFunctions(): PluginFunction[] {
    return this.functions;
  }

  public getConfigPath(): string {
    return './plugins/system-plugin/config/config.yaml';
  }

  public getDataPath(): string {
    return './plugins/system-plugin/data';
  }

  public getApp(name: string): any {
    return this.apps.get(name);
  }
}

// 设置默认导出
export default SystemPlugin;
