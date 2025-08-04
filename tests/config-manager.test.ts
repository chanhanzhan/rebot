/// <reference path="./jest.d.ts" />

import { ConfigManager } from '../src/config/config';
import { FrameworkEventBus } from '../src/common/event-bus';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  const testConfigDir = path.join(__dirname, 'test-config');
  const testBackupDir = path.join(__dirname, 'test-backups');

  beforeEach(() => {
    // 清理测试目录
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true });
    }
    if (fs.existsSync(testBackupDir)) {
      fs.rmSync(testBackupDir, { recursive: true });
    }

    // 创建测试目录
    fs.mkdirSync(testConfigDir, { recursive: true });
    fs.mkdirSync(testBackupDir, { recursive: true });

    // 创建测试配置文件
    const testConfig = {
      name: 'Test Bot',
      version: '1.0.0',
      environment: 'testing',
      adapters: {
        console: { enabled: true }
      },
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
      }
    };

    fs.writeFileSync(
      path.join(testConfigDir, 'config.yaml'),
      yaml.dump(testConfig)
    );

    configManager = ConfigManager.getInstance();
  });

  afterEach(() => {
    // 清理
    if (configManager) {
      configManager.destroy();
    }
  });

  describe('基础配置操作', () => {
    test('应该能够获取配置值', () => {
      const botName = configManager.get('name');
      expect(botName).toBe('Test Bot');
    });

    test('应该能够获取嵌套配置值', () => {
      const dbType = configManager.get('database.type');
      expect(dbType).toBe('sqlite');
    });

    test('应该能够设置配置值', async () => {
      await configManager.set('custom.test', 'value');
      const value = configManager.get('custom.test');
      expect(value).toBe('value');
    });

    test('应该能够批量更新配置', async () => {
      await configManager.updateConfig({
        logging: { level: 'debug' },
        performance: { 
          maxConcurrentTasks: 5,
          taskTimeout: 30000,
          memoryLimit: '512MB',
          cpuLimit: 80
        }
      });

      expect(configManager.get('logging.level')).toBe('debug');
      expect(configManager.get('performance.maxConcurrentTasks')).toBe(5);
    });

    test('应该能够获取完整配置', () => {
      const config = configManager.getConfig();
      expect(config.name).toBe('Test Bot');
      expect(config.version).toBe('1.0.0');
    });
  });

  describe('配置验证', () => {
    test('应该验证必需字段', async () => {
      await expect(configManager.set('name', null)).rejects.toThrow();
    });

    test('应该验证配置类型', async () => {
      await expect(configManager.set('performance.maxConcurrentTasks', 'invalid')).rejects.toThrow();
    });

    test('应该执行自定义验证', async () => {
      await expect(configManager.set('performance.cpuLimit', 150)).rejects.toThrow();
    });

    test('应该能够添加验证规则', () => {
      configManager.addValidationRule({
        path: 'custom.maxUsers',
        type: 'number',
        required: false,
        validator: (value: number) => value > 0 && value <= 100,
        description: '最大用户数'
      });

      const rules = configManager.getValidationRules();
      const customRule = Array.from(rules.values()).find(rule => rule.path === 'custom.maxUsers');
      expect(customRule).toBeDefined();
      expect(customRule?.type).toBe('number');
    });

    test('应该能够移除验证规则', () => {
      configManager.addValidationRule({
        path: 'custom.temp',
        type: 'string',
        required: false,
        description: '临时规则'
      });

      configManager.removeValidationRule('custom.temp');
      const rules = configManager.getValidationRules();
      const tempRule = Array.from(rules.values()).find(rule => rule.path === 'custom.temp');
      expect(tempRule).toBeUndefined();
    });
  });

  describe('配置模板', () => {
    test('应该能够列出模板', () => {
      const templates = configManager.getTemplates();
      expect(Array.isArray(templates)).toBe(true);
    });

    test('应该能够创建模板', async () => {
      await configManager.addTemplate({
          name: 'test-template',
          description: 'Test template',
          version: '1.0.0',
          config: { test: 'template-value' },
          createdAt: new Date().toISOString(),
          author: 'test'
        });
        
        const templates = configManager.getTemplates();
        const savedTemplate = templates.find(t => t.name === 'test-template');
        expect(savedTemplate).toBeDefined();
        expect(savedTemplate?.name).toBe('test-template');
    });

    test('应该能够应用模板', async () => {
      const template = {
        name: 'Applied Bot',
        version: '2.0.0'
      };

      await configManager.addTemplate({
          name: 'apply-test',
          description: '应用测试模板',
          version: '1.0.0',
          config: template,
          createdAt: new Date().toISOString(),
          author: 'test'
        });
      await configManager.applyTemplate('apply-test');

      expect(configManager.get('name')).toBe('Applied Bot');
      expect(configManager.get('version')).toBe('2.0.0');
    });
  });

  describe('配置备份和恢复', () => {
    test('应该能够创建备份', async () => {
      const backupId = await configManager.createBackup();
      expect(backupId).toBeDefined();
      expect(typeof backupId).toBe('string');
    });

    test('应该能够列出备份', async () => {
        await configManager.createBackup();
        const backups = configManager.getBackups();
        expect(backups.length).toBeGreaterThan(0);
      });

    test('应该能够恢复备份', async () => {
      const originalName = configManager.get('name');
      const backupId = await configManager.createBackup();

      // 修改配置
      await configManager.set('name', 'Modified Bot');
      expect(configManager.get('name')).toBe('Modified Bot');

      // 恢复备份
      await configManager.restoreBackup(backupId);
      expect(configManager.get('name')).toBe(originalName);
    });
  });

  describe('配置源管理', () => {
    test('应该能够获取配置源', () => {
      const sources = configManager.getConfigSources();
      expect(Array.isArray(sources)).toBe(true);
    });

    test('应该能够添加配置源', () => {
      configManager.addConfigSource({
        name: 'test-source',
        type: 'file',
        priority: 50,
        path: './test.yaml',
        enabled: true
      });

      const sources = configManager.getConfigSources();
      const testSource = Array.from(sources.values()).find(source => source.name === 'test-source');
      expect(testSource).toBeDefined();
      expect(testSource?.type).toBe('file');
    });

    test('应该能够移除配置源', () => {
      configManager.addConfigSource({
        name: 'temp-source',
        type: 'file',
        priority: 50,
        path: './temp.yaml',
        enabled: true
      });

      configManager.removeConfigSource('temp-source');
      const sources = configManager.getConfigSources();
      const tempSource = Array.from(sources.values()).find(source => source.name === 'temp-source');
      expect(tempSource).toBeUndefined();
    });
  });

  describe('环境管理', () => {
    test('应该能够获取当前环境', () => {
      const env = configManager.getEnvironment();
      expect(env).toBe('testing');
    });

    test('应该能够设置环境', async () => {
      await configManager.setEnvironment('development');
      expect(configManager.getEnvironment()).toBe('development');
    });
  });

  describe('配置变更历史', () => {
    test('应该记录配置变更', async () => {
      await configManager.set('custom.history', 'test');
      const history = configManager.getChangeHistory();
      
      const lastChange = history[history.length - 1];
      expect(lastChange.path).toBe('custom.history');
      expect(lastChange.newValue).toBe('test');
    });

    test('应该包含变更时间戳', async () => {
      const beforeTime = Date.now();
      await configManager.set('custom.timestamp', 'test');
      const afterTime = Date.now();

      const history = configManager.getChangeHistory();
      const lastChange = history[history.length - 1];
      
      expect(lastChange.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(lastChange.timestamp).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('配置导入导出', () => {
    test('应该能够导出为YAML', () => {
      const yamlConfig = configManager.exportConfig('yaml');
      expect(typeof yamlConfig).toBe('string');
      expect(yamlConfig.includes('name: Test Bot')).toBe(true);
    });

    test('应该能够导出为JSON', () => {
      const jsonConfig = configManager.exportConfig('json');
      expect(typeof jsonConfig).toBe('string');
      
      const parsed = JSON.parse(jsonConfig);
      expect(parsed.name).toBe('Test Bot');
    });

    test('应该能够从YAML导入', async () => {
      const yamlConfig = `
name: "Imported Bot"
version: "3.0.0"
custom:
  imported: true
`;

      await configManager.importConfig(yamlConfig, 'yaml');
      expect(configManager.get('name')).toBe('Imported Bot');
      expect(configManager.get('version')).toBe('3.0.0');
      expect(configManager.get('custom.imported')).toBe(true);
    });

    test('应该能够从JSON导入', async () => {
      const jsonConfig = JSON.stringify({
        name: 'JSON Bot',
        version: '4.0.0',
        custom: {
          fromJson: true
        }
      });

      await configManager.importConfig(jsonConfig, 'json');
      expect(configManager.get('name')).toBe('JSON Bot');
      expect(configManager.get('custom.fromJson')).toBe(true);
    });
  });

  describe('监控配置', () => {
    test('应该能够获取监控配置', () => {
      const monitorConfig = configManager.getMonitorConfig();
      expect(monitorConfig).toBeDefined();
      expect(typeof monitorConfig.enabled).toBe('boolean');
    });

    test('应该能够更新监控配置', () => {
      configManager.updateMonitorConfig({
        enabled: true,
        checkInterval: 5000,
        alertOnChange: true,
        backupOnChange: false,
        maxBackups: 5
      });

      const monitorConfig = configManager.getMonitorConfig();
      expect(monitorConfig.enabled).toBe(true);
      expect(monitorConfig.checkInterval).toBe(5000);
    });
  });

  describe('错误处理', () => {
    test('应该处理无效的配置路径', () => {
      const value = configManager.get('nonexistent.path');
      expect(value).toBeUndefined();
    });

    test('应该处理无效的模板名称', () => {
      const templates = configManager.getTemplates();
      const template = templates.find(t => t.name === 'nonexistent');
      expect(template).toBeUndefined();
    });

    test('应该处理无效的备份ID', async () => {
      await expect(configManager.restoreBackup('invalid-id')).rejects.toThrow();
    });

    test('应该处理无效的导入格式', async () => {
      await expect(configManager.importConfig('invalid yaml content', 'yaml')).rejects.toThrow();
    });
  });
});