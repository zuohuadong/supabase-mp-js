import {
  AuthError,
  FunctionsHttpError,
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

function extractErrorBodyMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const message = value.trim()
    if (!message) return null

    try {
      return extractErrorBodyMessage(JSON.parse(message)) ?? message
    } catch {
      return message
    }
  }

  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  for (const key of ['message', 'error', 'error_description']) {
    const message = extractErrorBodyMessage(body[key])
    if (message) return message
  }
  return null
}

async function functionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : 'Edge Function request failed'

  if (!(error instanceof FunctionsHttpError)) return fallback

  try {
    const context = error.context as Partial<Response> | undefined
    const response = typeof context?.clone === 'function' ? context.clone() : context
    if (typeof response?.text === 'function') {
      return extractErrorBodyMessage(await response.text()) ?? fallback
    }
    if (typeof response?.json === 'function') {
      return extractErrorBodyMessage(await response.json()) ?? fallback
    }
  } catch {
    // Keep the SDK's original message when the response body is unavailable or malformed.
  }

  return fallback
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
      return authFailure(await functionErrorMessage(invokeError), 'wechat_function_error')
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
