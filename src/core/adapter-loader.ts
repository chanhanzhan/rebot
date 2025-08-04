import * as path from 'path';
import * as fs from 'fs';
import { Worker } from 'worker_threads';
import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';
import { BaseAdapter, AdapterMetadata } from '../adapter/base-adapter';
import { VM } from 'vm2';

export interface AdapterSpec {
  name: string;
  path: string;
  config?: any;
  priority: number;
  dependencies?: string[];
  enabled: boolean;
  async: boolean;
  timeout?: number;
}

export interface AdapterLoadResult {
  name: string;
  success: boolean;
  adapter?: BaseAdapter;
  error?: Error;
  loadTime: number;
  metadata?: {
    version: string;
    description: string;
    author: string;
  };
}

export interface AdapterLoadOptions {
  parallel: boolean;
  maxConcurrency: number;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  sandbox: boolean;
}

/**
 * 适配器加载器 - 支持异步多线程加载
 */
export class AdapterLoader {
  private static instance: AdapterLoader;
  private eventBus: FrameworkEventBus;
  private loadedAdapters: Map<string, BaseAdapter> = new Map();
  private loadingPromises: Map<string, Promise<AdapterLoadResult>> = new Map();
  private dependencyGraph: Map<string, string[]> = new Map();
  private loadOrder: string[] = [];

