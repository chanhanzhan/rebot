import { Adapter, Message, PermissionLevel } from '../common/types';
import { Logger } from '../config/log';
import * as https from 'https';
import * as http from 'http';

export interface TelegramConfig {
  token: string;
  allowedUsers?: (string | number)[];
  adminUsers?: (string | number)[];
  ownerUsers?: (string | number)[];
  webhook?: {
    url?: string;
    port?: number;
  };
  polling?: {
    enabled?: boolean;
    interval?: number;
    timeout?: number;
  };
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
}

export interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  date: number;
  text?: string;
  caption?: string;
  photo?: any[];
  document?: any;
  video?: any;
  audio?: any;
  voice?: any;
  sticker?: any;
}

export interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  switch_inline_query?: string;
  switch_inline_query_current_chat?: string;
}

export class TelegramAdapter implements Adapter {
  public name = 'telegram';
  private config: TelegramConfig;
  private connected = false;
  private messageCallback?: (message: Message) => void;
  private botInfo?: any;
  private pollingInterval?: NodeJS.Timeout;
  private lastUpdateId = 0;

  constructor(config: TelegramConfig) {
    this.config = {
      polling: { 
        enabled: true, 
        interval: 1000,
        timeout: 10
      },
      parseMode: 'HTML',
      ...config
    };
  }

  public async connect(): Promise<void> {
    try {
      Logger.info('正在连接到Telegram Bot API...');
      
      if (!this.config.token) {
        throw new Error('Telegram Bot Token 是必需的');
      }

      // 验证Bot Token
      await this.getBotInfo();
      
      // 开始轮询或设置Webhook
      if (this.config.polling?.enabled) {
        this.startPolling();
      }
      
      this.connected = true;
      Logger.info(`Telegram Bot连接成功: @${this.botInfo?.username}`);
      
    } catch (error) {
      let errMsg = '';
      if (typeof error === 'string') {
        errMsg = error;
      } else if (error instanceof Error) {
        errMsg = error.stack || error.message;
      } else {
        try {
          errMsg = JSON.stringify(error);
        } catch {
          errMsg = String(error);
        }
      }
      Logger.error('Telegram连接失败:', errMsg);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    Logger.info('正在断开Telegram连接...');
    
    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
      this.pollingInterval = undefined;
    }
    
    this.connected = false;
    Logger.info('Telegram连接已断开');
  }

