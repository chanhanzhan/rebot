// Jest测试设置文件
import * as path from 'path';
import * as fs from 'fs';

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.CONFIG_DIR = path.join(__dirname, 'test-config');
process.env.BACKUP_DIR = path.join(__dirname, 'test-backups');
process.env.TEMPLATES_DIR = path.join(__dirname, 'test-templates');

// 清理测试目录
beforeEach(() => {
  const testDirs = [
    process.env.CONFIG_DIR!,
    process.env.BACKUP_DIR!,
    process.env.TEMPLATES_DIR!
  ];

  testDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
  });
});

// 全局清理
afterAll(() => {
  const testDirs = [
    process.env.CONFIG_DIR!,
    process.env.BACKUP_DIR!,
    process.env.TEMPLATES_DIR!
  ];

  testDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});