/**
 * 微信小程序 Fetch 适配器
 * 将 wx.request 封装为标准 Fetch API 接口
 */

const MAX_CONCURRENT_REQUESTS = 10
const DEFAULT_TIMEOUT = 60000 // 60秒超时
const requestQueue = []
let activeRequests = 0

/**
 * 处理请求队列
 */
function processQueue() {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS || requestQueue.length === 0) {
    return
  }

  const { url, options, resolve, reject } = requestQueue.shift()
  activeRequests++

  const timeout = options.timeout || DEFAULT_TIMEOUT

  wx.request({
    url: url,
    data: options.body,
    method: options.method || 'GET',
    dataType: 'json',
    timeout: timeout,
    header: normalizeHeaders(options.headers),
    success(res) {
      const response = createResponse(res)
      resolve(response)
    },
    fail(err) {
      // 增强错误信息
      const error = new Error(err.errMsg || '网络请求失败')
      error.code = err.errno || 'NETWORK_ERROR'
      error.originalError = err

      // 特殊处理常见错误
      if (err.errMsg?.includes('timeout')) {
        error.message = `请求超时 (${timeout / 1000}秒)`
        error.code = 'TIMEOUT'
      } else if (err.errMsg?.includes('fail')) {
        error.message = '网络连接失败，请检查网络设置'
        error.code = 'NETWORK_FAIL'
      }

      reject(error)
    },
    complete() {
      activeRequests--
      processQueue()
    },
  })
}

/**
 * 标准化请求头
 * 支持 Map、Headers 对象和普通对象
 */
function normalizeHeaders(headers) {
  if (!headers) {
    return {}
  }

  // Map 对象
  if (Object.prototype.toString.call(headers) === '[object Map]') {
    return Object.fromEntries(headers.entries())
  }

  // Headers 对象 (标准 Fetch API)
  if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
    const result = {}
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }

  // 普通对象
  return headers
}

/**
 * 创建标准 Response 对象
 */
function createResponse(wxRes) {
  const status = wxRes.statusCode
  const ok = status >= 200 && status <= 299

  // 转换响应头为小写（HTTP 规范要求不区分大小写）
  const headers = new Map()
  if (wxRes.header) {
    Object.entries(wxRes.header).forEach(([key, value]) => {
      headers.set(key.toLowerCase(), value)
    })
  }

  return {
    ok,
    status,
    statusText: getStatusText(status),
    headers: {
      get: (name) => headers.get(name.toLowerCase()) || null,
      has: (name) => headers.has(name.toLowerCase()),
      forEach: (callback) => headers.forEach(callback),
      entries: () => headers.entries(),
      keys: () => headers.keys(),
      values: () => headers.values(),
    },
    data: wxRes.data, // 微信特有：直接访问解析后的数据

    // Fetch API 标准方法
    json() {
      return Promise.resolve(wxRes.data)
    },
    text() {
      return Promise.resolve(
        typeof wxRes.data === 'string' ? wxRes.data : JSON.stringify(wxRes.data)
      )
    },
    blob() {
      // 微信小程序不支持 Blob，返回原始数据
      return Promise.resolve(wxRes.data)
    },
    arrayBuffer() {
      // 微信小程序不支持 ArrayBuffer 响应，返回原始数据
      return Promise.resolve(wxRes.data)
    },
  }
}

/**
 * HTTP 状态码文本映射
 */
function getStatusText(status) {
  const statusTexts = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  }
  return statusTexts[status] || 'Unknown'
}

/**
 * 微信小程序 Fetch 适配器
 * 模拟标准 Fetch API
 *
 * @param {string} url - 请求 URL
 * @param {Object} options - 请求选项
 * @param {string} options.method - HTTP 方法
 * @param {Object|Map} options.headers - 请求头
 * @param {string|Object} options.body - 请求体
 * @param {number} options.timeout - 超时时间（毫秒）
 * @returns {Promise<Response>}
 */
function myfetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ url, options, resolve, reject })
    processQueue()
  })
}

export default myfetch
