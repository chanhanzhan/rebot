import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';
import { ConfigManager } from '../config/config';
import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';

export interface Module {
  name: string;
  version: string;
  description: string;
  dependencies?: string[];
  priority?: number; // 加载优先级
  category?: string; // 模块分类
  tags?: string[]; // 模块标签
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  reload?(): Promise<void>; // 可选的重载方法
  getStatus?(): ModuleStatus; // 可选的状态获取方法
  getHealth?(): Promise<ModuleHealth>; // 可选的健康检查方法
}

export interface ModuleStats {
  name: string;
  version: string;
  status: 'loaded' | 'unloaded' | 'error' | 'initializing' | 'destroying';
  loadTime: number;
  lastReload: number;
  initializationTime: number;
  errorCount: number;
  lastError?: string;
  memoryUsage?: number;
  dependencies: string[];
  dependents: string[];
}

export interface ModuleHealth {
  name: string;
  status: 'healthy' | 'warning' | 'error' | 'unknown';
  issues: string[];
  performance: {
    initializationTime: number;
    memoryUsage?: number;
    errorRate: number;
  };
  lastCheck: number;
}

export interface ModuleStatus {
  name: string;
  running: boolean;
  initialized: boolean;
  lastActivity: number;
  details?: Record<string, any>;
}

export interface ModuleDependency {
  name: string;
  version?: string;
  optional: boolean;
  satisfied: boolean;
}

export interface ModuleMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  dependencies: ModuleDependency[];
  category: string;
  tags: string[];
  priority: number;
}

export class ModuleLoader {
  private static instance: ModuleLoader;
  private modules: Map<string, Module> = new Map();
  private moduleStats: Map<string, ModuleStats> = new Map();
  private moduleMetadata: Map<string, ModuleMetadata> = new Map();
  private loadOrder: string[] = [];
  private dependencyGraph: Map<string, string[]> = new Map();
  private eventBus: FrameworkEventBus;
  private configManager: ConfigManager;
  private fileWatcher: chokidar.FSWatcher | null = null;
  private hotReloadEnabled = false;
  private loadingQueue: Array<{ module: Module; priority: number }> = [];
  private isProcessingQueue = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private healthCheckIntervalMs = 60000; // 1分钟

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
    this.configManager = ConfigManager.getInstance();
    
    // 监听模块相关事件
    this.eventBus.on('module_reload_request', this.handleModuleReloadRequest.bind(this));
    this.eventBus.on('module_health_check', this.handleHealthCheckRequest.bind(this));
    
