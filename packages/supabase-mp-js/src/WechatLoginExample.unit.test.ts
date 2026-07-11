import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

type User = {
  id: string
  email: string
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}

type Session = {
  access_token: string
  refresh_token: string
}

type AuthResult<T> = {
  data: T | null
  error: { code?: string; message: string } | null
}

type MockResponseInit = {
  status?: number
  headers?: Record<string, string>
}

class MockResponse {
  readonly status: number
  readonly headers: Record<string, string>
  private readonly body: string

  constructor(body: string, init: MockResponseInit = {}) {
    this.body = body
    this.status = init.status ?? 200
    this.headers = init.headers ?? {}
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.body) as unknown
  }
}

type Handler = (request: Request) => Promise<MockResponse>

type ExampleRuntime = {
  exampleSource: string
  handler: Handler
  fetchMock: jest.MockedFunction<(url: string) => Promise<MockResponse>>
  createClientMock: jest.Mock
  admin: {
    createUser: jest.Mock
    generateLink: jest.Mock
    updateUserById: jest.Mock
  }
  verifyOtp: jest.Mock
}

const worktreeRoot = resolve(__dirname, '../../../')
const readmePath = resolve(worktreeRoot, 'README.md')
const readme = readFileSync(readmePath, 'utf8')

function extractBunExample(source: string): string {
  const marker = '```typescript\n// functions/<projectRef>/wechat-login.ts'
  const start = source.indexOf(marker)
  if (start < 0) throw new Error('Bun wechat-login example not found')

  const codeStart = start + '```typescript\n'.length
  const codeEnd = source.indexOf('\n```', codeStart)
  if (codeEnd < 0) throw new Error('Bun wechat-login code fence is not closed')

  return source.slice(codeStart, codeEnd)
}

function evaluateExample(env: Record<string, string | undefined>): ExampleRuntime {
  const exampleSource = extractBunExample(readme)
  const compiled = transpileModule(exampleSource, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  })

  const admin = {
    createUser: jest.fn(),
    generateLink: jest.fn(),
    updateUserById: jest.fn(),
  }
  const verifyOtp = jest.fn()
  const client = { auth: { admin, verifyOtp } }
  const createClientMock = jest.fn(() => client)
  const fetchMock = jest.fn<Promise<MockResponse>, [string]>()
  fetchMock.mockResolvedValue(
    new MockResponse(JSON.stringify({ openid: 'openid-123', unionid: 'union-123' }))
  )

  const module = { exports: {} as Record<string, unknown> }
  const requireMock = (moduleName: string): unknown => {
    if (moduleName === '@supabase/supabase-js') return { createClient: createClientMock }
    throw new Error(`Unexpected module: ${moduleName}`)
  }
  const processMock = { env }
  const factory = new Function(
    'require',
    'module',
    'exports',
    'fetch',
    'process',
    'Response',
    `${compiled.outputText}\nreturn exports.default;`
  ) as (
    require: (moduleName: string) => unknown,
    module: { exports: Record<string, unknown> },
    exports: Record<string, unknown>,
    fetch: typeof fetchMock,
    process: { env: Record<string, string | undefined> },
    Response: typeof MockResponse
  ) => Handler

  const handler = factory(requireMock, module, module.exports, fetchMock, processMock, MockResponse)

  return { exampleSource, handler, fetchMock, createClientMock, admin, verifyOtp }
}

function requestWithCode(code = 'wx-code'): Request {
  return {
    method: 'POST',
    json: async () => ({ code }),
  } as Request
}

const baseEnv = {
  WECHAT_MINIPROGRAM_APP_ID: 'wx-app-id',
  WECHAT_MINIPROGRAM_APP_SECRET: 'wx-app-secret',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
}

function configureSuccessfulAuth(runtime: ExampleRuntime, userId = 'user-1'): void {
  const user: User = { id: userId, email: 'openid-123@wechat.com' }
  runtime.admin.createUser.mockResolvedValue({
    data: { user },
    error: null,
  } satisfies AuthResult<{ user: User }>)
  runtime.admin.generateLink.mockResolvedValue({
    data: { properties: { hashed_token: 'token-hash' }, user },
    error: null,
  } satisfies AuthResult<{ properties: { hashed_token: string }; user: User }>)
  runtime.verifyOtp.mockResolvedValue({
    data: { session: { access_token: 'access-token', refresh_token: 'refresh-token' }, user },
    error: null,
  } satisfies AuthResult<{ session: Session; user: User }>)
  runtime.admin.updateUserById.mockResolvedValue({ data: { user }, error: null })
}

