import { Adapter, Message, PermissionLevel } from '../common/types';
import { Logger } from '../config/log';
import * as WebSocket from 'ws';

export interface WebSocketConfig {
  port: number;
  host?: string;
  
  // 认证配置
  authToken?: string;
  allowedOrigins?: string[];
  
  // 权限配置
  defaultPermission?: PermissionLevel;
  userPermissions?: { [userId: string]: PermissionLevel };
  
  // SSL配置
  ssl?: {
    cert: string;
    key: string;
  };
}

interface WebSocketClient {
  id: string;
  ws: WebSocket;
  userId?: string;
  permission: PermissionLevel;
  authenticated: boolean;
  lastPing: number;
}

export class WebSocketAdapter implements Adapter {
  public name = 'websocket';
  private config: WebSocketConfig;
  private connected = false;
  private messageCallback?: (message: Message) => void;
  private server?: WebSocket.Server;
  private clients: Map<string, WebSocketClient> = new Map();
  private pingInterval?: NodeJS.Timeout;

  constructor(config: WebSocketConfig) {
    this.config = {
      host: '0.0.0.0',
      defaultPermission: PermissionLevel.USER,
      ...config
    };
  }

  public async connect(): Promise<void> {
    try {
      Logger.info(`正在启动WebSocket服务器 ${this.config.host}:${this.config.port}...`);
      
      const options: WebSocket.ServerOptions = {
        port: this.config.port,
        host: this.config.host
      };

      this.server = new WebSocket.Server(options);
      
      this.setupServerEvents();
      this.startPingInterval();
      
      this.connected = true;
      Logger.info(`WebSocket服务器已启动: ws://${this.config.host}:${this.config.port}`);
      
    } catch (error) {
      Logger.error('WebSocket服务器启动失败:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    Logger.info('正在关闭WebSocket服务器...');
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
    
    // 关闭所有客户端连接
    this.clients.forEach(client => {
      client.ws.close();
    });
    this.clients.clear();
    
    // 关闭服务器
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
    
    this.connected = false;
    Logger.info('WebSocket服务器已关闭');
  }

  public async sendMessage(target: string, content: string): Promise<void> {
    if (!this.connected) {
      throw new Error('WebSocket adapter 未连接');
    }

    try {
      if (target === 'broadcast') {
        // 广播消息到所有已认证的客户端
        this.broadcast({
          type: 'message',
          content: content,
          timestamp: Date.now()
        });
      } else {
        // 发送到特定客户端
        const client = this.clients.get(target);
        if (client && client.authenticated) {
          this.sendToClient(client, {
            type: 'message',
            content: content,
            timestamp: Date.now()
          });
        } else {
          throw new Error(`客户端 ${target} 不存在或未认证`);
        }
      }
      
      Logger.debug(`WebSocket消息已发送到 ${target}: ${content}`);
    } catch (error) {
      Logger.error(`发送WebSocket消息失败:`, error);
      throw error;
    }
  }

  public onMessage(callback: (message: Message) => void): void {
    this.messageCallback = callback;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  private setupServerEvents(): void {
    if (!this.server) return;

    this.server.on('connection', (ws: WebSocket, req) => {
      const clientId = this.generateClientId();
      const client: WebSocketClient = {
        id: clientId,
        ws: ws,
        permission: this.config.defaultPermission || PermissionLevel.USER,
        authenticated: !this.config.authToken, // 如果没有设置认证令牌，默认认证通过
        lastPing: Date.now()
      };

      this.clients.set(clientId, client);
      Logger.info(`WebSocket客户端连接: ${clientId} (${req.socket.remoteAddress})`);

      // 发送欢迎消息
      this.sendToClient(client, {
        type: 'welcome',
        clientId: clientId,
        authenticated: client.authenticated,
        message: '欢迎连接到Bot WebSocket服务器'
      });

      // 设置客户端事件监听器
      this.setupClientEvents(client);
    });

    this.server.on('error', (error) => {
      Logger.error('WebSocket服务器错误:', error);
    });
  }

  private setupClientEvents(client: WebSocketClient): void {
    client.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(client, message);
      } catch (error) {
        Logger.error(`解析WebSocket消息失败:`, error);
        this.sendToClient(client, {
          type: 'error',
          message: '消息格式错误'
        });
      }
    });

    client.ws.on('close', () => {
      Logger.info(`WebSocket客户端断开: ${client.id}`);
      this.clients.delete(client.id);
    });

    client.ws.on('error', (error) => {
      Logger.error(`WebSocket客户端错误 ${client.id}:`, error);
    });

    client.ws.on('pong', () => {
      client.lastPing = Date.now();
    });
  }

