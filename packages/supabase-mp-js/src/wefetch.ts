import { ensureSupabasePlatformGlobals } from './platform'

const MAX_CONCURRENT_REQUESTS = 10
const DEFAULT_TIMEOUT = 60_000
const SUPPORTED_METHODS = new Set([
  'OPTIONS',
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'DELETE',
  'TRACE',
  'CONNECT',
])

type WxRequestInit = RequestInit & { timeout?: number }

interface QueueEntry {
  url: string
  init: WxRequestInit
  resolve: (response: Response) => void
  reject: (error: Error) => void
  signal?: AbortSignal | null
  queuedAbortListener?: () => void
  abortListener?: () => void
  task?: WechatMiniprogram.RequestTask
  started: boolean
  settled: boolean
  finished: boolean
}

const requestQueue: QueueEntry[] = []
let activeRequests = 0

function createAbortError(): Error & { code?: string } {
  const error = new Error('The operation was aborted') as Error & { code?: string }
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function normalizeUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString()
  if (input && typeof input === 'object' && 'url' in input) return String(input.url)
  return String(input)
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  const normalized: Record<string, string> = {}
  if (!headers) return normalized

  const source = new Headers(headers)
  source.forEach((value, key) => {
    normalized[key] = value
  })
  return normalized
}

function normalizeBody(body?: BodyInit | null): unknown {
  if (body == null) return undefined
  if (typeof body === 'string' || body instanceof ArrayBuffer) return body
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return body.toString()
  }
  return body as unknown
}

function responseText(data: unknown): string {
  if (typeof data === 'string') return data
  if (data == null) return ''
  if (data instanceof ArrayBuffer) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(data)
    return Array.from(new Uint8Array(data), (byte) => String.fromCharCode(byte)).join('')
  }
  return JSON.stringify(data)
}

function textToArrayBuffer(value: string): ArrayBuffer {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).buffer
  const encoded = unescape(encodeURIComponent(value))
  const bytes = new Uint8Array(encoded.length)
  for (let index = 0; index < encoded.length; index += 1) bytes[index] = encoded.charCodeAt(index)
  return bytes.buffer
}

function createResponse(
  wxResponse: WechatMiniprogram.RequestSuccessCallbackResult,
  url: string
): Response {
  const status = Number(wxResponse.statusCode || 0)
  const headers = new Headers()
  Object.entries(wxResponse.header || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, String(item)))
    else if (value != null) headers.set(key, String(value))
  })

  const rawData = wxResponse.data
  let bodyUsed = false

  const consume = <T>(reader: () => T | Promise<T>): Promise<T> => {
    if (bodyUsed) return Promise.reject(new TypeError('Body has already been consumed.'))
    bodyUsed = true
    return Promise.resolve(reader())
  }

  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText(status),
    headers: headers as unknown as Headers,
    redirected: false,
    type: 'basic' as ResponseType,
    url,
    body: null,
    get bodyUsed() {
      return bodyUsed
    },
    clone() {
      if (bodyUsed) throw new TypeError('Body has already been consumed.')
      return createResponse(wxResponse, url)
    },
    text: () => consume(() => responseText(rawData)),
    json: () =>
      consume(() => {
        if (typeof rawData !== 'string') return rawData
        if (!rawData.trim()) return null
        return JSON.parse(rawData)
      }),
    arrayBuffer: () =>
      consume(() =>
        rawData instanceof ArrayBuffer ? rawData : textToArrayBuffer(responseText(rawData))
      ),
    blob: () =>
      consume(async () => {
        const data =
          rawData instanceof ArrayBuffer ? rawData : textToArrayBuffer(responseText(rawData))
        if (typeof Blob === 'undefined') return data as unknown as Blob
        return new Blob([data], { type: headers.get('content-type') || '' })
      }),
    formData: () =>
      Promise.reject(
        new TypeError('multipart/form-data responses are not supported by wx.request')
      ),
    bytes: () =>
      consume(async () => {
        const data =
          rawData instanceof ArrayBuffer ? rawData : textToArrayBuffer(responseText(rawData))
        return new Uint8Array(data)
      }),
  }

  return response as Response
}

