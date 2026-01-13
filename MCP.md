## 🌉 MCP Bridge (Cursor 专用)

本包内置了 **Supabase MCP Bridge** (`supa-mcp`)。这是一个专为 Cursor/Claude 设计的 Model Context Protocol (MCP) 桥接工具，允许 AI 编辑器**安全地**访问您私有/本地部署的 Supabase 实例。

### 核心功能

- **SSH 隧道自动管理**: 自动建立 SSH 隧道连接到远程 Supabase 数据库服务器。
- **安全隔离**: 本地 18080 端口 -> 远程 8000 端口，无需暴露数据库公网端口。
- **零依赖**: 纯 Node.js/Bun 实现，无需本地安装 SSH 客户端（依赖系统 ssh 命令）。

### 安装与运行

#### 方法 1: 使用 npx (推荐)

无需安装，直接运行：

```bash
# 使用 npx (因包名与命令名不一致，需指定 -p)
npx -p supabase-self-mcp supa-mcp <你的项目路径>

# 或者使用 bunx (更推荐，速度更快)
bunx --package supabase-self-mcp supa-mcp <你的项目路径>
```

#### 方法 2: 全局安装

```bash
# 安装
npm install -g supabase-self-mcp
# 或
bun add -g supabase-self-mcp

# 运行 (在项目根目录下)
supa-mcp ./
```

### 配置 (.env)

在你的项目根目录创建 `.env` 文件，配置 SSH 连接信息：

```env
MCP_REMOTE_HOST=root@your-server-ip  # SSH 登录地址
MCP_REMOTE_PORT=8000                 # 远程 Supabase Studio/API 端口 (通常 Kong 端口)
MCP_LOCAL_PORT=18080                 # 本地映射端口
```

### 在 Cursor 中使用

1. 打开 Cursor Settings -> Features -> MCP Servers
2. 点击 **Add Check**
3. **Type**: `command`
4. **Command**:
   - Mac/Linux: `npx -y -p supabase-self-mcp supa-mcp ${workspaceFolder}`
   - Windows: `cmd /c npx -y -p supabase-self-mcp supa-mcp ${workspaceFolder}`
