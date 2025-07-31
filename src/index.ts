import { BotFramework } from './core/bot-framework';
import { Logger, LogLevel } from './config/log';
import { ConfigInitializer } from './config/init';
import { RedisDatabase } from './config/readis';
import { DatabaseManager } from './database/database-manager';

async function main() {
  try {
    Logger.setLogLevel(LogLevel.INFO);
    Logger.info('正在初始化...');
    // 初始化配置
    const configInit = ConfigInitializer.getInstance();
    await configInit.initialize();
    const botConfig = configInit.getConfig('bot');
    let redisDb: any = null;
    if (botConfig && botConfig.database && botConfig.database.type === 'redis') {
      redisDb = new RedisDatabase({
        host: botConfig.database.redis.host,
        port: botConfig.database.redis.port,
        password: botConfig.database.redis.password,
        db: botConfig.database.redis.db
      });
      let connected = false;
      for (let i = 0; i < 3; i++) {
        try {
          await redisDb.connect();
          connected = true;
          break;
        } catch (e) {
          Logger.error(`Redis连接失败，第${i + 1}次尝试...`);
          await new Promise(res => setTimeout(res, 2000));
        }
      }
      if (!connected) {
        Logger.warn('无法连接到 Redis，将在没有数据库的情况下继续运行');
        redisDb = null;
      } else {
        DatabaseManager.getInstance().setDatabase(redisDb);
      }
    }
    // 获取框架实例
    const framework = BotFramework.getInstance();
    // 启动框架（自动加载适配器和插件）
    await framework.start();
    // 显示状态
    const status = framework.getStatus();
    Logger.info(`📊 框架状态: 运行=${status.isRunning}, 插件数=${status.pluginCount}, 适配器数=${status.adapterCount}`);
    Logger.info('正在运行...');
    // 设置优雅退出
    process.on('SIGINT', async () => {
      Logger.info('收到退出信号，正在关闭...');
      await framework.stop();
      if (redisDb) await redisDb.disconnect();
      process.exit(0);
    });
  } catch (error) {
    Logger.error('启动失败:', error);
    process.exit(1);
  }
}

export { main };