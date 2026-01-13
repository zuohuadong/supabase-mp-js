# supabase-mp-js

专为微信小程序深度优化的 Supabase JavaScript 客户端。

`supabase-mp-js` 是官方 `supabase-js` 的轻量级、原生适配版本，移除了所有浏览器特定的 polyfill（如 `cross-fetch`, `websocket` 等），直接调用微信小程序的原生 API (`wx.request`, `wx.uploadFile`, `wx.connectSocket`, `wx.getStorageSync`)，从而显著减小包体积并提高性能。

## ✨ 核心优势

- **⚡️ 原生性能**: 直接底层调用 `wx` API，无中间层损耗。
- **📦 极致轻量**: 移除 `phoenix` (90kb+), `cross-fetch`, `wechaturl-parse` 等冗余依赖，体积减少 50% 以上。
- **🛠 零配置**: 自动检测小程序环境，自动注入 Storage 适配器，开箱即用。
- **🔒 类型安全**: 完整的 TypeScript 类型定义，包含 `wx` API 的类型声明。
- **📱 完美兼容**: 修复了 Realtime WebSocket 在小程序下的连接问题，支持 Storage 文件上传 (`wx.uploadFile`)。

## 📦 安装

```bash
npm install supabase-mp-js
```

## 🚀 快速开始

### 1. 初始化客户端

```typescript
import { createClient } from 'supabase-mp-js'

const supabase = createClient('https://xyzcompany.supabase.co', 'public-anon-key')

// 就这么简单！
// 库会自动使用 wx.getStorageSync 持久化 Session
// 会自动使用 wx.request 发起请求
```

### 2. 认证 (Auth)

支持多种认证方式。小程序场景推荐使用 OpenID 登录或手机号登录（需配合云函数或自定义后端）。

```typescript
// 获取当前 Session
const {
  data: { session },
} = await supabase.auth.getSession()

// 监听认证状态变化
supabase.auth.onAuthStateChange((event, session) => {
  console.log(event, session)
})
```

> **注意**: 如果您已有自定义的微信登录逻辑（例如通过 `wx.login` 获取 code 换取 OpenID），可以使用 `supabase.auth.signInWithCustomToken` 或调用自定义的 Edge Functions。

### 3. 数据操作 (Database)

完全兼容 PostgREST 语法。

```typescript
// 查询
const { data, error } = await supabase.from('users').select('*').eq('id', 1)

// 插入
const { error } = await supabase.from('todos').insert({ title: 'Learn Supabase MP', done: false })
```

### 4. 微信一键登录 (原生集成)

`supabase-mp-js` 现已将微信登录提升为**一等公民**支持。

相比传统手动处理，新版 `signInWithWechat` 方法会自动处理：code 获取（需手动传入）、调用 Edge Function、解析返回的 Session、自动持久化 Session 到 Storage、触发 `SIGNED_IN` 事件。

#### 客户端代码

```typescript
// 1. 获取微信登录 Code
wx.login({
  success: async (res) => {
    // 2. 一行代码完成登录
    // 默认会调用名为 'wechat-login' 的 Edge Function
    const { data, error } = await supabase.auth.signInWithWechat({
      code: res.code,
    })

    if (error) {
      console.error('登录失败', error)
      return
    }

    // 登录成功！Session 已自动保存
    console.log('登录用户:', data.user)
  },
})
```

#### 后端配置 (Edge Function)

请在您的 Supabase 项目中部署名为 `wechat-login` 的 Edge Function。

<details>
<summary>点击查看 wechat-login Deno 代码模版 (标准范式)</summary>

