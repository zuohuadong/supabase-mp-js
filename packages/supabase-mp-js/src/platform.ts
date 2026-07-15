type RuntimeGlobal = typeof globalThis & {
  URL: typeof URL
  URLSearchParams: typeof URLSearchParams
  Headers: typeof Headers
  AbortController: typeof AbortController
  AbortSignal: typeof AbortSignal
}

type ParameterPair = [string, string]
type ParameterSource =
  string | Record<string, unknown> | Iterable<readonly [unknown, unknown]> | MiniURLSearchParams

function decodeFormComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value.replace(/\+/g, ' ')
  }
}

function encodeFormComponent(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+')
}

class MiniURLSearchParams {
  private pairs: ParameterPair[] = []

  constructor(init: ParameterSource = '') {
    this.replace(init)
  }

  /** Replaces all entries without notifying the owning URL. */
  replace(init: ParameterSource): void {
    this.pairs = []
    if (typeof init === 'string') {
      const query = init.startsWith('?') ? init.slice(1) : init
      if (!query) return
      for (const part of query.split('&')) {
        if (!part) continue
        const separator = part.indexOf('=')
        const name = separator < 0 ? part : part.slice(0, separator)
        const value = separator < 0 ? '' : part.slice(separator + 1)
        this.pairs.push([decodeFormComponent(name), decodeFormComponent(value)])
      }
      return
    }

    if (init instanceof MiniURLSearchParams) {
      this.pairs = Array.from(init.pairs, ([name, value]) => [name, value])
      return
    }

    const iterable = init as Iterable<readonly [unknown, unknown]>
    if (typeof iterable[Symbol.iterator] === 'function') {
      for (const pair of iterable) {
        if (!Array.isArray(pair) || pair.length !== 2) {
          throw new TypeError('URLSearchParams entry must contain exactly two items')
        }
        this.pairs.push([String(pair[0]), String(pair[1])])
      }
      return
    }

    for (const [name, value] of Object.entries(init)) {
      this.pairs.push([name, String(value)])
    }
  }

  append(name: string, value: string): void {
    this.pairs.push([String(name), String(value)])
  }

  delete(name: string, value?: string): void {
    const normalizedName = String(name)
    const normalizedValue = value == null ? undefined : String(value)
    this.pairs = this.pairs.filter(
      ([entryName, entryValue]) =>
        entryName !== normalizedName ||
        (normalizedValue !== undefined && entryValue !== normalizedValue)
    )
  }

  get(name: string): string | null {
    const normalizedName = String(name)
    return this.pairs.find(([entryName]) => entryName === normalizedName)?.[1] ?? null
  }

  getAll(name: string): string[] {
    const normalizedName = String(name)
    return this.pairs
      .filter(([entryName]) => entryName === normalizedName)
      .map(([, value]) => value)
  }

  has(name: string, value?: string): boolean {
    const normalizedName = String(name)
    const normalizedValue = value == null ? undefined : String(value)
    return this.pairs.some(
      ([entryName, entryValue]) =>
        entryName === normalizedName &&
        (normalizedValue === undefined || entryValue === normalizedValue)
    )
  }

  set(name: string, value: string): void {
    const normalizedName = String(name)
    const normalizedValue = String(value)
    const index = this.pairs.findIndex(([entryName]) => entryName === normalizedName)
    if (index < 0) this.pairs.push([normalizedName, normalizedValue])
    else {
      this.pairs[index] = [normalizedName, normalizedValue]
      this.pairs = this.pairs.filter(
        ([entryName], entryIndex) => entryName !== normalizedName || entryIndex === index
      )
    }
  }

  sort(): void {
    this.pairs = this.pairs
      .map((pair, index) => ({ pair, index }))
      .sort((left, right) =>
        left.pair[0] === right.pair[0]
          ? left.index - right.index
          : left.pair[0] < right.pair[0]
            ? -1
            : 1
      )
      .map(({ pair }) => pair)
  }

  forEach(
    callback: (value: string, key: string, parent: MiniURLSearchParams) => void,
    thisArg?: unknown
  ): void {
    for (const [name, value] of this.pairs) callback.call(thisArg, value, name, this)
  }

  entries(): IterableIterator<ParameterPair> {
    return Array.from(this.pairs, ([name, value]) => [name, value] as ParameterPair)[
      Symbol.iterator
    ]()
  }

