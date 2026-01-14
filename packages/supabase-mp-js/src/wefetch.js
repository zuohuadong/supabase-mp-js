const MAX_CONCURRENT_REQUESTS = 10
const requestQueue = []
let activeRequests = 0

function processQueue() {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS || requestQueue.length === 0) {
    return
  }

  const { url, options, resolve, reject } = requestQueue.shift()
  activeRequests++

  wx.request({
    url: url,
    data: options.body,
    method: options.method,
    dataType: 'json',
    header:
      Object.prototype.toString.call(options.headers) == '[object Map]'
        ? Object.fromEntries(options.headers.entries())
        : options.headers,
    success(res) {
      if (res.statusCode >= 200 && res.statusCode <= 299) {
        res.ok = true
      } else {
        res.ok = false
      }
      res.headers = new Map(Object.entries(lowerJSONKey(res.header)))
      res.status = res.statusCode
      res.json = function () {
        return new Promise((resolve, reject) => {
          resolve(res.data)
        })
      }
      delete res.header
      delete res.statusCode
      resolve(res)
    },
    fail(err) {
      reject(err)
    },
    complete() {
      activeRequests--
      processQueue()
    },
  })
}

function myfetch(url, options) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ url, options, resolve, reject })
    processQueue()
  })
}

// header小写转换
function lowerJSONKey(jsonObj) {
  for (var key in jsonObj) {
    if (/[A-Z]/.test(key)) {
      jsonObj[key.toLowerCase()] = jsonObj[key]
      delete jsonObj[key]
    }
  }
  return jsonObj
}

export default myfetch
