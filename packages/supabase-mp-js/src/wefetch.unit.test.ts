import { wxFetch } from './wefetch'

describe('wxFetch', () => {
  afterEach(() => {
    delete (globalThis as any).wx
  })

  it('preserves JSON request bodies and exposes a fetch-compatible response', async () => {
    const request = jest.fn((options: any) => {
      queueMicrotask(() => {
        options.success({
          statusCode: 200,
          data: '{"ok":true}',
          header: { 'Content-Type': 'application/json', 'X-Trace': 'trace-id' },
          errMsg: 'request:ok',
        })
        options.complete({ errMsg: 'request:ok' })
      })
      return { abort: jest.fn() }
    })
    ;(globalThis as any).wx = { request }

    const response = await wxFetch('https://example.test/rest/v1/items', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: '{"name":"lure"}',
    })

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: '{"name":"lure"}',
        method: 'POST',
        header: expect.objectContaining({ authorization: 'Bearer token' }),
      })
    )
    expect(response.ok).toBe(true)
    expect(response.headers.get('x-trace')).toBe('trace-id')
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('maps AbortSignal to RequestTask.abort and rejects with AbortError', async () => {
    let requestOptions: any
    const abort = jest.fn(() => {
      requestOptions.fail({ errMsg: 'request:fail abort' })
      requestOptions.complete({ errMsg: 'request:fail abort' })
    })
    ;(globalThis as any).wx = {
      request: jest.fn((options: any) => {
        requestOptions = options
        return { abort }
      }),
    }

    const controller = new AbortController()
    const pending = wxFetch('https://example.test/slow', { signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' })
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('rejects an aborted request even when RequestTask.abort emits no callbacks', async () => {
    const abort = jest.fn()
    ;(globalThis as any).wx = {
      request: jest.fn(() => ({ abort })),
    }

    const controller = new AbortController()
    const pending = wxFetch('https://example.test/slow', { signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' })
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('rejects PATCH because wx.request does not document that method', async () => {
    const request = jest.fn()
    ;(globalThis as any).wx = { request }

    await expect(
      wxFetch('https://example.test/rest/v1/items?id=eq.1', {
        method: 'PATCH',
        body: '{"name":"updated"}',
      })
    ).rejects.toThrow('wx.request does not support HTTP method PATCH')
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects before scheduling an already-aborted request', async () => {
    const request = jest.fn()
    ;(globalThis as any).wx = { request }
    const controller = new AbortController()
    controller.abort()

    await expect(
      wxFetch('https://example.test/never', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).not.toHaveBeenCalled()
  })
})
