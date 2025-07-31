import { BasePlugin } from "../../src/plugins/plugin";
import { PluginFunction } from "../../src/common/types";
import { Logger } from "../../src/config/log";
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

export class WebTestPlugin extends BasePlugin {
  public name: string = 'web-test-plugin';
  public version: string = '1.0.0';
  public description: string = 'Web测试插件，提供HTTP API测试界面';
  
  private server?: http.Server;
  private port: number = 8080;

  constructor() {
    super();
  }

  async load(): Promise<void> {
    Logger.info('🌐 Web测试插件加载中...');
    
    // 获取框架的HTTP端口，如果存在的话
    const frameworkPort = this.getFrameworkPort();
    if (frameworkPort) {
      this.port = frameworkPort + 1; // 使用框架端口+1
    }
    
    await this.startWebServer();
    Logger.info(`✅ Web测试插件已启动: http://localhost:${this.port}`);
  }

  async unload(): Promise<void> {
    if (this.server) {
      this.server.close();
      Logger.info('🔌 Web测试服务器已关闭');
    }
  }

  getFunctions(): PluginFunction[] {
    return [];
  }

  private getFrameworkPort(): number | null {
    try {
      // 尝试从配置中获取HTTP适配器端口
      const configPath = path.join(process.cwd(), 'config', 'config', 'bot.yaml');
      if (fs.existsSync(configPath)) {
        try {
          const yaml = require('yaml');
          const config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
          return config?.adapters?.http?.port || null;
        } catch (yamlError) {
          Logger.warn('YAML模块加载失败，尝试使用内置配置管理器');
          // 尝试使用框架的配置管理器
          const frameworkConfig = this.getConfig('adapters.http.port');
          return frameworkConfig || null;
        }
      }
    } catch (error) {
      Logger.warn('无法获取框架端口配置:', error);
    }
    return null;
  }

