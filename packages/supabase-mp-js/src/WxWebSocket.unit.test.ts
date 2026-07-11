import { WxWebSocket } from './WxWebSocket'

describe('WxWebSocket', () => {
  afterEach(() => {
    delete (globalThis as any).wx
  })

  it('adapts wx SocketTask events and methods', () => {
    const callbacks: Record<string, (event: any) => void> = {}
    const task = {
      readyState: 0,
      send: jest.fn(),
      close: jest.fn(),
      onOpen: (callback: (event: any) => void) => (callbacks.open = callback),
      onClose: (callback: (event: any) => void) => (callbacks.close = callback),
      onError: (callback: (event: any) => void) => (callbacks.error = callback),
      onMessage: (callback: (event: any) => void) => (callbacks.message = callback),
    }
    ;(globalThis as any).wx = { connectSocket: jest.fn(() => task) }

    const socket = new WxWebSocket('wss://example.test/socket', ['vsn'])
    const onOpen = jest.fn()
    const onMessage = jest.fn()
    socket.onopen = onOpen
    socket.addEventListener('message', onMessage)

    callbacks.open({})
    callbacks.message({ data: '{"event":"ok"}' })
    socket.send('payload')
    socket.close(1000, 'done')

    expect(socket.readyState).toBe(WxWebSocket.CLOSING)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ data: '{"event":"ok"}' }))
    expect(task.send).toHaveBeenCalledWith({ data: 'payload' })
    expect(task.close).toHaveBeenCalledWith({ code: 1000, reason: 'done' })
  })
})
