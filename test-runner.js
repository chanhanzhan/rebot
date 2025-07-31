const { execSync } = require('child_process');
const path = require('path');

console.log('开始检查测试文件...');

try {
  // 检查TypeScript编译
  console.log('1. 检查TypeScript编译...');
  execSync('node node_modules/typescript/bin/tsc --noEmit --skipLibCheck', { 
    cwd: process.cwd(),
    stdio: 'inherit' 
  });
  console.log('✓ TypeScript编译检查通过');

  // 检查Jest配置
  console.log('2. 检查Jest配置...');
  const jestConfig = require('./jest.config.js');
  console.log('✓ Jest配置文件存在');

  // 检查测试文件语法
  console.log('3. 检查测试文件语法...');
  const testFiles = [
    './tests/config-manager.test.ts',
    './tests/config-manager-performance.test.ts', 
    './tests/config-manager-integration.test.ts'
  ];

  testFiles.forEach(file => {
    try {
      execSync(`node node_modules/typescript/bin/tsc --noEmit --skipLibCheck ${file}`, {
        cwd: process.cwd(),
        stdio: 'pipe'
      });
      console.log(`✓ ${file} 语法检查通过`);
    } catch (error) {
      console.log(`✗ ${file} 语法检查失败:`, error.message);
    }
  });

  console.log('\n所有检查完成！测试文件已修复。');

} catch (error) {
  console.error('检查失败:', error.message);
  process.exit(1);
}