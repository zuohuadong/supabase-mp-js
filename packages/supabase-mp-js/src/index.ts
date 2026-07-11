import {
  createClient as createSupabaseClient,
  type SupabaseClient,
  type SupabaseClientOptions,
  type WebSocketLikeConstructor,
} from '@supabase/supabase-js'
import { ensureSupabasePlatformGlobals } from './platform'
import { SupabaseMPAdapter } from './SupabaseMPAdapter'
import { installWxStorageUpload } from './storage'
import { WxWebSocket } from './WxWebSocket'
import { installWechatAuth, type WechatAuthExtension } from './wechat-auth'
import { wxFetch } from './wefetch'

ensureSupabasePlatformGlobals()

export type SupabaseMPClient<
  Database = any,
  SchemaNameOrClientOptions extends
    (string & keyof Omit<Database, '__InternalSupabase'>) | { PostgrestVersion: string } =
    'public' extends keyof Omit<Database, '__InternalSupabase'>
      ? 'public'
      : string & keyof Omit<Database, '__InternalSupabase'>,
  SchemaName extends string & keyof Omit<Database, '__InternalSupabase'> =
    SchemaNameOrClientOptions extends string & keyof Omit<Database, '__InternalSupabase'>
      ? SchemaNameOrClientOptions
      : 'public' extends keyof Omit<Database, '__InternalSupabase'>
        ? 'public'
        : string & keyof Omit<Omit<Database, '__InternalSupabase'>, '__InternalSupabase'>,
> = SupabaseClient<Database, SchemaNameOrClientOptions, SchemaName> & {
  auth: SupabaseClient<Database, SchemaNameOrClientOptions, SchemaName>['auth'] &
    WechatAuthExtension
}

function isWechatRuntime(): boolean {
  const browser = typeof window !== 'undefined' && typeof document !== 'undefined'
  return !browser && typeof wx !== 'undefined' && typeof wx.request === 'function'
}

type AuthLifecycleClient = Pick<SupabaseClient, 'auth'>

type ThirdPartyOptions<SchemaName extends string> = SupabaseClientOptions<SchemaName> & {
  accessToken: NonNullable<SupabaseClientOptions<SchemaName>['accessToken']>
}

type SupabaseAuthOptions<SchemaName extends string> = SupabaseClientOptions<SchemaName> & {
  accessToken?: undefined
}

function installAuthLifecycle(client: AuthLifecycleClient): void {
  if (!isWechatRuntime()) return

  if (typeof wx.onAppShow === 'function') {
    wx.onAppShow(() => {
      client.auth.startAutoRefresh()
      void client.auth.getSession()
    })
  }
  if (typeof wx.onAppHide === 'function') {
    wx.onAppHide(() => client.auth.stopAutoRefresh())
  }
}

/**
 * Creates an official Supabase v2 client with WeChat-native networking,
 * storage, realtime transport and local-file upload support.
 */
export function createClient<
  Database = any,
  SchemaNameOrClientOptions extends
    (string & keyof Omit<Database, '__InternalSupabase'>) | { PostgrestVersion: string } =
    'public' extends keyof Omit<Database, '__InternalSupabase'>
      ? 'public'
      : string & keyof Omit<Database, '__InternalSupabase'>,
  SchemaName extends string & keyof Omit<Database, '__InternalSupabase'> =
    SchemaNameOrClientOptions extends string & keyof Omit<Database, '__InternalSupabase'>
      ? SchemaNameOrClientOptions
      : 'public' extends keyof Omit<Database, '__InternalSupabase'>
        ? 'public'
        : string & keyof Omit<Omit<Database, '__InternalSupabase'>, '__InternalSupabase'>,
>(
  supabaseUrl: string,
  supabaseKey: string,
  options: ThirdPartyOptions<SchemaName>
): SupabaseClient<Database, SchemaNameOrClientOptions, SchemaName>
export function createClient<
  Database = any,
  SchemaNameOrClientOptions extends
    (string & keyof Omit<Database, '__InternalSupabase'>) | { PostgrestVersion: string } =
    'public' extends keyof Omit<Database, '__InternalSupabase'>
      ? 'public'
      : string & keyof Omit<Database, '__InternalSupabase'>,
  SchemaName extends string & keyof Omit<Database, '__InternalSupabase'> =
    SchemaNameOrClientOptions extends string & keyof Omit<Database, '__InternalSupabase'>
      ? SchemaNameOrClientOptions
      : 'public' extends keyof Omit<Database, '__InternalSupabase'>
        ? 'public'
        : string & keyof Omit<Omit<Database, '__InternalSupabase'>, '__InternalSupabase'>,
