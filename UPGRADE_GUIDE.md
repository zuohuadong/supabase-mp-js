# Upgrade guide

## Migrating from the vendored 0.3.x client

The package now wraps the official `@supabase/supabase-js` v2 client instead of maintaining copied
Auth, PostgREST, Functions, Realtime and Storage sources.

### What remains compatible

- `createClient(url, key, options)`
- `auth.getSession`, `auth.getUser`, `auth.setSession`, `auth.signOut`
- `from`, `rpc`, `functions.invoke`, `storage.from`, `channel`
- `auth.signInWithWechat`
- local WeChat file paths passed to Storage `upload`

### Required checks

1. Ensure the build environment uses Node.js 22 or newer.
2. Keep `auth.storageKey` stable if application code reads the stored Session directly.
3. Make the WeChat login backend return a real Supabase refresh token.
4. Add HTTPS upload/request and WSS socket domains to the WeChat allowlist.
5. Test login, token refresh after app resume, RLS queries, Functions, upload and Realtime in WeChat
   DevTools and on a real device.

When `options.accessToken` is configured for third-party authentication, the official client makes
its Auth namespace unavailable. The adapter therefore does not install `signInWithWechat` or Auth
lifecycle hooks for that client; local Storage uploads use the supplied token provider directly.

### PostgREST updates in WeChat

PostgREST updates use HTTP `PATCH`, but `wx.request` does not document `PATCH` as a supported
method. The default adapter rejects that method explicitly instead of relying on an unverified
method-override header. Use a custom `global.fetch` that can send `PATCH`, or perform updates in a
trusted backend/Edge Function.

`wx.uploadFile` is POST-only, so local-file `storage.update()` fails closed with
`wx_local_file_update_unsupported` instead of silently changing PUT semantics. The same
`StorageError` is thrown after `bucket.throwOnError()`. Only use
`storage.upload(path, tempFilePath, { upsert: true })` when insert-or-update semantics and the
required INSERT/UPDATE RLS policies are explicitly acceptable; otherwise perform the update in a
trusted backend or Edge Function.

For local WeChat paths, `wx.uploadFile` cannot reliably express the official `contentType` option.
Keep the correct filename extension so the upload transport can infer MIME. `metadata`,
`cacheControl`, and custom headers remain supported, with case-insensitive custom-header override.

### Removed API

The experimental `uploadLargeFile` helper was removed. Use a dedicated TUS client or a server-side
upload flow for resumable uploads.
