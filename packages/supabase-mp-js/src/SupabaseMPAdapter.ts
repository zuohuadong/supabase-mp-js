/**
 * Supabase Storage Adapter for WeChat Mini Program
 * Uses wx.getStorageSync / wx.setStorageSync / wx.removeStorageSync
 */
export class SupabaseMPAdapter {
  getItem(key: string): string | null {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null
    try {
      const value = wx.getStorageSync(key)
      if (value == null || value === '') return null
      return typeof value === 'string' ? value : JSON.stringify(value)
    } catch (e) {
      console.error('Error getting item from storage', e)
      return null
    }
  }

  setItem(key: string, value: string): void {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return
    try {
      wx.setStorageSync(key, value)
    } catch (e) {
      console.error('Error setting item to storage', e)
    }
  }

  removeItem(key: string): void {
    if (typeof wx === 'undefined' || typeof wx.removeStorageSync !== 'function') return
    try {
      wx.removeStorageSync(key)
    } catch (e) {
      console.error('Error removing item from storage', e)
    }
  }
}
