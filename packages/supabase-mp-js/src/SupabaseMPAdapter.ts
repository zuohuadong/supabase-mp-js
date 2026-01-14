/**
 * Supabase Storage Adapter for WeChat Mini Program
 * Uses wx.getStorageSync / wx.setStorageSync / wx.removeStorageSync
 */
declare const wx: any

export class SupabaseMPAdapter {
  getItem(key: string): string | null {
    try {
      return wx.getStorageSync(key)
    } catch (e) {
      console.error('Error getting item from storage', e)
      return null
    }
  }

  setItem(key: string, value: string): void {
    try {
      wx.setStorageSync(key, value)
    } catch (e) {
      console.error('Error setting item to storage', e)
    }
  }

  removeItem(key: string): void {
    try {
      wx.removeStorageSync(key)
    } catch (e) {
      console.error('Error removing item from storage', e)
    }
  }
}
