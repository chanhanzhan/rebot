import { BasePlugin } from '../../src/plugins/base-plugin';
import { Logger } from '../../src/config/log';
import { PluginMetadata, RouteDefinition } from '../../src/plugins/base-plugin';
import * as http from 'http';

/**
 * 示例插件 - 重构版本
 * 继承BasePlugin，支持自管理生命周期和动态路由申请
 */
export class ExamplePlugin extends BasePlugin {
  public readonly metadata: PluginMetadata = {
    name: 'example-plugin',
    version: '2.0.0',
    description: '示例插件，展示插件开发的基本功能',
    author: 'Plugin Developer',
    dependencies: [],
    permissions: [],
    config: {
      enableGreeting: true,
      maxMessages: 1000,
      debugMode: false
    }
  };

  private messageCount: number = 0;

  /**
   * 插件初始化时调用
   */
  protected async onInitialize(): Promise<void> {
    Logger.debug('示例插件初始化中...');
    // 初始化插件特定的资源
  }

  /**
   * 插件加载
   */
  protected async onLoad(): Promise<void> {
    Logger.info('🔧 示例插件开始加载');
    
    // 初始化插件状态
    this.messageCount = 0;
    
    // 初始化配置
    this.initializeConfig();
    
    Logger.info('✅ 示例插件加载完成');
  }

  /**
   * 插件启动
   */
  protected async onStart(): Promise<void> {
    Logger.info('🚀 示例插件开始启动');
    
    // 申请路由
    await this.requestRoutes();
    
    // 设置事件监听
    this.setupEventListeners();
    
    Logger.info('✅ 示例插件启动完成');
  }

  /**
   * 插件停止
   */
  protected async onStop(): Promise<void> {
    Logger.info('🔄 示例插件开始停止');
    
    // 释放路由
    await this.releaseRoutes();
    
    // 清理事件监听
    this.cleanupEventListeners();
    
    Logger.info('✅ 示例插件停止完成');
  }

  /**
   * 插件卸载
   */
  protected async onUnload(): Promise<void> {
    Logger.info('🗑️ 示例插件开始卸载');
    
    // 清理资源
    this.cleanup();
    
    Logger.info('✅ 示例插件卸载完成');
  }

  /**
   * 获取路由定义
   */
  protected getRoutes(): RouteDefinition[] {
    return [
      {
        path: '/apps',
        method: 'GET',
        handler: this.handleAppsRequest.bind(this),
        description: '获取应用列表'
      },
      {
        path: '/apps/info',
        method: 'GET',
        handler: this.handleAppInfo.bind(this),
        description: '获取应用信息'
      },
      {
        path: '/apps/greeting',
        method: 'POST',
        handler: this.handleGreeting.bind(this),
        description: '发送问候消息'
      },
      {
        path: '/apps/stats',
        method: 'GET',
        handler: this.handleStats.bind(this),
        description: '获取插件统计信息'
      }
    ];
  }

  /**
   * 初始化配置
   */
  private initializeConfig(): void {
    // 从环境变量或配置文件读取配置
    const config = {
      enableGreeting: process.env.ENABLE_GREETING !== 'false',
      maxMessages: parseInt(process.env.MAX_MESSAGES || '1000'),
      debugMode: process.env.DEBUG_MODE === 'true'
    };

    this.setConfig(config);
    Logger.debug('示例插件配置已初始化', config);
  }

  /**
   * 设置事件监听
   */
  private setupEventListeners(): void {
    // 监听消息事件
    this.eventBus.on('message-received', this.handleMessage.bind(this));
    
    // 监听框架事件
    this.eventBus.on('framework-ready', this.handleFrameworkReady.bind(this));
    
    Logger.debug('示例插件事件监听器已设置');
  }

  /**
   * 清理事件监听
   */
  private cleanupEventListeners(): void {
    // 移除事件监听器
    this.eventBus.off('message-received', this.handleMessage.bind(this));
    this.eventBus.off('framework-ready', this.handleFrameworkReady.bind(this));
    
    Logger.debug('示例插件事件监听器已清理');
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    this.messageCount = 0;
    Logger.debug('示例插件资源清理完成');
  }

  // HTTP处理器方法