describe('README Bun wechat-login example', () => {
  it('handles first login through an admin magic-link verification flow', async () => {
    const runtime = evaluateExample(baseEnv)
    configureSuccessfulAuth(runtime)

    const response = await runtime.handler(requestWithCode())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      data: {
        session: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          user: { id: 'user-1', email: 'openid-123@wechat.com' },
        },
        user: { id: 'user-1', email: 'openid-123@wechat.com' },
      },
    })
    expect(runtime.fetchMock).toHaveBeenCalledTimes(1)
    expect(runtime.createClientMock).toHaveBeenCalledTimes(1)
    expect(runtime.createClientMock).toHaveBeenCalledWith(
      baseEnv.SUPABASE_URL,
      baseEnv.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    )
    expect(runtime.admin.createUser).toHaveBeenCalledWith({
      email: 'openid-123@wechat.com',
      email_confirm: true,
      user_metadata: { openid: 'openid-123', unionid: 'union-123' },
      app_metadata: { provider: 'wechat', providers: ['wechat'] },
    })
    expect(runtime.admin.createUser.mock.calls[0][0]).not.toHaveProperty('password')
    expect(runtime.admin.generateLink).toHaveBeenCalledWith({
      type: 'magiclink',
      email: 'openid-123@wechat.com',
    })
    expect(runtime.verifyOtp).toHaveBeenCalledWith({
      type: 'magiclink',
      token_hash: 'token-hash',
    })
    expect(runtime.admin.updateUserById).toHaveBeenCalledWith('user-1', {
      user_metadata: { openid: 'openid-123', unionid: 'union-123' },
      app_metadata: { provider: 'wechat', providers: ['wechat'] },
    })
  })

  it('accepts only the user_already_exists duplicate branch and still signs in', async () => {
    const runtime = evaluateExample(baseEnv)
    const user: User = { id: 'existing-user', email: 'openid-123@wechat.com' }
    runtime.admin.createUser.mockResolvedValue({
      data: null,
      error: { code: 'user_already_exists', message: 'User already exists' },
    })
    runtime.admin.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'existing-token-hash' }, user },
      error: null,
    })
    runtime.verifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: 'existing-access',
          refresh_token: 'existing-refresh',
          user,
        },
        user,
      },
      error: null,
    })
    runtime.admin.updateUserById.mockResolvedValue({ data: { user }, error: null })

    const response = await runtime.handler(requestWithCode())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      data: {
        session: { access_token: 'existing-access', refresh_token: 'existing-refresh', user },
        user,
      },
    })
    expect(runtime.admin.generateLink).toHaveBeenCalledTimes(1)
    expect(runtime.verifyOtp).toHaveBeenCalledWith({
      type: 'magiclink',
      token_hash: 'existing-token-hash',
    })
  })

  it('does not depend on JWT_SECRET rotation or password sign-in', async () => {
    const oldSecretRuntime = evaluateExample({ ...baseEnv, JWT_SECRET: 'old-secret' })
    configureSuccessfulAuth(oldSecretRuntime)
    const newSecretRuntime = evaluateExample({ ...baseEnv, JWT_SECRET: 'new-secret' })
    configureSuccessfulAuth(newSecretRuntime)

    const oldResponse = await oldSecretRuntime.handler(requestWithCode())
    const newResponse = await newSecretRuntime.handler(requestWithCode())

    expect(await oldResponse.json()).toEqual(await newResponse.json())
    expect(oldSecretRuntime.exampleSource).not.toMatch(/JWT_SECRET/)
    expect(oldSecretRuntime.exampleSource).not.toMatch(/signInWithPassword/)
    expect(oldSecretRuntime.exampleSource).not.toMatch(/:\s*any\b/)
  })

  it('validates required environment before contacting WeChat', async () => {
    const runtime = evaluateExample({ ...baseEnv, SUPABASE_SERVICE_ROLE_KEY: undefined })
    configureSuccessfulAuth(runtime)

    const response = await runtime.handler(requestWithCode())
    const body = (await response.json()) as { error?: string }

    expect(response.status).toBe(400)
    expect(body.error).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(runtime.fetchMock).not.toHaveBeenCalled()
    expect(runtime.createClientMock).not.toHaveBeenCalled()
  })

  it('stops before generateLink for non-duplicate createUser failures', async () => {
    const runtime = evaluateExample(baseEnv)
    runtime.admin.createUser.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('create failed'), { code: 'unexpected_failure' }),
    })

    const response = await runtime.handler(requestWithCode())
    const body = (await response.json()) as { error?: string }

    expect(response.status).toBe(400)
    expect(body.error).toBe('create failed')
    expect(runtime.admin.generateLink).not.toHaveBeenCalled()
    expect(runtime.verifyOtp).not.toHaveBeenCalled()
  })

  it('rejects a WeChat response that is not an object with an openid', async () => {
    const runtime = evaluateExample(baseEnv)
    runtime.fetchMock.mockResolvedValue(new MockResponse(JSON.stringify({ unionid: 'union-123' })))

    const response = await runtime.handler(requestWithCode())
    const body = (await response.json()) as { error?: string }

    expect(response.status).toBe(400)
    expect(body.error).toContain('openid')
    expect(runtime.admin.createUser).not.toHaveBeenCalled()
  })

  it('documents WeChat magic-link authentication in the comparison table', () => {
    expect(readme).toMatch(/\|\s*认证方式\s*\|.*\|.*magic link.*verifyOtp/i)
  })
})