  keys(): IterableIterator<string> {
    return this.pairs.map(([name]) => name)[Symbol.iterator]()
  }

  values(): IterableIterator<string> {
    return this.pairs.map(([, value]) => value)[Symbol.iterator]()
  }

  [Symbol.iterator](): IterableIterator<ParameterPair> {
    return this.entries()
  }

  get size(): number {
    return this.pairs.length
  }

  toString(): string {
    return this.pairs
      .map(([name, value]) => `${encodeFormComponent(name)}=${encodeFormComponent(value)}`)
      .join('&')
  }
}

interface ParsedAuthority {
  username: string
  password: string
  hostname: string
  port: string
}

function defaultPort(protocol: string): string {
  if (protocol === 'http:' || protocol === 'ws:') return '80'
  if (protocol === 'https:' || protocol === 'wss:') return '443'
  return ''
}

function parsePort(port: string, protocol: string): string {
  if (!port) return ''
  if (!/^\d+$/.test(port) || Number(port) > 65_535) throw new TypeError('Invalid URL port')
  const normalized = String(Number(port))
  return normalized === defaultPort(protocol) ? '' : normalized
}

function normalizeUserInfo(value: string): string {
  return Array.from(value, (character) =>
    /^[A-Za-z\d!$&'()*+,\-._~%]$/.test(character) ? character : encodeURIComponent(character)
  ).join('')
}

function parseAuthority(authority: string, protocol: string): ParsedAuthority {
  let host = authority
  let username = ''
  let password = ''
  const at = host.lastIndexOf('@')
  if (at >= 0) {
    const credentials = host.slice(0, at)
    host = host.slice(at + 1)
    const separator = credentials.indexOf(':')
    username = normalizeUserInfo(separator < 0 ? credentials : credentials.slice(0, separator))
    password = normalizeUserInfo(separator < 0 ? '' : credentials.slice(separator + 1))
  }

  let hostname = host
  let port = ''
  if (host.startsWith('[')) {
    const bracket = host.indexOf(']')
    if (bracket < 0) throw new TypeError('Invalid IPv6 URL')
    hostname = host.slice(0, bracket + 1)
    if (host[bracket + 1] === ':') port = host.slice(bracket + 2)
    else if (host.length > bracket + 1) throw new TypeError('Invalid URL host')
  } else {
    const separator = host.lastIndexOf(':')
    if (separator >= 0) {
      if (host.indexOf(':') !== separator) throw new TypeError('IPv6 addresses must use brackets')
      hostname = host.slice(0, separator)
      port = host.slice(separator + 1)
    }
  }

  if (!hostname || /[\s/?#]/.test(hostname)) throw new TypeError('Invalid URL host')
  return {
    username,
    password,
    hostname: hostname.toLowerCase(),
    port: parsePort(port, protocol),
  }
}

function normalizePathname(pathname: string): string {
  const source = pathname.replace(/\\/g, '/')
  const lastSegment = source.slice(source.lastIndexOf('/') + 1)
  const preserveTrailingSlash =
    source.endsWith('/') || /^(?:\.|%2e|\.\.|\.%2e|%2e\.|%2e%2e)$/i.test(lastSegment)
  const output: string[] = []
  for (const segment of source.split('/')) {
    const normalizedSegment = segment.toLowerCase()
    if (
      normalizedSegment === '..' ||
      normalizedSegment === '.%2e' ||
      normalizedSegment === '%2e.' ||
      normalizedSegment === '%2e%2e'
    ) {
      output.pop()
    } else if (normalizedSegment !== '.' && normalizedSegment !== '%2e') output.push(segment)
  }
  let normalized = output.join('/')
  if (!normalized.startsWith('/')) normalized = `/${normalized}`
  if (preserveTrailingSlash && !normalized.endsWith('/')) normalized += '/'
  return Array.from(normalized, (character) =>
    /^[A-Za-z\d!$&'()*+,\-./:;=@_[\]~%]$/.test(character)
      ? character
      : encodeURIComponent(character)
  ).join('')
}

function normalizeHash(hash: string): string {
  const value = hash.startsWith('#') ? hash.slice(1) : hash
  if (!value) return ''
  return `#${Array.from(value, (character) =>
    /^[\x21\x23-\x3B\x3D-\x7E]$/.test(character) ? character : encodeURIComponent(character)
  ).join('')}`
}

interface URLParts {
  protocol: string
  username: string
  password: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
}

function parseAbsoluteURL(input: string): URLParts {
  const match = /^([A-Za-z][A-Za-z\d+.-]*:)(?:\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/.exec(input)
  if (!match) throw new TypeError(`Invalid URL: ${input}`)
  const protocol = match[1].toLowerCase()
  if (!match[2]) throw new TypeError(`URL requires a host: ${input}`)
  const authority = parseAuthority(match[2], protocol)
  return {
    protocol,
    ...authority,
    pathname: normalizePathname(match[3] || '/'),
    search: match[4] || '',
    hash: match[5] || '',
  }
}

class MiniURL {
  private _protocol = ''
  private _username = ''
  private _password = ''
  private _hostname = ''
  private _port = ''
  private _pathname = '/'
  private _hash = ''
  readonly searchParams: MiniURLSearchParams

  constructor(input: string | MiniURL, base?: string | MiniURL) {
    this.searchParams = new MiniURLSearchParams()
    const source = String(input)
    const parts = /^[A-Za-z][A-Za-z\d+.-]*:/.test(source)
      ? parseAbsoluteURL(source)
      : this.resolveRelative(source, base)
    this.assign(parts)
  }

  private resolveRelative(input: string, base?: string | MiniURL): URLParts {
    if (base == null) throw new TypeError(`Invalid URL: ${input}`)
    const baseURL = base instanceof MiniURL ? base : new MiniURL(String(base))
    if (input.startsWith('//')) return parseAbsoluteURL(`${baseURL.protocol}${input}`)

    const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(input)
    if (!match) throw new TypeError(`Invalid URL: ${input}`)
    const relativePath = match[1]
    const pathname = relativePath.startsWith('/')
      ? relativePath
      : relativePath
        ? `${baseURL.pathname.slice(0, baseURL.pathname.lastIndexOf('/') + 1)}${relativePath}`
        : baseURL.pathname

    return {
      protocol: baseURL.protocol,
      username: baseURL.username,
      password: baseURL.password,
      hostname: baseURL.hostname,
      port: baseURL.port,
      pathname: normalizePathname(pathname),
      search: match[2] ?? (relativePath ? '' : baseURL.search),
      hash: match[3] || '',
    }
  }

  private assign(parts: URLParts): void {
    this._protocol = parts.protocol
    this._username = parts.username
    this._password = parts.password
    this._hostname = parts.hostname
    this._port = parts.port
    this._pathname = parts.pathname
    this.searchParams.replace(parts.search)
    this._hash = normalizeHash(parts.hash)
  }

  get href(): string {
    const credentials =
      this._username || this._password
        ? `${this._username}${this._password ? `:${this._password}` : ''}@`
        : ''
    return `${this._protocol}//${credentials}${this.host}${this._pathname}${this.search}${this._hash}`
  }

  set href(value: string) {
    this.assign(parseAbsoluteURL(String(value)))
  }

  get origin(): string {
    return `${this._protocol}//${this.host}`
  }

  get protocol(): string {
    return this._protocol
  }

  set protocol(value: string) {
    const normalized = String(value).toLowerCase().replace(/:$/, '')
    if (!/^[a-z][a-z\d+.-]*$/.test(normalized)) throw new TypeError('Invalid URL protocol')
    this._protocol = `${normalized}:`
    this._port = parsePort(this._port, this._protocol)
  }

  get username(): string {
    return this._username
  }

  set username(value: string) {
    this._username = normalizeUserInfo(String(value))
  }

  get password(): string {
    return this._password
  }

  set password(value: string) {
    this._password = normalizeUserInfo(String(value))
  }

  get host(): string {
    return `${this._hostname}${this._port ? `:${this._port}` : ''}`
  }

  set host(value: string) {
    const authority = parseAuthority(String(value), this._protocol)
    this._hostname = authority.hostname
    this._port = authority.port
  }

  get hostname(): string {
    return this._hostname
  }

  set hostname(value: string) {
    const authority = parseAuthority(
      `${String(value)}${this._port ? `:${this._port}` : ''}`,
      this._protocol
    )
    this._hostname = authority.hostname
    this._port = authority.port
  }

  get port(): string {
    return this._port
  }

  set port(value: string) {
    this._port = parsePort(String(value), this._protocol)
  }

  get pathname(): string {
    return this._pathname
  }

  set pathname(value: string) {
    this._pathname = normalizePathname(String(value))
  }

  get search(): string {
    const query = this.searchParams.toString()
    return query ? `?${query}` : ''
  }

  set search(value: string) {
    this.searchParams.replace(String(value))
  }

  get hash(): string {
    return this._hash
  }

  set hash(value: string) {
    this._hash = normalizeHash(String(value))
  }

  toString(): string {
    return this.href
  }

  toJSON(): string {
    return this.href
  }
}

type HeaderValue = { values: string[] }

function normalizeHeaderName(name: string): string {
  const normalized = String(name).toLowerCase()
  if (!/^[!#$%&'*+\-.^_`|~\dA-Za-z]+$/.test(normalized)) {
    throw new TypeError(`Invalid header name: ${name}`)
  }
  return normalized
}

function normalizeHeaderValue(value: string): string {
  const normalized = String(value).trim()
  if (/[\0\r\n]/.test(normalized)) throw new TypeError('Invalid header value')
  return normalized
}

class MiniHeaders {
  private readonly valuesByName = new Map<string, HeaderValue>()

  constructor(init?: HeadersInit) {
    if (!init) return
    if (Array.isArray(init)) {
      for (const pair of init) {
        if (pair.length !== 2) throw new TypeError('Headers entry must contain two items')
        this.append(pair[0], pair[1])
      }
      return
    }

    const source = init as { forEach?: (callback: (value: string, key: string) => void) => void }
    if (typeof source.forEach === 'function') {
      source.forEach((value, name) => this.append(name, value))
      return
    }

    for (const [name, value] of Object.entries(init)) this.append(name, value)
  }

  append(name: string, value: string): void {
    const key = normalizeHeaderName(name)
    const normalized = normalizeHeaderValue(value)
    const current = this.valuesByName.get(key)
    if (current) current.values.push(normalized)
    else this.valuesByName.set(key, { values: [normalized] })
  }

  delete(name: string): void {
    this.valuesByName.delete(normalizeHeaderName(name))
  }

  get(name: string): string | null {
    const values = this.valuesByName.get(normalizeHeaderName(name))?.values
    return values ? values.join(', ') : null
  }

  getSetCookie(): string[] {
    return [...(this.valuesByName.get('set-cookie')?.values || [])]
  }

  has(name: string): boolean {
    return this.valuesByName.has(normalizeHeaderName(name))
  }

  set(name: string, value: string): void {
    this.valuesByName.set(normalizeHeaderName(name), { values: [normalizeHeaderValue(value)] })
  }

  private names(): string[] {
    return [...this.valuesByName.keys()].sort()
  }

  forEach(
    callback: (value: string, key: string, parent: MiniHeaders) => void,
    thisArg?: unknown
  ): void {
    for (const name of this.names()) callback.call(thisArg, this.get(name) as string, name, this)
  }

  entries(): IterableIterator<[string, string]> {
    return this.names()
      .map((name) => [name, this.get(name) as string] as [string, string])
      [Symbol.iterator]()
  }

  keys(): IterableIterator<string> {
    return this.names()[Symbol.iterator]()
  }

  values(): IterableIterator<string> {
    return this.names()
      .map((name) => this.get(name) as string)
      [Symbol.iterator]()
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries()
  }
}

type AbortListener = {
  callback: EventListenerOrEventListenerObject
  once: boolean
}

function createAbortReason(name: 'AbortError' | 'TimeoutError', message: string): unknown {
  if (typeof DOMException === 'function') return new DOMException(message, name)
  const error = new Error(message)
  error.name = name
  return error
}

function createAbortEvent(target: MiniAbortSignal): Event {
  return {
    type: 'abort',
    target,
    currentTarget: target,
    bubbles: false,
    cancelable: false,
    composed: false,
    defaultPrevented: false,
    eventPhase: 2,
    isTrusted: false,
    timeStamp: Date.now(),
    cancelBubble: false,
    returnValue: true,
    srcElement: target,
    composedPath: () => [target],
    initEvent: () => undefined,
    preventDefault: () => undefined,
    stopImmediatePropagation: () => undefined,
    stopPropagation: () => undefined,
    AT_TARGET: 2,
    BUBBLING_PHASE: 3,
    CAPTURING_PHASE: 1,
    NONE: 0,
  } as unknown as Event
}

class MiniAbortSignal {
  private readonly listeners: AbortListener[] = []
  aborted = false
  reason: unknown = undefined
  onabort: ((this: AbortSignal, event: Event) => unknown) | null = null

  static abort(reason?: unknown): MiniAbortSignal {
    const controller = new MiniAbortController()
    controller.abort(reason)
    return controller.signal
  }

  static timeout(milliseconds: number): MiniAbortSignal {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new TypeError('AbortSignal timeout must be a non-negative finite number')
    }
    const controller = new MiniAbortController()
    const timer = setTimeout(
      () =>
        controller.abort(
          createAbortReason('TimeoutError', 'The operation was aborted due to timeout')
        ),
      milliseconds
    )
    ;(timer as unknown as { unref?: () => void }).unref?.()
    return controller.signal
  }

  static any(signals: Iterable<AbortSignal>): MiniAbortSignal {
    const controller = new MiniAbortController()
    const subscriptions: Array<{ signal: AbortSignal; listener: () => void }> = []
    const cleanup = () => {
      for (const subscription of subscriptions) {
        subscription.signal.removeEventListener('abort', subscription.listener)
      }
      subscriptions.length = 0
    }
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason)
        cleanup()
        break
      }
      const listener = () => {
        controller.abort(signal.reason)
        cleanup()
      }
      subscriptions.push({ signal, listener })
      signal.addEventListener('abort', listener, { once: true })
    }
    return controller.signal
  }

  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (type !== 'abort' || callback == null) return
    if (this.listeners.some((listener) => listener.callback === callback)) return
    const once = typeof options === 'object' && options.once === true
    this.listeners.push({ callback, once })
  }

  removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null): void {
    if (type !== 'abort' || callback == null) return
    const index = this.listeners.findIndex((listener) => listener.callback === callback)
    if (index >= 0) this.listeners.splice(index, 1)
  }

  dispatchEvent(event: Event): boolean {
    if (event.type !== 'abort') return true
    this.dispatch(event)
    return !event.defaultPrevented
  }

  throwIfAborted(): void {
    if (this.aborted) throw this.reason
  }

  /** @internal */
  dispatch(event = createAbortEvent(this)): void {
    for (const listener of [...this.listeners]) {
      if (typeof listener.callback === 'function') listener.callback.call(this, event)
      else listener.callback.handleEvent(event)
      if (listener.once) this.removeEventListener('abort', listener.callback)
    }
    this.onabort?.call(this as unknown as AbortSignal, event)
  }
}

