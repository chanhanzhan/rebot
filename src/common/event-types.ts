/**
 * 框架事件类型定义
 */

export enum EventType {
  // 系统事件
  SYSTEM_START = 'system.start',
  SYSTEM_STOP = 'system.stop',
  SYSTEM_ERROR = 'system.error',
  SYSTEM_READY = 'system.ready',
  
  // 适配器事件
  ADAPTER_CONNECT = 'adapter.connect',
  ADAPTER_DISCONNECT = 'adapter.disconnect',
  ADAPTER_ERROR = 'adapter.error',
  ADAPTER_MESSAGE = 'adapter.message',
  
  // 插件事件
  PLUGIN_LOAD = 'plugin.load',
  PLUGIN_UNLOAD = 'plugin.unload',
  PLUGIN_ERROR = 'plugin.error',
  PLUGIN_READY = 'plugin.ready',
  
  // 消息事件
  MESSAGE_RECEIVE = 'message.receive',
  MESSAGE_SEND = 'message.send',
  MESSAGE_ERROR = 'message.error',
  
  // 配置事件
  CONFIG_LOAD = 'config.load',
  CONFIG_RELOAD = 'config.reload',
  CONFIG_ERROR = 'config.error',
  
  // 数据库事件
  DATABASE_CONNECT = 'database.connect',
  DATABASE_DISCONNECT = 'database.disconnect',
  DATABASE_ERROR = 'database.error',
  
  // OneBot事件
  ONEBOT_CONNECT = 'onebot.connect',
  ONEBOT_DISCONNECT = 'onebot.disconnect',
  ONEBOT_MESSAGE = 'onebot.message',
  ONEBOT_REQUEST = 'onebot.request',
  ONEBOT_NOTICE = 'onebot.notice',
  ONEBOT_META = 'onebot.meta'
}

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal'
}

export enum LogCategory {
  SYSTEM = 'system',
  ADAPTER = 'adapter',
  PLUGIN = 'plugin',
  MESSAGE = 'message',
  CONFIG = 'config',
  DATABASE = 'database',
  ONEBOT = 'onebot',
  HTTP = 'http',
  WEBSOCKET = 'websocket',
  SECURITY = 'security',
  PERFORMANCE = 'performance'
}

export interface BaseEvent {
  id: string;
  type: EventType;
  timestamp: number;
  source: string;
  data?: any;
}

export interface SystemEvent extends BaseEvent {
  type: EventType.SYSTEM_START | EventType.SYSTEM_STOP | EventType.SYSTEM_ERROR | EventType.SYSTEM_READY;
  data: {
    version?: string;
    uptime?: number;
    error?: Error;
    message?: string;
  };
}

export interface AdapterEvent extends BaseEvent {
  type: EventType.ADAPTER_CONNECT | EventType.ADAPTER_DISCONNECT | EventType.ADAPTER_ERROR | EventType.ADAPTER_MESSAGE;
  data: {
    adapterId: string;
    adapterType: string;
    error?: Error;
    message?: any;
    connectionInfo?: {
      host?: string;
      port?: number;
      protocol?: string;
    };
  };
}

export interface PluginEvent extends BaseEvent {
  type: EventType.PLUGIN_LOAD | EventType.PLUGIN_UNLOAD | EventType.PLUGIN_ERROR | EventType.PLUGIN_READY;
  data: {
    pluginId: string;
    pluginName: string;
    version?: string;
    error?: Error;
    loadTime?: number;
  };
}

export interface MessageEvent extends BaseEvent {
  type: EventType.MESSAGE_RECEIVE | EventType.MESSAGE_SEND | EventType.MESSAGE_ERROR;
  data: {
    messageId?: string;
    userId?: string;
    groupId?: string;
    content?: string;
    messageType?: 'private' | 'group' | 'channel';
    platform?: string;
    error?: Error;
  };
}

export interface ConfigEvent extends BaseEvent {
  type: EventType.CONFIG_LOAD | EventType.CONFIG_RELOAD | EventType.CONFIG_ERROR;
  data: {
    configFile?: string;
    configType?: string;
    error?: Error;
    changes?: string[];
  };
}

export interface DatabaseEvent extends BaseEvent {
  type: EventType.DATABASE_CONNECT | EventType.DATABASE_DISCONNECT | EventType.DATABASE_ERROR;
  data: {
    database?: string;
    host?: string;
    port?: number;
    error?: Error;
    connectionTime?: number;
  };
}

export interface OneBotEvent extends BaseEvent {
  type: EventType.ONEBOT_CONNECT | EventType.ONEBOT_DISCONNECT | EventType.ONEBOT_MESSAGE | EventType.ONEBOT_REQUEST | EventType.ONEBOT_NOTICE | EventType.ONEBOT_META;
  data: {
    selfId?: string;
    userId?: string;
    groupId?: string;
    messageType?: string;
    subType?: string;
    message?: any;
    rawEvent?: any;
    endpoint?: string;
  };
}

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  source: string;
  message: string;
  data?: any;
  error?: Error;
  tags?: string[];
}

export type FrameworkEvent = 
  | SystemEvent 
  | AdapterEvent 
  | PluginEvent 
  | MessageEvent 
  | ConfigEvent 
  | DatabaseEvent 
  | OneBotEvent;