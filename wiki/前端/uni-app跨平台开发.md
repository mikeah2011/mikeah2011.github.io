# uni-app 跨平台开发

## 定义
uni-app 是 DCloud 推出的跨平台开发框架，使用 Vue 语法编写一套代码，可编译到微信小程序、H5、iOS App、Android App 等多个平台。基于 Vue 3 + Vite 的现代工作流已成为主流。

## 核心原理

### 条件编译
uni-app 的核心机制，通过注释指令实现平台差异化代码：
```javascript
// #ifdef MP-WEIXIN
wx.login({ success: (res) => { /* 微信登录 */ } })
// #endif

// #ifdef APP-PLUS
plus.runtime.openURL('weixin://')  // App 中打开微信
// #endif

// #ifdef H5
window.location.href = '/oauth/wechat'  // H5 中跳转 OAuth
// #endif
```

### 平台标识
| 标识 | 平台 |
|------|------|
| `MP-WEIXIN` | 微信小程序 |
| `MP-ALIPAY` | 支付宝小程序 |
| `APP-PLUS` | App（iOS/Android） |
| `H5` | 网页 |
| `MP` | 所有小程序 |

### 项目结构
```
├── pages/           # 页面
├── components/      # 组件
├── pages.json       # 页面路由配置
├── manifest.json    # 应用配置
├── uni.scss         # 全局样式变量
└── App.vue          # 应用入口
```

### 多端发布流程
```
源码 → HBuilderX/CLI 编译
  ├── 微信小程序 → 微信开发者工具 → 上传审核
  ├── H5         → Web 服务器部署
  ├── iOS        → Xcode 打包 → App Store
  └── Android    → Android Studio → 各应用市场
```

## 核心能力

### 微信小程序
- 登录授权（`uni.login` + `wx.login`）
- 支付（`uni.requestPayment`）
- 分享（`onShareAppMessage`）
- 获取用户信息

### App 原生能力
- Native.js 调用原生 SDK
- 推送通知（极光/个推/UniPush）
- 离线存储（SQLite/IndexedDB）
- nvue 原生渲染

### 自定义组件
- 跨平台组件封装
- 插件市场发布
- 原生插件开发

## 实战案例
来自博客文章：
- [uni-app 微信小程序实战](/categories/Frontend/uni-app-guide-1/) - 登录、支付、分享完整流程
- [uni-app 条件编译实战](/categories/Frontend/uni-app-guide/) - 平台差异处理与适配策略
- [uni-app + Vue 3 + Vite](/categories/Frontend/uni-app-vue3-vite/) - 现代跨平台开发工作流
- [uni-app App 打包实战](/categories/Frontend/uni-app-app-guide-ios-android/) - iOS/Android 原生打包与发布
- [uni-app Native.js 原生插件](/categories/Frontend/uni-app-native-js-guide-sdk/) - 原生 SDK 集成
- [uni-app 多端适配实战](/categories/Frontend/uni-app-guide-h5-app/) - H5/微信小程序/App 一套代码
- [uni-app 自定义组件实战](/categories/Frontend/2026-06-01-uni-app-custom-component-cross-platform-native-plugin-marketplace/) - 跨平台原生组件封装
- [uni-app 推送通知实战](/categories/Frontend/2026-06-01-uni-app-push-notification-jpush-getui-unipush-vendor-channel-adaptation/) - 极光推送/个推/UniPush
- [uni-app 离线存储实战](/categories/Frontend/2026-06-01-uni-app-offline-storage-sqlite-indexeddb-data-sync-conflict-resolution/) - SQLite/IndexedDB 数据同步
- [HBuilderX 实战](/categories/Frontend/hbuilderx-guide-uni-app-ide/) - uni-app 官方 IDE

## 相关概念
- [uni-app 性能优化](uni-app性能优化.md) - 首屏、分包、懒加载优化
- [Vue 3 Composition API](Vue3-Composition-API.md) - uni-app Vue 3 版本基于此
- [Vite 深度实战](Vite深度实战.md) - uni-app Vue 3 版本使用 Vite 构建

## 常见问题

**Q: uni-app vs Flutter vs React Native？**
A: uni-app 适合国内生态（小程序优先），Flutter 适合高性能 UI，React Native 适合已有 React 技术栈。

**Q: uni-app 性能够用吗？**
A: H5 和小程序场景足够。App 场景如需极致性能，可使用 nvue 原生渲染页面。
