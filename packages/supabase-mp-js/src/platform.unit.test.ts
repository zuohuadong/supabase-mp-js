import { ensureSupabasePlatformGlobals } from './platform'

const NativeURL = globalThis.URL
const NativeURLSearchParams = globalThis.URLSearchParams
const NativeHeaders = globalThis.Headers
const NativeAbortController = globalThis.AbortController
const NativeAbortSignal = globalThis.AbortSignal

const PLATFORM_GLOBALS = [
  'URL',
  'URLSearchParams',
  'Headers',
  'AbortController',
  'AbortSignal',
] as const

type PlatformGlobal = (typeof PLATFORM_GLOBALS)[number]
type RuntimeRecord = Record<PlatformGlobal, unknown>

function withoutNativePlatform(): void {
  const runtime = globalThis as unknown as RuntimeRecord
  for (const name of PLATFORM_GLOBALS) runtime[name] = undefined
}

function restoreNativePlatform(): void {
  const runtime = globalThis as unknown as RuntimeRecord
  runtime.URL = NativeURL
  runtime.URLSearchParams = NativeURLSearchParams
  runtime.Headers = NativeHeaders
  runtime.AbortController = NativeAbortController
  runtime.AbortSignal = NativeAbortSignal
}

function installFallbacks(): void {
  withoutNativePlatform()
  ensureSupabasePlatformGlobals()
}

