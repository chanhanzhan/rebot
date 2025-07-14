import { Adapter, Message, PermissionLevel } from '../common/types';
import { Logger } from '../config/log';
import * as readline from 'readline';

export interface ConsoleConfig {
  username?: string;
  permission?: PermissionLevel;
  prompt?: string;
  enableHistory?: boolean;
  historySize?: number;
  enableColors?: boolean;
}

export class ConsoleAdapter implements Adapter {
  public name = 'console';
  private config: ConsoleConfig;
  private connected = false;
  private messageCallback?: (message: Message) => void;
  private rl?: readline.Interface;
  private messageHistory: string[] = [];

  constructor(config: ConsoleConfig = {}) {
    this.config = {
      username: 'Console User',
      permission: PermissionLevel.OWNER,
      prompt: '[控制台] ',
      enableHistory: true,
      historySize: 100,
      enableColors: true,
      ...config
    };
  }

  public async connect(): Promise<void> {
    Logger.info('正在连接控制台适配器');
    
    this.setupReadline();
    this.connected = true;
    
    Logger.info('控制台适配器已连接，可以开始输入消息');
    this.showWelcomeMessage();
    this.promptUser();
  }

  public async disconnect(): Promise<void> {
    Logger.info('正在断开控制台适配器');
    
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }
    
    this.connected = false;
    Logger.info('控制台适配器已断开');
  }

  public async sendMessage(target: string, content: string): Promise<void> {
    const timestamp = new Date().toLocaleTimeString();
    const coloredContent = this.config.enableColors ? 
      `\x1b[32m[Bot -> ${target}]\x1b[0m ${content}` : 
      `[Bot -> ${target}] ${content}`;
    
    console.log(`${timestamp} ${coloredContent}`);
    
    // 重新显示提示符
    if (this.rl && this.connected) {
      this.rl.prompt();
    }
  }

  public onMessage(callback: (message: Message) => void): void {
    Logger.debug('[控制台适配器] 设置消息回调函数');
    this.messageCallback = callback;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  private setupReadline(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.config.prompt,
      historySize: this.config.enableHistory ? this.config.historySize : 0
    });

    this.rl.on('line', (input: string) => {
      this.handleInput(input.trim());
    });

    this.rl.on('close', () => {
      Logger.info('控制台输入已关闭');
      this.connected = false;
    });
/*
    this.rl.on('SIGINT', () => {
      console.log('\n使用 /quit 或 /exit 退出程序');
      this.rl?.prompt();
    });
*/    
  }

  private handleInput(input: string): void {
    if (!this.connected || !this.messageCallback) {
      return;
    }

    // 处理控制台命令
    if (input.startsWith('/')) {
      this.handleCommand(input);
      return;
    }

    // 忽略空输入
    if (!input) {
      this.promptUser();
      return;
    }

    // 添加到历史记录
    if (this.config.enableHistory) {
      this.addToHistory(input);
    }

    // 创建消息对象
    const message: Message = {
      id: Date.now().toString(),
      content: input,
      sender: {
        id: 'console_user',
        name: this.config.username!,
        permission: this.config.permission!
      },
      platform: 'console',
      timestamp: Date.now(),
      extra: {
        source: 'console_input'
      }
    };

    Logger.debug(`[控制台适配器] 控制台输入: ${input}`);
    this.messageCallback(message);
  
    this.promptUser();
  }

  private handleCommand(command: string): void {
    const [cmd, ...args] = command.slice(1).split(' ');
    
    switch (cmd.toLowerCase()) {
      case 'help':
        this.showHelp();
        break;
        
      case 'quit':
      case 'exit':
        this.disconnect();
        process.exit(0);
        break;
        
      case 'clear':
        console.clear();
        this.showWelcomeMessage();
        break;
        
      case 'history':
        this.showHistory();
        break;
        
      case 'status':
        this.showStatus();
        break;
        
      case 'user':
        this.handleUserCommand(args);
        break;
        
      default:
        console.log(`未知命令: ${cmd}。输入 /help 查看可用命令。`);
    }
    
    this.promptUser();
  }

  private handleUserCommand(args: string[]): void {
    if (args.length === 0) {
      console.log(`当前用户: ${this.config.username} (权限: ${this.config.permission})`);
      return;
    }

    const [action, ...params] = args;
    
    switch (action) {
      case 'name':
        if (params.length > 0) {
          this.config.username = params.join(' ');
          console.log(`用户名已更改为: ${this.config.username}`);
        } else {
          console.log('请提供用户名');
        }
        break;
        
      case 'permission':
        if (params.length > 0) {
          const permission = params[0].toUpperCase() as keyof typeof PermissionLevel;
          if (permission in PermissionLevel) {
            this.config.permission = PermissionLevel[permission];
            console.log(`权限已更改为: ${this.config.permission}`);
          } else {
            console.log('无效的权限级别。可用选项: USER, ADMIN, OWNER');
          }
        } else {
          console.log('请提供权限级别 (USER, ADMIN, OWNER)');
        }
        break;
        
      default:
        console.log('可用的用户命令: name <名称>, permission <级别>');
    }
  }

  private showWelcomeMessage(): void {
    if (!this.config.enableColors) {
      console.log('=== Bot 控制台适配器 ===');
      console.log('输入消息与Bot交互，或使用 /help 查看命令');
      return;
    }

    console.log('\x1b[36m╔══════════════════════════════════╗\x1b[0m');
    console.log('\x1b[36m║      Bot 控制台适配器           ║\x1b[0m');
    console.log('\x1b[36m╚══════════════════════════════════╝\x1b[0m');
    console.log('\x1b[33m输入消息与Bot交互，或使用 /help 查看命令\x1b[0m');
    console.log();
  }

  private showHelp(): void {
    console.log('\n可用命令:');
    console.log('  /help     - 显示此帮助信息');
    console.log('  /quit     - 退出程序');
    console.log('  /exit     - 退出程序');
    console.log('  /clear    - 清屏');
    console.log('  /history  - 显示消息历史');
    console.log('  /status   - 显示状态信息');
    console.log('  /user     - 显示当前用户信息');
    console.log('  /user name <名称> - 设置用户名');
    console.log('  /user permission <级别> - 设置权限级别');
    console.log();
  }

  private showHistory(): void {
    if (this.messageHistory.length === 0) {
      console.log('消息历史为空');
      return;
    }

    console.log('\n消息历史:');
    this.messageHistory.slice(-10).forEach((msg, index) => {
      console.log(`  ${index + 1}. ${msg}`);
    });
    console.log();
  }

  private showStatus(): void {
    console.log('\n状态信息:');
    console.log(`  适配器: ${this.name}`);
    console.log(`  连接状态: ${this.connected ? '已连接' : '未连接'}`);
    console.log(`  用户: ${this.config.username}`);
    console.log(`  权限: ${this.config.permission}`);
    console.log(`  历史记录: ${this.messageHistory.length} 条消息`);
    console.log(`  进程运行时间: ${Math.floor(process.uptime())} 秒`);
    console.log();
  }

  private addToHistory(message: string): void {
    this.messageHistory.push(message);
    
    // 限制历史记录大小
    if (this.messageHistory.length > this.config.historySize!) {
      this.messageHistory.shift();
    }
  }

  private promptUser(): void {
    if (this.rl && this.connected) {
      this.rl.prompt();
    }
  }
}

// 设置默认导出
export default ConsoleAdapter;