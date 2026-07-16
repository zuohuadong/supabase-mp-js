import { FunctionsHttpError } from '@supabase/supabase-js'
import { installWechatAuth, type WechatAuthExtension } from './wechat-auth'

function createMockClient(invokeError: unknown) {
  const auth = {
    setSession: jest.fn(),
  } as unknown as {
    setSession: jest.Mock
  } & Partial<WechatAuthExtension>
  const client = {
    auth,
    functions: {
      invoke: jest.fn().mockResolvedValue({ data: null, error: invokeError }),
    },
  }

  installWechatAuth(client as unknown as Parameters<typeof installWechatAuth>[0])
  return auth
}

describe('installWechatAuth', () => {
  it('returns the JSON error message from a failed Edge Function response', async () => {
    const context = new Response(JSON.stringify({ error: 'WeChat login code has expired' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
    const auth = createMockClient(new FunctionsHttpError(context))

    const result = await auth.signInWithWechat!({ code: 'expired-code' })

    expect(result.error).toMatchObject({
      message: 'WeChat login code has expired',
      code: 'wechat_function_error',
    })
    expect(await context.json()).toEqual({ error: 'WeChat login code has expired' })
  })

  it('returns a plain-text Edge Function error response', async () => {
    const context = new Response('WeChat provider is unavailable', { status: 503 })
    const auth = createMockClient(new FunctionsHttpError(context))

    const result = await auth.signInWithWechat!({ code: 'wechat-code' })

    expect(result.error).toMatchObject({
      message: 'WeChat provider is unavailable',
      code: 'wechat_function_error',
    })
  })
})
