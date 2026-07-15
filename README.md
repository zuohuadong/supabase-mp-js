# supabase-mp-js

面向微信小程序的 Supabase JavaScript 客户端。当前实现直接复用官方
`@supabase/supabase-js` v2，并只维护微信运行时适配层，避免复制和长期冻结 Auth、
PostgREST、Functions、Realtime、Storage 的内部源码。

## 特性

- 官方 Supabase v2 API、类型和安全更新
- `wx.request` Fetch 适配，保留 JSON body 并支持取消请求
- `wx.getStorageSync` / `wx.setStorageSync` Auth Session 持久化
- `wx.connectSocket` Realtime transport
- `wx.uploadFile` 本地临时文件上传
- 微信前后台切换时启动/停止 Auth token 自动刷新
- Web 环境继续使用原生 `fetch`、`WebSocket` 和 Storage

## 安装

```bash
npm install supabase-mp-js
```

构建本包及使用本包的项目需要 Node.js 22 或更高版本。

## 初始化

```ts
import { createClient } from 'supabase-mp-js'

const supabase = createClient('https://your-project.supabase.co', 'your-anon-or-publishable-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})
```

在微信运行时，`createClient` 会自动注入网络、Session、Realtime 和文件上传适配器。
调用者显式传入的 `global.fetch`、`auth.storage` 或 `realtime.transport` 优先级更高。

包内仅在运行时缺失时安装紧凑的 `URL`、`URLSearchParams`、`Headers` 和 Abort
兼容层，已有原生实现不会被覆盖。小程序构建入口还会将官方 Supabase SDK 内部的
`URL` 与 `URLSearchParams` 静态绑定到包内兼容实现，因此即使微信提供了不可改写、且会拒绝
部分自定义域名的残缺全局实现，也不会影响传入的真实 Supabase URL。兼容层覆盖 Supabase
使用的 `http(s)` / `ws(s)` 层级 URL；自定义 Supabase/SupaCloud 端点的主机名应使用 ASCII
或 Punycode，路径、查询和片段支持 Unicode。

若使用官方 `options.accessToken` 接入第三方认证，Supabase Auth namespace 按官方契约不可用，
因此不会安装 `auth.signInWithWechat` 或 Auth 生命周期钩子；Storage 上传会直接复用该 token provider。

## 数据库与 Edge Functions

API 与官方 SDK 保持一致：

```ts
const { data, error } = await supabase.from('spots').select('id,name').eq('status', 'published')

const result = await supabase.functions.invoke('create-spot', {
  body: { name: 'River bend' },
})
```

`wx.request` 适配覆盖 Auth、PostgREST 的读取/新增/删除，以及 JSON Edge Function 请求。
微信官方未在 `wx.request` 中提供 `PATCH`，因此默认适配器会明确拒绝 PostgREST
`.update()`；更新操作请使用自定义 `global.fetch` 或可信服务端/Edge Function。适配器不会
注入未经验证的 method override。二进制或 `multipart/form-data` Function 响应也不属于
当前支持范围；文件上传请使用 Storage API。

## 微信登录

<details>
<summary>点击查看 wechat-login Bun 代码模版 (适用于 SupaCloud / Bun Edge Runtime)</summary>

```typescript
// functions/<projectRef>/wechat-login.ts
// Bun Edge Runtime 格式：使用 export default 替代 serve()，使用 npm 包名替代 URL 导入
import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Server Config Error: Missing ${name}`)
  return value
}

