/// <reference path="./jest.d.ts" />

import { ConfigManager } from '../src/config/config';
import { FrameworkEventBus } from '../src/common/event-bus';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * 配置管理器集成测试
 */
describe('ConfigManager Integration Tests', () => {
  let configManager: ConfigManager;
  let eventBus: FrameworkEventBus;
  const testConfigDir = path.join(__dirname, 'integration-test-config');
  const testBackupDir = path.join(__dirname, 'integration-test-backups');
  const testTemplatesDir = path.join(__dirname, 'integration-test-templates');

  beforeAll(async () => {
    // 清理并创建测试目录
    [testConfigDir, testBackupDir, testTemplatesDir].forEach(dir => {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
      fs.mkdirSync(dir, { recursive: true });
    });

    // 创建测试配置文件
    const mainConfig = {
      name: 'Integration Test Bot',
      version: '1.0.0',
      environment: 'testing',
      adapters: {
        console: { enabled: true },
        mock: { enabled: false }
      },
      database: {
        type: 'sqlite',
        sqlite: { path: './test.db' }
      },
      plugins: {
        directory: './plugins',
        autoLoad: true,
        hotReload: true
      },
      logging: {
        level: 'info',
        console: { enabled: true, colorize: false },
        file: { enabled: false }
      },
      security: {
        encryption: { enabled: false },
        rateLimit: { enabled: false },
        cors: { enabled: false }
      },
      performance: {
        maxConcurrentTasks: 10,
        taskTimeout: 30000,
        memoryLimit: '256MB',
        cpuLimit: 80
      },
      monitoring: {
        enabled: true,
        metrics: { enabled: true, interval: 10000 },
        health: { enabled: true, interval: 5000 }
      }
    };

    fs.writeFileSync(
      path.join(testConfigDir, 'config.yaml'),
      yaml.dump(mainConfig)
    );

    // 创建额外的配置文件
    const adapterConfig = {
      qq: {
        enabled: true,
        appId: 'test_app_id',
        token: 'test_token'
      },
      telegram: {
        enabled: false,
        token: 'test_telegram_token'
      }
    };

    fs.writeFileSync(
      path.join(testConfigDir, 'adapters.yaml'),
      yaml.dump(adapterConfig)
    );

    // 创建测试模板
    const testTemplate = {
      name: 'integration-test',
      description: '集成测试模板',
      version: '1.0.0',
      config: {
        name: 'Template Bot',
        environment: 'development',
        adapters: {
          console: { enabled: true }
        }
      },
      createdAt: new Date().toISOString(),
      author: 'integration-test'
    };

    fs.writeFileSync(
      path.join(testTemplatesDir, 'integration-test.template.yaml'),
      yaml.dump(testTemplate)
    );

    // 设置环境变量
    process.env.BOT_NAME = 'Environment Bot';
    process.env.BOT_VERSION = '2.0.0';
    process.env.DATABASE_TYPE = 'redis';
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PORT = '6379';

    // 设置配置目录环境变量
    process.env.CONFIG_DIR = testConfigDir;
    process.env.BACKUP_DIR = testBackupDir;
    process.env.TEMPLATES_DIR = testTemplatesDir;

    eventBus = FrameworkEventBus.getInstance();
    configManager = ConfigManager.getInstance();
  });

  afterAll(() => {
    if (configManager) {
      configManager.destroy();
    }

    // 清理环境变量
    delete process.env.BOT_NAME;
    delete process.env.BOT_VERSION;
    delete process.env.DATABASE_TYPE;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.CONFIG_DIR;
    delete process.env.BACKUP_DIR;
    delete process.env.TEMPLATES_DIR;

    // 清理测试目录
    [testConfigDir, testBackupDir, testTemplatesDir].forEach(dir => {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
    });
  });

  describe('配置加载和合并', () => {
    test('应该正确加载主配置文件', () => {
      const botName = configManager.get('name');
      expect(botName).toBe('Integration Test Bot');
    });

    test('应该正确合并多个配置源', () => {
      // 主配置中的适配器
      const consoleAdapter = configManager.get('adapters.console');
      expect(consoleAdapter.enabled).toBe(true);

      // 从adapters.yaml加载的配置
      const qqAdapter = configManager.get('adapters.qq');
      expect(qqAdapter?.enabled).toBe(true);
      expect(qqAdapter?.appId).toBe('test_app_id');
    });

    test('应该正确应用环境变量覆盖', () => {
      // 环境变量应该覆盖文件配置
      const botName = configManager.get('name');
      const version = configManager.get('version');
      
      // 这些值应该来自环境变量
      expect(botName).toBe('Environment Bot');
      expect(version).toBe('2.0.0');
    });
  });

  describe('事件系统集成', () => {
    test('应该在配置更新时发送事件', async (done) => {
      const eventHandler = (data: any) => {
        expect(data.path).toBe('test.event');
        expect(data.newValue).toBe('event-test-value');
        eventBus.off('config-updated', eventHandler);
        done();
      };

      eventBus.on('config-updated', eventHandler);
      await configManager.set('test.event', 'event-test-value');
    });

    test('应该在配置重新加载时发送事件', async (done) => {
      const eventHandler = (data: any) => {
        expect(data.source).toBeDefined();
        expect(data.config).toBeDefined();
        eventBus.off('config-reloaded', eventHandler);
        done();
      };

      eventBus.on('config-reloaded', eventHandler);
      await configManager.reload();
    });

    test('应该在创建备份时发送事件', async (done) => {
      const eventHandler = (data: any) => {
        expect(data.backupId).toBeDefined();
        expect(typeof data.backupId).toBe('string');
        eventBus.off('config-backup-created', eventHandler);
        done();
      };

      eventBus.on('config-backup-created', eventHandler);
      await configManager.backupConfiguration();
    });
  });

  describe('文件监控集成', () => {
    test('应该监控配置文件变化', (done) => {
      const configFile = path.join(testConfigDir, 'config.yaml');
      
      const eventHandler = (data: any) => {
        expect(data.source).toBe('file');
        eventBus.off('config-reloaded', eventHandler);
        done();
      };

      eventBus.on('config-reloaded', eventHandler);

      // 修改配置文件
      setTimeout(() => {
        const currentConfig = yaml.load(fs.readFileSync(configFile, 'utf8')) as any;
        currentConfig.name = 'File Modified Bot';
        fs.writeFileSync(configFile, yaml.dump(currentConfig));
      }, 100);
    }, 10000);
  });

  describe('模板系统集成', () => {
    test('应该加载预定义模板', () => {
      const templates = configManager.listTemplates();
      const integrationTemplate = templates.find(t => t.name === 'integration-test');
      expect(integrationTemplate).toBeDefined();
    });

    test('应该正确应用模板', async () => {
      const originalName = configManager.get('name');
      
      await configManager.applyTemplate('integration-test');
      
      const newName = configManager.get('name');
      expect(newName).toBe('Template Bot');
      expect(configManager.get('environment')).toBe('development');

      // 恢复原配置
      await configManager.set('name', originalName);
    });
  });

  describe('验证系统集成', () => {
    test('应该在设置无效配置时抛出错误', async () => {
      await expect(configManager.set('environment', 'invalid-env')).rejects.toThrow();
    });

    test('应该在批量更新时验证所有配置', async () => {
      await expect(configManager.update({
        'logging.level': 'invalid-level',
        'performance.cpuLimit': 150
      })).rejects.toThrow();
    });

    test('应该允许设置有效配置', async () => {
      await expect(configManager.update({
        'logging.level': 'debug',
        'performance.cpuLimit': 90
      })).resolves.not.toThrow();
    });
  });

  describe('备份系统集成', () => {
    test('应该在配置变更时自动创建备份', async () => {
      const initialBackups = configManager.listBackups().length;
      
      // 启用自动备份
      configManager.updateMonitorConfig({
        enabled: true,
        backupOnChange: true,
        maxBackups: 10,
        checkInterval: 1000,
        alertOnChange: false
      });

      await configManager.set('backup.test', 'auto-backup-test');
      
      // 等待备份创建
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const finalBackups = configManager.listBackups().length;
      expect(finalBackups).toBeGreaterThan(initialBackups);
    });

    test('应该正确恢复备份', async () => {
      const backupId = await configManager.backupConfiguration();
      const originalValue = configManager.get('backup.test');

      await configManager.set('backup.test', 'modified-value');
      expect(configManager.get('backup.test')).toBe('modified-value');

      await configManager.restoreFromBackup(backupId);
      expect(configManager.get('backup.test')).toBe(originalValue);
    });
  });

  describe('性能监控集成', () => {
    test('应该记录配置操作性能', async () => {
      const startTime = Date.now();
      
      // 执行一系列配置操作
      for (let i = 0; i < 10; i++) {
        await configManager.set(`perf.test_${i}`, `value_${i}`);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(1000); // 应该在1秒内完成
    });

    test('应该正确处理并发配置操作', async () => {
      const promises = [];
      
      for (let i = 0; i < 20; i++) {
        promises.push(configManager.set(`concurrent.test_${i}`, `value_${i}`));
      }
      
      await expect(Promise.all(promises)).resolves.not.toThrow();
      
      // 验证所有值都正确设置
      for (let i = 0; i < 20; i++) {
        expect(configManager.get(`concurrent.test_${i}`)).toBe(`value_${i}`);
      }
    });
  });

  describe('错误恢复集成', () => {
    test('应该在配置加载失败时恢复', async () => {
      const configFile = path.join(testConfigDir, 'config.yaml');
      const originalContent = fs.readFileSync(configFile, 'utf8');
      
      try {
        // 写入无效的YAML
        fs.writeFileSync(configFile, 'invalid: yaml: content: [');
        
        // 尝试重新加载
        await expect(configManager.reload()).rejects.toThrow();
        
        // 配置应该保持原状
        expect(configManager.get('name')).toBeDefined();
        
      } finally {
        // 恢复原文件
        fs.writeFileSync(configFile, originalContent);
      }
    });

    test('应该在验证失败时保持原配置', async () => {
      const originalLevel = configManager.get('logging.level');
      
      try {
        await configManager.set('logging.level', 'invalid-level');
      } catch (error) {
        // 验证失败是预期的
      }
      
      // 原配置应该保持不变
      expect(configManager.get('logging.level')).toBe(originalLevel);
    });
  });

  describe('环境切换集成', () => {
    test('应该正确切换环境配置', async () => {
      const originalEnv = configManager.getEnvironment();
      
      await configManager.setEnvironment('production');
      expect(configManager.getEnvironment()).toBe('production');
      
      await configManager.setEnvironment('development');
      expect(configManager.getEnvironment()).toBe('development');
      
      // 恢复原环境
      await configManager.setEnvironment(originalEnv);
    });
  });

  describe('配置源优先级集成', () => {
    test('应该按优先级合并配置', () => {
      // 添加高优先级配置源
      configManager.addConfigSource({
        name: 'high-priority',
        type: 'env',
        priority: 100,
        enabled: true
      });

      // 添加低优先级配置源
      configManager.addConfigSource({
        name: 'low-priority',
        type: 'file',
        priority: 10,
        path: './low-priority.yaml',
        enabled: true
      });

      const sources = configManager.getConfigSources();
      const highPriority = Array.from(sources.values()).find(s => s.name === 'high-priority');
      const lowPriority = Array.from(sources.values()).find(s => s.name === 'low-priority');

      expect(highPriority?.priority).toBeGreaterThan(lowPriority?.priority || 0);
    });
  });

  describe('完整工作流集成', () => {
    test('应该支持完整的配置管理工作流', async () => {
      // 1. 创建备份
      const backupId = await configManager.backupConfiguration();
      
      // 2. 应用模板
      await configManager.applyTemplate('integration-test');
      
      // 3. 修改配置
      await configManager.update({
        'custom.workflow': 'test',
        'adapters.mock.enabled': true
      });
      
      // 4. 验证配置
      expect(configManager.get('name')).toBe('Template Bot');
      expect(configManager.get('custom.workflow')).toBe('test');
      expect(configManager.get('adapters.mock.enabled')).toBe(true);
      
      // 5. 导出配置
      const exportedConfig = configManager.export('yaml');
      expect(exportedConfig).toContain('Template Bot');
      
      // 6. 恢复备份
      await configManager.restoreFromBackup(backupId);
      
      // 7. 验证恢复
      expect(configManager.get('name')).not.toBe('Template Bot');
      expect(configManager.get('custom.workflow')).toBeUndefined();
    });
  });
});