class MiniAbortController {
  readonly signal = new MiniAbortSignal()

  abort(reason?: unknown): void {
    if (this.signal.aborted) return
    this.signal.aborted = true
    this.signal.reason =
      reason === undefined ? createAbortReason('AbortError', 'The operation was aborted') : reason
    this.signal.dispatch()
  }
}

/**
 * Installs only the web-platform globals used by the official Supabase SDK.
 * Existing native implementations are always preserved.
 */
export function ensureSupabasePlatformGlobals(urlProbe = 'https://custom.example.com/'): void {
  const runtime = globalThis as RuntimeGlobal

  if (!hasUsableURLSearchParams(runtime)) {
    runtime.URLSearchParams = MiniURLSearchParams as unknown as typeof URLSearchParams
  }
  if (!hasUsableURL(runtime, urlProbe)) runtime.URL = MiniURL as unknown as typeof URL
  if (typeof runtime.Headers !== 'function') {
    runtime.Headers = MiniHeaders as unknown as typeof Headers
  }
  if (typeof runtime.AbortSignal !== 'function') {
    runtime.AbortSignal = MiniAbortSignal as unknown as typeof AbortSignal
  }
  if (typeof runtime.AbortController !== 'function') {
    runtime.AbortController = MiniAbortController as unknown as typeof AbortController
  }
}

function hasUsableURL(runtime: RuntimeGlobal, urlProbe: string): boolean {
  if (typeof runtime.URL !== 'function') return false
  try {
    // WeChat's partial URL implementation may accept some hosts while rejecting
    // a valid custom Supabase domain, so probe the actual configured endpoint.
    const parsed = new runtime.URL(urlProbe)
    return typeof parsed.href === 'string' && parsed.href.length > 0
  } catch {
    return false
  }
}

function hasUsableURLSearchParams(runtime: RuntimeGlobal): boolean {
  if (typeof runtime.URLSearchParams !== 'function') return false
  try {
    const params = new runtime.URLSearchParams('probe=value')
    return params.get('probe') === 'value' && typeof params.set === 'function'
  } catch {
    return false
  }
}