>(
  supabaseUrl: string,
  supabaseKey: string,
  options?: SupabaseAuthOptions<SchemaName>
): SupabaseMPClient<Database, SchemaNameOrClientOptions, SchemaName>
export function createClient<
  Database = any,
  SchemaNameOrClientOptions extends
    (string & keyof Omit<Database, '__InternalSupabase'>) | { PostgrestVersion: string } =
    'public' extends keyof Omit<Database, '__InternalSupabase'>
      ? 'public'
      : string & keyof Omit<Database, '__InternalSupabase'>,
  SchemaName extends string & keyof Omit<Database, '__InternalSupabase'> =
    SchemaNameOrClientOptions extends string & keyof Omit<Database, '__InternalSupabase'>
      ? SchemaNameOrClientOptions
      : 'public' extends keyof Omit<Database, '__InternalSupabase'>
        ? 'public'
        : string & keyof Omit<Omit<Database, '__InternalSupabase'>, '__InternalSupabase'>,
>(
  supabaseUrl: string,
  supabaseKey: string,
  options: SupabaseClientOptions<SchemaName>
): SupabaseClient<Database, SchemaNameOrClientOptions, SchemaName>
export function createClient<
  Database = any,
  SchemaNameOrClientOptions extends
    (string & keyof Omit<Database, '__InternalSupabase'>) | { PostgrestVersion: string } =
    'public' extends keyof Omit<Database, '__InternalSupabase'>
      ? 'public'
      : string & keyof Omit<Database, '__InternalSupabase'>,
  SchemaName extends string & keyof Omit<Database, '__InternalSupabase'> =
    SchemaNameOrClientOptions extends string & keyof Omit<Database, '__InternalSupabase'>
      ? SchemaNameOrClientOptions
      : 'public' extends keyof Omit<Database, '__InternalSupabase'>
        ? 'public'
        : string & keyof Omit<Omit<Database, '__InternalSupabase'>, '__InternalSupabase'>,
>(
  supabaseUrl: string,
  supabaseKey: string,
  options: SupabaseClientOptions<SchemaName> = {}
): SupabaseClient<Database, SchemaNameOrClientOptions, SchemaName> {
  ensureSupabasePlatformGlobals()
  const wechat = isWechatRuntime()
  const customFetch = options.global?.fetch || (wechat ? wxFetch : undefined)
  const configuredTransport = options.realtime?.transport
  const fallbackTransport: WebSocketLikeConstructor | undefined =
    configuredTransport ||
    (wechat && typeof wx.connectSocket === 'function' ? WxWebSocket : undefined)

  const client = createSupabaseClient<Database, SchemaNameOrClientOptions, SchemaName>(
    supabaseUrl,
    supabaseKey,
    {
      ...options,
      global: {
        ...options.global,
        ...(customFetch ? { fetch: customFetch } : {}),
        headers: options.global?.headers || {},
      },
      auth: {
        ...options.auth,
        ...(wechat && !options.auth?.storage ? { storage: new SupabaseMPAdapter() } : {}),
        ...(wechat && options.auth?.detectSessionInUrl == null
          ? { detectSessionInUrl: false }
          : {}),
      },
      realtime: {
        ...options.realtime,
        ...(fallbackTransport ? { transport: fallbackTransport } : {}),
      },
    }
  )

  if (wechat) installWxStorageUpload(client, supabaseUrl, supabaseKey, options.accessToken)
  if (!options.accessToken) {
    installWechatAuth(client)
    installAuthLifecycle(client)
  }
  return client
}

export { SupabaseMPAdapter } from './SupabaseMPAdapter'
export { WxWebSocket } from './WxWebSocket'
export { wxFetch } from './wefetch'
export { version } from './lib/version'
export type { SignInWithWechatParams, WechatAuthExtension } from './wechat-auth'
export * from '@supabase/supabase-js'
