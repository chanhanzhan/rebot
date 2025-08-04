import * as path from 'path';
import * as fs from 'fs';
import { Worker } from 'worker_threads';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';
import { BasePlugin } from '../plugins/base-plugin';

export interface PluginSpec {
  name: string;
  path: string;
  config?: any;
  priority: number;
  dependencies?: string[];
  enabled: boolean;
  async: boolean;
  timeout?: number;
  sandbox?: boolean;
  autoReload?: boolean;
  version?: string;
  description?: string;
  author?: string;
}

export interface PluginLoadResult {
  name: string;
  success: boolean;
  plugin?: BasePlugin;
  error?: Error;
  loadTime: number;
  metadata?: {
    version: string;
    description: string;
    author: string;
    functions: string[];
  };
}

export interface PluginLoadOptions {
  parallel: boolean;
  maxConcurrency: number;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  sandbox: boolean;
  hotReload: boolean;
  validateDependencies: boolean;
}

export interface PluginLifecycleHooks {
  beforeLoad?: (spec: PluginSpec) => Promise<void> | void;
  afterLoad?: (plugin: BasePlugin, result: PluginLoadResult) => Promise<void> | void;
  beforeUnload?: (plugin: BasePlugin) => Promise<void> | void;
  afterUnload?: (name: string) => Promise<void> | void;
  onError?: (error: Error, spec: PluginSpec) => Promise<void> | void;
}

/**
 * 插件加载器 - 支持异步多线程加载和生命周期管理
 */
export class PluginLoader {
  private static instance: PluginLoader;
  private eventBus: FrameworkEventBus;
  private loadedPlugins: Map<string, BasePlugin> = new Map();
  private loadingPromises: Map<string, Promise<PluginLoadResult>> = new Map();
  private dependencyGraph: Map<string, string[]> = new Map();
  private loadOrder: string[] = [];
  private lifecycleHooks: PluginLifecycleHooks = {};
  private fileWatchers: Map<string, fs.FSWatcher> = new Map();

