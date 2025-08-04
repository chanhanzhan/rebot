import { Message } from '../../../src/common/types';
import { Logger } from '../../../src/config/log';

export class WebAPIApp {
  public name = 'web-api';
  public description = 'Web API示例应用';

  // 处理HTTP请求的方法
  public async handleHttpRequest(req: any, res: any, body: any, subPath: string): Promise<void> {
    Logger.info(`[WebAPI] 处理HTTP请求: ${req.method} ${subPath}`);

    // 设置响应头
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    try {
      // 根据路径和方法路由请求
      if (req.method === 'GET') {
        await this.handleGetRequest(req, res, subPath);
      } else if (req.method === 'POST') {
        await this.handlePostRequest(req, res, body, subPath);
      } else {
        this.sendError(res, 405, 'Method Not Allowed');
      }
    } catch (error) {
      Logger.error('[WebAPI] 请求处理失败:', error);
      this.sendError(res, 500, 'Internal Server Error');
    }
  }

  // 处理GET请求
  private async handleGetRequest(req: any, res: any, subPath: string): Promise<void> {
    switch (subPath) {
      case '/':
      case '/info':
        this.sendJSON(res, {
          name: this.name,
          description: this.description,
          version: '1.0.0',
          endpoints: [
            'GET /info - 获取API信息',
            'GET /status - 获取状态',
            'POST /echo - 回显消息',
            'POST /greeting - 发送问候'
          ]
        });
        break;

      case '/status':
        this.sendJSON(res, {
          status: 'running',
          timestamp: new Date().toISOString(),
          uptime: process.uptime()
        });
        break;

      default:
        this.sendError(res, 404, 'Endpoint not found');
    }
  }

  // 处理POST请求
  private async handlePostRequest(req: any, res: any, body: any, subPath: string): Promise<void> {
    switch (subPath) {
      case '/echo':
        this.sendJSON(res, {
          message: 'Echo response',
          received: body,
          timestamp: new Date().toISOString()
        });
        break;

      case '/greeting':
        const name = body?.name || 'World';
        this.sendJSON(res, {
          greeting: `Hello, ${name}!`,
          message: `欢迎使用 ${this.name} API`,
          timestamp: new Date().toISOString()
        });
        break;

      default:
        this.sendError(res, 404, 'Endpoint not found');
    }
  }

  // 发送JSON响应
  private sendJSON(res: any, data: any): void {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data, null, 2));
  }

  // 发送错误响应
  private sendError(res: any, statusCode: number, message: string): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: true,
      statusCode,
      message,
      timestamp: new Date().toISOString()
    }, null, 2));
  }

  // 消息处理方法（用于聊天命令）
  public async handleMessage(message: Message): Promise<string | null> {
    const content = message.content.trim();
    
    if (content === '/webapi' || content === '/api') {
      return `🌐 Web API 应用

📋 可用端点:
• GET /apps/web-api/info - 获取API信息
• GET /apps/web-api/status - 获取状态
• POST /apps/web-api/echo - 回显消息
• POST /apps/web-api/greeting - 发送问候

💡 示例:
curl http://localhost:3000/apps/web-api/info
curl -X POST -H "Content-Type: application/json" -d '{"name":"张三"}' http://localhost:3000/apps/web-api/greeting`;
    }

    return null;
  }
}