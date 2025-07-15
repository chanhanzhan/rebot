import { Adapter, Message, PermissionLevel } from '../common/types';
import { Logger } from '../config/log';

export interface QQConfig {
  // OICQ配置
  uin: number; // QQ号
  password?: string; // 密码（可选，支持扫码登录）
  platform?: 1 | 2 | 3 | 4 | 5; // 登录设备类型
  
  // 权限配置
  allowedGroups?: string[]; // 允许的群组
  allowedUsers?: string[]; // 允许的用户
  adminUsers?: string[]; // 管理员用户
  ownerUsers?: string[]; // 主人用户
  
  // 功能配置
  autoAcceptFriend?: boolean; // 自动接受好友请求
  autoAcceptGroupInvite?: boolean; // 自动接受群邀请
  
  // 数据目录
  dataDir?: string;
  
  // 日志配置
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'off';
}

interface QQUser {
  user_id: number;
  nickname: string;
  card?: string;
  role?: 'owner' | 'admin' | 'member';
}

interface QQGroup {
  group_id: number;
  group_name: string;
}

export class QQAdapter implements Adapter {
  public name = 'qq';
  private config: QQConfig;
  private connected = false;
  private messageCallback?: (message: Message) => void;
  private client: any; // OICQ客户端实例
  private loginPromise?: Promise<void>;

  constructor(config: QQConfig) {
    this.config = {
      platform: 5, // 默认iPad
      autoAcceptFriend: false,
      autoAcceptGroupInvite: false,
      dataDir: './data/qq',
      logLevel: 'info',
      ...config
    };
  }

  public async connect(): Promise<void> {
    try {
      Logger.info(`正在连接QQ Bot (${this.config.uin})...`);
      
      // 这里应该使用真实的OICQ库
      // const { createClient } = require('oicq');
      // this.client = createClient(this.config.uin, {
      //   platform: this.config.platform,
      //   data_dir: this.config.dataDir,
      //   log_level: this.config.logLevel
      // });
      
      // 模拟QQ客户端实现
      this.client = this.createMockClient();
      
      // 设置事件监听器
      this.setupEventHandlers();
      
      // 执行登录
      await this.login();
      
      this.connected = true;
      Logger.info(`QQ Bot连接成功: ${this.config.uin}`);
      
    } catch (error) {
      Logger.error('QQ连接失败:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    Logger.info('正在断开QQ连接...');
    
    if (this.client) {
      // this.client.terminate();
      this.client = null;
    }
    
    this.connected = false;
    Logger.info('QQ连接已断开');
  }

  public async sendMessage(target: string, content: string): Promise<void> {
    if (!this.connected || !this.client) {
      throw new Error('QQ adapter 未连接');
    }

    try {
      const [type, id] = target.split(':');
      
      if (type === 'private') {
        await this.client.sendPrivateMsg(parseInt(id), content);
      } else if (type === 'group') {
        await this.client.sendGroupMsg(parseInt(id), content);
      } else {
        throw new Error(`不支持的目标类型: ${type}`);
      }
      
      Logger.debug(`QQ消息已发送到 ${target}: ${content}`);
    } catch (error) {
      Logger.error(`发送QQ消息失败:`, error);
      throw error;
    }
  }

  public onMessage(callback: (message: Message) => void): void {
    this.messageCallback = callback;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  private async login(): Promise<void> {
    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('QQ客户端未初始化'));
        return;
      }

      // 登录事件
      this.client.on('system.login.qrcode', () => {
        Logger.info('请使用手机QQ扫描二维码登录');
        // 在实际实现中，这里会显示二维码
      });

      this.client.on('system.login.slider', () => {
        Logger.info('请完成滑块验证');
        // 在实际实现中，这里会处理滑块验证
      });

      this.client.on('system.login.device', () => {
        Logger.info('请完成设备验证');
        // 在实际实现中，这里会处理设备验证
      });

      this.client.on('system.online', () => {
        Logger.info('QQ登录成功');
        resolve();
      });

      this.client.on('system.offline', (data: any) => {
        Logger.warn('QQ离线:', data.message);
        this.connected = false;
      });

      // 开始登录
      if (this.config.password) {
        this.client.login(this.config.password);
      } else {
        this.client.login(); // 扫码登录
      }
    });

    return this.loginPromise;
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    // 私聊消息
    this.client.on('message.private', (e: any) => {
      this.handlePrivateMessage(e);
    });

    // 群聊消息
    this.client.on('message.group', (e: any) => {
      this.handleGroupMessage(e);
    });

    // 好友请求
    this.client.on('request.friend', (e: any) => {
      this.handleFriendRequest(e);
    });

    // 群邀请
    this.client.on('request.group.invite', (e: any) => {
      this.handleGroupInvite(e);
    });

