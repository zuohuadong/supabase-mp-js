import AbortControllerPolyfill, { AbortSignal as AbortSignalPolyfill } from 'abort-controller'
import { Headers as HeadersPolyfill } from 'headers-polyfill'
import {
  URL as URLPolyfill,
  URLSearchParams as URLSearchParamsPolyfill,
} from 'whatwg-url-without-unicode'

type RuntimeGlobal = typeof globalThis & {
  URL: typeof URL
  URLSearchParams: typeof URLSearchParams
  Headers: typeof Headers
  AbortController: typeof AbortController
  AbortSignal: typeof AbortSignal
}

/**
 * Installs only the web-platform globals used by the official Supabase SDK.
 * Existing native implementations are always preserved.
 */
export function ensureSupabasePlatformGlobals(): void {
  const runtime = globalThis as RuntimeGlobal

  if (typeof runtime.URL !== 'function') runtime.URL = URLPolyfill
  if (typeof runtime.URLSearchParams !== 'function') {
    runtime.URLSearchParams = URLSearchParamsPolyfill
  }
  if (typeof runtime.Headers !== 'function') {
    runtime.Headers = HeadersPolyfill
  }
  if (typeof runtime.AbortController !== 'function') {
    runtime.AbortController = AbortControllerPolyfill as unknown as typeof AbortController
  }
  if (typeof runtime.AbortSignal !== 'function') {
    runtime.AbortSignal = AbortSignalPolyfill as unknown as typeof AbortSignal
  }
}
