export const defaultValidationRules = [
  // 基础配置验证
  {
    path: 'name',
    type: 'string' as const,
    required: true,
    description: '机器人名称'
  },
  {
    path: 'version',
    type: 'string' as const,
    required: true,
    validator: (value: string) => /^\d+\.\d+\.\d+$/.test(value) || '版本号格式应为 x.y.z',
    description: '机器人版本号'
  },
  {
    path: 'environment',
    type: 'string' as const,
    required: true,
    validator: (value: string) => ['development', 'production', 'testing', 'staging'].includes(value) || '环境必须是 development, production, testing 或 staging',
    description: '运行环境'
  },

  // 适配器配置验证
  {
    path: 'adapters',
    type: 'object' as const,
    required: true,
    description: '适配器配置'
  },

  // 数据库配置验证
  {
    path: 'database.type',
    type: 'string' as const,
    required: true,
    validator: (value: string) => ['sqlite', 'redis', 'mongodb', 'mysql', 'postgresql'].includes(value) || '数据库类型必须是支持的类型之一',
    description: '数据库类型'
  },
  {
    path: 'database.sqlite.path',
    type: 'string' as const,
    required: false,
    description: 'SQLite数据库文件路径'
  },
  {
    path: 'database.redis.host',
    type: 'string' as const,
    required: false,
    description: 'Redis主机地址'
  },
  {
    path: 'database.redis.port',
    type: 'number' as const,
    required: false,
    validator: (value: number) => value > 0 && value <= 65535 || '端口号必须在1-65535之间',
    description: 'Redis端口号'
  },

  // 插件配置验证
  {
    path: 'plugins.directory',
    type: 'string' as const,
    required: true,
    description: '插件目录路径'
  },
  {
    path: 'plugins.autoLoad',
    type: 'boolean' as const,
    required: true,
    description: '是否自动加载插件'
  },
  {
    path: 'plugins.hotReload',
    type: 'boolean' as const,
    required: false,
    default: false,
    description: '是否启用热重载'
  },

  // 日志配置验证
  {
    path: 'logging.level',
    type: 'string' as const,
    required: true,
    validator: (value: string) => ['debug', 'info', 'warn', 'error'].includes(value) || '日志级别必须是 debug, info, warn 或 error',
    description: '日志级别'
  },
  {
    path: 'logging.file.maxSize',
    type: 'string' as const,
    required: false,
    validator: (value: string) => /^\d+[KMGT]?B$/.test(value) || '文件大小格式应为数字+单位(B/KB/MB/GB/TB)',
    description: '日志文件最大大小'
  },
  {
    path: 'logging.file.maxFiles',
    type: 'number' as const,
    required: false,
    validator: (value: number) => value > 0 || '最大文件数必须大于0',
    description: '最大日志文件数'
  },

  // 安全配置验证
  {
    path: 'security.encryption.algorithm',
    type: 'string' as const,
    required: false,
    validator: (value: string) => ['aes-256-gcm', 'aes-256-cbc', 'aes-192-gcm'].includes(value) || '不支持的加密算法',
    description: '加密算法'
  },
  {
    path: 'security.rateLimit.windowMs',
    type: 'number' as const,
    required: false,
    validator: (value: number) => value > 0 || '时间窗口必须大于0',
    description: '限流时间窗口(毫秒)'
  },
  {
    path: 'security.rateLimit.maxRequests',
    type: 'number' as const,
    required: false,
    validator: (value: number) => value > 0 || '最大请求数必须大于0',
    description: '时间窗口内最大请求数'
  },

  // 性能配置验证
  {
    path: 'performance.maxConcurrentTasks',
    type: 'number' as const,
    required: true,
    validator: (value: number) => value > 0 && value <= 1000 || '并发任务数必须在1-1000之间',
    description: '最大并发任务数'
  },
  {
    path: 'performance.taskTimeout',
    type: 'number' as const,
    required: true,
    validator: (value: number) => value > 0 || '任务超时时间必须大于0',
    description: '任务超时时间(毫秒)'
  },
  {
    path: 'performance.memoryLimit',
    type: 'string' as const,
    required: true,
    validator: (value: string) => /^\d+[KMGT]?B$/.test(value) || '内存限制格式应为数字+单位(B/KB/MB/GB/TB)',
    description: '内存限制'
  },
  {
    path: 'performance.cpuLimit',
    type: 'number' as const,
    required: true,
    validator: (value: number) => value > 0 && value <= 100 || 'CPU限制必须在1-100之间',
    description: 'CPU使用率限制(%)'
  },

  // 监控配置验证
  {
    path: 'monitoring.metrics.interval',
    type: 'number' as const,
    required: false,
    validator: (value: number) => value >= 1000 || '指标收集间隔不能少于1秒',
    description: '指标收集间隔(毫秒)'
  },
  {
    path: 'monitoring.metrics.retention',
    type: 'number' as const,
    required: false,
    validator: (value: number) => value > 0 || '指标保留时间必须大于0',
    description: '指标保留时间(毫秒)'
  },
  {
    path: 'monitoring.health.interval',
    type: 'number' as const,
    required: false,
    validator: (value: number) => value >= 1000 || '健康检查间隔不能少于1秒',
    description: '健康检查间隔(毫秒)'
  }
];