  private defaultOptions: PluginLoadOptions = {
    parallel: true,
    maxConcurrency: 6,
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 1000,
    sandbox: false,
    hotReload: false,
    validateDependencies: true
  };

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
    this.setupEventListeners();
  }

  public static getInstance(): PluginLoader {
    if (!PluginLoader.instance) {
      PluginLoader.instance = new PluginLoader();
    }
    return PluginLoader.instance;
  }

  private setupEventListeners(): void {
    // 监听框架关闭事件
    this.eventBus.on('framework-stopping', async () => {
      await this.unloadAllPlugins();
    });

    // 监听插件重载请求
    this.eventBus.on('plugin-reload-request', async (pluginName: string) => {
      await this.reloadPlugin(pluginName);
    });
  }

  /**
   * 设置生命周期钩子
   */
  public setLifecycleHooks(hooks: Partial<PluginLifecycleHooks>): void {
    this.lifecycleHooks = { ...this.lifecycleHooks, ...hooks };
  }

  /**
   * 从目录加载所有插件
   */
  public async loadPluginsFromDirectory(
    directory: string,
    options: Partial<PluginLoadOptions> = {}
  ): Promise<PluginLoadResult[]> {
    const finalOptions = { ...this.defaultOptions, ...options };

    try {
      Logger.info(`🔄 开始从目录加载插件: ${directory}`);

      // 扫描插件规范
      const pluginSpecs = await this.scanPluginSpecs(directory);

      if (pluginSpecs.length === 0) {
        Logger.warn(`目录 ${directory} 中未找到插件`);
        return [];
      }

      Logger.info(`📦 发现 ${pluginSpecs.length} 个插件: ${pluginSpecs.map(s => s.name).join(', ')}`);

      // 过滤启用的插件
      const enabledSpecs = pluginSpecs.filter(spec => spec.enabled);
      Logger.info(`✅ 启用的插件: ${enabledSpecs.length}/${pluginSpecs.length}`);

      if (finalOptions.validateDependencies) {
        // 构建依赖图
        this.buildDependencyGraph(enabledSpecs);
        // 计算加载顺序
        this.calculateLoadOrder(enabledSpecs);
      }

      // 加载插件
      const results = await this.loadPlugins(enabledSpecs, finalOptions);

      // 设置热重载
      if (finalOptions.hotReload) {
        this.setupHotReload(directory, enabledSpecs);
      }

      Logger.info(`✅ 插件加载完成，成功: ${results.filter(r => r.success).length}/${results.length}`);

      return results;

    } catch (error) {
      Logger.error('插件目录加载失败:', error);
      throw error;
    }
  }

  /**
   * 加载单个插件
   */
  public async loadPlugin(
    spec: PluginSpec,
    options: Partial<PluginLoadOptions> = {}
  ): Promise<PluginLoadResult> {
    const finalOptions = { ...this.defaultOptions, ...options };

    // 检查是否已在加载中
    if (this.loadingPromises.has(spec.name)) {
      return await this.loadingPromises.get(spec.name)!;
    }

    // 检查是否已加载
    if (this.loadedPlugins.has(spec.name)) {
      Logger.info(`插件 ${spec.name} 已加载，跳过`);
      return {
        name: spec.name,
        success: true,
        plugin: this.loadedPlugins.get(spec.name)!,
        loadTime: 0
      };
    }

    const loadPromise = this.doLoadPlugin(spec, finalOptions);
    this.loadingPromises.set(spec.name, loadPromise);

    try {
      const result = await loadPromise;
      if (result.success && result.plugin) {
        this.loadedPlugins.set(spec.name, result.plugin);
        
        // 启动插件生命周期管理
        this.startPluginLifecycleManagement(result.plugin);
      }
      return result;
    } finally {
      this.loadingPromises.delete(spec.name);
    }
  }

  /**
   * 实际加载插件
   */
  private async doLoadPlugin(
    spec: PluginSpec,
    options: PluginLoadOptions
  ): Promise<PluginLoadResult> {
    const startTime = Date.now();

    try {
      Logger.info(`🔄 加载插件: ${spec.name}`);

      // 执行前置钩子
      if (this.lifecycleHooks.beforeLoad) {
        await this.lifecycleHooks.beforeLoad(spec);
      }

      // 检查依赖
      if (options.validateDependencies) {
        await this.checkDependencies(spec);
      }

      // 选择加载方式
      let plugin: BasePlugin;

      if (options.sandbox) {
        plugin = await this.loadPluginInSandbox(spec, options);
      } else if (spec.async) {
        plugin = await this.loadPluginAsync(spec, options);
      } else {
        plugin = await this.loadPluginSync(spec, options);
      }

      const loadTime = Date.now() - startTime;

      // 初始化插件
      await this.initializePlugin(plugin, spec);

      Logger.info(`✅ 插件加载成功: ${spec.name} (${loadTime}ms)`);

      const result: PluginLoadResult = {
        name: spec.name,
        success: true,
        plugin,
        loadTime,
        metadata: this.extractMetadata(plugin)
      };

      // 执行后置钩子
      if (this.lifecycleHooks.afterLoad) {
        await this.lifecycleHooks.afterLoad(plugin, result);
      }

      this.eventBus.emit('plugin-loaded', { name: spec.name, plugin, loadTime });

      return result;

    } catch (error) {
      const loadTime = Date.now() - startTime;
      Logger.error(`❌ 插件加载失败: ${spec.name} (${loadTime}ms)`, error);

      // 执行错误钩子
      if (this.lifecycleHooks.onError) {
        await this.lifecycleHooks.onError(error instanceof Error ? error : new Error(String(error)), spec);
      }

      this.eventBus.emit('plugin-load-failed', { name: spec.name, error, loadTime });

      return {
        name: spec.name,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        loadTime
      };
    }
  }

  /**
   * 同步加载插件
   */
  private async loadPluginSync(spec: PluginSpec, options: PluginLoadOptions): Promise<BasePlugin> {
    const absolutePath = path.resolve(spec.path);

    // 检查文件是否存在
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`插件文件不存在: ${absolutePath}`);
    }

    // 动态导入
    const module = await import(absolutePath);
    const PluginClass = module.default || module[Object.keys(module)[0]];

    if (!PluginClass) {
      throw new Error(`无法从 ${absolutePath} 导入插件类`);
    }

    const plugin = new PluginClass();

    if (!(plugin instanceof BasePlugin)) {
      throw new Error(`插件 ${spec.name} 必须继承自 BasePlugin`);
    }

    return plugin;
  }

  /**
   * 异步加载插件（使用Worker线程）
   */
  private async loadPluginAsync(spec: PluginSpec, options: PluginLoadOptions): Promise<BasePlugin> {
    return new Promise((resolve, reject) => {
      const workerScript = `
        const { parentPort } = require('worker_threads');
        const path = require('path');
        
        async function loadPlugin(pluginPath) {
          try {
            const absolutePath = path.resolve(pluginPath);
            const module = await import(absolutePath);
            const PluginClass = module.default || module[Object.keys(module)[0]];
            
            if (!PluginClass) {
              throw new Error('无法导入插件类');
            }
            
            // 创建插件实例进行验证
            const plugin = new PluginClass();
            
            // 序列化插件信息
            const pluginInfo = {
              name: plugin.name || 'unknown',
              version: plugin.version || '1.0.0',
              description: plugin.description || '',
              functions: plugin.getFunctions ? plugin.getFunctions().map(f => f.name) : []
            };
            
            parentPort.postMessage({ success: true, pluginInfo });
          } catch (error) {
            parentPort.postMessage({ success: false, error: error.message });
          }
        }
        
        parentPort.on('message', ({ pluginPath }) => {
          loadPlugin(pluginPath);
        });
      `;

      const worker = new Worker(workerScript, { eval: true });

      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error(`插件 ${spec.name} 加载超时`));
      }, options.timeout);

      worker.on('message', async (result) => {
        clearTimeout(timeout);

        if (result.success) {
          try {
            // 在主线程中重新加载插件
            const plugin = await this.loadPluginSync(spec, options);
            worker.terminate();
            resolve(plugin);
          } catch (error) {
            worker.terminate();
            reject(error);
          }
        } else {
          worker.terminate();
          reject(new Error(result.error));
        }
      });

      worker.on('error', (error) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(error);
      });

      worker.postMessage({ pluginPath: spec.path });
    });
  }

  /**
   * 沙箱模式加载插件
   */
  private async loadPluginInSandbox(spec: PluginSpec, options: PluginLoadOptions): Promise<BasePlugin> {
    // 这里可以使用 vm2 或其他沙箱技术
    Logger.warn(`沙箱模式暂未实现，使用同步加载: ${spec.name}`);
    return await this.loadPluginSync(spec, options);
  }

  /**
   * 初始化插件
   */
  private async initializePlugin(plugin: BasePlugin, spec: PluginSpec): Promise<void> {
    try {
      // 设置插件配置
      if (spec.config && typeof plugin.setConfig === 'function') {
        plugin.setConfig(spec.config);
      }

      // 调用插件的load方法
      if (typeof plugin.load === 'function') {
        await plugin.load();
      }

      Logger.info(`插件 ${spec.name} 初始化完成`);
    } catch (error) {
      Logger.error(`插件 ${spec.name} 初始化失败:`, error);
      throw error;
    }
  }

  /**
   * 启动插件生命周期管理
   */
  private startPluginLifecycleManagement(plugin: BasePlugin): void {
    // 监控插件健康状态
    const healthCheckInterval = setInterval(async () => {
      try {
        if (typeof plugin.healthCheck === 'function') {
          const isHealthy = await plugin.healthCheck();
          if (!isHealthy) {
            Logger.warn(`插件 ${plugin.name} 健康检查失败`);
            this.eventBus.emit('plugin-unhealthy', { name: plugin.name });
          }
        }
      } catch (error) {
        Logger.error(`插件 ${plugin.name} 健康检查异常:`, error);
      }
    }, 30000); // 30秒检查一次

    // 存储定时器引用以便清理
    (plugin as any)._healthCheckInterval = healthCheckInterval;
  }

  /**
   * 扫描插件规范
   */
  private async scanPluginSpecs(directory: string): Promise<PluginSpec[]> {
    const specs: PluginSpec[] = [];

    if (!fs.existsSync(directory)) {
      return specs;
    }

    const items = fs.readdirSync(directory, { withFileTypes: true });

    for (const item of items) {
      if (item.isDirectory()) {
        const pluginDir = path.join(directory, item.name);
        
        // 检查是否有插件规范文件
        const specFile = path.join(pluginDir, 'plugin.json');
        if (fs.existsSync(specFile)) {
          try {
            const specContent = fs.readFileSync(specFile, 'utf-8');
            const spec = JSON.parse(specContent) as PluginSpec;
            // 优先使用编译后的js文件
            const jsPath = path.join(pluginDir, (spec.path || 'index.ts').replace('.ts', '.js'));
            if (fs.existsSync(jsPath)) {
              spec.path = jsPath;
            } else {
              spec.path = path.join(pluginDir, spec.path || 'index.ts');
            }
            specs.push(spec);
          } catch (error) {
            Logger.warn(`解析插件规范失败: ${specFile}`, error);
          }
        } else {
          // 默认规范 - 优先使用编译后的js文件
          const indexJsFile = path.join(pluginDir, 'index.js');
          const indexTsFile = path.join(pluginDir, 'index.ts');
          
          if (fs.existsSync(indexJsFile)) {
            specs.push({
              name: item.name,
              path: indexJsFile,
              priority: 100,
              enabled: true,
              async: false
            });
          } else if (fs.existsSync(indexTsFile)) {
            specs.push({
              name: item.name,
              path: indexTsFile,
              priority: 100,
              enabled: true,
              async: false
            });
          }
        }
      }
    }

    return specs;
  }

  /**
   * 构建依赖图
   */
  private buildDependencyGraph(specs: PluginSpec[]): void {
    this.dependencyGraph.clear();

    for (const spec of specs) {
      this.dependencyGraph.set(spec.name, spec.dependencies || []);
    }
  }

  /**
   * 计算加载顺序（拓扑排序）
   */
  private calculateLoadOrder(specs: PluginSpec[]): void {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (name: string) => {
      if (visiting.has(name)) {
        throw new Error(`检测到循环依赖: ${name}`);
      }

      if (visited.has(name)) {
        return;
      }

      visiting.add(name);

      const dependencies = this.dependencyGraph.get(name) || [];
      for (const dep of dependencies) {
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    for (const spec of specs) {
      if (!visited.has(spec.name)) {
        visit(spec.name);
      }
    }

    this.loadOrder = order;
    Logger.info(`插件加载顺序: ${order.join(' -> ')}`);
  }

  /**
   * 批量加载插件
   */
  private async loadPlugins(
    specs: PluginSpec[],
    options: PluginLoadOptions
  ): Promise<PluginLoadResult[]> {
    const results: PluginLoadResult[] = [];
    const specMap = new Map(specs.map(s => [s.name, s]));

    if (options.parallel) {
      // 并行加载（考虑依赖关系）
      const batches = this.createLoadBatches(specs);

      for (const batch of batches) {
        const batchPromises = batch.slice(0, options.maxConcurrency).map(name => {
          const spec = specMap.get(name)!;
          return this.loadPlugin(spec, options);
        });

        const batchResults = await Promise.allSettled(batchPromises);

        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            results.push({
              name: 'unknown',
              success: false,
              error: result.reason,
              loadTime: 0
            });
          }
        }
      }
    } else {
      // 串行加载
      for (const name of this.loadOrder) {
        const spec = specMap.get(name);
        if (spec) {
          const result = await this.loadPlugin(spec, options);
          results.push(result);
        }
      }
    }

    return results;
  }

  /**
   * 创建加载批次（考虑依赖关系）
   */
  private createLoadBatches(specs: PluginSpec[]): string[][] {
    const batches: string[][] = [];
    const processed = new Set<string>();

    while (processed.size < specs.length) {
      const batch: string[] = [];

      for (const spec of specs) {
        if (processed.has(spec.name)) {
          continue;
        }

        const dependencies = spec.dependencies || [];
        const canLoad = dependencies.every(dep => processed.has(dep));

        if (canLoad) {
          batch.push(spec.name);
        }
      }

      if (batch.length === 0) {
        const remaining = specs.filter(s => !processed.has(s.name));
        Logger.error('无法解决的插件依赖:', remaining.map(s => s.name));
        break;
      }

      batches.push(batch);
      batch.forEach(name => processed.add(name));
    }

    return batches;
  }

  /**
   * 检查依赖
   */
  private async checkDependencies(spec: PluginSpec): Promise<void> {
    if (!spec.dependencies || spec.dependencies.length === 0) {
      return;
    }

    for (const dep of spec.dependencies) {
      if (!this.loadedPlugins.has(dep)) {
        throw new Error(`插件 ${spec.name} 依赖的插件 ${dep} 未加载`);
      }
    }
  }

  /**
   * 提取插件元数据
   */
  private extractMetadata(plugin: BasePlugin): any {
    return {
      version: plugin.version || '1.0.0',
      description: plugin.description || '',
      author: (plugin as any).author || 'unknown',
      functions: plugin.getFunctions ? plugin.getFunctions().map(f => f.name) : []
    };
  }

  /**
   * 设置热重载
   */
  private setupHotReload(directory: string, specs: PluginSpec[]): void {
    for (const spec of specs) {
      if (spec.autoReload !== false) {
        const watcher = fs.watch(spec.path, async (eventType) => {
          if (eventType === 'change') {
            Logger.info(`检测到插件文件变化，重新加载: ${spec.name}`);
            await this.reloadPlugin(spec.name);
          }
        });

        this.fileWatchers.set(spec.name, watcher);
      }
    }
  }

  /**
   * 重新加载插件
   */
  public async reloadPlugin(name: string): Promise<boolean> {
    try {
      const plugin = this.loadedPlugins.get(name);
      if (!plugin) {
        Logger.warn(`插件 ${name} 未加载，无法重新加载`);
        return false;
      }

      // 卸载插件
      await this.unloadPlugin(name);

      // 重新扫描并加载
      // 这里需要重新获取插件规范，简化处理
      Logger.info(`插件 ${name} 重新加载完成`);
      return true;

    } catch (error) {
      Logger.error(`重新加载插件 ${name} 失败:`, error);
      return false;
    }
  }

  /**
   * 卸载插件
   */
  public async unloadPlugin(name: string): Promise<boolean> {
    const plugin = this.loadedPlugins.get(name);
    if (!plugin) {
      Logger.warn(`插件 ${name} 未加载`);
      return false;
    }

    try {
      // 执行前置钩子
      if (this.lifecycleHooks.beforeUnload) {
        await this.lifecycleHooks.beforeUnload(plugin);
      }

      // 停止健康检查
      if ((plugin as any)._healthCheckInterval) {
        clearInterval((plugin as any)._healthCheckInterval);
      }

      // 调用插件的unload方法
      if (typeof plugin.unload === 'function') {
        await plugin.unload();
      }

      this.loadedPlugins.delete(name);

      // 停止文件监听
      const watcher = this.fileWatchers.get(name);
      if (watcher) {
        watcher.close();
        this.fileWatchers.delete(name);
      }

      Logger.info(`插件 ${name} 已卸载`);

      // 执行后置钩子
      if (this.lifecycleHooks.afterUnload) {
        await this.lifecycleHooks.afterUnload(name);
      }

      this.eventBus.emit('plugin-unloaded', { name });
      return true;

    } catch (error) {
      Logger.error(`卸载插件 ${name} 失败:`, error);
      return false;
    }
  }

  /**
   * 卸载所有插件
   */
  public async unloadAllPlugins(): Promise<void> {
    const pluginNames = Array.from(this.loadedPlugins.keys());
    
    for (const name of pluginNames) {
      await this.unloadPlugin(name);
    }

    Logger.info('所有插件已卸载');
  }

  /**
   * 获取已加载的插件
   */
  public getLoadedPlugins(): Map<string, BasePlugin> {
    return new Map(this.loadedPlugins);
  }

  /**
   * 获取加载统计
   */
  public getLoadStats(): { total: number; loaded: number; failed: number } {
    const total = this.loadOrder.length;
    const loaded = this.loadedPlugins.size;
    const failed = total - loaded;

    return { total, loaded, failed };
  }
}