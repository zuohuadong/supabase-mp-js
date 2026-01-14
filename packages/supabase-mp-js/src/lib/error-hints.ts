/**
 * PostgREST 错误友好提示系统
 * 将晦涩的 PostgREST 错误转换为开发者友好的中文提示
 */

interface PostgrestError {
  code?: string
  message?: string
  details?: string
  hint?: string
}

interface FriendlyError extends PostgrestError {
  friendlyMessage?: string
  suggestion?: string
}

/**
 * PostgREST 错误码映射表
 */
const ERROR_CODE_MAP: Record<string, { message: string; suggestion: string }> = {
  // RPC 相关错误
  PGRST202: {
    message: '找不到匹配的函数',
    suggestion: '请检查：1) 函数名是否正确 2) 参数名是否与数据库定义一致 3) 参数类型是否匹配',
  },
  PGRST204: {
    message: '函数调用参数类型不匹配',
    suggestion: '请检查传入参数的类型是否与数据库函数定义一致（如 string vs number）',
  },

  // 认证相关错误
  PGRST301: {
    message: 'JWT 令牌无效或已过期',
    suggestion: '请重新登录获取新的访问令牌',
  },
  PGRST302: {
    message: '匿名用户不允许访问',
    suggestion: '请确保用户已登录，或检查 RLS 策略是否允许匿名访问',
  },

  // 权限相关错误
  '42501': {
    message: '权限不足',
    suggestion: '请检查数据库的 RLS (Row Level Security) 策略配置',
  },
  '42P01': {
    message: '表或视图不存在',
    suggestion: '请检查表名是否正确，或者该表是否已创建',
  },
  '42883': {
    message: '函数不存在',
    suggestion: '请检查函数名和参数类型是否与数据库定义完全一致',
  },

  // 数据相关错误
  '23505': {
    message: '数据重复（违反唯一约束）',
    suggestion: '该记录已存在，请检查主键或唯一索引字段',
  },
  '23503': {
    message: '外键约束失败',
    suggestion: '引用的关联记录不存在，请先创建关联数据',
  },
  '23502': {
    message: '非空约束违反',
    suggestion: '必填字段不能为空，请检查数据完整性',
  },

  // 连接相关错误
  '08006': {
    message: '数据库连接失败',
    suggestion: '服务端可能暂时不可用，请稍后重试或联系管理员',
  },
  '57P03': {
    message: '数据库正在启动中',
    suggestion: '请等待几秒后重试',
  },
}

/**
 * HTTP 状态码映射
 */
const HTTP_STATUS_MAP: Record<number, { message: string; suggestion: string }> = {
  400: {
    message: '请求参数错误',
    suggestion: '请检查请求参数格式是否正确',
  },
  401: {
    message: '未授权访问',
    suggestion: '请检查 API Key 或登录状态',
  },
  403: {
    message: '禁止访问',
    suggestion: '当前用户没有权限执行此操作，请检查 RLS 策略',
  },
  404: {
    message: '资源不存在',
    suggestion: '请检查 API 路径或资源 ID 是否正确',
  },
  409: {
    message: '资源冲突',
    suggestion: '可能存在并发修改，请刷新后重试',
  },
  500: {
    message: '服务器内部错误',
    suggestion: '服务端发生错误，请联系管理员',
  },
  502: {
    message: '网关错误',
    suggestion: 'API 网关无法连接后端服务，请检查服务状态',
  },
  503: {
    message: '服务暂时不可用',
    suggestion: 'PostgREST 可能正在重启或数据库连接异常，请稍后重试',
  },
  504: {
    message: '网关超时',
    suggestion: '请求处理时间过长，请优化查询或增加超时时间',
  },
}

/**
 * 增强 PostgREST 错误，添加友好提示
 */
export function enhancePostgrestError(
  error: PostgrestError | null,
  httpStatus?: number
): FriendlyError | null {
  if (!error) return null

  const enhanced: FriendlyError = { ...error }

  // 1. 尝试通过错误码匹配
  if (error.code && ERROR_CODE_MAP[error.code]) {
    const mapped = ERROR_CODE_MAP[error.code]
    enhanced.friendlyMessage = mapped.message
    enhanced.suggestion = mapped.suggestion
  }

  // 2. 尝试通过 HTTP 状态码匹配
  if (!enhanced.friendlyMessage && httpStatus && HTTP_STATUS_MAP[httpStatus]) {
    const mapped = HTTP_STATUS_MAP[httpStatus]
    enhanced.friendlyMessage = mapped.message
    enhanced.suggestion = mapped.suggestion
  }

  // 3. 解析 hint 字段中的有用信息
  if (error.hint) {
    // PostgREST 经常在 hint 中给出建议，如 "Perhaps you meant to call..."
    if (error.hint.includes('Perhaps you meant')) {
      enhanced.suggestion = `PostgREST 提示: ${error.hint}`
    }
  }

  // 4. 特殊处理：RPC 函数签名不匹配
  if (error.message?.includes('function') && error.message?.includes('does not exist')) {
    enhanced.friendlyMessage = 'RPC 函数调用失败：函数签名不匹配'
    enhanced.suggestion =
      '请确保：1) 函数名拼写正确 2) 参数名与数据库定义完全一致（区分大小写）3) 参数类型正确'
  }

  // 5. 特殊处理：Schema Cache 错误 (503)
  if (error.message?.includes('schema cache')) {
    enhanced.friendlyMessage = '数据库 Schema 缓存加载失败'
    enhanced.suggestion = '这是服务端问题，请重启 PostgREST 服务或检查数据库连接'
  }

  return enhanced
}

/**
 * 在控制台打印友好的错误信息（开发模式）
 */
export function logFriendlyError(error: FriendlyError, context?: string): void {
  if (!error) return

  const prefix = context ? `[${context}]` : '[Supabase]'

  console.group(`${prefix} 请求失败`)

  if (error.friendlyMessage) {
    console.error(`❌ ${error.friendlyMessage}`)
  }

  if (error.message && error.message !== error.friendlyMessage) {
    console.error(`   原始错误: ${error.message}`)
  }

  if (error.code) {
    console.error(`   错误码: ${error.code}`)
  }

  if (error.details) {
    console.error(`   详情: ${error.details}`)
  }

  if (error.suggestion) {
    console.warn(`💡 建议: ${error.suggestion}`)
  }

  if (error.hint) {
    console.info(`   提示: ${error.hint}`)
  }

  console.groupEnd()
}
