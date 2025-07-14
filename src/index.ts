import { BotFramework } from './core/bot-framework';
import { Logger, LogLevel } from './config/log';

async function main() {
  try {
   
    Logger.setLogLevel(LogLevel.INFO);
    
    Logger.info('正在初始化Bot框架...');
    
    // 获取框架实例
    const framework = BotFramework.getInstance();
    
    // 启动框架（自动加载适配器和插件）
    await framework.start();
    
    // 显示状态
    const status = framework.getStatus();
   // Logger.info(`框架状态: 适配器 ${status.adapterCount} 个，插件 ${status.pluginCount} 个`);
    
    Logger.info('Bot框架正在运行，请开始使用...');
    
    // 设置优雅退出
    process.on('SIGINT', async () => {
      Logger.info('收到退出信号，正在优雅关闭...');
      await framework.stop();
      process.exit(0);
    });
    
  } catch (error) {
    Logger.error('启动Bot框架失败:', error);
    process.exit(1);
  }
}

// 全局异常处理
process.on('uncaughtException', (error: Error) => {
  Logger.error('未捕获的异常:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  Logger.error(`未处理的Promise拒绝: ${promise}, 原因: ${reason}`);
  process.exit(1);
});

// 启动应用
main().catch((error) => {
  console.error('致命错误:', error);
  process.exit(1);
});