  private handleClientMessage(client: WebSocketClient, message: any): void {
    switch (message.type) {
      case 'auth':
        this.handleAuth(client, message);
        break;
        
      case 'message':
        this.handleMessage(client, message);
        break;
        
      case 'ping':
        this.sendToClient(client, { type: 'pong' });
        break;
        
      case 'setUser':
        this.handleSetUser(client, message);
        break;
        
      default:
        this.sendToClient(client, {
          type: 'error',
          message: `未知消息类型: ${message.type}`
        });
    }
  }

  private handleAuth(client: WebSocketClient, message: any): void {
    if (!this.config.authToken) {
      this.sendToClient(client, {
        type: 'auth_result',
        success: true,
        message: '无需认证'
      });
      return;
    }

    if (message.token === this.config.authToken) {
      client.authenticated = true;
      this.sendToClient(client, {
        type: 'auth_result',
        success: true,
        message: '认证成功'
      });
      Logger.info(`WebSocket客户端认证成功: ${client.id}`);
    } else {
      this.sendToClient(client, {
        type: 'auth_result',
        success: false,
        message: '认证失败'
      });
      Logger.warn(`WebSocket客户端认证失败: ${client.id}`);
    }
  }

  private handleSetUser(client: WebSocketClient, message: any): void {
    if (!client.authenticated) {
      this.sendToClient(client, {
        type: 'error',
        message: '请先完成认证'
      });
      return;
    }

    const { userId, username } = message;
    client.userId = userId;
    
    // 设置用户权限
    if (this.config.userPermissions && this.config.userPermissions[userId]) {
      client.permission = this.config.userPermissions[userId];
    }

    this.sendToClient(client, {
      type: 'user_set',
      success: true,
      userId: userId,
      permission: client.permission
    });

    Logger.info(`WebSocket客户端设置用户: ${client.id} -> ${userId} (${username})`);
  }

  private handleMessage(client: WebSocketClient, message: any): void {
    if (!client.authenticated) {
      this.sendToClient(client, {
        type: 'error',
        message: '请先完成认证'
      });
      return;
    }

    if (!this.messageCallback) return;

    const botMessage: Message = {
      id: Date.now().toString(),
      content: message.content,
      sender: {
        id: client.userId || client.id,
        name: message.username || `WebSocket用户${client.id}`,
        permission: client.permission
      },
      platform: 'websocket',
      timestamp: Date.now(),
      extra: {
        clientId: client.id,
        messageType: 'websocket'
      }
    };

    Logger.info(`收到WebSocket消息: ${botMessage.content} (来自: ${botMessage.sender.name})`);
    this.messageCallback(botMessage);
  }

  private sendToClient(client: WebSocketClient, data: any): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }

  private broadcast(data: any): void {
    this.clients.forEach(client => {
      if (client.authenticated) {
        this.sendToClient(client, data);
      }
    });
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      
      this.clients.forEach(client => {
        // 发送ping
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping();
        }
        
        // 检查超时的客户端
        if (now - client.lastPing > 60000) { // 60秒超时
          Logger.warn(`WebSocket客户端超时: ${client.id}`);
          client.ws.close();
          this.clients.delete(client.id);
        }
      });
    }, 30000); // 每30秒检查一次
  }

  private generateClientId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  // 获取连接的客户端列表
  public getConnectedClients(): string[] {
    return Array.from(this.clients.keys());
  }

  // 获取已认证的客户端数量
  public getAuthenticatedClientCount(): number {
    return Array.from(this.clients.values()).filter(client => client.authenticated).length;
  }
}

// 默认导出
export default WebSocketAdapter;
