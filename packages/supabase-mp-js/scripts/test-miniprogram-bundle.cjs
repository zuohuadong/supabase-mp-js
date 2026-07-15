const assert = require('node:assert/strict')

const originalURL = Object.getOwnPropertyDescriptor(globalThis, 'URL')
const originalURLSearchParams = Object.getOwnPropertyDescriptor(globalThis, 'URLSearchParams')
let urlCalls = 0
let urlSearchParamsCalls = 0

class BrokenWechatURL {
  constructor() {
    urlCalls += 1
    throw new TypeError('URL is not supported by this runtime')
  }
}

class BrokenWechatURLSearchParams {
  constructor() {
    urlSearchParamsCalls += 1
    throw new TypeError('URLSearchParams is not supported by this runtime')
  }
}

Object.defineProperty(globalThis, 'URL', {
  configurable: true,
  writable: false,
  value: BrokenWechatURL,
})
Object.defineProperty(globalThis, 'URLSearchParams', {
  configurable: true,
  writable: false,
  value: BrokenWechatURLSearchParams,
})

try {
  const { createClient } = require('../dist/miniprogram/index.js')
  const client = createClient('https://sapi.dbbaby.top', 'anon-key')
  const query = client.from('items').select('id').eq('status', 'active')

  assert.equal(urlCalls, 0)
  assert.equal(urlSearchParamsCalls, 0)
  assert.match(query.url.href, /^https:\/\/sapi\.dbbaby\.top\/rest\/v1\/items\?/)
  assert.match(query.url.href, /select=id/)
  assert.match(query.url.href, /status=eq\.active/)
} finally {
  Object.defineProperty(globalThis, 'URL', originalURL)
  Object.defineProperty(globalThis, 'URLSearchParams', originalURLSearchParams)
}
