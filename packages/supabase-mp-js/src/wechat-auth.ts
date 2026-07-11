import {
  AuthError,
  type AuthResponse,
  type FunctionInvokeOptions,
  type SupabaseClient,
} from '@supabase/supabase-js'

export interface SignInWithWechatParams {
  code: string
  functionName?: string
  invokeOptions?: Omit<FunctionInvokeOptions, 'body'>
}

export interface WechatAuthExtension {
  signInWithWechat(params: SignInWithWechatParams): Promise<AuthResponse>
}

type WechatAuthClient = Pick<SupabaseClient, 'auth' | 'functions'>

/** Installs the convenience login method without forking GoTrue internals. */
function authFailure(message: string, code: string): AuthResponse {
  return {
    data: { user: null, session: null },
    error: new AuthError(message, 400, code),
  }
}

function extractSession(value: unknown): { access_token: string; refresh_token: string } | null {
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const payload =
    root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root
  const session = payload.session
  if (!session || typeof session !== 'object') return null
  const record = session as Record<string, unknown>
  return typeof record.access_token === 'string' && typeof record.refresh_token === 'string'
    ? { access_token: record.access_token, refresh_token: record.refresh_token }
    : null
}

export function installWechatAuth(client: WechatAuthClient): void {
  const auth = client.auth as typeof client.auth & Partial<WechatAuthExtension>
  if (auth.signInWithWechat) return

  auth.signInWithWechat = async ({ code, functionName = 'wechat-login', invokeOptions = {} }) => {
    if (!code || !code.trim()) {
      return authFailure('WeChat login code is required', 'wechat_code_required')
    }

    const { data: functionResponse, error: invokeError } = await client.functions.invoke(
      functionName,
      {
        ...invokeOptions,
        body: { code },
      }
    )
    if (invokeError) {
      return authFailure(invokeError.message, 'wechat_function_error')
    }

    const session = extractSession(functionResponse)
    if (!session) {
      return authFailure(
        'WeChat login response did not include a refreshable session',
        'wechat_session_missing'
      )
    }

    return client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })
  }
}