    // 启动健康检查
    this.startHealthCheck();
  }

  public static getInstance(): ModuleLoader {
    if (!ModuleLoader.instance) {
      ModuleLoader.instance = new ModuleLoader();
    }
    return ModuleLoader.instance;
  }

  public async loadModule(module: Module, options?: {
    force?: boolean;
    skipDependencyCheck?: boolean;
    priority?: number;
  }): Promise<void> {
    const start = Date.now();
    
    try {
      Logger.info(`正在加载模块: ${module.name}`);
      
      // 检查模块是否已存在
      if (this.modules.has(module.name) && !options?.force) {
        Logger.warn(`模块 ${module.name} 已存在，跳过加载`);
        return;
      }
      
      // 初始化模块统计
      this.initializeModuleStats(module);
      this.updateModuleStats(module.name, { status: 'initializing' });
      
      // 检查依赖关系
      if (!options?.skipDependencyCheck) {
        await this.checkModuleDependencies(module);
      }
      
      // 加载模块元数据
      await this.loadModuleMetadata(module);
      
      const initStart = Date.now();
      
      // 初始化模块
      await module.initialize();
      
      const initTime = Date.now() - initStart;
      
      // 注册模块
      this.modules.set(module.name, module);
      
      // 更新加载顺序（按优先级排序）
      this.updateLoadOrder(module.name, options?.priority || module.priority || 0);
      
      // 更新依赖图
      this.updateDependencyGraph(module);
      
      // 更新统计信息
      this.updateModuleStats(module.name, {
        status: 'loaded',
        loadTime: Date.now() - start,
        initializationTime: initTime,
        dependencies: module.dependencies || [],
        dependents: this.getModuleDependents(module.name)
      });

      Logger.info(`模块加载成功: ${module.name} (${Date.now() - start}ms)`);
      this.eventBus.safeEmit('module-loaded', module);

    } catch (error) {
      this.updateModuleStats(module.name, { 
        status: 'error',
        errorCount: (this.moduleStats.get(module.name)?.errorCount || 0) + 1,
        lastError: error instanceof Error ? error.message : String(error)
      });
      Logger.error(`模块加载失败 ${module.name}:`, error);
      throw error;
    }
  }

  public async unloadModule(moduleName: string, options?: {
    force?: boolean;
    skipDependencyCheck?: boolean;
  }): Promise<void> {
    const module = this.modules.get(moduleName);
    if (!module) {
      Logger.warn(`Module not found: ${moduleName}`);
      return;
    }

    try {
      Logger.info(`正在卸载模块: ${moduleName}`);
      
      this.updateModuleStats(moduleName, { status: 'destroying' });

      // 检查是否有其他模块依赖这个模块
      if (!options?.skipDependencyCheck) {
        const dependents = this.getModuleDependents(moduleName);
        if (dependents.length > 0 && !options?.force) {
          throw new Error(`无法卸载模块 ${moduleName}，以下模块依赖它: ${dependents.join(', ')}`);
        }
      }

      // 销毁模块
      await module.destroy();

      // 移除模块
      this.modules.delete(moduleName);
      const index = this.loadOrder.indexOf(moduleName);
      if (index > -1) {
        this.loadOrder.splice(index, 1);
      }
      
      // 更新依赖图
      this.dependencyGraph.delete(moduleName);
      
      // 更新统计信息
      this.updateModuleStats(moduleName, { status: 'unloaded' });

      Logger.info(`模块卸载成功: ${moduleName}`);
      this.eventBus.safeEmit('module-unloaded', module);

    } catch (error) {
      this.updateModuleStats(moduleName, { 
        status: 'error',
        errorCount: (this.moduleStats.get(moduleName)?.errorCount || 0) + 1,
        lastError: error instanceof Error ? error.message : String(error)
      });
      Logger.error(`模块卸载失败 ${moduleName}:`, error);
      throw error;
    }
  }

  public async reloadModule(moduleName: string, options?: {
    preserveState?: boolean;
    force?: boolean;
  }): Promise<void> {
    const module = this.modules.get(moduleName);
    if (!module) {
      Logger.warn(`Module not found: ${moduleName}`);
      return;
    }

    try {
      Logger.info(`重新加载模块: ${moduleName}`);
      
      // 保存状态
      let savedState: any = null;
      if (options?.preserveState && typeof (module as any).getState === 'function') {
        savedState = (module as any).getState();
      }
      
      // 如果模块支持热重载
      if (module.reload) {
        await module.reload();
      } else {
        // 否则先卸载再加载
        await this.unloadModule(moduleName, { force: options?.force, skipDependencyCheck: true });
        await this.loadModule(module, { force: true });
      }
      
      // 恢复状态
      if (savedState && typeof (module as any).setState === 'function') {
        (module as any).setState(savedState);
      }
      
      // 更新统计信息
      this.updateModuleStats(moduleName, { lastReload: Date.now() });
      
      Logger.info(`模块重新加载成功: ${moduleName}`);
      this.eventBus.safeEmit('module-reloaded', module);

    } catch (error) {
      this.updateModuleStats(moduleName, { 
        status: 'error',
        errorCount: (this.moduleStats.get(moduleName)?.errorCount || 0) + 1,
        lastError: error instanceof Error ? error.message : String(error)
      });
      Logger.error(`模块重新加载失败 ${moduleName}:`, error);
      throw error;
    }
  }

  // 批量操作
  public async loadModulesBatch(modules: Module[], options?: {
    parallel?: boolean;
    continueOnError?: boolean;
    sortByPriority?: boolean;
  }): Promise<void> {
    let modulesToLoad = modules;
    
    // 按优先级排序
    if (options?.sortByPriority) {
      modulesToLoad = modules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }
    
    if (options?.parallel) {
      const promises = modulesToLoad.map(module => 
        this.loadModule(module).catch(error => {
          if (!options.continueOnError) throw error;
          Logger.error(`批量加载模块 ${module.name} 失败:`, error);
          return error;
        })
      );
      await Promise.allSettled(promises);
    } else {
      for (const module of modulesToLoad) {
        try {
          await this.loadModule(module);
        } catch (error) {
          if (!options?.continueOnError) throw error;
          Logger.error(`批量加载模块 ${module.name} 失败:`, error);
        }
      }
    }
  }

  public async unloadModulesBatch(moduleNames: string[], options?: {
    parallel?: boolean;
    continueOnError?: boolean;
    reverseOrder?: boolean;
  }): Promise<void> {
    let namesToUnload = moduleNames;
    
    // 按相反顺序卸载
    if (options?.reverseOrder) {
      namesToUnload = [...moduleNames].reverse();
    }
    
    if (options?.parallel) {
      const promises = namesToUnload.map(name => 
        this.unloadModule(name).catch(error => {
          if (!options.continueOnError) throw error;
          Logger.error(`批量卸载模块 ${name} 失败:`, error);
          return error;
        })
      );
      await Promise.allSettled(promises);
    } else {
      for (const name of namesToUnload) {
        try {
          await this.unloadModule(name);
        } catch (error) {
          if (!options?.continueOnError) throw error;
          Logger.error(`批量卸载模块 ${name} 失败:`, error);
        }
      }
    }
  }

  // 热重载功能
  public enableHotReload(modulesDir: string): void {
    if (this.fileWatcher) {
      Logger.warn('热重载已启用');
      return;
    }
    
    this.hotReloadEnabled = true;
    this.fileWatcher = chokidar.watch(modulesDir, {
      ignored: /node_modules/,
      persistent: true,
      ignoreInitial: true
    });
    
    this.fileWatcher.on('change', async (filePath) => {
      const moduleName = this.getModuleNameFromPath(filePath);
      if (moduleName && this.modules.has(moduleName)) {
        Logger.info(`检测到模块文件变化: ${filePath}，正在热重载模块: ${moduleName}`);
        try {
          await this.reloadModule(moduleName, { preserveState: true });
        } catch (error) {
          Logger.error(`热重载模块 ${moduleName} 失败:`, error);
        }
      }
    });
    
    Logger.info(`热重载已启用，监控目录: ${modulesDir}`);
  }

  public disableHotReload(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
      this.hotReloadEnabled = false;
      Logger.info('热重载已禁用');
    }
  }

  // 模块统计和健康检查
  public getModuleStats(moduleName?: string): ModuleStats | ModuleStats[] {
    if (moduleName) {
      const stats = this.moduleStats.get(moduleName);
      if (!stats) throw new Error(`Module not found: ${moduleName}`);
      return { ...stats };
    }
    
    return Array.from(this.moduleStats.values()).map(stats => ({ ...stats }));
  }

  public async getModuleHealth(moduleName?: string): Promise<ModuleHealth | ModuleHealth[]> {
    const checkHealth = async (name: string, module: Module): Promise<ModuleHealth> => {
      const stats = this.moduleStats.get(name);
      const issues: string[] = [];
      let status: 'healthy' | 'warning' | 'error' | 'unknown' = 'healthy';
      
      if (!stats || stats.status !== 'loaded') {
        status = 'error';
        issues.push('模块未正确加载');
      } else {
        // 检查错误率
        if (stats.errorCount > 5) {
          status = 'error';
          issues.push(`错误次数过多: ${stats.errorCount}`);
        } else if (stats.errorCount > 2) {
          status = 'warning';
          issues.push(`错误次数较多: ${stats.errorCount}`);
        }
        
        // 检查初始化时间
        if (stats.initializationTime > 10000) {
          status = status === 'error' ? 'error' : 'warning';
          issues.push(`初始化时间过长: ${stats.initializationTime}ms`);
        }
        
        // 检查内存使用
        if (stats.memoryUsage && stats.memoryUsage > 200 * 1024 * 1024) { // 200MB
          status = status === 'error' ? 'error' : 'warning';
          issues.push(`内存使用过高: ${(stats.memoryUsage / 1024 / 1024).toFixed(1)}MB`);
        }
        
        // 调用模块自定义健康检查
        if (module.getHealth) {
          try {
            const moduleHealth = await module.getHealth();
            if (moduleHealth.status === 'error') {
              status = 'error';
            } else if (moduleHealth.status === 'warning' && status === 'healthy') {
              status = 'warning';
            }
            issues.push(...moduleHealth.issues);
          } catch (error) {
            status = 'error';
            issues.push(`健康检查失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      
      return {
        name,
        status,
        issues,
        performance: {
          initializationTime: stats?.initializationTime || 0,
          memoryUsage: stats?.memoryUsage,
          errorRate: stats?.errorCount || 0
        },
        lastCheck: Date.now()
      };
    };
    
    if (moduleName) {
      const module = this.modules.get(moduleName);
      if (!module) throw new Error(`Module not found: ${moduleName}`);
      return await checkHealth(moduleName, module);
    }
    
    const healthResults: ModuleHealth[] = [];
    for (const [name, module] of this.modules) {
      healthResults.push(await checkHealth(name, module));
    }
    
    return healthResults;
  }

  public resetModuleStats(moduleName?: string): void {
    if (moduleName) {
      const stats = this.moduleStats.get(moduleName);
      if (stats) {
        stats.errorCount = 0;
        stats.lastError = undefined;
      }
    } else {
      for (const stats of this.moduleStats.values()) {
        stats.errorCount = 0;
        stats.lastError = undefined;
      }
    }
    
    Logger.info(`模块统计已重置${moduleName ? ` (${moduleName})` : ''}`);
  }

  // 依赖管理
  private async checkModuleDependencies(module: Module): Promise<void> {
    if (!module.dependencies) return;
    
    for (const dep of module.dependencies) {
      if (!this.modules.has(dep)) {
        throw new Error(`模块 ${module.name} 缺少依赖: ${dep}`);
      }
    }
  }

  private getModuleDependents(moduleName: string): string[] {
    const dependents: string[] = [];
    
    for (const [name, deps] of this.dependencyGraph) {
      if (deps.includes(moduleName)) {
        dependents.push(name);
      }
    }
    
    return dependents;
  }

  private updateDependencyGraph(module: Module): void {
    if (module.dependencies) {
      this.dependencyGraph.set(module.name, [...module.dependencies]);
    }
  }

  private updateLoadOrder(moduleName: string, priority: number): void {
    // 移除现有的
    const index = this.loadOrder.indexOf(moduleName);
    if (index > -1) {
      this.loadOrder.splice(index, 1);
    }
    
    // 按优先级插入
    let insertIndex = 0;
    for (let i = 0; i < this.loadOrder.length; i++) {
      const existingModule = this.modules.get(this.loadOrder[i]);
      const existingPriority = existingModule?.priority || 0;
      if (priority > existingPriority) {
        insertIndex = i;
        break;
      }
      insertIndex = i + 1;
    }
    
    this.loadOrder.splice(insertIndex, 0, moduleName);
  }

  // 健康检查
  private startHealthCheck(): void {
    if (this.healthCheckInterval) return;
    
    this.healthCheckInterval = setInterval(async () => {
      try {
        const healthResults = await this.getModuleHealth() as ModuleHealth[];
        const unhealthyModules = healthResults.filter(h => h.status === 'error' || h.status === 'warning');
        
        if (unhealthyModules.length > 0) {
          Logger.warn(`发现 ${unhealthyModules.length} 个不健康的模块:`, 
            unhealthyModules.map(m => `${m.name} (${m.status})`).join(', '));
          
          this.eventBus.safeEmit('modules-health-warning', unhealthyModules);
        }
      } catch (error) {
        Logger.error('模块健康检查失败:', error);
      }
    }, this.healthCheckIntervalMs);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  // 工具方法
  private getModuleNameFromPath(filePath: string): string | null {
    const parts = filePath.split(path.sep);
    const modulesDirIndex = parts.findIndex(part => part === 'modules');
    
    if (modulesDirIndex >= 0 && modulesDirIndex < parts.length - 1) {
      return parts[modulesDirIndex + 1];
    }
    
    return null;
  }

  private initializeModuleStats(module: Module): void {
    if (!this.moduleStats.has(module.name)) {
      this.moduleStats.set(module.name, {
        name: module.name,
        version: module.version,
        status: 'unloaded',
        loadTime: 0,
        lastReload: 0,
        initializationTime: 0,
        errorCount: 0,
        dependencies: module.dependencies || [],
        dependents: []
      });
    }
  }

  private updateModuleStats(moduleName: string, updates: Partial<ModuleStats>): void {
    const stats = this.moduleStats.get(moduleName);
    if (stats) {
      Object.assign(stats, updates);
    }
  }

  private async loadModuleMetadata(module: Module): Promise<void> {
    try {
      const metadata: ModuleMetadata = {
        name: module.name,
        version: module.version,
        description: module.description,
        dependencies: (module.dependencies || []).map(dep => ({
          name: dep,
          optional: false,
          satisfied: this.modules.has(dep)
        })),
        category: module.category || 'general',
        tags: module.tags || [],
        priority: module.priority || 0
      };
      
      this.moduleMetadata.set(module.name, metadata);
    } catch (error) {
      Logger.warn(`加载模块元数据失败 ${module.name}:`, error);
    }
  }

  // 事件处理器
  private handleModuleReloadRequest(data: { moduleName: string }): void {
    this.reloadModule(data.moduleName).catch(error => {
      Logger.error(`处理模块重载请求失败:`, error);
    });
  }

  private handleHealthCheckRequest(): void {
    this.getModuleHealth().then(results => {
      this.eventBus.safeEmit('modules-health-report', results);
    }).catch(error => {
      Logger.error(`处理健康检查请求失败:`, error);
    });
  }

  // 公共接口
  public getModule(name: string): Module | undefined {
    return this.modules.get(name);
  }

  public getAllModules(): Module[] {
    return Array.from(this.modules.values());
  }

  public getLoadedModules(): Module[] {
    return Array.from(this.modules.values()).filter(module => {
      const stats = this.moduleStats.get(module.name);
      return stats?.status === 'loaded';
    });
  }

  public getModulesByCategory(category: string): Module[] {
    return Array.from(this.modules.values()).filter(module => 
      module.category === category
    );
  }

  public getModulesByTag(tag: string): Module[] {
    return Array.from(this.modules.values()).filter(module => 
      module.tags?.includes(tag)
    );
  }

  public getLoadOrder(): string[] {
    return [...this.loadOrder];
  }

  public getDependencyGraph(): Map<string, string[]> {
    return new Map(this.dependencyGraph);
  }

  public getModuleMetadata(moduleName?: string): ModuleMetadata | ModuleMetadata[] {
    if (moduleName) {
      const metadata = this.moduleMetadata.get(moduleName);
      if (!metadata) throw new Error(`Module metadata not found: ${moduleName}`);
      return metadata;
    }
    
    return Array.from(this.moduleMetadata.values());
  }

  public async unloadAll(): Promise<void> {
    Logger.info('开始卸载所有模块...');
    
    // 按相反的加载顺序卸载模块
    const reverseOrder = [...this.loadOrder].reverse();
    
    for (const moduleName of reverseOrder) {
      try {
        await this.unloadModule(moduleName, { force: true, skipDependencyCheck: true });
      } catch (error) {
        Logger.error(`卸载模块 ${moduleName} 时出错:`, error);
      }
    }
    
    Logger.info('所有模块已卸载');
  }

  // 清理资源
  public destroy(): void {
    this.disableHotReload();
    this.stopHealthCheck();
    
    // 卸载所有模块
    this.unloadAll().catch(error => {
      Logger.error('卸载所有模块时出错:', error);
    });
    
    this.modules.clear();
    this.moduleStats.clear();
    this.moduleMetadata.clear();
    this.loadOrder = [];
    this.dependencyGraph.clear();
    this.loadingQueue = [];
    
    Logger.info('[模块加载器] 已清理所有资源');
  }
}