describe('Supabase web-platform fallbacks', () => {
  afterEach(() => {
    restoreNativePlatform()
    jest.useRealTimers()
  })

  it('preserves complete native implementations', () => {
    ensureSupabasePlatformGlobals()
    expect(globalThis.URL).toBe(NativeURL)
    expect(globalThis.URLSearchParams).toBe(NativeURLSearchParams)
    expect(globalThis.Headers).toBe(NativeHeaders)
    expect(globalThis.AbortController).toBe(NativeAbortController)
    expect(globalThis.AbortSignal).toBe(NativeAbortSignal)
  })

  it('replaces incomplete runtime URL implementations', () => {
    const runtime = globalThis as unknown as RuntimeRecord
    const BrokenURL = class {
      constructor() {
        throw new TypeError('URL is not supported by this runtime')
      }
    }
    runtime.URL = BrokenURL
    ensureSupabasePlatformGlobals()

    expect(globalThis.URL).not.toBe(BrokenURL)
    expect(new URL('https://custom.example.com/').hostname).toBe('custom.example.com')
  })

  it('replaces incomplete runtime URLSearchParams implementations', () => {
    const runtime = globalThis as unknown as RuntimeRecord
    const BrokenURLSearchParams = class {
      get(): never {
        throw new TypeError('URLSearchParams is not supported by this runtime')
      }
    }
    runtime.URLSearchParams = BrokenURLSearchParams
    ensureSupabasePlatformGlobals()

    expect(globalThis.URLSearchParams).not.toBe(BrokenURLSearchParams)
    expect(new URLSearchParams('probe=value').get('probe')).toBe('value')
  })

  it('matches native URL resolution for Supabase service endpoints', () => {
    installFallbacks()
    const base = 'https://project.supabase.co/platform/'
    for (const endpoint of [
      '../rest/v1',
      '../auth/v1?flow=pkce',
      '../storage/v1/object/public/media/avatar.png',
      '../functions/v1/hello#result',
    ]) {
      expect(new URL(endpoint, base).href).toBe(new NativeURL(endpoint, base).href)
    }

    expect(new URL('//localhost:54321/rest/v1', base).href).toBe(
      new NativeURL('//localhost:54321/rest/v1', base).href
    )
    expect(new URL('https://[2001:db8::1]:443/rest/v1').href).toBe(
      new NativeURL('https://[2001:db8::1]:443/rest/v1').href
    )
    expect(new URL('../鱼 图/../饵.png?名称=铁板#片段', base).href).toBe(
      new NativeURL('../鱼 图/../饵.png?名称=铁板#片段', base).href
    )
    expect(new URL('/a/%2e%2e/b', base).href).toBe(new NativeURL('/a/%2e%2e/b', base).href)
    for (const [input, dotBase] of [
      ['/a/.', base],
      ['/a/%2e', base],
      ['.', 'https://project.supabase.co/a/b/'],
      ['..', 'https://project.supabase.co/a/b/'],
    ]) {
      expect(new URL(input, dotBase).href).toBe(new NativeURL(input, dotBase).href)
    }

    const credentials = new URL(base)
    const nativeCredentials = new NativeURL(base)
    credentials.username = nativeCredentials.username = 'user name@example.com'
    credentials.password = nativeCredentials.password = 'p@ss word'
    expect(credentials.href).toBe(nativeCredentials.href)
  })

  it('keeps PostgREST filters live and iterable', () => {
    installFallbacks()
    const actual = new URL('https://project.supabase.co/rest/v1/items')
    const expected = new NativeURL(actual.href)
    const configure = (params: URLSearchParams) => {
      params.set('select', 'id, name')
      params.append('status', 'eq.in progress')
      params.append('status', 'neq.closed')
      params.set('or', '(owner.eq.me,title.ilike.*lure*)')
      params.delete('status', 'eq.in progress')
    }
    configure(actual.searchParams)
    configure(expected.searchParams)

    expect(actual.href).toBe(expected.href)
    expect([...actual.searchParams]).toEqual([...expected.searchParams])
    expect(actual.searchParams.getAll('status')).toEqual(['neq.closed'])
    expect(actual.searchParams.size).toBe(expected.searchParams.size)
  })

  it('supports Storage hostname and Realtime protocol/path setters', () => {
    installFallbacks()
    const storage = new URL('https://project.supabase.co/storage/v1')
    storage.hostname = storage.hostname.replace('supabase.', 'storage.supabase.')
    expect(storage.href).toBe('https://project.storage.supabase.co/storage/v1')

    const realtime = new URL('realtime/v1', 'https://project.supabase.co/')
    realtime.protocol = realtime.protocol.replace('http', 'ws')
    realtime.pathname = `${realtime.pathname}/websocket`
    expect(realtime.href).toBe('wss://project.supabase.co/realtime/v1/websocket')
  })

  it('handles OAuth query/hash parsing and live search replacement', () => {
    installFallbacks()
    const actual = new URL(
      '/auth/v1/authorize?provider=github#access_token=a%2Bb&refresh_token=r%20t',
      'https://project.supabase.co/dashboard/'
    )
    const expected = new NativeURL(
      '/auth/v1/authorize?provider=github#access_token=a%2Bb&refresh_token=r%20t',
      'https://project.supabase.co/dashboard/'
    )
    const liveParams = actual.searchParams
    actual.search = '?redirect_to=https%3A%2F%2Fapp.example%2Fcallback'
    expected.search = '?redirect_to=https%3A%2F%2Fapp.example%2Fcallback'
    liveParams.append('scopes', 'openid profile')
    expected.searchParams.append('scopes', 'openid profile')

    expect(actual.href).toBe(expected.href)
    expect(actual.searchParams).toBe(liveParams)
    expect(new URLSearchParams(actual.hash.slice(1)).get('access_token')).toBe('a+b')
  })

  it('normalizes, combines, clones and iterates Headers', () => {
    installFallbacks()
    const headers = new Headers({ Authorization: ' Bearer token ', 'X-Trace': 'one' })
    headers.append('x-trace', 'two')
    headers.set('Content-Type', 'application/json')
    const cloned = new Headers(headers)

    expect(cloned.get('AUTHORIZATION')).toBe('Bearer token')
    expect(cloned.get('x-trace')).toBe('one, two')
    expect(Object.fromEntries(cloned)).toEqual({
      authorization: 'Bearer token',
      'content-type': 'application/json',
      'x-trace': 'one, two',
    })
    expect(() => cloned.set('bad header', 'value')).toThrow(TypeError)
    expect(() => cloned.set('x-test', 'bad\nvalue')).toThrow(TypeError)
  })

  it('supports abort events, reasons, throwIfAborted and idempotence', () => {
    installFallbacks()
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const listener = jest.fn()
    const onabort = jest.fn()
    controller.signal.addEventListener('abort', listener, { once: true })
    controller.signal.onabort = onabort

    controller.abort(reason)
    controller.abort(new Error('ignored'))

    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toBe(reason)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(onabort).toHaveBeenCalledTimes(1)
    expect(() => controller.signal.throwIfAborted()).toThrow(reason)
  })

  it('supports AbortSignal.abort, timeout and any', () => {
    jest.useFakeTimers()
    installFallbacks()
    const reason = { source: 'manual' }
    expect(AbortSignal.abort(reason)).toMatchObject({ aborted: true, reason })

    const first = new AbortController()
    const second = new AbortController()
    const FallbackAbortSignal = AbortSignal as typeof AbortSignal & {
      any(signals: Iterable<AbortSignal>): AbortSignal
    }
    const combined = FallbackAbortSignal.any([first.signal, second.signal])
    second.abort(reason)
    expect(combined).toMatchObject({ aborted: true, reason })

    const timeout = AbortSignal.timeout(25)
    expect(timeout.aborted).toBe(false)
    jest.advanceTimersByTime(25)
    expect(timeout.aborted).toBe(true)
    expect((timeout.reason as Error).name).toBe('TimeoutError')
  })
})