  /**
   * 处理应用列表请求
   */
  private async handleAppsRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const apps = [
        {
          id: 'example-app',
          name: '示例应用',
          version: this.metadata.version,
          description: '这是一个示例应用',
          status: 'running'
        }
      ];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: apps,
        timestamp: new Date().toISOString()
      }));

    } catch (error) {
      Logger.error('处理应用列表请求失败', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  /**
   * 处理应用信息请求
   */
  private async handleAppInfo(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const appInfo = {
        plugin: this.metadata,
        state: this.getLifecycleState(),
        config: this.getConfig(),
        stats: {
          messageCount: this.messageCount,
          uptime: this.getLifecycleState().startTime ? Date.now() - this.getLifecycleState().startTime! : 0
        },
        timestamp: new Date().toISOString()
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: appInfo
      }));

    } catch (error) {
      Logger.error('处理应用信息请求失败', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  /**
   * 处理问候请求
   */
  private async handleGreeting(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (!this.config.enableGreeting) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: '问候功能已禁用'
        }));
        return;
      }

      const { name = '朋友' } = (req as any).body || {};
      const greeting = `你好，${name}！欢迎使用示例插件。`;

      // 增加消息计数
      this.messageCount++;

      // 发送事件
      this.eventBus.emit('plugin-greeting', {
        plugin: this.metadata.name,
        message: greeting,
        target: name
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: {
          message: greeting,
          messageCount: this.messageCount
        },
        timestamp: new Date().toISOString()
      }));

    } catch (error) {
      Logger.error('处理问候请求失败', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  /**
   * 处理统计信息请求
   */
  private async handleStats(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const stats = {
        messageCount: this.messageCount,
        maxMessages: this.config.maxMessages,
        uptime: this.getLifecycleState().startTime ? Date.now() - this.getLifecycleState().startTime! : 0,
        memoryUsage: process.memoryUsage(),
        isHealthy: await this.healthCheck(),
        timestamp: new Date().toISOString()
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: stats
      }));

    } catch (error) {
      Logger.error('处理统计信息请求失败', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  // 事件处理器方法

  /**
   * 处理消息事件
   */
  private handleMessage(event: any): void {
    try {
      if (this.config.debugMode) {
        Logger.debug('示例插件收到消息事件', event);
      }

      this.messageCount++;

      // 检查消息数量限制
      if (this.messageCount > this.config.maxMessages) {
        Logger.warn(`示例插件消息数量超过限制: ${this.messageCount}/${this.config.maxMessages}`);
      }

    } catch (error) {
      Logger.error('处理消息事件失败', error);
    }
  }

  /**
   * 处理框架就绪事件
   */
  private handleFrameworkReady(event: any): void {
    try {
      Logger.info('示例插件收到框架就绪事件');
      
      // 可以在这里执行一些初始化后的操作
      if (this.config.enableGreeting) {
        Logger.info('示例插件问候功能已启用');
      }

    } catch (error) {
      Logger.error('处理框架就绪事件失败', error);
    }
  }

  /**
   * 健康检查
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // 检查插件是否正常运行
      if (!this.lifecycleState.isLoaded || !this.lifecycleState.isInitialized) {
        return false;
      }
      
      const isRunning = this.isRunning && this.getLifecycleState().isStarted;
      
      // 检查消息数量是否在合理范围内
      const messageCountOk = this.messageCount <= this.config.maxMessages;
      
      // 检查内存使用情况
      const memoryUsage = process.memoryUsage();
      const memoryOk = memoryUsage.heapUsed < 512 * 1024 * 1024; // 512MB
      
      return isRunning && messageCountOk && memoryOk;
      
    } catch (error) {
      Logger.error('示例插件健康检查失败', error);
      return false;
    }
  }

  /**
   * 获取插件特定的统计信息
   */
  public getPluginStats(): any {
    return {
      messageCount: this.messageCount,
      maxMessages: this.config.maxMessages,
      greetingEnabled: this.config.enableGreeting,
      debugMode: this.config.debugMode
    };
  }

  /**
   * 重置消息计数
   */
  public resetMessageCount(): void {
    this.messageCount = 0;
    Logger.info('示例插件消息计数已重置');
  }
}

// 导出插件类
export default ExamplePlugin;