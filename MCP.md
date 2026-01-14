## 🌉 MCP Bridge (Cursor 专用)

本包内置了 **Supabase MCP Bridge** (`supa-mcp`)。这是一个专为 Cursor/Claude 设计的 Model Context Protocol (MCP) 桥接工具，允许 AI 编辑器**安全地**访问您私有/本地部署的 Supabase 实例。

### 核心功能

- **SSH 隧道自动管理**: 自动建立 SSH 隧道连接到远程 Supabase 数据库服务器。
- **多项目并发支持**: (v0.3.2+) 自动检测空闲端口，支持同时打开多个 Cursor 项目互不冲突。
- **安全隔离**: 本地动态端口 -> 远程 8000 端口，无需暴露数据库公网端口。
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
# SSH 连接配置
MCP_REMOTE_HOST=root@your-server-ip  # SSH 登录地址
MCP_REMOTE_PORT=8000                 # 远程端口 (见下方说明)
MCP_LOCAL_PORT=18080                 # (可选) 本地端口，不设置则自动分配

# MCP 端点配置 (v0.3.26+)
MCP_BASE_PATH=/mcp                   # (可选) MCP 端点路径，默认 /mcp
```

**端口配置说明：**

1. **通过 Kong 访问** (默认，有 IP 限制可能导致 403)：

   ```env
   MCP_REMOTE_PORT=8000
   MCP_BASE_PATH=/mcp
   ```

2. **直连 Studio** (推荐，绕过 Kong 限制)：

   ```env
   MCP_REMOTE_PORT=3003      # 或 8082，取决于你的 Studio 端口映射
   MCP_BASE_PATH=/api/mcp
   ```

   查看 Studio 端口：`docker ps | grep studio`

### 在 Cursor 中使用 (推荐配置)

为了获得最佳的多项目支持和稳定性（特别是 Windows 环境），建议**不要**使用全局 MCP 设置，而是为每个项目创建独立的配置文件。

**1. 在项目根目录创建 `.cursor/mcp.json`**

_(注：可以将 `.cursor/` 添加到 `.gitignore` 防止提交本地路径)_

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "-p", "supabase-self-mcp", "supa-mcp"],
      "env": {
        // (v0.3.3+) 显式指定项目路径，解决部分 IDE 变量替换失效问题
        "MCP_PROJECT_PATH": "D:\\workspace\\your-project-path"
      }
    }
  }
}
```

**2. 为什么这样做？**

- **稳定性**: 绕过了部分 IDE (如 Antigravity) 在 Windows 下 `${workspaceFolder}` 变量替换失败的问题。
- **多项目**: 每个项目使用独立的 `.cursor/mcp.json`，自动获得独立的 SSH 隧道和端口。
- **安全**: 配置仅在本地有效，配合 `.gitignore` 不会泄露路径信息。

---

### 全局使用 (备选)

如果你的 IDE 能正确处理 `${workspaceFolder}` 变量,也可以在全局设置中使用：

1. 打开 Cursor Settings -> Features -> MCP Servers
2. 点击 **Add Check**
3. **Type**: `command`
4. **Command**:
   - Mac/Linux: `npx -y -p supabase-self-mcp supa-mcp ${workspaceFolder}`
   - Windows: `cmd /c npx -y -p supabase-self-mcp supa-mcp ${workspaceFolder}`

---

### Antigravity IDE 多项目配置

Antigravity 目前不支持项目级 `.cursor/mcp.json` 配置，只能使用全局 `mcp_config.json`。

**配置示例** (`~/.gemini/antigravity/mcp_config.json`):

```json
{
  "mcpServers": {
    "supabase-project1": {
      "command": "bun",
      "args": ["x", "-y", "supabase-self-mcp@latest"],
      "env": {
        "MCP_PROJECT_PATH": "d:\\workspace\\project1"
      }
    },
    "supabase-project2": {
      "command": "bun",
      "args": ["x", "-y", "supabase-self-mcp@latest"],
      "env": {
        "MCP_PROJECT_PATH": "d:\\workspace\\project2"
      }
    }
  }
}
```

**⚠️ 重要提示：**

1. **所有 MCP 服务器会在每个项目中同时加载**
2. **使用时必须明确指定服务器名称**，例如：
   - 在 `project1` 中使用 `mcp_supabase-project1_*` 工具
   - 在 `project2` 中使用 `mcp_supabase-project2_*` 工具
3. **避免混用**：如果在错误的项目中调用了其他项目的 MCP 工具，会操作到错误的数据库

**期待改进：**

- 希望 Antigravity 未来支持工作区感知，自动根据当前项目过滤可用的 MCP 服务器
- 或支持项目级 `.cursor/mcp.json` 配置文件
