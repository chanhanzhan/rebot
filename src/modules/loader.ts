import { Logger } from '../config/log';
import { FrameworkEventBus } from '../common/event-bus';

export interface Module {
  name: string;
  version: string;
  description: string;
  dependencies?: string[];
  initialize(): Promise<void>;
  destroy(): Promise<void>;
}

export class ModuleLoader {
  private static instance: ModuleLoader;
  private modules: Map<string, Module> = new Map();
  private loadOrder: string[] = [];
  private eventBus: FrameworkEventBus;

  private constructor() {
    this.eventBus = FrameworkEventBus.getInstance();
  }

  public static getInstance(): ModuleLoader {
    if (!ModuleLoader.instance) {
      ModuleLoader.instance = new ModuleLoader();
    }
    return ModuleLoader.instance;
  }

  public async loadModule(module: Module): Promise<void> {
    try {
      Logger.info(`Loading module: ${module.name}`);

      // 检查依赖
      if (module.dependencies) {
        for (const dep of module.dependencies) {
          if (!this.modules.has(dep)) {
            throw new Error(`Missing dependency: ${dep}`);
          }
        }
      }

      // 初始化模块
      await module.initialize();

      // 注册模块
      this.modules.set(module.name, module);
      this.loadOrder.push(module.name);

      Logger.info(`Module loaded successfully: ${module.name}`);
      this.eventBus.safeEmit('module-loaded', module);

    } catch (error) {
      Logger.error(`Failed to load module ${module.name}:`, error);
      throw error;
    }
  }

  public async unloadModule(moduleName: string): Promise<void> {
    const module = this.modules.get(moduleName);
    if (!module) {
      Logger.warn(`Module not found: ${moduleName}`);
      return;
    }

    try {
      Logger.info(`Unloading module: ${moduleName}`);

      // 检查是否有其他模块依赖这个模块
      for (const [name, mod] of this.modules) {
        if (mod.dependencies?.includes(moduleName)) {
          throw new Error(`Module ${name} depends on ${moduleName}`);
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

      Logger.info(`Module unloaded successfully: ${moduleName}`);
      this.eventBus.safeEmit('module-unloaded', module);

    } catch (error) {
      Logger.error(`Failed to unload module ${moduleName}:`, error);
      throw error;
    }
  }

  public getModule(name: string): Module | undefined {
    return this.modules.get(name);
  }

  public getAllModules(): Module[] {
    return Array.from(this.modules.values());
  }

  public getLoadOrder(): string[] {
    return [...this.loadOrder];
  }

  public async unloadAll(): Promise<void> {
    // 按相反的加载顺序卸载模块
    const reverseOrder = [...this.loadOrder].reverse();
    
    for (const moduleName of reverseOrder) {
      try {
        await this.unloadModule(moduleName);
      } catch (error) {
        Logger.error(`Error unloading module ${moduleName}:`, error);
      }
    }
  }
}