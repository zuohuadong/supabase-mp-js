#!/usr/bin/env node
/**
 * Supabase MCP Bridge for Self-Hosted Instance
 * Polyglot Version: Supports Bun, Node.js, and Deno with native performance.
 */

import * as path from 'node:path'
import * as net from 'node:net'
import * as fs from 'node:fs'
import * as child_process from 'node:child_process'
import { resolve } from 'node:path'

// === Runtime Detection ===
// @ts-ignore
const isBun = typeof Bun !== 'undefined'
// @ts-ignore
const isDeno = typeof Deno !== 'undefined'
const isNode = !isBun && !isDeno

console.error(`[Bridge] Runtime detected: ${isBun ? 'Bun' : isDeno ? 'Deno' : 'Node.js'}`)

// === Platform Adapters ===

interface BridgeAdapter {
  checkPort(port: number): Promise<boolean>
  spawnSSH(args: string[]): {
    kill: () => void
    stderr: ReadableStream | NodeJS.ReadableStream | null
  }
  readFile(path: string): Promise<string>
  readStdinLine(onLine: (line: string) => Promise<void>): Promise<void>
}

// 1. Bun Implementation (Highest Performance)
const bunAdapter: BridgeAdapter = {
  async checkPort(port: number): Promise<boolean> {
    try {
      // @ts-ignore
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
  },
  spawnSSH(args: string[]) {
    // @ts-ignore
    const proc = Bun.spawn(args, {
      stdout: 'ignore',
      stderr: 'pipe',
    })
    return {
      kill: () => proc.kill(),
      stderr: proc.stderr,
    }
  },
  async readFile(filePath: string) {
    // @ts-ignore
    return await Bun.file(filePath).text()
  },
  async readStdinLine(onLine) {
    const decoder = new TextDecoder()
    // @ts-ignore
    const reader = Bun.stdin.stream().getReader()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line) await onLine(line)
      }
    }
  },
}

// 2. Node.js Implementation (Standard Compatibility)
const nodeAdapter: BridgeAdapter = {
  checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(200) // Fast timeout check
      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })
      socket.on('error', () => {
        socket.destroy()
        resolve(false)
      })
      socket.connect(port, '127.0.0.1')
    })
  },
  spawnSSH(args: string[]) {
    // First arg is 'ssh', rest are params
    const cmd = args[0]
    const params = args.slice(1)
    const proc = child_process.spawn(cmd, params, {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    return {
      kill: () => proc.kill(),
      stderr: proc.stderr,
    }
  },
  async readFile(filePath: string) {
    return await fs.promises.readFile(filePath, 'utf-8')
  },
  async readStdinLine(onLine) {
    const rl = await import('node:readline')
    const iface = rl.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    })

    for await (const line of iface) {
      if (line.trim()) await onLine(line.trim())
    }
  },
}

// 3. Deno Implementation (Future Proof)
// Note: To fully support Deno in this single file without compilation step is tricky due to TS types.
// We fallback to Node adapter logic via 'node:' compat layer if running in Deno with node compat,
// or use minimal Deno specifics if possible.
// For now, Deno (via npm specifiers) runs Node code quite well.
// We will use a mixed approach or alias to Node if Deno is detected but has node compat.

const adapter = isBun ? bunAdapter : nodeAdapter

// === Config & Env Loading ===

// CLI Args: [runtime, script, projectPath]
// Node: node index.js path
// Bun: bun index.ts path
const args = process.argv.slice(2)
const projectPath = args[0] // First argument is project path

async function loadEnv() {
  if (!projectPath) return

  console.error(`[Config] Target project path: ${projectPath}`)
  try {
    const envFile = projectPath.endsWith('.env') ? projectPath : resolve(projectPath, '.env')

    // Use adapter to read file
    const content = await adapter.readFile(envFile)
    console.error(`[Config] Loaded .env from ${envFile}`)

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim()
        let val = trimmed.slice(eqIdx + 1).trim()
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1)
        }
        process.env[key] = val
      }
    }
  } catch (e: any) {
    console.error(`[Config] Warning: Could not load .env from ${projectPath}: ${e.message}`)
  }
}

// === Logic ===
const REMOTE_HOST = process.env.MCP_REMOTE_HOST || 'root@your-ip'
const REMOTE_PORT = parseInt(process.env.MCP_REMOTE_PORT || '8000')
const LOCAL_PORT = parseInt(process.env.MCP_LOCAL_PORT || '18080')
const BASE_URL = `http://localhost:${LOCAL_PORT}/mcp`

let activeProcess: { kill: () => void } | null = null

async function ensureTunnel() {
  if (await adapter.checkPort(LOCAL_PORT)) {
    console.error(`[Tunnel] Port ${LOCAL_PORT} already active`)
    return
  }

  console.error(`[Tunnel] Starting SSH tunnel to ${REMOTE_HOST}...`)

  // Construct SSH Args
  // Note: 'ssh' command must be in PATH
  const sshArgs = [
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
  ]

  const proc = adapter.spawnSSH(sshArgs)
  activeProcess = proc

  // Read stderr for errors
  if (proc.stderr) {
    // @ts-ignore
    if (typeof proc.stderr.on === 'function') {
      // Node stream
      // @ts-ignore
      proc.stderr.on('data', (d) => console.error(`[SSH Error] ${d.toString()}`))
    } else {
      // Web Stream (Bun)
      // We don't block main loop, just log if happens
      // @ts-ignore
      readStream(proc.stderr)
    }
  }

  // Wait loop
  for (let i = 0; i < 30; i++) {
    // @ts-ignore wait
    await new Promise((r) => setTimeout(r, 500))
    if (await adapter.checkPort(LOCAL_PORT)) {
      console.error(`[Tunnel] Connected successfully on port ${LOCAL_PORT}`)
      return
    }
  }
  throw new Error('SSH Tunnel timeout')
}

async function readStream(stream: ReadableStream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    console.error(`[SSH Error] ${decoder.decode(value)}`)
  }
}

async function cleanup() {
  if (activeProcess) {
    console.error('[Tunnel] Closing SSH tunnel...')
    activeProcess.kill()
    activeProcess = null
  }
}

async function sendRequest(jsonBody: string): Promise<void> {
  try {
    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: jsonBody,
    })

    if (!response.ok) {
      console.error(`[Error] HTTP ${response.status}`)
      return
    }

    const text = await response.text()
    console.log(text) // Output to Stdout for Cursor/Claude
  } catch (e: any) {
    // console.error(`[Request Error] ${e.message}`);
    // Create JSON-RPC error
    console.log(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: e.message },
        id: null,
      })
    )
  }
}

async function main() {
  process.on('exit', cleanup)
  process.on('SIGINT', () => {
    cleanup()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    cleanup()
    process.exit(0)
  })

  await loadEnv()

  try {
    await ensureTunnel()
  } catch (e) {
    console.error(`[Fatal] ${e}`)
    process.exit(1)
  }

  console.error('[Ready] Supa-MCP Bridge started.')

  await adapter.readStdinLine(async (line) => {
    // console.error(`[DEBUG Request] ${line.substring(0, 50)}...`);
    await sendRequest(line)
  })
}

main()