  private defaultOptions: AdapterLoadOptions = {
    parallel: true,
    maxConcurrency: 4,
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 1000,
    sandbox: false
  };

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
  }

  public static getInstance(): AdapterLoader {
    if (!AdapterLoader.instance) {
      AdapterLoader.instance = new AdapterLoader();
    }
    return AdapterLoader.instance;
  }

  /**
   * 从目录加载所有适配器
   */
  public async loadAdaptersFromDirectory(
    directory: string, 
    options: Partial<AdapterLoadOptions> = {}
  ): Promise<AdapterLoadResult[]> {
    const finalOptions = { ...this.defaultOptions, ...options };
    
    try {
      Logger.info(`🔄 开始从目录加载适配器: ${directory}`);
      
      // 扫描适配器规范
      const adapterSpecs = await this.scanAdapterSpecs(directory);
      
      if (adapterSpecs.length === 0) {
        Logger.warn(`目录 ${directory} 中未找到适配器`);
        return [];
      }

      Logger.info(`📦 发现 ${adapterSpecs.length} 个适配器: ${adapterSpecs.map(s => s.name).join(', ')}`);

      // 构建依赖图
      this.buildDependencyGraph(adapterSpecs);

      // 计算加载顺序
      this.calculateLoadOrder(adapterSpecs);

      // 加载适配器
      const results = await this.loadAdapters(adapterSpecs, finalOptions);

      Logger.info(`✅ 适配器加载完成，成功: ${results.filter(r => r.success).length}/${results.length}`);
      
      return results;

    } catch (error) {
      Logger.error('适配器目录加载失败:', error);
      throw error;
    }
  }

  /**
   * 加载单个适配器
   */
  public async loadAdapter(
    spec: AdapterSpec, 
    options: Partial<AdapterLoadOptions> = {}
  ): Promise<AdapterLoadResult> {
    const finalOptions = { ...this.defaultOptions, ...options };
    
    // 检查是否已在加载中
    if (this.loadingPromises.has(spec.name)) {
      return await this.loadingPromises.get(spec.name)!;
    }

    // 检查是否已加载
    if (this.loadedAdapters.has(spec.name)) {
      Logger.info(`适配器 ${spec.name} 已加载，跳过`);
      return {
        name: spec.name,
        success: true,
        adapter: this.loadedAdapters.get(spec.name)!,
        loadTime: 0
      };
    }

    const loadPromise = this.doLoadAdapter(spec, finalOptions);
    this.loadingPromises.set(spec.name, loadPromise);

    try {
      const result = await loadPromise;
      if (result.success && result.adapter) {
        this.loadedAdapters.set(spec.name, result.adapter);
      }
      return result;
    } finally {
      this.loadingPromises.delete(spec.name);
    }
  }

  /**
   * 实际加载适配器
   */
  private async doLoadAdapter(
    spec: AdapterSpec, 
    options: AdapterLoadOptions
  ): Promise<AdapterLoadResult> {
    const startTime = Date.now();
    
    try {
      Logger.info(`🔄 加载适配器: ${spec.name}`);

      // 检查依赖
      await this.checkDependencies(spec);

      // 选择加载方式
      let adapter: BaseAdapter;
      
      if (options.sandbox) {
        adapter = await this.loadAdapterInSandbox(spec, options);
      } else if (spec.async) {
        adapter = await this.loadAdapterAsync(spec, options);
      } else {
        adapter = await this.loadAdapterSync(spec, options);
      }

      // 调用适配器的 load 方法（包含初始化）
      await adapter.load();

      const loadTime = Date.now() - startTime;
      Logger.info(`✅ 适配器加载成功: ${spec.name} (${loadTime}ms)`);
      
      this.eventBus.emit('adapter-loaded', { name: spec.name, adapter, loadTime });

      return {
        name: spec.name,
        success: true,
        adapter,
        loadTime,
        metadata: this.extractMetadata(adapter)
      };

    } catch (error) {
      const loadTime = Date.now() - startTime;
      Logger.error(`❌ 适配器加载失败: ${spec.name} (${loadTime}ms)`, error);
      
      this.eventBus.emit('adapter-load-failed', { name: spec.name, error, loadTime });

      return {
        name: spec.name,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        loadTime
      };
    }
  }

  /**
   * 同步加载适配器
   */
  private async loadAdapterSync(spec: AdapterSpec, options: AdapterLoadOptions): Promise<BaseAdapter> {
    const absolutePath = path.resolve(spec.path);
    
    // 检查文件是否存在
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`适配器文件不存在: ${absolutePath}`);
    }

    // 动态导入
    const module = await import(absolutePath);
    const AdapterClass = module.default || module[Object.keys(module)[0]];
    
    if (!AdapterClass) {
      throw new Error(`无法从 ${absolutePath} 导入适配器类`);
    }

    return new AdapterClass();
  }

  /**
   * 异步加载适配器（使用Worker线程）
   */
  private async loadAdapterAsync(spec: AdapterSpec, options: AdapterLoadOptions): Promise<BaseAdapter> {
    return new Promise((resolve, reject) => {
      const workerScript = `
        const { parentPort } = require('worker_threads');
        const path = require('path');
        
        async function loadAdapter(adapterPath) {
          try {
            const absolutePath = path.resolve(adapterPath);
            const module = await import(absolutePath);
            const AdapterClass = module.default || module[Object.keys(module)[0]];
            
            if (!AdapterClass) {
              throw new Error('无法导入适配器类');
            }
            
            const adapter = new AdapterClass();
            
            // 序列化适配器信息（不能直接传递类实例）
            const adapterInfo = {
              name: adapter.name || 'unknown',
              version: adapter.version || '1.0.0',
              description: adapter.description || '',
              type: adapter.type || 'generic'
            };
            
            parentPort.postMessage({ success: true, adapterInfo });
          } catch (error) {
            parentPort.postMessage({ success: false, error: error.message });
          }
        }
        
        parentPort.on('message', ({ adapterPath }) => {
          loadAdapter(adapterPath);
        });
      `;

      const worker = new Worker(workerScript, { eval: true });
      
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error(`适配器 ${spec.name} 加载超时`));
      }, options.timeout);

      worker.on('message', async (result) => {
        clearTimeout(timeout);
        
        if (result.success) {
          try {
            // 在主线程中重新加载适配器
            const adapter = await this.loadAdapterSync(spec, options);
            worker.terminate();
            resolve(adapter);
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

      worker.postMessage({ adapterPath: spec.path });
    });
  }

  /**
   * 沙箱模式加载适配器
   */
  private async loadAdapterInSandbox(spec: AdapterSpec, options: AdapterLoadOptions): Promise<BaseAdapter> {
    // 这里可以使用 vm2 或其他沙箱技术
    // 暂时使用同步加载作为占位符
    Logger.warn(`沙箱模式暂未实现，使用同步加载: ${spec.name}`);
    return await this.loadAdapterSync(spec, options);
  }

  /**
   * 扫描适配器规范
   */
  private async scanAdapterSpecs(directory: string): Promise<AdapterSpec[]> {
    const specs: AdapterSpec[] = [];
    
    if (!fs.existsSync(directory)) {
      return specs;
    }

    const items = fs.readdirSync(directory, { withFileTypes: true });
    
    for (const item of items) {
      // 检查是否为适配器文件（优先使用编译后的js文件）
      if (item.isFile() && item.name.endsWith('-adapter.js')) {
        // 排除基类适配器
        if (item.name === 'base-adapter.js') {
          continue;
        }
        
        const adapterPath = path.join(directory, item.name);
        const name = item.name.replace('-adapter.js', '');
        
        specs.push({
          name,
          path: adapterPath,
          priority: 100,
          enabled: true,
          async: false
        });
      } else if (item.isFile() && item.name.endsWith('-adapter.ts')) {
        // 排除基类适配器
        if (item.name === 'base-adapter.ts') {
          continue;
        }
        
        // 如果没有对应的js文件，则使用ts文件
        const jsPath = path.join(directory, item.name.replace('.ts', '.js'));
        if (!fs.existsSync(jsPath)) {
          const adapterPath = path.join(directory, item.name);
          const name = item.name.replace('-adapter.ts', '');
          
          specs.push({
            name,
            path: adapterPath,
            priority: 100,
            enabled: true,
            async: false
          });
        }
      } else if (item.isDirectory()) {
        // 检查目录中的适配器规范文件
        const specFile = path.join(directory, item.name, 'adapter.json');
        if (fs.existsSync(specFile)) {
          try {
            const specContent = fs.readFileSync(specFile, 'utf-8');
            const spec = JSON.parse(specContent) as AdapterSpec;
            // 优先使用编译后的js文件
            const jsPath = path.join(directory, item.name, (spec.path || 'index.ts').replace('.ts', '.js'));
            if (fs.existsSync(jsPath)) {
              spec.path = jsPath;
            } else {
              spec.path = path.join(directory, item.name, spec.path || 'index.ts');
            }
            specs.push(spec);
          } catch (error) {
            Logger.warn(`解析适配器规范失败: ${specFile}`, error);
          }
        }
      }
    }

    return specs;
  }

  /**
   * 构建依赖图
   */
  private buildDependencyGraph(specs: AdapterSpec[]): void {
    this.dependencyGraph.clear();
    
    for (const spec of specs) {
      this.dependencyGraph.set(spec.name, spec.dependencies || []);
    }
  }

  /**
   * 计算加载顺序（拓扑排序）
   */
  private calculateLoadOrder(specs: AdapterSpec[]): void {
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
    Logger.info(`适配器加载顺序: ${order.join(' -> ')}`);
  }

  /**
   * 批量加载适配器
   */
  private async loadAdapters(
    specs: AdapterSpec[], 
    options: AdapterLoadOptions
  ): Promise<AdapterLoadResult[]> {
    const results: AdapterLoadResult[] = [];
    const specMap = new Map(specs.map(s => [s.name, s]));

    if (options.parallel) {
      // 并行加载（考虑依赖关系）
      const batches = this.createLoadBatches(specs);
      
      for (const batch of batches) {
        const batchPromises = batch.map(name => {
          const spec = specMap.get(name)!;
          return this.loadAdapter(spec, options);
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
          const result = await this.loadAdapter(spec, options);
          results.push(result);
        }
      }
    }

    return results;
  }

  /**
   * 创建加载批次（考虑依赖关系）
   */
  private createLoadBatches(specs: AdapterSpec[]): string[][] {
    const batches: string[][] = [];
    const processed = new Set<string>();
    const specMap = new Map(specs.map(s => [s.name, s]));

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
        // 检测到无法解决的依赖
        const remaining = specs.filter(s => !processed.has(s.name));
        Logger.error('无法解决的适配器依赖:', remaining.map(s => s.name));
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
  private async checkDependencies(spec: AdapterSpec): Promise<void> {
    if (!spec.dependencies || spec.dependencies.length === 0) {
      return;
    }

    for (const dep of spec.dependencies) {
      if (!this.loadedAdapters.has(dep)) {
        throw new Error(`适配器 ${spec.name} 依赖的适配器 ${dep} 未加载`);
      }
    }
  }

  /**
   * 提取适配器元数据
   */
  private extractMetadata(adapter: BaseAdapter): any {
    return {
      version: (adapter as any).version || '1.0.0',
      description: (adapter as any).description || '',
      author: (adapter as any).author || 'unknown'
    };
  }

  /**
   * 卸载适配器
   */
  public async unloadAdapter(name: string): Promise<boolean> {
    const adapter = this.loadedAdapters.get(name);
    if (!adapter) {
      Logger.warn(`适配器 ${name} 未加载`);
      return false;
    }

    try {
      // 销毁适配器
      if (typeof (adapter as any).destroy === 'function') {
        await (adapter as any).destroy();
      }

      this.loadedAdapters.delete(name);
      Logger.info(`适配器 ${name} 已卸载`);
      
      this.eventBus.emit('adapter-unloaded', { name });
      return true;
    } catch (error) {
      Logger.error(`卸载适配器 ${name} 失败:`, error);
      return false;
    }
  }

  /**
   * 卸载所有适配器
   */
  public async unloadAllAdapters(): Promise<void> {
    const adapterNames = Array.from(this.loadedAdapters.keys());
    
    for (const name of adapterNames) {
      await this.unloadAdapter(name);
    }
    
    Logger.info('所有适配器已卸载');
  }

  /**
   * 获取已加载的适配器
   */
  public getLoadedAdapters(): Map<string, BaseAdapter> {
    return new Map(this.loadedAdapters);
  }

  /**
   * 获取加载统计
   */
  public getLoadStats(): { total: number; loaded: number; failed: number } {
    const total = this.loadOrder.length;
    const loaded = this.loadedAdapters.size;
    const failed = total - loaded;

    return { total, loaded, failed };
  }
}