```typescript
// supabase/functions/wechat-login/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let body
    try {
      body = await req.json()
    } catch (e) {
      throw new Error('Invalid Request Body')
    }
    const { code } = body

    if (!code) throw new Error('Missing code in request body')

    // 验证环境变量
    const WECHAT_APP_ID = Deno.env.get('WECHAT_APP_ID')
    const WECHAT_APP_SECRET = Deno.env.get('WECHAT_APP_SECRET')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const JWT_SECRET = Deno.env.get('JWT_SECRET') // 必须配置，通常与项目配置一致

    if (
      !WECHAT_APP_ID ||
      !WECHAT_APP_SECRET ||
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !JWT_SECRET
    ) {
      throw new Error('Server Config Error: Missing Env Vars')
    }

    // 1. 微信接口换取 OpenID
    const tokenUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${WECHAT_APP_ID}&secret=${WECHAT_APP_SECRET}&js_code=${code}&grant_type=authorization_code`
    const wechatRes = await fetch(tokenUrl)
    const wechatData = await wechatRes.json()

    if (wechatData.errcode) {
      throw new Error(`WeChat API Error: ${wechatData.errmsg}`)
    }

    const { openid, unionid } = wechatData

    // 2. 初始化 Supabase Admin 客户端
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // 3. 查找或创建用户
    const email = `${openid}@wechat.com` // 虚拟邮箱策略
    let userId = ''

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { openid, unionid },
    })

    if (createError) {
      if (createError.message?.includes('already been registered')) {
        // 用户已存在，需查询 userId
        // 注意：生产环境建议维护一张 public.users 表来快速查询 openid -> userid 映射
        // 这里为演示简单，使用 listUsers (性能较低，仅适合演示)
        const {
          data: { users },
        } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
        const foundUser = users.find((u) => u.email === email || u.user_metadata?.openid === openid)
        if (foundUser) {
          userId = foundUser.id
        } else {
          throw new Error('User exists but not found')
        }
      } else {
        throw createError
      }
    } else {
      userId = newUser.user.id
    }

    // 4. 手动签发 JWT (自定义有效期)
    const currentTimestamp = Math.floor(Date.now() / 1000)
    const expiration = currentTimestamp + 60 * 60 * 24 * 7 // 7 天有效期

    const jwtPayload = {
      aud: 'authenticated',
      exp: expiration,
      sub: userId,
      email: email,
      role: 'authenticated',
      app_metadata: { provider: 'wechat', providers: ['wechat'] },
      user_metadata: { openid, unionid },
    }

    // 签名逻辑 (HMAC SHA-256)
    const header = { alg: 'HS256', typ: 'JWT' }
    const encoder = new TextEncoder()
    const b64 = (obj: any) =>
      btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    const toSign = `${b64(header)}.${b64(jwtPayload)}`
    const keyData = encoder.encode(JWT_SECRET)
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(toSign))
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
    const access_token = `${toSign}.${sigB64}`

    // 5. 返回标准 Session 结构
    const session = {
      access_token,
      token_type: 'bearer',
      expires_in: 60 * 60 * 24 * 7,
      refresh_token: access_token, // 简化处理，可自行实现 Refresh Token 逻辑
      user: {
        id: userId,
        email,
        app_metadata: jwtPayload.app_metadata,
        user_metadata: jwtPayload.user_metadata,
        aud: jwtPayload.aud,
        created_at: new Date().toISOString(),
        role: jwtPayload.role,
      },
    }

    return new Response(JSON.stringify({ data: { session, user: session.user } }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
```

</details>

### 5. 增强功能

- **智能并发控制**: 内置请求队列，防止小程序 `wx.request` 并发数超限。
- **Session 自动保活**: 监听 `wx.onAppShow`，在应用切回前台时自动校验并恢复 Session 状态，防止鉴权失效。
- **环境隔离**: `signInWithWechat` 调用 `Edge Function` 方式完美隔离了 PostgreSQL 权限和微信登录逻辑。

---

### 6. 文件存储 (Storage)

小程序环境会自动调用 `wx.uploadFile` 进行文件上传。

**注意**：`fileBody` 参数直接传入图片的本地临时路径 (`tempFilePath`) 即可，无需手动读取 ArrayBuffer 或转换 FormData。

```typescript
// 选择图片
wx.chooseMedia({
  count: 1,
  success: async (res) => {
    const tempFilePath = res.tempFiles[0].tempFilePath

    // 直接上传
    const { data, error } = await supabase.storage
      .from('avatars')
      .upload('public/avatar.png', tempFilePath, {
        contentType: 'image/png', // 建议显式指定
      })

    if (error) console.error(error)
    else console.log('上传成功', data)
  },
})
```

### 7. 实时订阅 (Realtime)

```typescript
const channel = supabase
  .channel('room_1')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
    console.log('新消息:', payload.new)
  })
  .subscribe()
