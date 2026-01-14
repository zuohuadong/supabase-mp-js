# 🎉 v0.3.27 已发布到 NPM！

## 快速升级

在你的微信小程序项目中运行：

```bash
npm install supabase-self-mcp@0.3.27
# 或者
npm update supabase-self-mcp
```

## 此版本修复了什么？

### 核心问题
✅ **Session 持久化失败** - 修复了登录成功但 `getSession()` 返回空的问题  
✅ **无错误处理** - 添加了完整的 try-catch 和日志追踪  
✅ **调试困难** - 增强了 `signInWithWechat` 的调试日志  

### 技术细节
- `setItemAsync` 现在正确返回 `Promise<void>`
- `getItemAsync` 现在正确返回 `Promise<any | null>`
- 所有存储操作都有完整的错误处理和日志记录

## 测试你的升级

升级后，重新登录时你应该在控制台看到：

```
[signInWithWechat] Starting WeChat login, code: 071xxxxx...
[signInWithWechat] Function URL: https://your-api.com/functions/v1/wechat-login
[signInWithWechat] Response status: 200 OK
[signInWithWechat] Response data: { hasUser: true, hasSession: true, hasError: false }
[signInWithWechat] Session received, saving...
[setItemAsync] Saving key: sb-xxxxx-auth-token, data length: 1234
[setItemAsync] Successfully saved key: sb-xxxxx-auth-token
[signInWithWechat] Session saved successfully
[signInWithWechat] Login completed successfully
```

## 验证 Session 持久化

登录后运行以下代码验证：

```typescript
// 立即检查
const { data: { session } } = await supabase.auth.getSession()
console.log('Session check:', session ? '✅ 已保存' : '❌ 未保存')

// 刷新页面后再次检查
onLoad() {
  const { data: { session } } = await supabase.auth.getSession()
  console.log('Session after reload:', session ? '✅ 持久化成功' : '❌ 持久化失败')
}
```

## 如果仍然遇到 503 错误

503 错误是服务端问题，与此次修复无关。请检查：

### 1. 使用 MCP 工具检查服务状态

```typescript
// 检查 PostgREST 日志
await mcp.execute('get_logs', { service: 'api' })

// 检查安全建议
await mcp.execute('get_advisors', { type: 'security' })
```

### 2. 检查 RLS 权限

```sql
-- 查看当前用户权限
SELECT current_user, session_user;

-- 检查表的 RLS 策略
SELECT schemaname, tablename, policyname, permissive, roles, qual 
FROM pg_policies 
WHERE tablename IN ('store_managers', 'shop_assistants');
```

### 3. 临时诊断（开发环境）

```sql
-- 临时禁用 RLS 来测试（不要在生产环境使用！）
ALTER TABLE store_managers DISABLE ROW LEVEL SECURITY;
ALTER TABLE shop_assistants DISABLE ROW LEVEL SECURITY;

-- 测试完记得重新启用
ALTER TABLE store_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_assistants ENABLE ROW LEVEL SECURITY;
```

## 需要帮助？

- **查看详细修复日志**: [CHANGELOG_FIX.md](./CHANGELOG_FIX.md)
- **查看版本历史**: [CHANGELOG.md](./CHANGELOG.md)
- **报告问题**: [GitHub Issues](https://github.com/zuohuadong/supabase-mp-js/issues)

## NPM 包信息

- **包名**: `supabase-self-mcp`
- **版本**: `0.3.27`
- **发布时间**: 2026-01-14 13:49 UTC+8
- **NPM 链接**: https://www.npmjs.com/package/supabase-self-mcp

---

Happy coding! 🚀