  private async startWebServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.port, () => {
        resolve();
      });

      this.server.on('error', (error) => {
        reject(error);
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';
    
    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (url === '/') {
      this.serveHomePage(res);
    } else if (url === '/api/status') {
      this.serveApiStatus(res);
    } else if (url === '/api/events') {
      this.serveEvents(res);
    } else if (url === '/api/logs') {
      this.serveLogs(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('页面未找到');
    }
  }

  private serveHomePage(res: http.ServerResponse): void {
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>机器人框架测试面板</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 30px;
            font-size: 2.5em;
            background: linear-gradient(45deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .card {
            background: white;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            border-left: 4px solid #667eea;
        }
        .card h3 {
            color: #333;
            margin-bottom: 15px;
            font-size: 1.3em;
        }
        .status {
            display: flex;
            align-items: center;
            margin: 10px 0;
        }
        .status-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 10px;
            background: #4CAF50;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        .btn {
            background: linear-gradient(45deg, #667eea, #764ba2);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 25px;
            cursor: pointer;
            font-size: 16px;
            margin: 5px;
            transition: transform 0.2s;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .log-container {
            background: #1e1e1e;
            color: #00ff00;
            padding: 20px;
            border-radius: 10px;
            font-family: 'Courier New', monospace;
            height: 300px;
            overflow-y: auto;
            margin-top: 20px;
        }
        .event-list {
            max-height: 200px;
            overflow-y: auto;
            border: 1px solid #ddd;
            border-radius: 5px;
            padding: 10px;
        }
        .event-item {
            padding: 8px;
            border-bottom: 1px solid #eee;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 机器人框架测试面板</h1>
        
        <div class="grid">
            <div class="card">
                <h3>📊 系统状态</h3>
                <div class="status">
                    <div class="status-dot"></div>
                    <span>框架运行中</span>
                </div>
                <div class="status">
                    <div class="status-dot"></div>
                    <span>Web测试插件活跃</span>
                </div>
                <button class="btn" onclick="refreshStatus()">刷新状态</button>
            </div>
            
            <div class="card">
                <h3>🔗 API端点</h3>
                <p><strong>状态API:</strong> /api/status</p>
                <p><strong>事件API:</strong> /api/events</p>
                <p><strong>日志API:</strong> /api/logs</p>
                <button class="btn" onclick="testApi()">测试API</button>
            </div>
            
            <div class="card">
                <h3>📝 最近事件</h3>
                <div id="events" class="event-list">
                    <div class="event-item">系统启动 - ${new Date().toLocaleString()}</div>
                    <div class="event-item">Web测试插件加载完成</div>
                </div>
                <button class="btn" onclick="loadEvents()">加载事件</button>
            </div>
        </div>
        
        <div class="card">
            <h3>📋 实时日志</h3>
            <div id="logs" class="log-container">
                [${new Date().toISOString()}] INFO: Web测试插件已启动<br>
                [${new Date().toISOString()}] INFO: HTTP服务器运行在端口 ${this.port}<br>
                [${new Date().toISOString()}] INFO: 等待连接...
            </div>
            <button class="btn" onclick="clearLogs()">清空日志</button>
            <button class="btn" onclick="refreshLogs()">刷新日志</button>
        </div>
    </div>

    <script>
        function refreshStatus() {
            fetch('/api/status')
                .then(response => response.json())
                .then(data => {
                    console.log('状态:', data);
                    alert('状态已刷新，请查看控制台');
                })
                .catch(error => console.error('错误:', error));
        }

        function testApi() {
            Promise.all([
                fetch('/api/status').then(r => r.json()),
                fetch('/api/events').then(r => r.json()),
                fetch('/api/logs').then(r => r.json())
            ]).then(results => {
                console.log('API测试结果:', results);
                alert('API测试完成，请查看控制台');
            }).catch(error => {
                console.error('API测试失败:', error);
                alert('API测试失败，请查看控制台');
            });
        }

        function loadEvents() {
            fetch('/api/events')
                .then(response => response.json())
                .then(data => {
                    const eventsDiv = document.getElementById('events');
                    eventsDiv.innerHTML = data.events.map(event => 
                        \`<div class="event-item">\${event}</div>\`
                    ).join('');
                })
                .catch(error => console.error('加载事件失败:', error));
        }

        function refreshLogs() {
            fetch('/api/logs')
                .then(response => response.json())
                .then(data => {
                    const logsDiv = document.getElementById('logs');
                    logsDiv.innerHTML = data.logs.join('<br>');
                    logsDiv.scrollTop = logsDiv.scrollHeight;
                })
                .catch(error => console.error('刷新日志失败:', error));
        }

        function clearLogs() {
            document.getElementById('logs').innerHTML = '';
        }

        // 自动刷新日志
        setInterval(refreshLogs, 5000);
    </script>
</body>
</html>`;
    
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private serveApiStatus(res: http.ServerResponse): void {
    const status = {
      timestamp: new Date().toISOString(),
      plugin: 'web-test-plugin',
      version: '1.0.0',
      port: this.port,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      status: 'running'
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(status, null, 2));
  }

  private serveEvents(res: http.ServerResponse): void {
    const events = {
      timestamp: new Date().toISOString(),
      events: [
        `系统启动 - ${new Date().toLocaleString()}`,
        'Web测试插件加载完成',
        'HTTP服务器启动成功',
        '等待用户连接...',
        '框架事件监听中'
      ]
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(events, null, 2));
  }

  private serveLogs(res: http.ServerResponse): void {
    const logs = {
      timestamp: new Date().toISOString(),
      logs: [
        `[${new Date().toISOString()}] INFO: Web测试插件已启动`,
        `[${new Date().toISOString()}] INFO: HTTP服务器运行在端口 ${this.port}`,
        `[${new Date().toISOString()}] INFO: 等待连接...`,
        `[${new Date().toISOString()}] INFO: 框架运行正常`,
        `[${new Date().toISOString()}] DEBUG: 内存使用: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
      ]
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(logs, null, 2));
  }
}

// 导出插件类，而不是实例
export default WebTestPlugin;