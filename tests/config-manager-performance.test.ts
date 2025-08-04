/// <reference path="./jest.d.ts" />

import { ConfigManager } from '../src/config/config';
import { FrameworkEventBus } from '../src/common/event-bus';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * 配置管理器性能测试
 */
describe('ConfigManager Performance Tests', () => {
  let configManager: ConfigManager;
  const testConfigDir = path.join(__dirname, 'perf-test-config');

  beforeAll(() => {
    // 创建测试目录和配置
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true });
    }
    fs.mkdirSync(testConfigDir, { recursive: true });

    // 创建大型配置文件
    const largeConfig: any = {
      name: 'Performance Test Bot',
      version: '1.0.0',
      environment: 'testing',
      adapters: {},
      database: {
        type: 'sqlite',
        sqlite: { path: ':memory:' }
      },
      plugins: {
        directory: './plugins',
        autoLoad: false,
        hotReload: false
      },
      logging: {
        level: 'warn',
        console: { enabled: false }
      },
      security: {
        encryption: { enabled: false },
        rateLimit: { enabled: false },
        cors: { enabled: false }
      },
      performance: {
        maxConcurrentTasks: 1,
        taskTimeout: 5000,
        memoryLimit: '128MB',
        cpuLimit: 50
      },
      monitoring: {
        enabled: false
      },
      custom: {}
    };

    // 添加大量自定义配置项
    for (let i = 0; i < 1000; i++) {
      largeConfig.custom[`item_${i}`] = {
        id: i,
        name: `Item ${i}`,
        description: `Description for item ${i}`,
        enabled: i % 2 === 0,
        priority: Math.floor(Math.random() * 100),
        tags: [`tag_${i % 10}`, `category_${i % 5}`],
        metadata: {
          created: new Date().toISOString(),
          version: '1.0.0',
          author: `user_${i % 20}`
        }
      };
    }

    fs.writeFileSync(
      path.join(testConfigDir, 'config.yaml'),
      yaml.dump(largeConfig)
    );

    configManager = ConfigManager.getInstance();
  });

  afterAll(() => {
    if (configManager) {
      configManager.destroy();
    }
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true });
    }
  });

  describe('配置读取性能', () => {
    test('应该快速读取顶级配置', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        configManager.get('name');
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`1000次顶级配置读取耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(100); // 应该在100ms内完成
    });

    test('应该快速读取嵌套配置', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        configManager.get('database.sqlite.path');
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`1000次嵌套配置读取耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(200); // 应该在200ms内完成
    });

    test('应该快速读取深层嵌套配置', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        configManager.get(`custom.item_${i}.metadata.created`);
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`100次深层嵌套配置读取耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(50); // 应该在50ms内完成
    });
  });

  describe('配置写入性能', () => {
    test('应该快速写入配置', async () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        await configManager.set(`perf.test_${i}`, `value_${i}`);
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`100次配置写入耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(1000); // 应该在1秒内完成
    });

    test('应该快速批量更新配置', async () => {
      const updates: { [key: string]: any } = {};
      for (let i = 0; i < 100; i++) {
        updates[`batch.item_${i}`] = {
          id: i,
          value: `batch_value_${i}`,
          timestamp: Date.now()
        };
      }

      const startTime = performance.now();
      await configManager.updateConfig(updates);
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`100项批量更新耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(500); // 应该在500ms内完成
    });
  });

  describe('配置验证性能', () => {
    test('应该快速验证配置', async () => {
      // 添加多个验证规则
      for (let i = 0; i < 50; i++) {
        configManager.addValidationRule({
          path: `perf.rule_${i}`,
          type: 'string',
          required: false,
          validator: (value: string) => value.length > 0,
          description: `Performance rule ${i}`
        });
      }

      const startTime = performance.now();
      
      // 触发验证
      for (let i = 0; i < 50; i++) {
        try {
          await configManager.set(`perf.rule_${i}`, `valid_value_${i}`);
        } catch (error) {
          // 忽略验证错误
        }
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`50次配置验证耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(200); // 应该在200ms内完成
    });
  });

  describe('配置备份性能', () => {
    test('应该快速创建备份', async () => {
      const startTime = performance.now();
      
      const backupIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const backupId = await configManager.createBackup();
        backupIds.push(backupId);
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`10次配置备份耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(1000); // 应该在1秒内完成
      expect(backupIds.length).toBe(10);
    });

    test('应该快速恢复备份', async () => {
      const backupId = await configManager.createBackup();
      
      const startTime = performance.now();
      await configManager.restoreBackup(backupId);
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`配置恢复耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(200); // 应该在200ms内完成
    });
  });

  describe('配置导入导出性能', () => {
    test('应该快速导出配置', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 10; i++) {
        configManager.exportConfig('yaml');
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`10次YAML导出耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(500); // 应该在500ms内完成
    });

    test('应该快速导入配置', async () => {
      const configData = configManager.exportConfig('yaml');
      
      const startTime = performance.now();
      await configManager.importConfig(configData, 'yaml');
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`YAML导入耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(300); // 应该在300ms内完成
    });
  });

  describe('内存使用测试', () => {
    test('应该有效管理内存', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // 执行大量操作
      for (let i = 0; i < 1000; i++) {
        configManager.get(`custom.item_${i % 100}`);
        if (i % 100 === 0) {
          await configManager.set(`temp.item_${i}`, `value_${i}`);
        }
      }
      
      // 强制垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      console.log(`内存增长: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // 应该少于50MB
    });
  });

  describe('并发性能测试', () => {
    test('应该处理并发读取', async () => {
      const startTime = performance.now();
      
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(Promise.resolve(configManager.get(`custom.item_${i % 50}`)));
      }
      
      await Promise.all(promises);
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`100个并发读取耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(100); // 应该在100ms内完成
    });

    test('应该处理并发写入', async () => {
      const startTime = performance.now();
      
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(configManager.set(`concurrent.item_${i}`, `value_${i}`));
      }
      
      await Promise.all(promises);
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`50个并发写入耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(1000); // 应该在1秒内完成
    });
  });

  describe('大数据量测试', () => {
    test('应该处理大型配置对象', async () => {
      const largeObject: any = {};
      
      // 创建深层嵌套的大对象
      for (let i = 0; i < 100; i++) {
        largeObject[`section_${i}`] = {};
        for (let j = 0; j < 50; j++) {
          largeObject[`section_${i}`][`item_${j}`] = {
            id: `${i}_${j}`,
            data: new Array(100).fill(0).map((_, k) => `data_${k}`),
            metadata: {
              created: new Date().toISOString(),
              tags: new Array(10).fill(0).map((_, k) => `tag_${k}`)
            }
          };
        }
      }

      const startTime = performance.now();
      await configManager.set('large.data', largeObject);
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`大对象设置耗时: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(1000); // 应该在1秒内完成

      // 测试读取
      const readStartTime = performance.now();
      const retrieved = configManager.get('large.data');
      const readEndTime = performance.now();
      const readDuration = readEndTime - readStartTime;
      
      console.log(`大对象读取耗时: ${readDuration.toFixed(2)}ms`);
      expect(readDuration).toBeLessThan(100); // 应该在100ms内完成
      expect(retrieved).toBeDefined();
    });
  });
});