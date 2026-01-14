# Changelog

All notable changes to this project will be documented in this file.

## [0.3.27] - 2026-01-14

### Fixed

- **Session 持久化问题**: 修复 `setItemAsync/getItemAsync/removeItemAsync` 函数不返回 Promise 导致的 session 保存失败
- **错误处理**: 为微信存储 API 包装函数添加完整的 try-catch 错误处理
- **调试日志**: 在 `signInWithWechat` 方法中添加详细的调试日志，方便追踪登录和 session 保存流程

### Changed

- `setItemAsync` 现在返回 `Promise<void>` 并包含错误处理
- `getItemAsync` 现在返回 `Promise<any | null>` 并包含错误处理
- `removeItemAsync` 增强了错误处理和日志记录

### Technical Details

此版本修复了微信小程序中登录成功但 session 未被持久化的关键问题。修复前，`wx.setStorageSync` 的同步调用被包装在一个非 Promise 函数中，导致调用方的 `await` 无法正确等待存储完成。现在所有存储操作都正确返回 Promise，并有完善的错误处理机制。

## [0.3.26] - Previous version

- 之前的稳定版本
