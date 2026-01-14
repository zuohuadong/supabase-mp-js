import SupabaseClient from './SupabaseClient'
import type { GenericSchema, SupabaseClientOptions } from './lib/types'
export { SupabaseMPAdapter } from './SupabaseMPAdapter'
import { SupabaseMPAdapter } from './SupabaseMPAdapter'

export * from './gotrue-js/src/index'
export type { User as AuthUser, Session as AuthSession } from './gotrue-js/src/index'
export type {
  PostgrestResponse,
  PostgrestSingleResponse,
  PostgrestMaybeSingleResponse,
  PostgrestError,
} from './postgrest-js/src/index'
export {
  FunctionsHttpError,
  FunctionsFetchError,
  FunctionsRelayError,
  FunctionsError,
} from './functions-js/src/index'
export * from './realtime-js/src/index'
export * from './storage-js/src/packages/ResumableUpload'
export { default as SupabaseClient } from './SupabaseClient'
export type { SupabaseClientOptions } from './lib/types'
import myfetch from './wefetch'

/**
 * Creates a new Supabase Client.
 */
export const createClient = <
  Database = any,
  SchemaName extends string & keyof Database = 'public' extends keyof Database
    ? 'public'
    : string & keyof Database,
  Schema extends GenericSchema = Database[SchemaName] extends GenericSchema
    ? Database[SchemaName]
    : any,
>(
  supabaseUrl: string,
  supabaseKey: string,
  options?: SupabaseClientOptions<SchemaName>
): SupabaseClient<Database, SchemaName, Schema> => {
  const clientOptions = { ...options }
  // @ts-ignore
  if (typeof wx !== 'undefined' && !clientOptions.auth?.storage) {
    if (!clientOptions.auth) clientOptions.auth = {}
    clientOptions.auth.storage = new SupabaseMPAdapter()
  }

  return new SupabaseClient(supabaseUrl, supabaseKey, {
    ...clientOptions,
    global: {
      fetch: ((...args: any[]) => myfetch(args[0], args[1])) as any,
      headers: options?.global?.headers || {},
    },
  })
}
