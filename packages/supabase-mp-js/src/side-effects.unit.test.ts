const NATIVE_GLOBALS = {
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,
  Headers: globalThis.Headers,
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
}

type RuntimeRecord = Record<keyof typeof NATIVE_GLOBALS, unknown>

describe('package platform initialization', () => {
  afterEach(() => {
    Object.assign(globalThis as unknown as RuntimeRecord, NATIVE_GLOBALS)
    delete (globalThis as { wx?: unknown }).wx
    jest.resetModules()
  })

  it('installs missing globals while importing the public runtime entry', () => {
    const runtime = globalThis as unknown as RuntimeRecord
    for (const name of Object.keys(NATIVE_GLOBALS) as Array<keyof typeof NATIVE_GLOBALS>) {
      runtime[name] = undefined
    }

    jest.isolateModules(() => {
      require('./index')
    })

    for (const name of Object.keys(NATIVE_GLOBALS) as Array<keyof typeof NATIVE_GLOBALS>) {
      expect(runtime[name]).toBeInstanceOf(Function)
    }
  })

  it('keeps direct SupabaseClient runtime exports usable without native globals', () => {
    const runtime = globalThis as unknown as RuntimeRecord
    for (const name of Object.keys(NATIVE_GLOBALS) as Array<keyof typeof NATIVE_GLOBALS>) {
      runtime[name] = undefined
    }
    ;(globalThis as { wx?: unknown }).wx = {
      request: jest.fn(),
      getStorageSync: jest.fn(),
      setStorageSync: jest.fn(),
      removeStorageSync: jest.fn(),
    }

    jest.isolateModules(() => {
      const entry = require('./index') as typeof import('./index')
      const client = new entry.SupabaseClient('https://project.supabase.co', 'anon-key', {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      expect(client).toBeInstanceOf(entry.SupabaseClient)
      expect(client.from('lures')).toBeDefined()
    })

    for (const name of Object.keys(NATIVE_GLOBALS) as Array<keyof typeof NATIVE_GLOBALS>) {
      expect(runtime[name]).toBeInstanceOf(Function)
    }
  })
})
