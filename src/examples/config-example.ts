import { ConfigManager } from '../config/config';

/**
 * 配置管理器使用示例
 */
export class ConfigExample {
  private configManager: ConfigManager;

  constructor() {
    this.configManager = ConfigManager.getInstance();
  }

  /**
   * 基础配置操作示例
   */
  async basicOperations() {
    console.log('=== 基础配置操作示例 ===');

    // 获取配置
    const botName = this.configManager.get('name');
    console.log('机器人名称:', botName);

    // 获取嵌套配置
    const dbType = this.configManager.get('database.type');
    console.log('数据库类型:', dbType);

    // 设置配置
    await this.configManager.set('custom.example', 'Hello World');
    console.log('设置自定义配置:', this.configManager.get('custom.example'));

    // 批量更新配置
    await this.configManager.update({
      'logging.level': 'debug',
      'performance.maxConcurrentTasks': 20
    });

    // 获取完整配置
    const fullConfig = this.configManager.getConfig();
    console.log('完整配置:', JSON.stringify(fullConfig, null, 2));
  }

  /**
   * 配置模板操作示例
   */
  async templateOperations() {
    console.log('\n=== 配置模板操作示例 ===');

    // 列出所有模板
    const templates = this.configManager.listTemplates();
    console.log('可用模板:', templates);

    // 获取特定模板
    const devTemplate = this.configManager.getTemplate('development');
    if (devTemplate) {
      console.log('开发环境模板:', devTemplate.description);
    }

    // 应用模板
    try {
      await this.configManager.applyTemplate('development');
      console.log('已应用开发环境模板');
    } catch (error) {
      console.error('应用模板失败:', error);
    }

    // 创建自定义模板
    const customTemplate = {
      name: 'custom-dev',
      description: '自定义开发环境',
      version: '1.0.0',
      config: {
        name: '自定义开发机器人',
        environment: 'development',
        logging: {
          level: 'debug'
        }
      },
      createdAt: new Date().toISOString(),
      author: 'developer'
    };

    await this.configManager.createTemplate('custom-template', '自定义模板', customTemplate);
    console.log('已创建自定义模板');
  }

  /**
   * 配置验证示例
   */
  async validationOperations() {
    console.log('\n=== 配置验证示例 ===');

    // 获取验证规则
    const rules = this.configManager.getValidationRules();
    console.log('验证规则数量:', rules.size);

    // 添加自定义验证规则
    this.configManager.addValidationRule({
      path: 'custom.maxUsers',
      type: 'number',
      required: false,
      validator: (value: number) => value > 0 && value <= 1000 || '用户数量必须在1-1000之间',
      description: '最大用户数量'
    });

    // 尝试设置无效值（会触发验证）
    try {
      await this.configManager.set('custom.maxUsers', -1);
    } catch (error) {
      console.log('验证失败（预期）:', (error as Error).message);
    }

    // 设置有效值
    await this.configManager.set('custom.maxUsers', 100);
    console.log('设置有效值成功');
  }

  /**
   * 配置备份和恢复示例
   */
  async backupOperations() {
    console.log('\n=== 配置备份和恢复示例 ===');

    // 创建备份
    const backupId = await this.configManager.backupConfiguration();
    console.log('创建备份:', backupId);

    // 列出备份
    const backups = this.configManager.listBackups();
    console.log('备份列表:', backups);

    // 修改配置
    await this.configManager.set('name', '临时修改的名称');
    console.log('修改后的名称:', this.configManager.get('name'));

    // 恢复备份
    await this.configManager.restoreFromBackup(backupId);
    console.log('恢复后的名称:', this.configManager.get('name'));
  }

  /**
   * 配置源管理示例
   */
  async configSourceOperations() {
    console.log('\n=== 配置源管理示例 ===');

    // 获取配置源
    const sources = this.configManager.getConfigSources();
    console.log('配置源:', sources);

    // 添加新的配置源
    this.configManager.addConfigSource({
      name: 'custom-file',
      type: 'file',
      priority: 50,
      path: './config/custom.yaml',
      enabled: true
    });

    // 重新加载配置
    await this.configManager.reload();
    console.log('已重新加载配置');
  }

  /**
   * 环境变量操作示例
   */
  async environmentOperations() {
    console.log('\n=== 环境变量操作示例 ===');

    // 获取当前环境
    const currentEnv = this.configManager.getEnvironment();
    console.log('当前环境:', currentEnv);

    // 切换环境
    await this.configManager.setEnvironment('testing');
    console.log('切换到测试环境');

    // 切换回原环境
    await this.configManager.setEnvironment(currentEnv);
    console.log('切换回原环境');
  }

  /**
   * 配置变更历史示例
   */
  async changeHistoryOperations() {
    console.log('\n=== 配置变更历史示例 ===');

    // 进行一些配置变更
    await this.configManager.set('custom.testValue', 'initial');
    await this.configManager.set('custom.testValue', 'updated');
    await this.configManager.set('custom.anotherValue', 'new');

    // 获取变更历史
    const history = this.configManager.getChangeHistory();
    console.log('变更历史:');
    history.slice(-5).forEach(change => {
      console.log(`  ${new Date(change.timestamp).toISOString()}: ${change.path} = ${change.newValue}`);
    });
  }

  /**
   * 配置导入导出示例
   */
  async importExportOperations() {
    console.log('\n=== 配置导入导出示例 ===');

    // 导出配置为YAML
    const yamlConfig = this.configManager.export('yaml');
    console.log('YAML配置长度:', yamlConfig.length);

    // 导出配置为JSON
    const jsonConfig = this.configManager.export('json');
    console.log('JSON配置长度:', jsonConfig.length);

    // 保存配置到文件
    await this.configManager.save('./config/exported-config.yaml');
    console.log('配置已保存到文件');

    // 从字符串导入配置（示例）
    const sampleConfig = `
name: "导入的机器人"
version: "2.0.0"
custom:
  imported: true
`;

    try {
      await this.configManager.import(sampleConfig, 'yaml');
      console.log('配置导入成功');
    } catch (error) {
      console.error('配置导入失败:', (error as Error).message);
    }
  }

  /**
   * 运行所有示例
   */
  async runAllExamples() {
    try {
      await this.basicOperations();
      await this.templateOperations();
      await this.validationOperations();
      await this.backupOperations();
      await this.configSourceOperations();
      await this.environmentOperations();
      await this.changeHistoryOperations();
      await this.importExportOperations();

      console.log('\n=== 所有示例运行完成 ===');
    } catch (error) {
      console.error('示例运行失败:', error);
    }
  }
}

// 如果直接运行此文件，则执行示例
if (require.main === module) {
  const example = new ConfigExample();
  example.runAllExamples().catch(console.error);
}