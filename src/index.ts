import { BotFramework } from './core/bot-framework';
import { Logger } from './config/log';
import { Config } from './config/config';
import { RedisClient } from './database/redis';

export async function main() {
  try {
    Logger.info('🚀 框架启动中...');
    
    // 初始化配置
    const config = Config.getInstance();
    Logger.info('✅ 配置初始化完成');
    
    // 连接Redis数据库（如果配置了）
    if (config.redis.enabled) {
      try {
        await RedisClient.getInstance().connect();
        Logger.info('✅ Redis数据库连接成功');
      } catch (error) {
        Logger.error('❌ Redis数据库连接失败:', error);
        // 根据配置决定是否继续启动
        if (config.redis.required) {
          process.exit(1);
        }
      }
    }
    
    // 启动框架
    const framework = BotFramework.getInstance();
    await framework.start();
    
    Logger.info('🎉 框架启动完成');
    
    // 监听退出信号
    const gracefulShutdown = async (signal: string) => {
      Logger.info(`🔄 接收到${signal}信号，正在关闭框架...`);
      
      try {
        await framework.stop();
        Logger.info('✅ 框架关闭完成');
        
        // 断开Redis连接
        if (config.redis.enabled) {
          await RedisClient.getInstance().disconnect();
          Logger.info('✅ Redis数据库连接已断开');
        }
        
        process.exit(0);
      } catch (error) {
        Logger.error('❌ 框架关闭失败:', error);
        process.exit(1);
      }
    };
    
    // 监听多种退出信号
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
    
    // 监听未捕获的异常
    process.on('uncaughtException', (error) => {
      Logger.error('❌ 未捕获的异常:', error);
      gracefulShutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      Logger.error('❌ 未处理的Promise拒绝:', reason, 'at:', promise);
      gracefulShutdown('unhandledRejection');
    });
    
  } catch (error) {
    Logger.error('❌ 框架启动失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件，则启动框架
if (require.main === module) {
  main().catch((error) => {
    Logger.error('❌ 主程序异常:', error);
    process.exit(1);
  });
}