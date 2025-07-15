import { BasePlugin, IPlugin } from '../../src/plugins/plugin';
import { PluginFunction, Message, PermissionLevel } from '../../src/common/types';
import { Logger } from '../../src/config/log';
import { PluginManagerApp } from './apps/plugin-manager';
import { SystemInfoApp } from './apps/system-info';
import { LogViewerApp } from './apps/log-viewer';

/**
 * 系统管理插件主入口
 * 继承 BasePlugin，apps 子模块全部注册到主类，集成插件管理命令
 */
export class SystemPlugin extends BasePlugin implements IPlugin {
  public name = 'system-plugin';
  public version = '2.0.0';
  public description = '系统管理插件，提供框架管理和监控功能';

  private functions: PluginFunction[] = [];
  private apps: Map<string, any> = new Map();

  constructor() {
    super();
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
    Logger.info(`加载插件: ${this.name} v${this.version}`);
    for (const [name, app] of this.apps) {
      if (app.initialize) {
        await app.initialize();
        Logger.debug(`初始化子模块: ${name}`);
      }
    }
    Logger.info(`插件加载完成: ${this.name}`);
  }

  public async unload(): Promise<void> {
    Logger.info(`卸载插件: ${this.name}`);
    for (const [name, app] of this.apps) {
      if (app.cleanup) {
        await app.cleanup();
        Logger.debug(`清理子模块: ${name}`);
      }
    }
    Logger.info(`插件卸载完成: ${this.name}`);
  }

  public getFunctions(): PluginFunction[] {
    return this.enabled ? this.functions : [];
  }

  public async onHotReload(): Promise<void> {
    Logger.info(`插件 ${this.name} 热重载`);
  }
}

export default SystemPlugin;