function parseWechatResponse(value: unknown): { openid: string; unionid?: string } {
  if (!isRecord(value)) throw new Error('Invalid WeChat response')

  if (typeof value.errcode === 'number' && value.errcode !== 0) {
    const message = typeof value.errmsg === 'string' ? value.errmsg : 'Unknown WeChat error'
    throw new Error(`WeChat API Error: ${message}`)
  }

  if (typeof value.openid !== 'string' || value.openid.length === 0) {
    throw new Error('WeChat response is missing openid')
  }

  return {
    openid: value.openid,
    ...(typeof value.unionid === 'string' ? { unionid: value.unionid } : {}),
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body: unknown = await req.json()
    if (!isRecord(body) || typeof body.code !== 'string' || body.code.length === 0) {
      throw new Error('Missing code')
    }

    const WECHAT_MINIPROGRAM_APP_ID = requireEnv('WECHAT_MINIPROGRAM_APP_ID')
    const WECHAT_MINIPROGRAM_APP_SECRET = requireEnv('WECHAT_MINIPROGRAM_APP_SECRET')
    const SUPABASE_URL = requireEnv('SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

    // 1. 微信接口换取 OpenID
    const wechatRes = await fetch(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${WECHAT_MINIPROGRAM_APP_ID}&secret=${WECHAT_MINIPROGRAM_APP_SECRET}&js_code=${body.code}&grant_type=authorization_code`
    )
    const { openid, unionid } = parseWechatResponse(await wechatRes.json())

    // 2. 初始化 Admin 客户端
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })

    // 3. 创建或复用用户
    const email = `${openid}@wechat.com`

    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { openid, unionid },
      app_metadata: { provider: 'wechat', providers: ['wechat'] },
    })

    if (createError && createError.code !== 'user_already_exists') {
      throw createError
    }

    // 4. 生成一次性 magic link，并用 token_hash 换取可刷新的 Session
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    if (linkError) throw linkError

    const tokenHash = linkData?.properties?.hashed_token
    if (typeof tokenHash !== 'string' || tokenHash.length === 0) {
      throw new Error('Magic link response is missing token_hash')
    }

    const { data: sessionData, error: verifyError } = await supabaseAdmin.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    })
    if (verifyError) throw verifyError
    if (!sessionData.session || !sessionData.user) throw new Error('Unable to create Session')

    const { data: updatedUserData, error: updateError } =
      await supabaseAdmin.auth.admin.updateUserById(sessionData.user.id, {
        user_metadata: { openid, unionid },
        app_metadata: { provider: 'wechat', providers: ['wechat'] },
      })
    if (updateError) throw updateError

    const user = updatedUserData.user ?? sessionData.user
    const session = { ...sessionData.session, user }

    return new Response(JSON.stringify({ data: { session, user } }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
}
```

**与 Deno 版本的主要区别：**

| 项目 | Deno 版本 | Bun 版本 |
|------|-----------|----------|
| 入口 | `serve(handler)` | `export default handler` |
| 导入 | `https://esm.sh/...` URL | `"@supabase/supabase-js"` npm 包名 |
| 环境变量 | `Deno.env.get()` | `process.env` (也兼容 `Deno.env.get`) |
| 认证方式 | 手动签发 JWT | Admin magic link + `verifyOtp`（GoTrue 正式签发可刷新 Session） |

</details>

客户端提供 `auth.signInWithWechat`，默认调用 `wechat-login` Edge Function：

```ts
wx.login({
  success: async ({ code }) => {
    const { data, error } = await supabase.auth.signInWithWechat({ code })
    if (error) throw error
    console.log(data.user)
  },
})
```

也可以指定函数名：

```ts
await supabase.auth.signInWithWechat({
  code,
  functionName: 'custom-wechat-login',
})
```

Edge Function 必须返回由 Supabase Auth 正式签发、可刷新的 Session：

```json
{
  "data": {
    "session": {
      "access_token": "...",
      "refresh_token": "..."
    },
    "user": {
      "id": "..."
    }
  }
}
```

不要在客户端保存 `service_role`、JWT secret、数据库密码或微信 App Secret，也不要把
access token 伪装成 refresh token。微信 code 换取 OpenID、用户映射和 Session 签发必须
在可信服务端完成。

## Storage 本地文件上传

微信临时路径会自动走 `wx.uploadFile`：

```ts
wx.chooseMedia({
  count: 1,
  success: async ({ tempFiles }) => {
    const { data, error } = await supabase.storage
      .from('avatars')
      .upload('users/me.png', tempFiles[0].tempFilePath, {
        upsert: false,
      })

    if (error) throw error
    console.log(data.path)
  },
})
```

Web 端的 `Blob`、`File` 和 `FormData` 仍由官方 Storage SDK 处理。微信本地路径上传时，
`wx.uploadFile` 无法可靠传递官方 `contentType` 选项，请保留正确的文件扩展名，让上传端据此
推断 MIME；`metadata`、`cacheControl` 与自定义 headers 会继续传递，自定义 header 名按大小写
不敏感规则覆盖。

微信 `wx.uploadFile` 只提供 POST，因此本地临时路径不能通过 `storage.update()` 保持官方 PUT
语义；适配器会 fail closed 并返回 `wx_local_file_update_unsupported`。调用过
`bucket.throwOnError()` 时会抛出同一个 `StorageError`。仅当业务明确接受 insert-or-update 语义
且 RLS 同时允许 INSERT/UPDATE 时，才可改用 `upload(path, tempFilePath, { upsert: true })`；
否则应使用可信服务端或 Edge Function 执行更新。

## Realtime

```ts
const channel = supabase
  .channel('messages')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) =>
    console.log(payload.new)
  )
  .subscribe()
```

在微信后台配置中，需要把 HTTPS 域名加入 request/uploadFile 合法域名，把 WSS 域名加入
socket 合法域名。

## 自定义适配器

```ts
import { createClient, SupabaseMPAdapter, WxWebSocket, wxFetch } from 'supabase-mp-js'

const supabase = createClient('URL', 'KEY', {
  global: { fetch: wxFetch },
  auth: {
    storage: new SupabaseMPAdapter(),
    storageKey: 'sb-custom-auth-token',
    detectSessionInUrl: false,
  },
  realtime: { transport: WxWebSocket },
})
```

## 从 0.3.x 旧实现迁移

- 常用的 `createClient`、`auth`、`from`、`rpc`、`functions`、`storage`、`channel` API 保持不变。
- 返回类型和错误类型现在直接来自官方 `@supabase/supabase-js` v2。
- 已移除旧实现独有且未稳定维护的 `uploadLargeFile` 导出。
- 自定义微信登录函数必须返回真实 `refresh_token`，随后由官方 `auth.setSession` 校验并持久化。
- 如业务同步读取 Session，请显式配置并固定 `auth.storageKey`。

更多说明见 [UPGRADE_GUIDE.md](./UPGRADE_GUIDE.md)。

## 开发

```bash
npm install
npm run build
npm run test
```

MCP Bridge 是独立 workspace，见 [MCP.md](./MCP.md)。

MIT