  public async sendMessage(target: string, content: string, options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    replyMarkup?: InlineKeyboard;
    disableWebPagePreview?: boolean;
    disableNotification?: boolean;
  }): Promise<void> {
    if (!this.connected) {
      throw new Error('Telegram adapter 未连接');
    }

    try {
  
      let chatId = target;
      if (target.includes(':')) {
        chatId = target.split(':')[1] || target;
      }

      const params: any = {
        chat_id: chatId,
        text: content,
        parse_mode: options?.parseMode || this.config.parseMode || 'HTML'
      };

      if (options?.replyMarkup) {
        params.reply_markup = JSON.stringify(options.replyMarkup);
      }

      if (options?.disableWebPagePreview) {
        params.disable_web_page_preview = true;
      }

      if (options?.disableNotification) {
        params.disable_notification = true;
      }

      await this.makeApiCall('sendMessage', params);
      
      Logger.debug(`Telegram消息已发送到 ${chatId}: ${content}`);
    } catch (error) {
      Logger.error(`发送Telegram消息失败:`, error);
      throw error;
    }
  }

  public onMessage(callback: (message: Message) => void): void {
    Logger.debug('[Telegram适配器] 设置消息回调函数');
    this.messageCallback = callback;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  // ====== 适配器通用/特有API补全 ======
  public async getBotInfo(): Promise<any> {
    return this.botInfo || { platform: 'telegram', status: this.connected ? 'online' : 'offline' };
  }
  public getSessionList(): string[] {
    // 仅示例，实际应返回活跃会话id
    return [];
  }
  public async sendFile(target: string, filePath: string): Promise<void> {
    throw new Error('sendFile not implemented for TelegramAdapter');
  }
  public async getUserInfo(userId: string): Promise<any> {
    // 仅示例，实际应通过API获取
    return { id: userId, name: 'Telegram用户' + userId };
  }
  public async broadcastMessage(content: string): Promise<void> {
    throw new Error('broadcastMessage not implemented for TelegramAdapter');
  }
  public async getGroupList(): Promise<any[]> {
    return [];
  }
  public async getFriendList(): Promise<any[]> {
    return [];
  }
  public async kickUser(userId: string, groupId?: string): Promise<void> {
    throw new Error('kickUser not implemented for TelegramAdapter');
  }
  public async muteUser(userId: string, groupId?: string, duration?: number): Promise<void> {
    throw new Error('muteUser not implemented for TelegramAdapter');
  }

  private async makeApiCall(method: string, params?: any): Promise<any> {
    const url = `https://api.telegram.org/bot${this.config.token}/${method}`;
    
    return new Promise((resolve, reject) => {
      const postData = params ? JSON.stringify(params) : '';
      
      Logger.debug(`Telegram API调用: ${method}`, params ? JSON.stringify(params) : '无参数');
      
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'TelegramBot/1.0'
        },
        timeout: 30000 // 30秒超时
      };

      const req = https.request(url, options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            Logger.debug(`Telegram API响应状态: ${res.statusCode}`);
            Logger.debug(`Telegram API响应数据:`, data);
            
            const response = JSON.parse(data);
            
            if (response.ok) {
              resolve(response);
            } else {
              const errorMsg = `Telegram API错误: ${response.description || '未知错误'} (错误代码: ${response.error_code || 'unknown'})`;
              Logger.error(errorMsg);
              reject(new Error(errorMsg));
            }
          } catch (error) {
            const parseError = `解析Telegram API响应失败: ${error}，原始数据: ${data}`;
            Logger.error(parseError);
            reject(new Error(parseError));
          }
        });
      });

      req.on('error', (error) => {
        const requestError = `Telegram API请求失败: ${error.message}`;
        Logger.error(requestError);
        reject(new Error(requestError));
      });

      req.on('timeout', () => {
        req.destroy();
        const timeoutError = 'Telegram API请求超时';
        Logger.error(timeoutError);
        reject(new Error(timeoutError));
      });

      if (postData) {
        req.write(postData);
      }
      
      req.end();
    });
  }

  private startPolling(): void {
    Logger.info('开始Telegram消息轮询...');
    
    const poll = async () => {
      if (!this.connected) {
        Logger.debug('适配器已断开，停止轮询');
        return;
      }
      
      try {
        Logger.debug(`正在轮询Telegram消息，offset: ${this.lastUpdateId + 1}`);
        const updates = await this.getUpdates(this.lastUpdateId + 1);
        
        if (updates && updates.length > 0) {
          Logger.info(`收到 ${updates.length} 个Telegram更新`);
          for (const update of updates) {
            Logger.debug(`处理更新 ${update.update_id}:`, JSON.stringify(update, null, 2));
            await this.processUpdate(update);
            this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
          }
          Logger.debug(`更新offset为: ${this.lastUpdateId}`);
        } else {
          Logger.debug('没有新的Telegram更新');
        }
      } catch (error) {
        Logger.error('Telegram轮询错误:', error);
        // 在错误后等待更长时间再重试
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      // 继续轮询
      if (this.connected) {
        this.pollingInterval = setTimeout(poll, this.config.polling?.interval || 1000);
      }
    };
    
    // 立即开始第一次轮询
    setTimeout(poll, 100);
  }

  private async getUpdates(offset: number): Promise<any[]> {
    try {
      Logger.debug(`正在获取Telegram更新，offset: ${offset}`);
      
      const response = await this.makeApiCall('getUpdates', {
        offset: offset,
        limit: 10, // 减少限制数量
        timeout: 0, // 设置为0，使用短轮询
        allowed_updates: ['message', 'callback_query', 'inline_query']
      });
      
      const updates = response.result || [];
      if (updates.length > 0) {
        Logger.info(`收到 ${updates.length} 个Telegram更新`);
        Logger.debug('更新详情:', JSON.stringify(updates, null, 2));
      } else {
        Logger.debug('没有新的更新');
      }
      
      return updates;
    } catch (error) {
      Logger.error('获取Telegram更新失败:', error);
      return [];
    }
  }

  private async processUpdate(update: any): Promise<void> {
    Logger.debug(`处理Telegram更新:`, JSON.stringify(update, null, 2));
    
    if (!this.messageCallback) {
      Logger.error('消息回调函数未设置！');
      return;
    }
    
    // 处理普通消息
    if (update.message) {
      Logger.debug('处理普通消息');
      await this.processMessage(update.message);
    }
    
    // 处理回调查询（按钮点击）
    if (update.callback_query) {
      Logger.debug('处理回调查询');
      await this.processCallbackQuery(update.callback_query);
    }
    
    // 处理内联查询
    if (update.inline_query) {
      Logger.debug('处理内联查询');
      await this.processInlineQuery(update.inline_query);
    }
    
    if (!update.message && !update.callback_query && !update.inline_query) {
      Logger.debug('跳过不支持的更新类型');
    }
  }

  private async processMessage(telegramMessage: TelegramMessage): Promise<void> {
    Logger.debug(`正在处理Telegram消息:`, JSON.stringify(telegramMessage, null, 2));
    
    // 获取消息内容
    const content = telegramMessage.text || telegramMessage.caption || '';
    if (!content) {
      Logger.debug('跳过空消息或非文本消息');
      return;
    }
    
    // 检查用户权限
    const userId = telegramMessage.from.id.toString();
    Logger.info(`处理来自用户 ${userId} (${telegramMessage.from.first_name}) 的消息: "${content}"`);
    
    if (!this.isUserAllowed(userId)) {
      Logger.warn(`拒绝用户 ${userId} 的Telegram消息（权限不足）`);
      // 发送权限不足的提示
      try {
        await this.sendMessage(telegramMessage.chat.id.toString(), 
          '❌ 权限不足，您没有使用此机器人的权限。');
      } catch (error) {
        Logger.error('发送权限提示失败:', error);
      }
      return;
    }
    
    const permission = this.getUserPermission(userId);
    Logger.debug(`用户 ${userId} 权限级别: ${permission}`);
    
    const message: Message = {
      id: telegramMessage.message_id.toString(),
      content: content,
      sender: {
        id: userId,
        name: `${telegramMessage.from.first_name} ${telegramMessage.from.last_name || ''}`.trim(),
        permission: permission
      },
      platform: 'telegram',
      timestamp: telegramMessage.date * 1000,
      extra: {
        chatId: telegramMessage.chat.id.toString(),
        username: telegramMessage.from.username,
        chatType: telegramMessage.chat.type,
        messageType: 'text',
        hasPhoto: !!telegramMessage.photo,
        hasDocument: !!telegramMessage.document,
        hasVideo: !!telegramMessage.video,
        hasAudio: !!telegramMessage.audio,
        hasVoice: !!telegramMessage.voice,
        hasSticker: !!telegramMessage.sticker
      }
    };
    
    Logger.info(`✅ 接收到有效的Telegram消息，准备转发给框架: ${message.content} (来自: ${message.sender.name})`);
    Logger.debug(`消息对象:`, JSON.stringify(message, null, 2));
    
    // 调用消息回调
    try {
      this.messageCallback!(message);
      Logger.debug('✅ 消息已成功转发给框架');
    } catch (error) {
      Logger.error('❌ 转发消息给框架时出错:', error);
    }
  }

  private async processCallbackQuery(callbackQuery: any): Promise<void> {
    if (!this.messageCallback) return;
    
    const userId = callbackQuery.from.id.toString();
    if (!this.isUserAllowed(userId)) {
      Logger.debug(`拒绝用户 ${userId} 的Telegram回调查询`);
      return;
    }
    
    // 应答回调查询
    await this.makeApiCall('answerCallbackQuery', {
      callback_query_id: callbackQuery.id
    });
    
    const permission = this.getUserPermission(userId);
    
    const message: Message = {
      id: callbackQuery.id,
      content: callbackQuery.data || '',
      sender: {
        id: userId,
        name: `${callbackQuery.from.first_name} ${callbackQuery.from.last_name || ''}`.trim(),
        permission: permission
      },
      platform: 'telegram',
      timestamp: Date.now(),
      extra: {
        chatId: callbackQuery.message?.chat?.id?.toString(),
        username: callbackQuery.from.username,
        messageType: 'callback_query',
        callbackData: callbackQuery.data,
        messageId: callbackQuery.message?.message_id
      }
    };
    
    Logger.info(`收到Telegram回调查询: ${message.content} (来自: ${message.sender.name})`);
    this.messageCallback!(message);
  }

  private async processInlineQuery(inlineQuery: any): Promise<void> {
    if (!this.messageCallback) return;
    
    const userId = inlineQuery.from.id.toString();
    if (!this.isUserAllowed(userId)) {
      Logger.debug(`拒绝用户 ${userId} 的Telegram内联查询`);
      return;
    }
    
    const permission = this.getUserPermission(userId);
    
    const message: Message = {
      id: inlineQuery.id,
      content: inlineQuery.query || '',
      sender: {
        id: userId,
        name: `${inlineQuery.from.first_name} ${inlineQuery.from.last_name || ''}`.trim(),
        permission: permission
      },
      platform: 'telegram',
      timestamp: Date.now(),
      extra: {
        username: inlineQuery.from.username,
        messageType: 'inline_query',
        query: inlineQuery.query,
        offset: inlineQuery.offset
      }
    };
    
    Logger.info(`收到Telegram内联查询: ${message.content} (来自: ${message.sender.name})`);
    this.messageCallback!(message);
  }

  private isUserAllowed(userId: string): boolean {
    // 将用户ID转换为字符串进行比较
    const userIdStr = userId.toString();
    const userIdNum = parseInt(userId);
    
    Logger.debug(`检查用户权限: ${userId} (字符串: ${userIdStr}, 数字: ${userIdNum})`);
    Logger.debug(`配置的用户列表:`, {
      allowedUsers: this.config.allowedUsers,
      adminUsers: this.config.adminUsers,
      ownerUsers: this.config.ownerUsers
    });
    
    // 首先检查是否为主人或管理员（总是允许）
    const isOwner = this.config.ownerUsers?.some(id => 
      id.toString() === userIdStr || id === userIdNum
    );
    const isAdmin = this.config.adminUsers?.some(id => 
      id.toString() === userIdStr || id === userIdNum
    );
    
    if (isOwner || isAdmin) {
      Logger.debug(`用户 ${userId} 是 ${isOwner ? '主人' : '管理员'}，允许访问`);
      return true;
    }
    
    // 如果配置了允许的用户列表，检查用户是否在列表中
    if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
      const isAllowed = this.config.allowedUsers.some(id => 
        id.toString() === userIdStr || id === userIdNum
      );
      Logger.debug(`用户 ${userId} 在允许列表中: ${isAllowed}`);
      return isAllowed;
    }
    
    // 如果没有配置允许列表，但配置了管理员或主人，只允许管理员和主人
    if (this.config.adminUsers?.length || this.config.ownerUsers?.length) {
      Logger.debug(`用户 ${userId} 不在权限列表中，拒绝访问`);
      return false; // 已经在上面检查过了，这里返回false
    }
    
    // 如果没有配置任何权限列表，默认允许所有用户
    Logger.debug(`用户 ${userId} 没有权限配置，默认允许`);
    return true;
  }

  private getUserPermission(userId: string): PermissionLevel {
    const userIdStr = userId.toString();
    const userIdNum = parseInt(userId);
    
    // 检查是否为主人
    if (this.config.ownerUsers?.some(id => 
      id.toString() === userIdStr || id === userIdNum
    )) {
      return PermissionLevel.OWNER;
    }
    
    // 检查是否为管理员
    if (this.config.adminUsers?.some(id => 
      id.toString() === userIdStr || id === userIdNum
    )) {
      return PermissionLevel.ADMIN;
    }
    
    // 检查是否在允许列表中
    if (this.config.allowedUsers?.some(id => 
      id.toString() === userIdStr || id === userIdNum
    )) {
      return PermissionLevel.USER;
    }
    
    // 默认权限
    return PermissionLevel.USER;
  }

  // 创建内联键盘
  public createInlineKeyboard(buttons: InlineKeyboardButton[][]): InlineKeyboard {
    return {
      inline_keyboard: buttons
    };
  }

  // 发送带按钮的消息
  public async sendMessageWithButtons(chatId: string, text: string, buttons: InlineKeyboardButton[][], options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  }): Promise<void> {
    const replyMarkup = this.createInlineKeyboard(buttons);
    
    await this.sendMessage(chatId, text, {
      ...options,
      replyMarkup
    });
  }

  // 发送 Markdown 格式消息
  public async sendMarkdownMessage(target: string, content: string, version: 'Markdown' | 'MarkdownV2' = 'Markdown'): Promise<void> {
    await this.sendMessage(target, content, { parseMode: version });
  }

  // 发送图片
  public async sendPhoto(chatId: string, photoUrlOrFile: string, caption?: string, options?: { parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'; replyMarkup?: InlineKeyboard; }): Promise<void> {
    if (!this.connected) throw new Error('Telegram adapter 未连接');
    const params: any = {
      chat_id: chatId,
      photo: photoUrlOrFile,
      caption: caption,
      parse_mode: options?.parseMode || this.config.parseMode || 'HTML'
    };
    if (options?.replyMarkup) params.reply_markup = JSON.stringify(options.replyMarkup);
    await this.makeApiCall('sendPhoto', params);
  }

  // 发送文件
  public async sendDocument(chatId: string, fileUrlOrFile: string, caption?: string, options?: { parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'; replyMarkup?: InlineKeyboard; }): Promise<void> {
    if (!this.connected) throw new Error('Telegram adapter 未连接');
    const params: any = {
      chat_id: chatId,
      document: fileUrlOrFile,
      caption: caption,
      parse_mode: options?.parseMode || this.config.parseMode || 'HTML'
    };
    if (options?.replyMarkup) params.reply_markup = JSON.stringify(options.replyMarkup);
    await this.makeApiCall('sendDocument', params);
  }

  // 获取聊天全部上下文（历史消息）
  public async getChatHistory(chatId: string, limit: number = 50): Promise<any[]> {
    // Telegram Bot API 不直接支持获取历史消息，需通过用户端API或数据库缓存实现
    throw new Error('getChatHistory 需通过外部服务或缓存实现，Telegram Bot API 不支持');
  }

  // 解封用户（unban）
  public async unbanUser(chatId: string, userId: string): Promise<void> {
    await this.makeApiCall('unbanChatMember', { chat_id: chatId, user_id: userId });
  }

  // 解口（unmute/unrestrict）
  public async unmuteUser(chatId: string, userId: string): Promise<void> {
    await this.makeApiCall('restrictChatMember', { chat_id: chatId, user_id: userId, permissions: { can_send_messages: true, can_send_media_messages: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true, can_change_info: true, can_invite_users: true, can_pin_messages: true } });
  }

  // 撤回消息（deleteMessage 已有，提供 revokeMessage 别名）
  public async revokeMessage(chatId: string, messageId: number): Promise<void> {
    await this.deleteMessage(chatId, messageId);
  }

  // 编辑消息
  public async editMessage(chatId: string, messageId: number, text: string, options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    replyMarkup?: InlineKeyboard;
  }): Promise<void> {
    if (!this.connected) {
      throw new Error('Telegram adapter 未连接');
    }

    try {
      const params: any = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: options?.parseMode || this.config.parseMode || 'HTML'
      };

      if (options?.replyMarkup) {
        params.reply_markup = JSON.stringify(options.replyMarkup);
      }

      await this.makeApiCall('editMessageText', params);
      
      Logger.debug(`Telegram消息已编辑: ${chatId}/${messageId}`);
    } catch (error) {
      Logger.error(`编辑Telegram消息失败:`, error);
      throw error;
    }
  }

  // 删除消息
  public async deleteMessage(chatId: string, messageId: number): Promise<void> {
    if (!this.connected) {
      throw new Error('Telegram adapter 未连接');
    }

    try {
      await this.makeApiCall('deleteMessage', {
        chat_id: chatId,
        message_id: messageId
      });
      
      Logger.debug(`Telegram消息已删除: ${chatId}/${messageId}`);
    } catch (error) {
      Logger.error(`删除Telegram消息失败:`, error);
      throw error;
    }
  }

  // ====== 群管理相关 ======
  // 获取群成员列表
  public async getChatMembers(chatId: string): Promise<any[]> {
    const res = await this.makeApiCall('getChatAdministrators', { chat_id: chatId });
    return res.result || [];
  }
  // 踢出群成员
  public async kickUserFromGroup(chatId: string, userId: string): Promise<void> {
    await this.makeApiCall('kickChatMember', { chat_id: chatId, user_id: userId });
  }
  // 邀请用户入群（仅支持公开群）
  public async inviteUserToGroup(chatId: string, userId: string): Promise<void> {
    // Telegram Bot API 不支持直接邀请用户入群
    throw new Error('inviteUserToGroup 需用户自行加入，Bot API 不支持');
  }
  // 设置群头衔
  public async setGroupTitle(chatId: string, title: string): Promise<void> {
    await this.makeApiCall('setChatTitle', { chat_id: chatId, title });
  }
  // 设置群公告
  public async setGroupDescription(chatId: string, description: string): Promise<void> {
    await this.makeApiCall('setChatDescription', { chat_id: chatId, description });
  }

  // ====== 更多媒体类型 ======
  public async sendAudio(chatId: string, audioUrlOrFile: string, options?: any): Promise<void> {
    await this.makeApiCall('sendAudio', { chat_id: chatId, audio: audioUrlOrFile, ...options });
  }
  public async sendVideo(chatId: string, videoUrlOrFile: string, options?: any): Promise<void> {
    await this.makeApiCall('sendVideo', { chat_id: chatId, video: videoUrlOrFile, ...options });
  }
  public async sendVoice(chatId: string, voiceUrlOrFile: string, options?: any): Promise<void> {
    await this.makeApiCall('sendVoice', { chat_id: chatId, voice: voiceUrlOrFile, ...options });
  }
  public async sendSticker(chatId: string, stickerUrlOrFile: string, options?: any): Promise<void> {
    await this.makeApiCall('sendSticker', { chat_id: chatId, sticker: stickerUrlOrFile, ...options });
  }

  // ====== 上下文缓存（需外部实现，预留接口） ======
  private contextCache: Map<string, any[]> = new Map();
  public cacheMessageContext(chatId: string, message: any): void {
    if (!this.contextCache.has(chatId)) this.contextCache.set(chatId, []);
    this.contextCache.get(chatId)!.push(message);
    if (this.contextCache.get(chatId)!.length > 100) this.contextCache.get(chatId)!.shift();
  }
  public getCachedContext(chatId: string, limit: number = 20): any[] {
    return (this.contextCache.get(chatId) || []).slice(-limit);
  }

  // ====== 批量操作 ======
  public async batchDeleteMessages(chatId: string, messageIds: number[]): Promise<void> {
    for (const id of messageIds) {
      try { await this.deleteMessage(chatId, id); } catch {}
    }
  }
  public async batchSendMessages(chatId: string, messages: { text: string, options?: any }[]): Promise<void> {
    for (const msg of messages) {
      await this.sendMessage(chatId, msg.text, msg.options);
    }
  }

  // ====== 定时撤回 ======
  public async scheduleRevokeMessage(chatId: string, messageId: number, delayMs: number): Promise<void> {
    setTimeout(() => { this.deleteMessage(chatId, messageId); }, delayMs);
  }

  // ====== 消息引用 ======
  public async sendReplyMessage(chatId: string, text: string, replyToMessageId: number, options?: any): Promise<void> {
    await this.sendMessage(chatId, text, { ...options, reply_to_message_id: replyToMessageId });
  }
}

// 设置默认导出
export default TelegramAdapter;
