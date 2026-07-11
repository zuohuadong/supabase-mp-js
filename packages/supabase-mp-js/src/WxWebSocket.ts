type SocketEventType = 'open' | 'close' | 'error' | 'message'
type SocketListener = EventListener

/** WebSocket-compatible transport backed by wx.connectSocket. */
export class WxWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly CONNECTING = WxWebSocket.CONNECTING
  readonly OPEN = WxWebSocket.OPEN
  readonly CLOSING = WxWebSocket.CLOSING
  readonly CLOSED = WxWebSocket.CLOSED

  readonly url: string
  protocol = ''
  extensions = ''
  bufferedAmount = 0
  binaryType: BinaryType = 'arraybuffer'
  readyState = WxWebSocket.CONNECTING

  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  private readonly listeners = new Map<SocketEventType, Set<SocketListener>>()
  private readonly task: WechatMiniprogram.SocketTask

  constructor(address: string | URL, protocols?: string | string[]) {
    if (typeof wx === 'undefined' || typeof wx.connectSocket !== 'function') {
      throw new Error('wx.connectSocket is unavailable')
    }

    this.url = String(address)
    const protocolList = typeof protocols === 'string' ? [protocols] : protocols
    this.task = wx.connectSocket({ url: this.url, protocols: protocolList })
    this.task.binaryType = this.binaryType

    this.task.onOpen((rawEvent) => {
      this.readyState = WxWebSocket.OPEN
      this.dispatch('open', { type: 'open', target: this, rawEvent } as unknown as Event)
    })
    this.task.onMessage((rawEvent) => {
      this.dispatch('message', {
        type: 'message',
        target: this,
        data: rawEvent.data,
      } as unknown as MessageEvent)
    })
    this.task.onError((rawEvent) => {
      this.dispatch('error', {
        type: 'error',
        target: this,
        message: rawEvent.errMsg,
        rawEvent,
      } as unknown as Event)
    })
    this.task.onClose((rawEvent) => {
      this.readyState = WxWebSocket.CLOSED
      this.dispatch('close', {
        type: 'close',
        target: this,
        code: Number(rawEvent?.code || 1000),
        reason: String(rawEvent?.reason || ''),
        wasClean: Number(rawEvent?.code || 1000) === 1000,
        rawEvent,
      } as unknown as CloseEvent)
    })
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== WxWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    const payload = ArrayBuffer.isView(data)
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data
    this.task.send({ data: payload as string | ArrayBuffer })
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === WxWebSocket.CLOSING || this.readyState === WxWebSocket.CLOSED) return
    this.readyState = WxWebSocket.CLOSING
    this.task.close({ code, reason })
  }

  addEventListener(type: SocketEventType, listener: SocketListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)?.add(listener)
  }

  removeEventListener(type: SocketEventType, listener: SocketListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  private dispatch(type: SocketEventType, event: Event): void {
    if (type === 'open') this.onopen?.call(this, event)
    if (type === 'error') this.onerror?.call(this, event)
    if (type === 'message') this.onmessage?.call(this, event as MessageEvent)
    if (type === 'close') this.onclose?.call(this, event as CloseEvent)
    this.listeners.get(type)?.forEach((listener) => listener.call(this, event))
  }
}
