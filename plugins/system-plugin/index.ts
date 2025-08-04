import { BasePlugin, PluginMetadata, PluginFunction, RouteDefinition } from '../../src/plugins/base-plugin';
import { Message, PermissionLevel } from '../../src/common/types';
import { Logger } from '../../src/config/log';
import { PluginManagerApp } from './apps/plugin-manager';
import { SystemInfoApp } from './apps/system-info';
import { LogViewerApp } from './apps/log-viewer';

/**
 * 系统管理插件主入口
 * 继承 BasePlugin，apps 子模块全部注册到主类，集成插件管理命令
 */
export class SystemPlugin extends BasePlugin {
  public readonly metadata: PluginMetadata = {
    name: 'system-plugin',
    version: '2.0.0',
    description: '系统管理插件，提供框架管理和监控功能',
    author: 'System',
    dependencies: [],
    permissions: ['admin']
  };

  private functions: PluginFunction[] = [];
  private apps: Map<string, any> = new Map();

  constructor() {
    super();
  }

  protected async onLoad(): Promise<void> {
    Logger.info(`加载插件: ${this.metadata.name} v${this.metadata.version}`);
    this.initializeApps();
    this.initializeFunctions();
    Logger.info(`插件加载完成: ${this.metadata.name}`);
  }

  protected async onInitialize(): Promise<void> {
    Logger.info(`初始化插件: ${this.metadata.name}`);
    for (const [name, app] of this.apps) {
      if (app.initialize) {
        await app.initialize();
        Logger.debug(`初始化子模块: ${name}`);
      }
    }
    Logger.info(`插件初始化完成: ${this.metadata.name}`);
  }

  protected async onStart(): Promise<void> {
    Logger.info(`启动插件: ${this.metadata.name}`);
    Logger.info(`插件启动完成: ${this.metadata.name}`);
  }

  protected async onStop(): Promise<void> {
    Logger.info(`停止插件: ${this.metadata.name}`);
    Logger.info(`插件停止完成: ${this.metadata.name}`);
  }

  protected async onUnload(): Promise<void> {
    Logger.info(`卸载插件: ${this.metadata.name}`);
    for (const [name, app] of this.apps) {
      if (app.cleanup) {
        await app.cleanup();
        Logger.debug(`清理子模块: ${name}`);
      }
    }
    Logger.info(`插件卸载完成: ${this.metadata.name}`);
  }

  protected getRoutes(): RouteDefinition[] {
    return [];
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
        parameters: [],
        handler: this.apps.get('plugin-manager').listPlugins.bind(this.apps.get('plugin-manager'))
      },
      {
        name: 'reload-plugin',
        description: '重载指定插件',
        parameters: [{ name: 'pluginName', type: 'string', description: '插件名称' }],
        handler: this.apps.get('plugin-manager').reloadPlugin.bind(this.apps.get('plugin-manager'))
      },
      {
        name: 'enable-plugin',
        description: '启用插件',
        parameters: [{ name: 'pluginName', type: 'string', description: '插件名称' }],
        handler: this.apps.get('plugin-manager').enablePlugin.bind(this.apps.get('plugin-manager'))
      },
      {
        name: 'disable-plugin',
        description: '禁用插件',
        parameters: [{ name: 'pluginName', type: 'string', description: '插件名称' }],
        handler: this.apps.get('plugin-manager').disablePlugin.bind(this.apps.get('plugin-manager'))
      },
      {
        name: 'system-info',
        description: '显示系统信息',
        parameters: [],
        handler: this.apps.get('system-info').showSystemInfo.bind(this.apps.get('system-info'))
      },
      {
        name: 'performance',
        description: '显示性能信息',
        parameters: [],
        handler: this.apps.get('system-info').showPerformance.bind(this.apps.get('system-info'))
      },
      {
        name: 'logs',
        description: '查看系统日志',
        parameters: [{ name: 'lines', type: 'number', description: '日志行数', default: 50 }],
        handler: this.apps.get('log-viewer').viewLogs.bind(this.apps.get('log-viewer'))
      },
      {
        name: 'errors',
        description: '查看错误日志',
        parameters: [{ name: 'lines', type: 'number', description: '日志行数', default: 50 }],
        handler: this.apps.get('log-viewer').viewErrors.bind(this.apps.get('log-viewer'))
      }
    ];
  }



  public getFunctions(): PluginFunction[] {
    const functions: PluginFunction[] = [];
    
    for (const [name, app] of this.apps) {
      if (app.getFunctions) {
        const appFunctions = app.getFunctions();
        functions.push(...appFunctions);
      }
    }
    
    return functions;
  }

  public async healthCheck(): Promise<boolean> {
    try {
      // 检查插件是否正常运行
      if (!this.lifecycleState.isLoaded || !this.lifecycleState.isInitialized) {
        return false;
      }
      
      // 检查所有子应用是否正常
      for (const [name, app] of this.apps) {
        if (app.healthCheck && !(await app.healthCheck())) {
          Logger.debug(`子模块健康检查失败: ${name}`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      Logger.error(`SystemPlugin 健康检查异常`, error);
      return false;
    }
  }

  public async onHotReload(): Promise<void> {
    Logger.info(`插件 ${this.name} 热重载`);
  }
}

export default SystemPlugin;
