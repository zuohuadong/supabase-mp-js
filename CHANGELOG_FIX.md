# 修复日志 - v0.3.26

## 问题描述

用户在微信小程序登录后遇到以下问题：

1. **Session 持久化失败** - `signInWithWechat` 返回成功，但后续 `getSession()` 返回空
2. **503 服务错误** - 查询 `store_managers` 和 `shop_assistants` 表时返回 503 Service Unavailable

## 根本原因

### 1. Session 持久化问题

- **问题代码位置**: `src/gotrue-js/src/lib/helpers.ts` 第 55-68 行
- **问题原因**:
  - `setItemAsync` 函数使用 `wx.setStorageSync` 同步方法，但没有返回 Promise
  - 调用方使用 `await` 等待，但函数不是真正的异步函数
  - 没有错误处理和日志追踪

### 2. 503 服务错误

- **可能原因**:
  - PostgREST 服务不可用
  - RLS 权限配置问题
  - 数据库连接池耗尽

## 修复内容

### 1. 修复 Session 存储 API (helpers.ts)

```typescript
// 修复前
export const setItemAsync = (storage: SupportedStorage, key: string, data: any) => {
  wx.setStorageSync(key, JSON.stringify(data))
}

// 修复后
export const setItemAsync = async (
  storage: SupportedStorage,
  key: string,
  data: any
): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      const jsonData = JSON.stringify(data)
      console.log(`[setItemAsync] Saving key: ${key}, data length: ${jsonData.length}`)
      wx.setStorageSync(key, jsonData)
      console.log(`[setItemAsync] Successfully saved key: ${key}`)
      resolve()
    } catch (error) {
      console.error(`[setItemAsync] Failed to save key: ${key}`, error)
      reject(error)
    }
  })
}
```

### 2. 添加详细日志 (SupabaseAuthClient.ts)

在 `signInWithWechat` 方法中添加了完整的调试日志：

- 登录开始/结束
- HTTP 响应状态
- Session 数据验证
- Session 保存过程
- 订阅者通知

## 如何使用修复后的库

### 方式一：在你的小程序项目中使用本地构建

```bash
# 1. 在你的小程序项目中安装（假设小程序在 packages/miniapp）
cd your-miniapp-project
npm install file:d:/workspace/supabase-wechat

# 2. 或者使用相对路径
npm install ../../supabase-wechat
```

### 方式二：直接复制 dist 目录

```bash
# 复制构建产物到你的项目
cp -r d:/workspace/supabase-wechat/dist your-project/node_modules/supabase-mp-js/
```

### 方式三：发布到 NPM（推荐）

```bash
cd d:/workspace/supabase-wechat
npm version patch  # 或者 minor/major
npm publish
```

## 测试验证

重新登录后，你应该在控制台看到类似这样的日志：

```
[signInWithWechat] Starting WeChat login, code: 071xxxxx...
[signInWithWechat] Function URL: https://sapi.dbbaby.top/functions/v1/wechat-login
[signInWithWechat] Response status: 200 OK
[signInWithWechat] Response data: { hasUser: true, hasSession: true, hasError: false }
[signInWithWechat] Session received, saving... { access_token: 'eyJhbG...', expires_at: 1705221600, expires_in: 3600 }
[setItemAsync] Saving key: sb-xxxxx-auth-token, data length: 1234
[setItemAsync] Successfully saved key: sb-xxxxx-auth-token
[signInWithWechat] Session saved successfully
[signInWithWechat] Subscribers notified
[signInWithWechat] Login completed successfully
```

## 503 错误排查

如果仍然遇到 503 错误，请检查：

1. **服务状态**

   ```bash
   # 检查 PostgREST 服务
   curl https://sapi.dbbaby.top/rest/v1/

   # 检查数据库连接
   psql -h your-host -U postgres -c "SELECT 1"
   ```

2. **Kong 配置**

   - 检查上游服务配置
   - 验证健康检查设置
   - 查看 Kong 错误日志

3. **数据库 RLS 权限**

   ```sql
   -- 检查表的 RLS 策略
   SELECT * FROM pg_policies WHERE tablename IN ('store_managers', 'shop_assistants');

   -- 临时禁用 RLS 测试（不要在生产环境使用）
   ALTER TABLE store_managers DISABLE ROW LEVEL SECURITY;
   ```

## 下一步行动

1. **立即**: 在小程序中测试修复后的登录流程
2. **如果 503 持续**: 使用 MCP 工具检查 Supabase 服务状态和日志
3. **长期**: 考虑实现重试机制和离线缓存

---

**修复时间**: 2026-01-14 13:47  
**影响版本**: v0.3.26+  
**测试状态**: ✅ 编译通过，待集成测试
