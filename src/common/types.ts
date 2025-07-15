// 权限等级枚举
export enum PermissionLevel {
  USER = 1,
  ADMIN = 2,
  OWNER = 3
}

// 消息类型
export interface Message {
  id: string;
  content: string;
  sender: {
    id: string;
    name: string;
    permission: PermissionLevel;
  };
  platform: string;
  groupId?: string;
  timestamp: number;
  extra?: any; // 额外的平台特定数据
}

// 适配器接口
export interface Adapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(target: string, content: string): Promise<void>;
  onMessage(callback: (message: Message) => void): void;
  isConnected(): boolean;
  // 通用API
  getSessionList?(): string[];
  sendFile?(target: string, filePath: string): Promise<void>;
  getUserInfo?(userId: string): Promise<any>;
  broadcastMessage?(content: string): Promise<void>;
  // 群聊/好友相关
  getGroupList?(): Promise<any[]>;
  getFriendList?(): Promise<any[]>;
  kickUser?(groupId: string, userId: string): Promise<void>;
  muteUser?(groupId: string, userId: string, duration: number): Promise<void>;
  getBotInfo?(): Promise<any>;
  // 适配器自定义API可扩展
}

// 插件函数注册信息
export interface PluginFunction {
  name: string;
  description: string;
  permission: PermissionLevel;
  triggers: string[];
  adapters?: string[]; // 支持的适配器平台，如 ['qq', 'telegram']，不填为全部
  handler: (message: Message, args: string[]) => Promise<void>;
}

// 插件接口
export interface Plugin {
  name: string;
  version: string;
  description: string;
  load(): Promise<void>;
  unload(): Promise<void>;
  reload(): Promise<void>;
  getFunctions(): PluginFunction[];
  getConfigPath(): string;
}

// 框架事件
export interface FrameworkEvents {
  'message': (message: Message) => void;
  'plugin-loaded': (plugin: Plugin) => void;
  'plugin-unloaded': (plugin: Plugin) => void;
  'error': (error: Error) => void;
}