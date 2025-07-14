
  import { Plugin, PluginFunction, Message, PermissionLevel } from '../common/types';
import { Logger } from '../config/log';

/**
 * 插件基类
 * 所有插件都应该继承此类
 */
export abstract class BasePlugin implements Plugin {
  public abstract name: string;
  public abstract version: string;
  public abstract description: string;

  /**
   * 插件加载方法
   */
  public abstract load(): Promise<void>;

  /**
   * 插件卸载方法
   */
  public abstract unload(): Promise<void>;

  /**
   * 插件重载方法
   */
  public async reload(): Promise<void> {
    await this.unload();
    await this.load();
  }

  /**
   * 获取插件提供的函数列表
   */
  public abstract getFunctions(): PluginFunction[];

  /**
   * 获取插件配置文件路径
   */
  public getConfigPath(): string {
    return `./plugins/${this.name}/config.yaml`;
  }

  /**
   * 发送消息的辅助方法
   * 子类可以重写此方法来实现具体的消息发送逻辑
   */
  protected async sendMessage(message: Message, content: string): Promise<void> {
    // 这里应该通过适配器发送消息
    // 为了简化，现在只是记录日志
    Logger.info(`Plugin ${this.name} would send: ${content} to ${message.sender.name}`);
    console.log(`[${this.name} -> ${message.sender.name}]: ${content}`);
  }

  /**
   * 检查用户权限的辅助方法
   */
  protected checkPermission(userPermission: PermissionLevel, requiredPermission: PermissionLevel): boolean {
    return userPermission >= requiredPermission;
  }

  /**
   * 解析消息参数的辅助方法
   */
  protected parseArgs(content: string): string[] {
    return content.trim().split(/\s+/).slice(1); // 移除第一个词（命令）
  }
}