    // 群申请
    this.client.on('request.group.add', (e: any) => {
      this.handleGroupAdd(e);
    });
  }

  private handlePrivateMessage(e: any): void {
    if (!this.messageCallback) return;

    const userId = e.user_id.toString();
    
    // 检查用户权限
    if (!this.isUserAllowed(userId)) {
      Logger.debug(`拒绝用户 ${userId} 的私聊消息`);
      return;
    }

    const message: Message = {
      id: e.message_id,
      content: e.raw_message,
      sender: {
        id: userId,
        name: e.nickname,
        permission: this.getUserPermission(userId)
      },
      platform: 'qq',
      timestamp: e.time * 1000,
      extra: {
        messageType: 'private',
        user: e.sender
      }
    };

    this.messageCallback(message);
  }

  private handleGroupMessage(e: any): void {
    if (!this.messageCallback) return;

    const userId = e.user_id.toString();
    const groupId = e.group_id.toString();
    
    // 检查群组权限
    if (!this.isGroupAllowed(groupId)) {
      Logger.debug(`拒绝群组 ${groupId} 的消息`);
      return;
    }

    // 检查用户权限
    if (!this.isUserAllowed(userId)) {
      Logger.debug(`拒绝用户 ${userId} 在群组 ${groupId} 的消息`);
      return;
    }

    const message: Message = {
      id: e.message_id,
      content: e.raw_message,
      sender: {
        id: userId,
        name: e.sender.card || e.sender.nickname,
        permission: this.getUserPermission(userId, e.sender.role)
      },
      platform: 'qq',
      timestamp: e.time * 1000,
      extra: {
        messageType: 'group',
        groupId: groupId,
        groupName: e.group_name,
        user: e.sender
      }
    };

    this.messageCallback(message);
  }

  private handleFriendRequest(e: any): void {
    Logger.info(`收到好友请求: ${e.nickname} (${e.user_id})`);
    
    if (this.config.autoAcceptFriend) {
      e.approve();
      Logger.info(`自动接受好友请求: ${e.nickname}`);
    }
  }

  private handleGroupInvite(e: any): void {
    Logger.info(`收到群邀请: ${e.group_name} (${e.group_id})`);
    
    if (this.config.autoAcceptGroupInvite) {
      e.approve();
      Logger.info(`自动接受群邀请: ${e.group_name}`);
    }
  }

  private handleGroupAdd(e: any): void {
    Logger.info(`收到入群申请: ${e.nickname} (${e.user_id}) 申请加入 ${e.group_name}`);
    
    // 这里可以根据配置自动处理入群申请
    // 暂时不自动处理，留给管理员手动审批
  }

  private isUserAllowed(userId: string): boolean {
    // 如果配置了允许的用户列表，检查用户是否在列表中
    if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
      return this.config.allowedUsers.includes(userId);
    }
    
    // 如果没有配置允许列表，默认允许所有用户
    return true;
  }

  private isGroupAllowed(groupId: string): boolean {
    // 如果配置了允许的群组列表，检查群组是否在列表中
    if (this.config.allowedGroups && this.config.allowedGroups.length > 0) {
      return this.config.allowedGroups.includes(groupId);
    }
    
    // 如果没有配置允许列表，默认允许所有群组
    return true;
  }

  private getUserPermission(userId: string, groupRole?: string): PermissionLevel {
    // 检查是否为主人
    if (this.config.ownerUsers?.includes(userId)) {
      return PermissionLevel.OWNER;
    }
    
    // 检查是否为管理员
    if (this.config.adminUsers?.includes(userId)) {
      return PermissionLevel.ADMIN;
    }
    
    // 根据群组角色判断权限
    if (groupRole === 'owner') {
      return PermissionLevel.ADMIN;
    } else if (groupRole === 'admin') {
      return PermissionLevel.ADMIN;
    }
    
    return PermissionLevel.USER;
  }

  // 模拟QQ客户端（用于开发测试）
  private createMockClient(): any {
    const events: { [key: string]: Function[] } = {};
    
    return {
      on: (event: string, handler: Function) => {
        if (!events[event]) events[event] = [];
        events[event].push(handler);
      },
      
      emit: (event: string, ...args: any[]) => {
        if (events[event]) {
          events[event].forEach(handler => handler(...args));
        }
      },
      
      login: (password?: string) => {
        Logger.info('模拟QQ登录中...');
        setTimeout(() => {
          if (events['system.online']) {
            events['system.online'].forEach(handler => handler());
          }
        }, 1000);
      },
      
      sendPrivateMsg: async (userId: number, message: string) => {
        Logger.debug(`模拟发送私聊消息到 ${userId}: ${message}`);
        return { message_id: Math.random().toString() };
      },
      
      sendGroupMsg: async (groupId: number, message: string) => {
        Logger.debug(`模拟发送群消息到 ${groupId}: ${message}`);
        return { message_id: Math.random().toString() };
      },
      
      // 模拟接收消息的方法（用于测试）
      simulateMessage: (type: 'private' | 'group', data: any) => {
        const event = `message.${type}`;
        if (events[event]) {
          events[event].forEach(handler => handler(data));
        }
      }
    };
  }

  // ====== 适配器通用/特有API补全 ======
  public async getBotInfo(): Promise<any> {
    return {
      uin: this.config.uin,
      platform: 'qq',
      status: this.connected ? 'online' : 'offline'
    };
  }
  public getSessionList(): string[] {
    // 模拟返回所有群和好友id
    return ['private:' + this.config.uin];
  }
  public async sendFile(target: string, filePath: string): Promise<void> {
    throw new Error('sendFile not implemented for QQAdapter');
  }
  public async getUserInfo(userId: string): Promise<any> {
    // 模拟返回用户信息
    return { id: userId, name: 'QQ用户' + userId };
  }
  public async broadcastMessage(content: string): Promise<void> {
    throw new Error('broadcastMessage not implemented for QQAdapter');
  }
  public async getGroupList(): Promise<any[]> {
    return [];
  }
  public async getFriendList(): Promise<any[]> {
    return [];
  }
  public async kickUser(userId: string, groupId?: string): Promise<void> {
    throw new Error('kickUser not implemented for QQAdapter');
  }
  public async muteUser(userId: string, groupId?: string, duration?: number): Promise<void> {
    throw new Error('muteUser not implemented for QQAdapter');
  }
}

// 默认导出
export default QQAdapter;
