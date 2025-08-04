import { BaseAdapter, AdapterMetadata, MessageContext } from './base-adapter';
import { Logger } from '../config/log';
import { Message, PermissionLevel, Adapter } from '../common/types';
import * as readline from 'readline';

export interface ConsoleConfig {
  username?: string;
  permission?: PermissionLevel;
  prompt?: string;
  enableHistory?: boolean;
  historySize?: number;
  enableColors?: boolean;
}

export class ConsoleAdapter extends BaseAdapter {
  public readonly metadata: AdapterMetadata = {
    name: 'console-adapter',
    version: '2.0.0',
    description: '控制台适配器，支持命令行交互',
    author: 'Framework Team',
    type: 'bidirectional',
    protocol: 'console',
    dependencies: [],
    priority: 200,
    config: {
      username: 'Console User',
      permission: PermissionLevel.OWNER,
      prompt: '[控制台] ',
      enableHistory: true,
      historySize: 100,
      enableColors: true
    }
  };

  private consoleConfig?: ConsoleConfig;
  private rl?: readline.Interface;
  private messageHistory: string[] = [];
  private messageCallback?: (message: Message) => void;
  private currentUser: string = 'Console User';
  private currentPermission: PermissionLevel = PermissionLevel.OWNER;

  constructor() {
    super();
  }

  /**
   * 获取控制台配置
   */
  private getConsoleConfig(): ConsoleConfig {
    if (!this.consoleConfig) {
      this.consoleConfig = this.metadata.config as ConsoleConfig;
    }
    return this.consoleConfig;
  }

  /**
   * 适配器加载
   */
  protected async onLoad(): Promise<void> {
    Logger.debug('控制台适配器开始加载');
    // 控制台适配器无需特殊加载逻辑
    Logger.debug('控制台适配器加载完成');
  }

  /**
   * 适配器初始化
   */
  protected async onInitialize(): Promise<void> {
    Logger.debug('控制台适配器开始初始化');
    this.setupReadline();
    Logger.debug('控制台适配器初始化完成');
  }

  /**
   * 适配器连接
   */
  protected async onConnect(): Promise<void> {
    Logger.info('正在连接控制台适配器');
    
    Logger.info('控制台适配器已连接，可以开始输入消息');
    this.showWelcomeMessage();
    this.promptUser();
  }

  /**
   * 适配器断开连接
   */
  protected async onDisconnect(): Promise<void> {
    Logger.info('正在断开控制台适配器');
    
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }
    
