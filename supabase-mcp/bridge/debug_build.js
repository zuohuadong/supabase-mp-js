// index.ts
var REMOTE_HOST = 'root@supa.seagoo.top'
var REMOTE_PORT = 8000
var LOCAL_PORT = 18080
var BASE_URL = `http://localhost:${LOCAL_PORT}/mcp`
async function checkPort(port) {
  try {
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        data() {},
        open(socket2) {
          socket2.end()
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
var sshProc = null
async function ensureTunnel() {
  if (await checkPort(LOCAL_PORT)) {
    console.error(`[Tunnel] Port ${LOCAL_PORT} already active`)
    return
  }
  console.error(`[Tunnel] Starting SSH tunnel to ${REMOTE_HOST}...`)
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
  for (let i = 0; i < 30; i++) {
    await Bun.sleep(500)
    if (await checkPort(LOCAL_PORT)) {
      console.error(`[Tunnel] Connected successfully on port ${LOCAL_PORT}`)
      return
    }
  }
  const errorText = await new Response(sshProc.stderr).text()
  throw new Error(`Failed to establish SSH tunnel: ${errorText}`)
}
async function sendRequest(jsonBody) {
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: jsonBody,
  })
  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[Error] HTTP ${response.status}: ${errorText}`)
    return JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: `HTTP ${response.status}: ${response.statusText}` },
      id: null,
    })
  }
  return await response.text()
}
function cleanup() {
  if (sshProc) {
    console.error('[Tunnel] Closing SSH tunnel...')
    sshProc.kill()
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
  try {
    await ensureTunnel()
  } catch (e) {
    console.error(`[Fatal] ${e}`)
    process.exit(1)
  }
  console.error('[Ready] MCP Bridge started, waiting for input...')
  const decoder = new TextDecoder()
  const reader = Bun.stdin.stream().getReader()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newlineIndex
    while (
      (newlineIndex = buffer.indexOf(`
`)) !== -1
    ) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue
      console.error(`[Request] ${line.substring(0, 60)}...`)
      try {
        const response = await sendRequest(line)
        console.log(response)
      } catch (e) {
        console.error(`[Error] ${e}`)
      }
    }
  }
}
main()
