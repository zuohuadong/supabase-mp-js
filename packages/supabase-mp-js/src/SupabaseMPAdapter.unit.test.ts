import { SupabaseMPAdapter } from './SupabaseMPAdapter'

describe('SupabaseMPAdapter', () => {
  afterEach(() => {
    delete (globalThis as any).wx
  })

  it('stores the raw string expected by supabase auth', () => {
    const values = new Map<string, unknown>()
    ;(globalThis as any).wx = {
      getStorageSync: (key: string) => values.get(key),
      setStorageSync: (key: string, value: unknown) => values.set(key, value),
      removeStorageSync: (key: string) => values.delete(key),
    }

    const adapter = new SupabaseMPAdapter()
    adapter.setItem('session', '{"access_token":"token"}')
    expect(adapter.getItem('session')).toBe('{"access_token":"token"}')
    adapter.removeItem('session')
    expect(adapter.getItem('session')).toBeNull()
  })

  it('normalizes legacy object values without double-parsing strings', () => {
    ;(globalThis as any).wx = {
      getStorageSync: () => ({ access_token: 'legacy' }),
      setStorageSync: jest.fn(),
      removeStorageSync: jest.fn(),
    }

    expect(new SupabaseMPAdapter().getItem('session')).toBe('{"access_token":"legacy"}')
  })
})
