import { GoTrueClient, AuthResponse, isAuthError } from '../gotrue-js/src/index'
import { SupabaseAuthClientOptions } from './types'

type WechatLoginResponse = {
  data: {
    user: any
    session: any
  }
  error?: any
}

declare const wx: any

export class SupabaseAuthClient extends GoTrueClient {
  constructor(options: SupabaseAuthClientOptions) {
    super(options)

    if (typeof wx !== 'undefined' && typeof wx.onAppShow === 'function') {
      wx.onAppShow(async () => {
        await this._recoverAndRefresh()
        if (this.autoRefreshToken) {
          this.startAutoRefresh()
        }
      })
    }
  }

  /**
   * Initializes a WeChat login flow.
   *
   * @param params.code The authorization code from wx.login()
   * @param params.functionName Optional. The name of the Edge Function to call. Defaults to 'wechat-login'.
   * @param params.options Optional. fetch options.
   */
  async signInWithWechat(params: {
    code: string
    functionName?: string
    options?: any
  }): Promise<AuthResponse> {
    try {
      const { code, functionName = 'wechat-login', options } = params

      console.log('[signInWithWechat] Starting WeChat login, code:', code.substring(0, 10) + '...')

      const projectUrl = this.url.replace(/\/auth\/v1$/, '')
      const functionUrl = `${projectUrl}/functions/v1/${functionName}`

      console.log('[signInWithWechat] Function URL:', functionUrl)

      const res = await this.fetch(functionUrl, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
        ...options,
      })

      console.log('[signInWithWechat] Response status:', res.status, res.statusText)

      const responseData = (await res.json()) as WechatLoginResponse

      console.log('[signInWithWechat] Response data:', {
        hasUser: !!responseData.data?.user,
        hasSession: !!responseData.data?.session,
        hasError: !!responseData.error,
      })

      if (!res.ok || responseData.error) {
        console.error('[signInWithWechat] Login failed:', responseData.error)
        return {
          data: { user: null, session: null },
          error: responseData.error || new Error('WeChat login failed'),
        }
      }

      const { session, user } = responseData.data

      if (session) {
        console.log('[signInWithWechat] Session received, saving...', {
          access_token: session.access_token?.substring(0, 20) + '...',
          expires_at: session.expires_at,
          expires_in: session.expires_in,
        })

        await this._saveSession(session)
        console.log('[signInWithWechat] Session saved successfully')

        this._notifyAllSubscribers('SIGNED_IN', session)
        console.log('[signInWithWechat] Subscribers notified')
      } else {
        console.warn('[signInWithWechat] No session in response!')
      }

      console.log('[signInWithWechat] Login completed successfully')
      return { data: { user, session }, error: null }
    } catch (error) {
      console.error('[signInWithWechat] Exception caught:', error)
      if (isAuthError(error)) {
        return { data: { user: null, session: null }, error }
      }
      throw error
    }
  }
}
