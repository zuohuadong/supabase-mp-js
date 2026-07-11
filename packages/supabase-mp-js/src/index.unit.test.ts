import { createClient } from './index'

function installWxRuntime() {
  const storage = new Map<string, unknown>()
  const lifecycle = { show: [] as Array<() => void>, hide: [] as Array<() => void> }
  const uploadFile = jest.fn((options: any) => {
    options.success({
      statusCode: 200,
      data: '{"Id":"object-id","Key":"media/avatar.png"}',
      errMsg: 'uploadFile:ok',
    })
    return { abort: jest.fn() }
  })

  ;(globalThis as any).wx = {
    request: jest.fn(),
    uploadFile,
    connectSocket: jest.fn(),
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    onAppShow: (callback: () => void) => lifecycle.show.push(callback),
    onAppHide: (callback: () => void) => lifecycle.hide.push(callback),
  }

  return { storage, lifecycle, uploadFile }
}

describe('createClient', () => {
  afterEach(() => {
    delete (globalThis as any).wx
    delete (globalThis as any).window
    delete (globalThis as any).document
    jest.restoreAllMocks()
  })

  it('creates the official v2 client with WeChat auth and lifecycle extensions', () => {
    const { lifecycle } = installWxRuntime()
    const client = createClient('https://project.example.test', 'anon-key')

    expect(client.auth.signInWithWechat).toBeInstanceOf(Function)
    expect(lifecycle.show).toHaveLength(1)
    expect(lifecycle.hide).toHaveLength(1)

    const start = jest.spyOn(client.auth, 'startAutoRefresh').mockResolvedValue()
    const stop = jest.spyOn(client.auth, 'stopAutoRefresh').mockResolvedValue()
    jest
      .spyOn(client.auth, 'getSession')
      .mockResolvedValue({ data: { session: null }, error: null })
    lifecycle.show[0]()
    lifecycle.hide[0]()
    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('persists a WeChat-issued refreshable session through official auth.setSession', async () => {
    installWxRuntime()
    const client = createClient('https://project.example.test', 'anon-key')
    Object.defineProperty(client, 'functions', {
      value: {
        invoke: jest.fn().mockResolvedValue({
          data: {
            data: {
              session: { access_token: 'access-token', refresh_token: 'refresh-token' },
              user: { id: 'user-id' },
            },
          },
          error: null,
        }),
      },
    })
    const setSession = jest.spyOn(client.auth, 'setSession').mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    })

    await client.auth.signInWithWechat({ code: 'wechat-code' })
    expect(setSession).toHaveBeenCalledWith({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    })
  })

  it('uses wx.uploadFile for local Storage paths', async () => {
    const { uploadFile } = installWxRuntime()
    const client = createClient('https://project.example.test', 'anon-key')
    jest.spyOn(client.auth, 'getSession').mockResolvedValue({
      data: { session: { access_token: 'user-token' } as any },
      error: null,
    })

    const result = await client.storage
      .from('media')
      .upload('avatars/user.png', 'wxfile://tmp/avatar.png', {
        contentType: 'image/png',
        metadata: { source: 'wechat' },
        headers: { 'x-custom': 'value' },
      })

    expect(result.error).toBeNull()
    expect(result.data).toEqual({
      id: 'object-id',
      path: 'avatars/user.png',
      fullPath: 'media/avatar.png',
    })
    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://project.example.test/storage/v1/object/media/avatars/user.png',
        filePath: 'wxfile://tmp/avatar.png',
        header: expect.objectContaining({
          authorization: 'Bearer user-token',
          apikey: 'anon-key',
          'x-custom': 'value',
          'x-upsert': 'false',
        }),
        formData: expect.objectContaining({
          cacheControl: '3600',
          metadata: '{"source":"wechat"}',
        }),
      })
    )
  })

  it('uses accessToken without touching the unavailable auth namespace', async () => {
    const { uploadFile } = installWxRuntime()
    const accessToken = jest.fn().mockResolvedValue('third-party-token')
    const client = createClient('https://project.example.test', 'anon-key', { accessToken })

    if (false) {
      // @ts-expect-error Third-party accessToken clients do not install the WeChat Auth extension.
      client.auth.signInWithWechat
    }

    await client.storage.from('media').upload('avatar.png', 'wxfile://tmp/avatar.png')

    expect(accessToken).toHaveBeenCalled()
    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        header: expect.objectContaining({ authorization: 'Bearer third-party-token' }),
      })
    )
  })

  it('rejects local Storage update instead of silently sending POST', async () => {
    const { uploadFile } = installWxRuntime()
    const client = createClient('https://project.example.test', 'anon-key')

    const result = await client.storage
      .from('media')
      .update('avatar.png', 'wxfile://tmp/avatar.png', {
        upsert: true,
      })

    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ statusCode: 'wx_local_file_update_unsupported' })
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('honors throwOnError for unsupported local Storage update', async () => {
    const { uploadFile } = installWxRuntime()
    const client = createClient('https://project.example.test', 'anon-key')
    const bucket = client.storage.from('media').throwOnError()

    await expect(bucket.update('avatar.png', 'wxfile://tmp/avatar.png')).rejects.toMatchObject({
      statusCode: 'wx_local_file_update_unsupported',
    })
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('returns StorageUnknownError for transport failures', async () => {
    installWxRuntime()
    ;(globalThis as any).wx.uploadFile = jest.fn((options: any) => {
      options.fail({ errMsg: 'uploadFile:fail timeout' })
      return { abort: jest.fn() }
    })
    const client = createClient('https://project.example.test', 'anon-key')
    jest.spyOn(client.auth, 'getSession').mockResolvedValue({
      data: { session: { access_token: 'user-token' } as any },
      error: null,
    })

    const result = await client.storage
      .from('media')
      .upload('avatar.png', 'wxfile://tmp/avatar.png')

    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ name: 'StorageUnknownError' })
  })

  it('rejects malformed Storage success payloads', async () => {
    installWxRuntime()
    ;(globalThis as any).wx.uploadFile = jest.fn((options: any) => {
      options.success({ statusCode: 200, data: '{}', errMsg: 'uploadFile:ok' })
      return { abort: jest.fn() }
    })
    const client = createClient('https://project.example.test', 'anon-key')
    jest.spyOn(client.auth, 'getSession').mockResolvedValue({
      data: { session: { access_token: 'user-token' } as any },
      error: null,
    })

    const result = await client.storage
      .from('media')
      .upload('avatar.png', 'wxfile://tmp/avatar.png')

    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ name: 'StorageUnknownError' })
  })

  it('applies bucket and per-upload headers case-insensitively', async () => {
    const { uploadFile } = installWxRuntime()
    const client = createClient('https://project.example.test', 'anon-key')
    jest.spyOn(client.auth, 'getSession').mockResolvedValue({
      data: { session: { access_token: 'user-token' } as any },
      error: null,
    })
    const bucket = client.storage.from('media').setHeader('X-Custom', 'bucket')

    await bucket.upload('//avatars//user.png/', 'wxfile://tmp/avatar.png', {
      headers: { 'x-CUSTOM': 'upload' },
    })

    const call = uploadFile.mock.calls[0]?.[0]
    expect(call.url).toBe('https://project.example.test/storage/v1/object/media/avatars/user.png')
    expect(call.header['x-custom']).toBe('upload')
    expect(
      Object.keys(call.header).filter((name) => name.toLowerCase() === 'x-custom')
    ).toHaveLength(1)
  })

  it('does not treat a browser wx shim as the WeChat JSCore runtime', () => {
    const lifecycle = { show: [] as Array<() => void>, hide: [] as Array<() => void> }
    ;(globalThis as any).window = {}
    ;(globalThis as any).document = {}
    ;(globalThis as any).wx = {
      request: jest.fn(),
      onAppShow: (callback: () => void) => lifecycle.show.push(callback),
      onAppHide: (callback: () => void) => lifecycle.hide.push(callback),
    }

    createClient('https://project.example.test', 'anon-key', {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    expect(lifecycle.show).toHaveLength(0)
    expect(lifecycle.hide).toHaveLength(0)
  })

  it('builds a native-equivalent PostgREST URL through wx.request with fallbacks', async () => {
    const nativePlatform = {
      URL: globalThis.URL,
      URLSearchParams: globalThis.URLSearchParams,
      Headers: globalThis.Headers,
      AbortController: globalThis.AbortController,
      AbortSignal: globalThis.AbortSignal,
    }
    const request = jest.fn((options: any) => {
      queueMicrotask(() => {
        options.success({
          statusCode: 200,
          data: '[]',
          header: { 'Content-Type': 'application/json' },
          errMsg: 'request:ok',
        })
        options.complete({ errMsg: 'request:ok' })
      })
      return { abort: jest.fn() }
    })

    try {
      Object.assign(globalThis, {
        URL: undefined,
        URLSearchParams: undefined,
        Headers: undefined,
        AbortController: undefined,
        AbortSignal: undefined,
      })
      const storage = new Map<string, unknown>()
      ;(globalThis as any).wx = {
        request,
        getStorageSync: (key: string) => storage.get(key),
        setStorageSync: (key: string, value: unknown) => storage.set(key, value),
        removeStorageSync: (key: string) => storage.delete(key),
      }

      const client = createClient('https://project.supabase.co', 'anon-key', {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      await client
        .from('lures')
        .select('id, name')
        .eq('name', '铁板 lure')
        .order('created_at', { ascending: false })

      const expected = new nativePlatform.URL('https://project.supabase.co/rest/v1/lures')
      expected.searchParams.set('select', 'id,name')
      expected.searchParams.append('name', 'eq.铁板 lure')
      expected.searchParams.set('order', 'created_at.desc')
      expect(request).toHaveBeenCalledTimes(1)
      expect(request.mock.calls[0][0].url).toBe(expected.href)
    } finally {
      Object.assign(globalThis, nativePlatform)
    }
  })
})