    Logger.info('控制台适配器已断开');
  }

  /**
   * 适配器卸载
   */
  protected async onUnload(): Promise<void> {
    Logger.debug('控制台适配器开始卸载');
    
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }
    
    this.messageHistory = [];
    
    Logger.debug('控制台适配器卸载完成');
  }

  /**
   * 发送消息 - 重写BaseAdapter方法
   */
  protected async onSendMessage(context: MessageContext): Promise<void> {
    const config = this.getConsoleConfig();
    const timestamp = new Date().toLocaleTimeString();
    const coloredContent = config.enableColors ? 
      `\x1b[32m[Bot -> ${context.target || 'console'}]\x1b[0m ${context.content}` : 
      `[Bot -> ${context.target || 'console'}] ${context.content}`;
    
    console.log(`${timestamp} ${coloredContent}`);
    
    // 重新显示提示符
    this.promptUser();
  }

  /**
   * 设置readline接口
   */
  private setupReadline(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.getConsoleConfig().prompt || '[控制台] '
    });

    this.rl.on('line', (input: string) => {
      this.handleInput(input.trim());
    });

    this.rl.on('close', () => {
      Logger.info('控制台输入已关闭');
    });
  }

  /**
   * 处理用户输入
   */
  private handleInput(input: string): void {
    if (!input) {
      this.promptUser();
      return;
    }

    // 处理控制台命令
    if (input.startsWith('/')) {
      this.handleCommand(input);
      return;
    }

    // 添加到历史记录
    const config = this.getConsoleConfig();
    if (config.enableHistory) {
      this.messageHistory.push(input);
      if (this.messageHistory.length > (config.historySize || 100)) {
        this.messageHistory.shift();
      }
    }

    // 创建消息对象
    const message = {
      id: Date.now().toString(),
      content: input,
      sender: {
        id: 'console-user',
        name: this.currentUser,
        permission: this.currentPermission
      },
      platform: 'console',
      timestamp: Date.now()
    };

    // 触发消息事件
    this.receiveMessage({
      id: message.id,
      timestamp: new Date(message.timestamp),
      source: 'console',
      type: 'text',
      content: message
    });
    this.promptUser();
  }

  /**
   * 处理控制台命令
   */
  private handleCommand(command: string): void {
    const [cmd, ...args] = command.slice(1).split(' ');
    const config = this.getConsoleConfig();

    switch (cmd.toLowerCase()) {
      case 'help':
        console.log('\n可用命令:');
        console.log('  /help - 显示帮助信息');
        console.log('  /quit - 退出程序');
        console.log('  /clear - 清屏');
        console.log('  /user <name> - 设置用户名');
        console.log('  /permission <level> - 设置权限级别 (owner/admin/user)');
        console.log('  /history - 显示消息历史');
        console.log('  /status - 显示适配器状态\n');
        break;

      case 'quit':
      case 'exit':
        console.log('正在退出...');
        process.exit(0);
        break;

      case 'clear':
        console.clear();
        this.showWelcomeMessage();
        break;

      case 'user':
        if (args.length > 0) {
          this.consoleConfig = { ...config, username: args.join(' ') };
          console.log(`用户名已设置为: ${this.consoleConfig.username}`);
        } else {
          console.log(`当前用户名: ${config.username}`);
        }
        break;

      case 'permission':
        if (args.length > 0) {
          const level = args[0].toLowerCase();
          if (['owner', 'admin', 'user'].includes(level)) {
            this.consoleConfig = { ...config, permission: level as unknown as PermissionLevel };
            console.log(`权限级别已设置为: ${this.consoleConfig.permission}`);
          } else {
            console.log('无效的权限级别，可用值: owner, admin, user');
          }
        } else {
          console.log(`当前权限级别: ${config.permission}`);
        }
        break;

      case 'history':
        if (this.messageHistory.length === 0) {
          console.log('暂无消息历史');
        } else {
          console.log('\n消息历史:');
          this.messageHistory.forEach((msg, index) => {
            console.log(`  ${index + 1}. ${msg}`);
          });
          console.log();
        }
        break;

      case 'status':
        console.log('\n适配器状态:');
        console.log(`  名称: ${this.metadata.name}`);
        console.log(`  版本: ${this.metadata.version}`);
        console.log(`   状态: ${this.getStats().connectionStatus}`);
        console.log(`  用户: ${config.username}`);
        console.log(`  权限: ${config.permission}`);
        console.log(`  历史记录: ${this.messageHistory.length} 条\n`);
        break;

      default:
        console.log(`未知命令: ${cmd}，输入 /help 查看可用命令`);
        break;
    }

    this.promptUser();
  }

  /**
   * 显示欢迎消息
   */
  private showWelcomeMessage(): void {
    const config = this.getConsoleConfig();
    if (config.enableColors) {
      console.log('\x1b[36m╔══════════════════════════════════════╗\x1b[0m');
      console.log('\x1b[36m║          控制台适配器已启动          ║\x1b[0m');
      console.log('\x1b[36m╚══════════════════════════════════════╝\x1b[0m');
      console.log(`\x1b[33m欢迎, ${config.username}!\x1b[0m`);
      console.log('\x1b[32m输入消息开始对话，输入 /help 查看命令\x1b[0m\n');
    } else {
      console.log('══════════════════════════════════════');
      console.log('          控制台适配器已启动          ');
      console.log('══════════════════════════════════════');
      console.log(`欢迎, ${config.username}!`);
      console.log('输入消息开始对话，输入 /help 查看命令\n');
    }
  }

  /**
   * 显示用户提示符
   */
  private promptUser(): void {
    if (this.rl) {
      this.rl.prompt();
    }
  }

  /**
   * 适配器包装器 - 实现Adapter接口
   */
  public getAdapterWrapper(): Adapter {
    const self = this;
    return {
      name: this.metadata.name,
      
      async connect(): Promise<void> {
        await self.connect();
      },
      
      async disconnect(): Promise<void> {
        await self.disconnect();
      },
      
      async sendMessage(target: string, content: string): Promise<void> {
        const context: MessageContext = {
          id: `console-${Date.now()}`,
          target,
          content,
          source: 'system',
          type: 'text',
          timestamp: new Date()
        };
        await self.sendMessage(context);
      },
      
      onMessage(callback: (message: Message) => void): void {
        self.messageCallback = callback;
      },
      
      isConnected(): boolean {
        return self.isConnected();
      }
    };
  }

  // 实现Adapter接口的onMessage方法
  public onMessage(callback: (message: Message) => void): void {
    this.messageCallback = callback;
  }

  // 重写receiveMessage方法以调用回调
  protected async onReceiveMessage(context: MessageContext): Promise<void> {
    if (this.messageCallback && context.content) {
      this.messageCallback(context.content);
    }
    await super.onReceiveMessage(context);
  }
}