function statusText(status: number): string {
  const values: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    206: 'Partial Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  }
  return values[status] || ''
}

function finish(entry: QueueEntry): void {
  if (entry.finished) return
  entry.finished = true
  if (entry.signal && entry.queuedAbortListener) {
    entry.signal.removeEventListener('abort', entry.queuedAbortListener)
  }
  if (entry.signal && entry.abortListener) {
    entry.signal.removeEventListener('abort', entry.abortListener)
  }
  activeRequests = Math.max(0, activeRequests - 1)
  processQueue()
}

function startRequest(entry: QueueEntry): void {
  if (entry.signal && entry.queuedAbortListener) {
    entry.signal.removeEventListener('abort', entry.queuedAbortListener)
  }
  if (entry.signal?.aborted) {
    entry.settled = true
    entry.reject(createAbortError())
    return
  }

  entry.started = true
  activeRequests += 1
  const timeout = entry.init.timeout || DEFAULT_TIMEOUT

  entry.abortListener = () => {
    if (entry.settled) return
    entry.settled = true
    entry.task?.abort()
    entry.reject(createAbortError())
    finish(entry)
  }
  entry.signal?.addEventListener('abort', entry.abortListener, { once: true })

  try {
    entry.task = wx.request({
      url: entry.url,
      data: normalizeBody(entry.init.body),
      method: (
        entry.init.method || 'GET'
      ).toUpperCase() as WechatMiniprogram.RequestOption['method'],
      dataType: 'text',
      timeout,
      header: normalizeHeaders(entry.init.headers),
      success: (result) => {
        if (entry.settled) return
        entry.settled = true
        entry.resolve(createResponse(result, entry.url))
      },
      fail: (result) => {
        if (entry.settled) return
        entry.settled = true
        if (entry.signal?.aborted) {
          entry.reject(createAbortError())
          return
        }
        const error = new Error(result.errMsg || 'wx.request failed') as Error & {
          code?: string | number
          cause?: unknown
        }
        error.code = result.errno || 'NETWORK_ERROR'
        error.cause = result
        entry.reject(error)
      },
      complete: () => finish(entry),
    })
  } catch (error) {
    entry.settled = true
    entry.reject(error instanceof Error ? error : new Error(String(error)))
    finish(entry)
  }
}

function processQueue(): void {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && requestQueue.length > 0) {
    const entry = requestQueue.shift() as QueueEntry
    if (entry.signal?.aborted) {
      entry.settled = true
      entry.reject(createAbortError())
      continue
    }
    startRequest(entry)
  }
}

/** Fetch-compatible adapter backed by wx.request. */
export function wxFetch(input: RequestInfo | URL, init: WxRequestInit = {}): Promise<Response> {
  ensureSupabasePlatformGlobals()
  if (typeof wx === 'undefined' || typeof wx.request !== 'function') {
    return Promise.reject(new Error('wx.request is unavailable'))
  }

  const method = (init.method || 'GET').toUpperCase()
  if (!SUPPORTED_METHODS.has(method)) {
    return Promise.reject(
      new TypeError(
        `wx.request does not support HTTP method ${method}; use a custom fetch or server-side endpoint for this operation`
      )
    )
  }

  return new Promise((resolve, reject) => {
    const entry: QueueEntry = {
      url: normalizeUrl(input),
      init,
      resolve,
      reject,
      signal: init.signal,
      started: false,
      settled: false,
      finished: false,
    }

    if (entry.signal?.aborted) {
      entry.settled = true
      reject(createAbortError())
      return
    }

    entry.queuedAbortListener = () => {
      if (entry.started || entry.settled) return
      const index = requestQueue.indexOf(entry)
      if (index >= 0) requestQueue.splice(index, 1)
      entry.settled = true
      reject(createAbortError())
    }
    entry.signal?.addEventListener('abort', entry.queuedAbortListener, { once: true })
    requestQueue.push(entry)
    processQueue()
  })
}

export default wxFetch
