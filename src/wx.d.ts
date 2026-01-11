// Basic type definitions for WeChat Mini Program API used in this library
declare namespace WechatMiniprogram {
  interface Wx {
    request(options: RequestOption): RequestTask
    uploadFile(options: UploadFileOption): UploadTask
    connectSocket(options: ConnectSocketOption): SocketTask
    getStorageSync(key: string): any
    setStorageSync(key: string, data: any): void
    removeStorageSync(key: string): void
    getFileSystemManager(): FileSystemManager
    arrayBufferToBase64(buffer: ArrayBuffer): string
  }

  interface FileSystemManager {
    stat(options: {
      path: string
      success?: (res: Stats) => void
      fail?: (res: GeneralCallbackResult) => void
    }): void
    readFile(options: {
      filePath: string
      encoding?: string
      position?: number
      length?: number
      success?: (res: ReadFileSuccessCallbackResult) => void
      fail?: (res: GeneralCallbackResult) => void
    }): void
  }

  interface Stats {
    mode: number
    size: number
    lastAccessedTime: number
    lastModifiedTime: number
    isDirectory(): boolean
    isFile(): boolean
  }

  interface ReadFileSuccessCallbackResult {
    data: string | ArrayBuffer
    errMsg: string
  }

  interface RequestOption {
    url: string
    data?: any
    header?: any
    method?: 'OPTIONS' | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'TRACE' | 'CONNECT'
    dataType?: string
    responseType?: string
    success?: (res: RequestSuccessCallbackResult) => void
    fail?: (res: GeneralCallbackResult) => void
    complete?: (res: GeneralCallbackResult) => void
  }

  interface RequestSuccessCallbackResult {
    data: any
    statusCode: number
    header: any
    cookies?: string[]
    errMsg: string
  }

  interface GeneralCallbackResult {
    errMsg: string
    errno?: number
  }

  interface RequestTask {
    abort(): void
  }

  interface UploadFileOption {
    url: string
    filePath: string
    name: string
    header?: any
    formData?: any
    success?: (res: UploadFileSuccessCallbackResult) => void
    fail?: (res: GeneralCallbackResult) => void
  }

  interface UploadFileSuccessCallbackResult {
    data: string
    statusCode: number
    errMsg: string
  }

  interface UploadTask {
    abort(): void
  }

  interface ConnectSocketOption {
    url: string
    header?: any
    protocols?: string[]
    tcpNoDelay?: boolean
  }

  interface SocketTask {
    send(options: { data: string | ArrayBuffer }): void
    close(options?: { code?: number; reason?: string }): void
    onOpen(callback: (res: any) => void): void
    onClose(callback: (res: any) => void): void
    onError(callback: (res: { errMsg: string }) => void): void
    onMessage(callback: (res: { data: string | ArrayBuffer }) => void): void
    binaryType?: string
    readyState: number
  }
}

declare const wx: WechatMiniprogram.Wx
