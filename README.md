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

### 4. 微信一键登录 (强烈推荐)

> 💡 强烈建议配合 Supabase Edge Functions 使用。
>
> **重要说明**: 官方 supabase-js 的 `signInWithOAuth` 依赖浏览器重定向，无法在微信小程序中使用。
> 推荐方案：小程序端调用 `wx.login` 获取 code -> 调用 Edge Function -> Edge Function 请求微信 API 获取 OpenID -> 生成/获取 User -> 返回 Session -> 小程序端调用 `supabase.auth.setSession(data.session)`。

#### 客户端代码

```typescript
// 1. 获取微信登录 Code
wx.login({
  success: async (res) => {
    // 2. 调用封装好的 Edge Function (需自行部署 wechat-login)
    const { data, error } = await supabase.functions.invoke('wechat-login', {
      body: { code: res.code },
    })

    if (error) {
      console.error('登录失败', error)
      return
    }

    // 3. 将 Session 设置到客户端，Supabase 会自动持久化
    if (data?.session) {
      await supabase.auth.setSession(data.session)
      console.log('登录成功', data.user)
    }
  },
})

// 或者使用手机号一键登录 (需前端获取 code)
// <button open-type="getPhoneNumber" bindgetphonenumber="onGetPhoneNumber">...</button>
async function onGetPhoneNumber(e) {
  const { code } = e.detail

  // 同样推荐使用 Edge Function (需自行实现 wechat-phone-login 逻辑)
  const { data, error } = await supabase.functions.invoke('wechat-phone-login', {
    body: { code },
  })
}
```

#### 安全最佳实践

> ⚠️ **严禁**将微信小程序的 `AppID` 和 `Secret` 硬编码在小程序前端代码中！
> 必须将其配置在 Supabase 控制台的 Project Settings -> Edge Functions -> Secrets 中，通过 `Deno.env.get('WECHAT_APP_SECRET')` 读取。

#### 后端配置 (Edge Function)

请在您的 Supabase 项目中部署名为 `wechat-login` 的 Edge Function。

<details>
<summary>点击查看 wechat-login Deno 代码模版</summary>

```typescript
// supabase/functions/wechat-login/index.ts
// 0. 依赖与 CORS 配置
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { code, phone_code } = await req.json()
    if (!code) throw new Error('No code provided')

    // 1. 获取环境变量
    const appId = Deno.env.get('WECHAT_APP_ID') // 注意：需确保 Supabase Secrets 中配置一致
    const secret = Deno.env.get('WECHAT_APP_SECRET')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') // 必须使用 Service Role Key 以支持 Admin 操作

    if (!appId || !secret || !supabaseUrl || !serviceKey) {
      throw new Error('Missing Secrets')
    }

    // 2. 请求微信 API 获取 OpenID
    const wxResp = await fetch(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${secret}&js_code=${code}&grant_type=authorization_code`
    )
    const wxData = await wxResp.json()
    if (wxData.errcode) throw new Error(`WeChat OpenID Error: ${wxData.errmsg}`)

    const { openid } = wxData
    // 使用 OpenID 映射虚拟邮箱
    const email = `${openid}@wechat.program`
    const password = `${openid}_${secret.substring(0, 6)}_pwd`

    // 3. 构建 Auth 请求头 (使用 Service Key)
    const authUrl = `${supabaseUrl}/auth/v1`
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    }

    // 4. 尝试登录 (直接调用 Auth API)
    let loginResp = await fetch(`${authUrl}/token?grant_type=password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    })

    let sessionData = await loginResp.json()

    // 5. 登录失败则自动注册
    if (!loginResp.ok) {
      const createResp = await fetch(`${authUrl}/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: { openid },
        }),
      })

      if (!createResp.ok) {
        const err = await createResp.json()
        // 忽略 422 (用户已存在) 错误
        if (createResp.status !== 422) {
          throw new Error(err.msg || err.message || 'Create user failed')
        }
      }

      // 注册后再次登录
      loginResp = await fetch(`${authUrl}/token?grant_type=password`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, password }),
      })

      if (!loginResp.ok) throw new Error('Final login failed')
      sessionData = await loginResp.json()
    }

    // 6. (可选) 处理手机号绑定逻辑
    // 如果前端传了 phone_code，可在此处请求微信接口获取手机号并更新 user_metadata 或 profiles 表
    // const phone = ...

    // 7. 返回 Session
    return new Response(JSON.stringify({ session: sessionData, user: sessionData.user }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
```

</details>

---

### 5. 文件存储 (Storage)

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

### 5. 实时订阅 (Realtime)

```typescript
const channel = supabase
  .channel('room_1')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
    console.log('新消息:', payload.new)
  })
  .subscribe()
```

### 6. 断点续传/大文件上传 (分片)

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

### 7. 调用 Edge Functions

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