```

### 8. 断点续传/大文件上传 (分片)

该功能为独立模块，**支持 Tree-Shaking**。仅在引入时才会增加包体积。
支持大文件分片上传，网络中断后可重试（需自行维护 offset 或依赖 TUS 恢复机制）。

```typescript
import { createClient, uploadLargeFile } from 'supabase-mp-js'

const supabase = createClient('URL', 'KEY')

// 选择视频等大文件
wx.chooseMedia({
  count: 1,
  mediaType: ['video'],
  success: async (res) => {
    const filePath = res.tempFiles[0].tempFilePath

    // 调用分片上传 helper
    const { data, error } = await uploadLargeFile(
      'https://xyz.supabase.co', // 您的 Supabase Project URL
      {
        apikey: 'YOUR_ANON_KEY',
        Authorization: `Bearer ${session.access_token}`, // 如果需要认证
      },
      filePath,
      'my-bucket',
      'folder/video.mp4',
      { chunkSize: 5 * 1024 * 1024 } // 可选：每片大小 5MB
    )
  },
})
```

### 9. 调用 Edge Functions

`supabase-mp-js` 会自动处理鉴权：

- **未登录时**：请求不带 `Authorization` 头 (或带 Anon Key)，Function 内部需处理匿名逻辑。
- **登录后** (调用 `setSession` 后)：后续请求会自动并在 `Authorization` 头中带上 Bearer Token，Function 中可直接 `getUser()`。

```typescript
const { data, error } = await supabase.functions.invoke('hello-world', {
  body: { name: 'WeChat' },
})
```

## 🛠 进阶配置

如果需要自定义 Storage 适配器（默认为 `wx.getStorageSync`）：

```typescript
import { createClient, SupabaseMPAdapter } from 'supabase-mp-js'

const supabase = createClient('URL', 'KEY', {
  auth: {
    storage: SupabaseMPAdapter, // 默认已配置，无需手动添加
    persistSession: true,
  },
})
```

## 📋 功能对比

| 功能              | supabase-mp-js      | 官方 supabase-js        | 说明                                              |
| :---------------- | :------------------ | :---------------------- | :------------------------------------------------ |
| **Http Client**   | `wx.request`        | `fetch` (with polyfill) | 原生 API 更快，无 Polyfill 兼容问题               |
| **Websocket**     | `wx.connectSocket`  | `WebSocket`             | 完美适配小程序 SocketTask                         |
| **File Upload**   | `wx.uploadFile`     | `FormData`              | 小程序不支持标准 FormData，必须用 `wx.uploadFile` |
| **Local Storage** | `wx.setStorageSync` | `localStorage`          | 自动适配，无需 `AsyncStorage` 桥接                |
| **Bundle Size**   | **极小**            | 较大                    | 移除了大量无用 web 依赖                           |

## ⚠️ 注意事项

1. **域名白名单**: 必须在微信小程序后台将 Supabase 的 URL (`Config -> API -> URL`) 添加到 `request` 和 `uploadFile` 合法域名列表中。Realtime URL (wss) 需添加到 `socket` 合法域名。
2. **TypeScript**: 本库已内置 `wx` 类型定义，但建议您的项目也配置 `miniprogram-api-typings` 以获得完整的微信 API 提示。

## 📝 待支持功能

- **断点续传 (TUS)**: 目前仅支持普通上传。超大文件断点续传需要适配 TUS 协议到 `wx.request`，暂未实现。

## 📄 License

MIT
