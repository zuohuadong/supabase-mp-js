#!/usr/bin/env bun
/**
 * Supabase MCP Bridge for Self-Hosted Instance
 * 使用 Bun 原生 API 优化版本 - 极简高性能
 */

import * as path from 'node:path'
import * as fs from 'node:fs'

// === 配置加载 ===
const projectPath = process.env.MCP_PROJECT_PATH || process.argv[2]

async function loadEnv(): Promise<void> {
  if (!projectPath) {
    console.error('[Config] No MCP_PROJECT_PATH set, using defaults')
    return
  }

  console.error(`[Config] Loading from: ${projectPath}`)

  try {
    const envFile = projectPath.endsWith('.env') ? projectPath : path.resolve(projectPath, '.env')

    const content = await fs.promises.readFile(envFile, 'utf-8')
    console.error(`[Config] Loaded .env (${content.length} bytes)`)

    const ALLOWED_KEYS = [
      'MCP_REMOTE_HOST',
      'MCP_REMOTE_PORT',
      'MCP_LOCAL_PORT',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SERVICE_ROLE_KEY',
      'MCP_DISABLE_AUTH_HEADER',
    ]

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim()
        let val = trimmed.slice(eqIdx + 1).trim()

        // 移除引号
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1)
        }

        if (ALLOWED_KEYS.includes(key)) {
          process.env[key] = val
          console.error(`[Config] ${key}=${key.includes('KEY') ? '***' : val}`)
        }
      }
    }
  } catch (e: any) {
    console.error(`[Config] Warning: ${e.message}`)
  }
}

// === 配置参数 (加载后更新) ===
let REMOTE_HOST = ''
let REMOTE_PORT = 8000
let LOCAL_PORT = 0
let BASE_URL = ''

function updateConfig(): void {
  REMOTE_HOST = process.env.MCP_REMOTE_HOST || 'root@localhost'
  REMOTE_PORT = parseInt(process.env.MCP_REMOTE_PORT || '8000')
  LOCAL_PORT = parseInt(process.env.MCP_LOCAL_PORT || '18080')
  BASE_URL = `http://localhost:${LOCAL_PORT}/mcp`

  console.error(`[Config] REMOTE_HOST=${REMOTE_HOST}`)
  console.error(`[Config] REMOTE_PORT=${REMOTE_PORT}`)
  console.error(`[Config] LOCAL_PORT=${LOCAL_PORT}`)
}

// === 端口检查 ===
async function checkPort(port: number): Promise<boolean> {
  try {
    // @ts-ignore Bun API
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        data() {},
        open(socket: any) {
          socket.end()
        },
        close() {},
        error() {},
      },
    })
    return true
  } catch {
    return false
  }
}

// === SSH 隧道 ===
let sshProc: ReturnType<typeof Bun.spawn> | null = null

async function ensureTunnel(): Promise<void> {
  // 如果端口已经被占用（可能是之前的隧道），直接使用
  if (await checkPort(LOCAL_PORT)) {
    console.error(`[Tunnel] Port ${LOCAL_PORT} already active, reusing`)
    return
  }

  console.error(`[Tunnel] Starting SSH tunnel to ${REMOTE_HOST}...`)

  // @ts-ignore Bun API
  sshProc = Bun.spawn(
    [
      'ssh',
      '-N',
      '-L',
      `${LOCAL_PORT}:localhost:${REMOTE_PORT}`,
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ServerAliveCountMax=3',
      REMOTE_HOST,
    ],
    {
      stdout: 'ignore',
      stderr: 'pipe',
    }
  )

  // 等待隧道建立 (最多 30 秒)
  for (let i = 0; i < 60; i++) {
    // @ts-ignore Bun API
    await Bun.sleep(500)
    if (await checkPort(LOCAL_PORT)) {
      console.error(`[Tunnel] Connected successfully on port ${LOCAL_PORT}`)
      return
    }
  }

  // 读取错误信息
  const errorText =
    sshProc.stderr && typeof sshProc.stderr !== 'number'
      ? await new Response(sshProc.stderr).text()
      : 'Unknown error'
  throw new Error(`SSH tunnel timeout: ${errorText}`)
}

// === 请求处理 ===
async function sendRequest(jsonBody: string): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }

  // 添加认证头
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
  if (apiKey && process.env.MCP_DISABLE_AUTH_HEADER !== 'true') {
    headers['apikey'] = apiKey
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers,
    body: jsonBody,
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[Error] HTTP ${response.status}: ${errorText.substring(0, 200)}`)
    return JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: `HTTP ${response.status}: ${response.statusText}` },
      id: null,
    })
  }

  return await response.text()
}

// === Initialize 响应 (本地快速响应，避免超时) ===
function handleInitialize(line: string): boolean {
  try {
    const parsed = JSON.parse(line)
    if (parsed.method === 'initialize') {
      console.error('[Bridge] Intercepted initialize, responding locally')
      const response = {
        jsonrpc: '2.0',
        id: parsed.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: true },
            prompts: {},
          },
          serverInfo: {
            name: 'supabase-self-mcp-bridge',
            version: '0.4.0',
          },
        },
      }
      console.log(JSON.stringify(response))
      return true
    }
  } catch {}
  return false
}

// === 清理 ===
function cleanup(): void {
  if (sshProc) {
    console.error('[Tunnel] Closing SSH tunnel...')
    sshProc.kill()
    sshProc = null
  }
}

// === 主程序 ===
async function main(): Promise<void> {
  // 注册清理
  process.on('exit', cleanup)
  process.on('SIGINT', () => {
    cleanup()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    cleanup()
    process.exit(0)
  })

  // 加载配置
  await loadEnv()
  updateConfig()

  // 立即开始读取 stdin (不等待隧道)
  let tunnelReady = false
  const requestQueue: string[] = []

  // 启动隧道 (异步)
  const tunnelPromise = ensureTunnel()
    .then(() => {
      tunnelReady = true
      console.error('[Ready] MCP Bridge started')

      // 处理队列中的请求
      if (requestQueue.length > 0) {
        console.error(`[Queue] Processing ${requestQueue.length} buffered requests`)
        for (const req of requestQueue) {
          processRequest(req)
        }
        requestQueue.length = 0
      }
    })
    .catch((e) => {
      console.error(`[Fatal] ${e}`)
      process.exit(1)
    })

  async function processRequest(line: string): Promise<void> {
    console.error(`[Request] ${line.substring(0, 80)}...`)
    try {
      const response = await sendRequest(line)
      console.error(`[Response] ${response.substring(0, 80)}...`)
      console.log(response)
    } catch (e: any) {
      console.error(`[Error] ${e.message}`)
      console.log(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: e.message },
          id: null,
        })
      )
    }
  }

  // 使用 Bun 原生 stdin 读取
  const decoder = new TextDecoder()
  // @ts-ignore Bun API
  const reader = Bun.stdin.stream().getReader()

  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // 按行处理
    let newlineIndex: number
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)

      if (!line) continue

      // 优先处理 initialize (本地响应，避免超时)
      if (handleInitialize(line)) {
        continue
      }

      // 隧道就绪则直接处理，否则入队
      if (tunnelReady) {
        await processRequest(line)
      } else {
        console.error(`[Queue] Buffering request...`)
        requestQueue.push(line)
      }
    }
  }

  await tunnelPromise
}

main()
