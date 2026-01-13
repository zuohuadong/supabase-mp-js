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

      const projectUrl = this.url.replace(/\/auth\/v1$/, '')
      const functionUrl = `${projectUrl}/functions/v1/${functionName}`

      const res = await this.fetch(functionUrl, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
        ...options,
      })

      const responseData = (await res.json()) as WechatLoginResponse

      if (!res.ok || responseData.error) {
        return {
          data: { user: null, session: null },
          error: responseData.error || new Error('WeChat login failed'),
        }
      }

      const { session, user } = responseData.data

      if (session) {
        await this._saveSession(session)
        this._notifyAllSubscribers('SIGNED_IN', session)
      }

      return { data: { user, session }, error: null }
    } catch (error) {
      if (isAuthError(error)) {
        return { data: { user: null, session: null }, error }
      }
      throw error
    }
  }
}
