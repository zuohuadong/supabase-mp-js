import { type SupabaseClient } from '@supabase/supabase-js'
import { StorageApiError, StorageError, StorageUnknownError } from '@supabase/storage-js'

type StorageBucket = ReturnType<SupabaseClient['storage']['from']>
type WxUploadOptions = NonNullable<Parameters<StorageBucket['upload']>[2]>
type UploadResult = Awaited<ReturnType<StorageBucket['upload']>>
type AccessTokenProvider = () => Promise<string | null>
type StorageClientHost = Pick<SupabaseClient, 'auth' | 'storage'>

function isWxLocalFile(value: unknown): value is string {
  return typeof value === 'string' && /^(?:wxfile:|file:|https?:\/\/tmp\/|\/?tmp\/)/i.test(value)
}

function normalizeObjectPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
}

function setHeader(
  headers: Record<string, string>,
  name: string,
  value: string
): Record<string, string> {
  const normalizedName = name.toLowerCase()
  const next = { ...headers }
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === normalizedName) delete next[key]
  }
  next[normalizedName] = value
  return next
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function createStorageApiError(value: unknown, status: number): StorageApiError {
  const payload = parseJsonObject(value)
  const message =
    nonEmptyString(payload?.message) ||
    nonEmptyString(payload?.error) ||
    nonEmptyString(payload?.msg) ||
    nonEmptyString(value) ||
    `Storage upload failed (${status})`
  const statusCode =
    nonEmptyString(payload?.statusCode) || nonEmptyString(payload?.code) || String(status)
  return new StorageApiError(message, status, statusCode)
}

function settleStorageError(
  resolve: (value: UploadResult) => void,
  reject: (reason?: unknown) => void,
  error: StorageError,
  shouldThrowOnError: boolean
): void {
  if (shouldThrowOnError) reject(error)
  else resolve({ data: null, error })
}

async function uploadWxFile(
  client: StorageClientHost,
  supabaseUrl: string,
  supabaseKey: string,
  bucketId: string,
  objectPath: string,
  filePath: string,
  options: WxUploadOptions = {},
  accessTokenProvider?: AccessTokenProvider,
  bucketHeaders: Record<string, string> = {},
  shouldThrowOnError = false
): Promise<UploadResult> {
  const accessToken = accessTokenProvider
    ? (await accessTokenProvider()) || supabaseKey
    : (await client.auth.getSession()).data.session?.access_token || supabaseKey
  const cleanPath = normalizeObjectPath(objectPath)
  const target = [bucketId, ...cleanPath.split('/')].map(encodeURIComponent).join('/')

  const formData: Record<string, string> = {
    cacheControl: options.cacheControl || '3600',
  }
  if (options.metadata) formData.metadata = JSON.stringify(options.metadata)

  let headers: Record<string, string> = {}
  headers = setHeader(headers, 'apikey', supabaseKey)
  headers = setHeader(headers, 'Authorization', `Bearer ${accessToken}`)
  headers = setHeader(headers, 'x-upsert', String(options.upsert === true))
  headers = setHeader(headers, 'cache-control', `max-age=${options.cacheControl || '3600'}`)
  for (const [name, value] of Object.entries(bucketHeaders)) {
    headers = setHeader(headers, name, value)
  }
  for (const [name, value] of Object.entries(options.headers || {})) {
    headers = setHeader(headers, name, value)
  }

  return new Promise<UploadResult>((resolve, reject) => {
    try {
      wx.uploadFile({
        url: `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${target}`,
        filePath,
        name: 'file',
        header: headers,
        formData,
        success: (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            const payload = parseJsonObject(response.data)
            const id = nonEmptyString(payload?.Id)
            const fullPath = nonEmptyString(payload?.Key)
            if (!id || !fullPath) {
              settleStorageError(
                resolve,
                reject,
                new StorageUnknownError('Storage upload returned a malformed success response', {
                  statusCode: response.statusCode,
                  data: response.data,
                }),
                shouldThrowOnError
              )
              return
            }
            resolve({ data: { id, path: cleanPath, fullPath }, error: null })
            return
          }
          settleStorageError(
            resolve,
            reject,
            createStorageApiError(response.data, response.statusCode),
            shouldThrowOnError
          )
        },
        fail: (error) => {
          settleStorageError(
            resolve,
            reject,
            new StorageUnknownError(error.errMsg || 'wx.uploadFile failed', error),
            shouldThrowOnError
          )
        },
      })
    } catch (error) {
      settleStorageError(
        resolve,
        reject,
        new StorageUnknownError('wx.uploadFile failed', error),
        shouldThrowOnError
      )
    }
  })
}

/** Adds wx.uploadFile support while preserving every official Storage method. */
export function installWxStorageUpload(
  client: StorageClientHost,
  supabaseUrl: string,
  supabaseKey: string,
  accessTokenProvider?: AccessTokenProvider
): void {
  if (typeof wx === 'undefined' || typeof wx.uploadFile !== 'function') return

  const originalFrom = client.storage.from.bind(client.storage)
  client.storage.from = ((bucketId: string) => {
    const bucket = originalFrom(bucketId)
    const originalUpload = bucket.upload.bind(bucket)
    const originalUpdate = bucket.update.bind(bucket)
    const originalThrowOnError = bucket.throwOnError.bind(bucket)
    const originalSetHeader = bucket.setHeader.bind(bucket)
    let bucketHeaders: Record<string, string> = {}
    let shouldThrowOnError = false

    bucket.throwOnError = (() => {
      shouldThrowOnError = true
      return originalThrowOnError()
    }) as typeof bucket.throwOnError

    bucket.setHeader = ((name: string, value: string) => {
      bucketHeaders = setHeader(bucketHeaders, name, value)
      return originalSetHeader(name, value)
    }) as typeof bucket.setHeader

    bucket.upload = ((path: string, body: unknown, options?: WxUploadOptions) => {
      if (!isWxLocalFile(body)) {
        return originalUpload(path, body as Parameters<typeof originalUpload>[1], options)
      }
      return uploadWxFile(
        client,
        supabaseUrl,
        supabaseKey,
        bucketId,
        path,
        body,
        options,
        accessTokenProvider,
        bucketHeaders,
        shouldThrowOnError
      )
    }) as typeof bucket.upload

    bucket.update = ((path: string, body: unknown, options?: WxUploadOptions) => {
      if (!isWxLocalFile(body)) {
        return originalUpdate(path, body as Parameters<typeof originalUpdate>[1], options)
      }
      const error = new StorageError(
        'wx_local_file_update_unsupported: wx.uploadFile cannot issue PUT; local-path Storage update is unsupported',
        'storage',
        undefined,
        'wx_local_file_update_unsupported'
      )
      if (shouldThrowOnError) return Promise.reject(error)
      return Promise.resolve({ data: null, error })
    }) as typeof bucket.update

    return bucket
  }) as typeof client.storage.from
}
