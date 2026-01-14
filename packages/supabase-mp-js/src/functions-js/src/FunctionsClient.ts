import { resolveFetch } from './helper'
import {
  Fetch,
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  FunctionsResponse,
  FunctionInvokeOptions,
} from './types'

export class FunctionsClient {
  protected url: string
  protected headers: Record<string, string>
  protected fetch: Fetch
  protected customFetch?: Fetch

  constructor(
    url: string,
    {
      headers = {},
      customFetch,
    }: {
      headers?: Record<string, string>
      customFetch?: Fetch
    } = {}
  ) {
    this.url = url
    this.headers = headers
    this.customFetch = customFetch
    this.fetch = resolveFetch(customFetch)
  }

  /**
   * Updates the authorization header
   * @param token - the new jwt token sent in the authorisation header
   */
  setAuth(token: string) {
    this.headers.Authorization = `Bearer ${token}`
  }

  /**
   * Invokes a function
   * @param functionName - the name of the function to invoke
   */
  async invoke<T = any>(
    functionName: string,
    invokeOptions: FunctionInvokeOptions = {}
  ): Promise<FunctionsResponse<T>> {
    try {
      const { headers, method, body: functionArgs } = invokeOptions

      let _headers: Record<string, string> = {}
      let body: any
      if (
        functionArgs &&
        ((headers && !Object.prototype.hasOwnProperty.call(headers, 'Content-Type')) || !headers)
      ) {
        if (
          (typeof Blob !== 'undefined' && functionArgs instanceof Blob) ||
          functionArgs instanceof ArrayBuffer
        ) {
          // will work for File as File inherits Blob
          // also works for ArrayBuffer as it is the same underlying structure as a Blob
          _headers['Content-Type'] = 'application/octet-stream'
          body = functionArgs
        } else if (typeof functionArgs === 'string') {
          // plain string
          _headers['Content-Type'] = 'text/plain'
          body = functionArgs
        } else if (typeof FormData !== 'undefined' && functionArgs instanceof FormData) {
          // don't set content-type headers
          // Request will automatically add the right boundary value
          body = functionArgs
        } else {
          // default, assume this is JSON
          _headers['Content-Type'] = 'application/json'
          body = JSON.stringify(functionArgs)
        }
      }

      // Use customFetch if available (with auth), otherwise use resolved fetch
      const fetchFn = this.customFetch || this.fetch
      const functionUrl = `${this.url}/${functionName}`

      // WeChat Mini Program Check
      // @ts-ignore
      if (typeof wx !== 'undefined' && typeof wx.request === 'function') {
        return new Promise((resolve) => {
          // @ts-ignore
          wx.request({
            url: functionUrl,
            method: (method || 'POST') as any,
            header: { ..._headers, ...this.headers, ...headers },
            data: body,
            responseType: 'text', // Get raw text to handle parsing manually based on Content-Type if needed
            dataType: 'text', // Prevent auto-JSON parse to align with standard fetch behavior of explicit .json() check?
            // Actually, to make it robust, let's let wx parse JSON if it looks like JSON, but we must check statusCode.
            // If we use 'text', we must JSON.parse ourselves.
            // Let's use 'text' to be safe against "success but error" auto-parsing quirks.
            success: (res: any) => {
              // Handle 200-299 success
              if (res.statusCode >= 200 && res.statusCode < 300) {
                // Try to parse data if content-type is json
                const contentType =
                  (res.header && (res.header['Content-Type'] || res.header['content-type'])) ||
                  'text/plain'
                let data = res.data
                if (typeof data === 'string' && contentType.includes('application/json')) {
                  try {
                    data = JSON.parse(data)
                  } catch (e) {
                    // ignore, keep as string
                  }
                }
                resolve({ data, error: null })
              } else {
                // Handle Error
                // rpc often returns error details in body
                const contentType =
                  (res.header && (res.header['Content-Type'] || res.header['content-type'])) ||
                  'text/plain'
                let errorData = res.data
                if (typeof errorData === 'string' && contentType.includes('application/json')) {
                  try {
                    errorData = JSON.parse(errorData)
                  } catch (e) {}
                }

                resolve({
                  data: null,
                  error: {
                    name: 'FunctionsHttpError',
                    message:
                      errorData && typeof errorData === 'object' && errorData.error
                        ? errorData.error
                        : res.errMsg || 'Unknown error',
                    status: res.statusCode,
                    context: res,
                  },
                })
              }
            },
            fail: (err: any) => {
              resolve({
                data: null,
                error: {
                  name: 'FunctionsFetchError',
                  message: err.errMsg || 'Network request failed',
                  cause: err,
                },
              })
            },
          })
        })
      }

      const response = await fetchFn(functionUrl, {
        method: method || 'POST',
        // ... existing fetch logic
        // headers priority is (high to low):
        // 1. invoke-level headers
        // 2. client-level headers
        // 3. default Content-Type header
        headers: { ..._headers, ...this.headers, ...headers },
        body,
      }).catch((fetchError) => {
        throw new FunctionsFetchError(fetchError)
      })

      const isRelayError = response.headers.get('x-relay-error')
      if (isRelayError && isRelayError === 'true') {
        throw new FunctionsRelayError(response)
      }

      if (!response.ok) {
        throw new FunctionsHttpError(response)
      }

      let responseType = (response.headers.get('Content-Type') ?? 'text/plain').split(';')[0].trim()
      let data: any
      if (responseType === 'application/json') {
        data = await response.json()
      } else if (responseType === 'application/octet-stream') {
        data = await response.blob()
      } else if (responseType === 'multipart/form-data') {
        data = await response.formData()
      } else {
        // default to text
        data = await response.text()
      }

      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  }
}
