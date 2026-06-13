---

title: Chrome Extension Manifest V3 实战：Service Worker、存储 API 与 Laravel 后端集成
keywords: [Chrome Extension Manifest V3, Service Worker, API, Laravel, 存储, 后端集成, 前端]
date: 2026-06-10 09:11:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- Chrome Extension
- Manifest V3
- Service Worker
- Laravel
- 浏览器
description: 从零搭建一个基于 Manifest V3 的 Chrome 扩展，深入讲解 Service Worker 生命周期、chrome.storage API 的实战用法，以及与 Laravel 后端的完整集成方案。
---



## 前言

2024 年底，Chrome 正式弃用 Manifest V2，所有新提交的扩展必须基于 Manifest V3（MV3）。这次升级不仅仅是版本号的变化——Background Page 被 Service Worker 取代，`XMLHttpRequest` 被 `fetch` 取代，持久化后台脚本变成了随时可能被终止的短生命周期 Worker。

这些变化对很多开发者来说是痛苦的，但 MV3 带来了更好的安全性、性能和用户体验。本文将从零开始，构建一个完整的 Chrome 扩展项目：前端使用 Chrome Extension API，后端使用 Laravel 提供数据接口，完整覆盖开发流程。

## Manifest V3 核心变化

### 从 V2 到 V3，到底改了什么？

| 特性 | Manifest V2 | Manifest V3 |
|------|------------|-------------|
| 后台脚本 | Background Page（持久化） | Service Worker（短生命周期） |
| 网络请求 | `XMLHttpRequest` | `fetch` API |
| 内容安全策略 | `content_security_policy` 字符串 | 对象结构，支持 `sandbox` |
| 远程代码 | 允许（有风险） | 禁止 |
| Web Accessible Resources | 数组 | 对象，支持 `matches` 匹配 |
| 权限 | 安装时全部请求 | 支持 `optional_permissions` 动态申请 |

最核心的变化是 **Background Page → Service Worker**。这意味着你的后台脚本不再常驻内存，Chrome 会在需要时唤醒它，空闲时终止它。每次唤醒都是一次全新的执行上下文。

### manifest.json 基础结构

```json
{
  "manifest_version": 3,
  "name": "Laravel Helper",
  "version": "1.0.0",
  "description": "与 Laravel 后端集成的 Chrome 扩展",
  "permissions": [
    "storage",
    "alarms",
    "activeTab",
    "contextMenus"
  ],
  "host_permissions": [
    "https://your-laravel-app.com/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["https://your-laravel-app.com/*"],
      "js": ["content.js"],
      "css": ["content.css"]
    }
  ]
}
```

注意 `type: "module"` ——这允许你在 Service Worker 中使用 ES Module 的 `import/export` 语法，代码组织更清晰。

## Service Worker 生命周期详解

### 生命周期的五个阶段

```
安装(install) → 激活(activate) → 运行(idle) → 终止(terminated) → 唤醒(wakeup)
```

**关键约束：**

- Service Worker 没有 DOM 访问权限（`document`、`window` 都不存在）
- 没有 `XMLHttpRequest`，只能用 `fetch`
- 运行时间有限，空闲 30 秒后会被终止
- 每次唤醒都是全新的执行上下文，之前的变量全部丢失

### 实现一个健壮的 Service Worker

```js
// background.js

// ========== 安装阶段 ==========
self.addEventListener('install', (event) => {
  console.log('[SW] 安装完成');
  // 跳过等待，立即激活
  self.skipWaiting();
});

// ========== 激活阶段 ==========
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活完成');
  // 立即获取所有客户端的控制权
  event.waitUntil(self.clients.claim());
});

// ========== 消息监听 ==========
// 所有消息处理必须在这里注册，因为每次唤醒都是新的执行上下文
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[SW] 收到消息:', message.type);

  switch (message.type) {
    case 'SYNC_DATA':
      handleSyncData(message.payload).then(sendResponse);
      return true; // 异步响应必须返回 true

    case 'GET_USER_INFO':
      handleGetUserInfo().then(sendResponse);
      return true;

    default:
      sendResponse({ error: 'Unknown message type' });
  }
});

// ========== Alarm 定时任务 ==========
// 用 alarms API 替代 setInterval，这是 MV3 的推荐做法
chrome.alarms.create('sync-check', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync-check') {
    handlePeriodicSync();
  }
});

// ========== 工具安装事件 ==========
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 首次安装：初始化默认配置
    chrome.storage.local.set({
      apiBaseUrl: 'https://your-laravel-app.com/api',
      syncInterval: 5,
      installedAt: Date.now()
    });

    // 创建右键菜单
    chrome.contextMenus.create({
      id: 'save-to-laravel',
      title: '保存到 Laravel',
      contexts: ['selection', 'link']
    });
  }
});

// ========== 右键菜单点击 ==========
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-to-laravel') {
    handleContextMenuAction(info, tab);
  }
});
```

### 保持 Service Worker 存活的技巧

有些场景需要 Service Worker 持续运行（比如长连接上传），但 MV3 不允许这样做。几个替代方案：

```js
// 方案 1：使用 chrome.alarms（最小间隔 1 分钟）
chrome.alarms.create('keep-alive', { periodInMinutes: 1 });

// 方案 2：使用 Port 连接（popup 或 content script 打开时保持存活）
chrome.runtime.onConnect.addListener((port) => {
  console.log('[SW] 端口连接:', port.name);
  port.onDisconnect.addListener(() => {
    console.log('[SW] 端口断开');
  });
});

// 方案 3：对于长任务，拆分成小批次
async function processLargeDataset(items) {
  const BATCH_SIZE = 50;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await processBatch(batch);
    // 给浏览器喘息的时间
    await new Promise(r => setTimeout(r, 10));
  }
}
```

## Chrome Storage API 实战

MV3 中不能使用 `localStorage`（Service Worker 中不可用），必须使用 `chrome.storage` API。

### chrome.storage.local vs chrome.storage.sync

| 特性 | `local` | `sync` |
|------|---------|--------|
| 存储位置 | 本地磁盘 | Chrome 同步服务器 |
| 容量 | 10 MB | 100 KB |
| 跨设备 | 不同步 | 自动同步 |
| 速度 | 快 | 受网络影响 |
| 适用场景 | 大量数据、缓存 | 用户配置、小数据 |

### 封装一个实用的 Storage 工具类

```js
// storage.js

class ExtensionStorage {
  /**
   * 获取数据
   * @param {string|string[]|null} keys
   * @returns {Promise<object>}
   */
  static async get(keys = null) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          console.error('Storage get error:', chrome.runtime.lastError);
          resolve({});
          return;
        }
        resolve(result);
      });
    });
  }

  /**
   * 设置数据
   * @param {object} data
   */
  static async set(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(true);
      });
    });
  }

  /**
   * 删除数据
   * @param {string|string[]} keys
   */
  static async remove(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, resolve);
    });
  }

  /**
   * 带过期时间的存储
   * @param {string} key
   * @param {*} value
   * @param {number} ttlMs 过期时间（毫秒）
   */
  static async setWithTTL(key, value, ttlMs) {
    const record = {
      value,
      expiresAt: Date.now() + ttlMs
    };
    await this.set({ [key]: record });
  }

  /**
   * 获取带过期时间的数据（过期返回 null）
   * @param {string} key
   * @returns {Promise<*>}
   */
  static async getWithTTL(key) {
    const result = await this.get(key);
    const record = result[key];

    if (!record) return null;
    if (Date.now() > record.expiresAt) {
      await this.remove(key);
      return null;
    }
    return record.value;
  }

  /**
   * 监听存储变化
   * @param {string} key
   * @param {Function} callback
   */
  static onChanged(key, callback) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[key]) {
        callback(changes[key].newValue, changes[key].oldValue);
      }
    });
  }
}

export default ExtensionStorage;
```

### 实战：缓存 Laravel API 响应

```js
// api-client.js
import ExtensionStorage from './storage.js';

class LaravelAPI {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.token = null;
  }

  async init() {
    const config = await ExtensionStorage.get(['apiBaseUrl', 'authToken']);
    this.baseUrl = config.apiBaseUrl || this.baseUrl;
    this.token = config.authToken;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (response.status === 401) {
        // Token 过期，清除本地存储的 token
        await ExtensionStorage.remove('authToken');
        throw new Error('认证失败，请重新登录');
      }

      if (!response.ok) {
        throw new Error(`API 错误: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API 请求失败:', error);
      throw error;
    }
  }

  /**
   * 带缓存的 GET 请求
   */
  async cachedGet(endpoint, cacheTTL = 5 * 60 * 1000) {
    const cacheKey = `cache:GET:${endpoint}`;

    // 先查缓存
    const cached = await ExtensionStorage.getWithTTL(cacheKey);
    if (cached) {
      console.log('[API] 缓存命中:', endpoint);
      return cached;
    }

    // 缓存未命中，请求 API
    console.log('[API] 缓存未命中，请求:', endpoint);
    const data = await this.request(endpoint);

    // 写入缓存
    await ExtensionStorage.setWithTTL(cacheKey, data, cacheTTL);
    return data;
  }
}

export default LaravelAPI;
```

## Popup 界面开发

Popup 是用户点击扩展图标时弹出的小窗口。它有独立的 DOM 环境，可以自由使用 HTML/CSS/JS。

### popup.html

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 360px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      color: #333;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px;
    }
    .header h1 { font-size: 16px; margin-bottom: 4px; }
    .header p { font-size: 12px; opacity: 0.8; }
    .content { padding: 16px; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .card h3 { font-size: 14px; margin-bottom: 8px; }
    .btn {
      display: inline-block;
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.85; }
    .btn-primary { background: #667eea; color: white; }
    .btn-danger { background: #e74c3c; color: white; }
    .status { font-size: 12px; color: #666; margin-top: 8px; }
    .stats { display: flex; gap: 12px; }
    .stat-item { text-align: center; flex: 1; }
    .stat-value { font-size: 24px; font-weight: bold; color: #667eea; }
    .stat-label { font-size: 11px; color: #999; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Laravel Helper</h1>
    <p id="connection-status">检测连接中...</p>
  </div>
  <div class="content">
    <div class="card">
      <h3>数据同步</h3>
      <div class="stats">
        <div class="stat-item">
          <div class="stat-value" id="synced-count">0</div>
          <div class="stat-label">已同步</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" id="pending-count">0</div>
          <div class="stat-label">待同步</div>
        </div>
      </div>
      <button class="btn btn-primary" id="sync-btn" style="margin-top: 12px; width: 100%;">
        立即同步
      </button>
    </div>
    <div class="card">
      <h3>快速操作</h3>
      <button class="btn btn-primary" id="save-current" style="margin-right: 8px;">
        保存当前页面
      </button>
      <button class="btn btn-danger" id="clear-cache">
        清除缓存
      </button>
    </div>
    <p class="status" id="last-sync">上次同步：从未</p>
  </div>
  <script src="popup.js" type="module"></script>
</body>
</html>
```

### popup.js

```js
// popup.js
import ExtensionStorage from './storage.js';
import LaravelAPI from './api-client.js';

const api = new LaravelAPI();

document.addEventListener('DOMContentLoaded', async () => {
  await api.init();
  await updateStatus();
  bindEvents();
});

async function updateStatus() {
  // 检测后端连接
  try {
    const health = await api.request('/health');
    document.getElementById('connection-status').textContent =
      `已连接 · ${health.version || 'Laravel'}`;
    document.getElementById('connection-status').style.color = '#4ade80';
  } catch {
    document.getElementById('connection-status').textContent = '连接失败';
    document.getElementById('connection-status').style.color = '#f87171';
  }

  // 统计数据
  const data = await ExtensionStorage.get(['syncedItems', 'pendingItems', 'lastSyncAt']);
  document.getElementById('synced-count').textContent = data.syncedItems?.length || 0;
  document.getElementById('pending-count').textContent = data.pendingItems?.length || 0;

  if (data.lastSyncAt) {
    const ago = formatTimeAgo(data.lastSyncAt);
    document.getElementById('last-sync').textContent = `上次同步：${ago}`;
  }
}

function bindEvents() {
  // 同步按钮
  document.getElementById('sync-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sync-btn');
    btn.disabled = true;
    btn.textContent = '同步中...';

    try {
      // 发消息给 Service Worker 执行同步
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_DATA',
        payload: { force: true }
      });

      if (response.success) {
        btn.textContent = '同步完成 ✓';
        await updateStatus();
      } else {
        btn.textContent = '同步失败';
      }
    } catch (error) {
      btn.textContent = `错误: ${error.message}`;
    }

    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = '立即同步';
    }, 2000);
  });

  // 保存当前页面
  document.getElementById('save-current').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.runtime.sendMessage({
        type: 'SAVE_PAGE',
        payload: { url: tab.url, title: tab.title }
      });
      window.close();
    }
  });

  // 清除缓存
  document.getElementById('clear-cache').addEventListener('click', async () => {
    if (confirm('确定清除所有缓存数据？')) {
      await chrome.storage.local.clear();
      await updateStatus();
    }
  });
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}
```

## Content Script 与页面交互

Content Script 运行在网页的上下文中，可以访问和修改 DOM，但与网页的 JavaScript 隔离（独立的 JS 环境）。

```js
// content.js

// 注入自定义 UI
function injectSidebar() {
  const sidebar = document.createElement('div');
  sidebar.id = 'laravel-helper-sidebar';
  sidebar.innerHTML = `
    <div style="
      position: fixed;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      background: white;
      border-radius: 8px 0 0 8px;
      box-shadow: -2px 0 10px rgba(0,0,0,0.1);
      padding: 12px;
      z-index: 999999;
      font-family: -apple-system, sans-serif;
      transition: right 0.3s;
    ">
      <button id="lh-save" style="
        background: #667eea;
        color: white;
        border: none;
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        display: block;
        width: 100%;
        margin-bottom: 8px;
      ">保存页面</button>
      <button id="lh-note" style="
        background: #f5f5f5;
        color: #333;
        border: 1px solid #ddd;
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        display: block;
        width: 100%;
      ">添加笔记</button>
    </div>
  `;
  document.body.appendChild(sidebar);

  // 保存当前页面
  document.getElementById('lh-save').addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'SAVE_PAGE',
      payload: {
        url: window.location.href,
        title: document.title,
        selectedText: window.getSelection()?.toString() || ''
      }
    }, (response) => {
      showToast(response.success ? '保存成功' : '保存失败');
    });
  });
}

// 简单的 Toast 提示
function showToast(message) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: white;
    padding: 10px 20px;
    border-radius: 6px;
    z-index: 999999;
    font-size: 14px;
    animation: fadeInOut 2s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// 与网页 JS 通信（通过 CustomEvent）
function listenToPageEvents() {
  window.addEventListener('laravel-helper-action', (event) => {
    const { action, data } = event.detail;
    chrome.runtime.sendMessage({ type: action, payload: data });
  });
}

// 初始化
injectSidebar();
listenToPageEvents();

// 监听来自 background/popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'HIGHLIGHT_TEXT') {
    highlightText(message.payload.text);
    sendResponse({ success: true });
  }
});
```

## Laravel 后端集成

### API 路由设计

```php
// routes/api.php

use App\Http\Controllers\ExtensionController;

Route::prefix('extension')->group(function () {
    // 公开接口
    Route::post('/auth/login', [ExtensionController::class, 'login']);
    Route::get('/health', [ExtensionController::class, 'health']);

    // 需要认证的接口
    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/user', [ExtensionController::class, 'user']);
        Route::post('/pages', [ExtensionController::class, 'savePage']);
        Route::get('/pages', [ExtensionController::class, 'listPages']);
        Route::post('/sync', [ExtensionController::class, 'sync']);
        Route::get('/notes', [ExtensionController::class, 'listNotes']);
        Route::post('/notes', [ExtensionController::class, 'createNote']);
    });
});
```

### ExtensionController 实现

```php
<?php

namespace App\Http\Controllers;

use App\Models\SavedPage;
use App\Models\Note;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class ExtensionController extends Controller
{
    public function health()
    {
        return response()->json([
            'status' => 'ok',
            'version' => config('app.version', '1.0.0'),
            'timestamp' => now()->toISOString(),
        ]);
    }

    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        $credentials = $request->only('email', 'password');

        if (!Auth::attempt($credentials)) {
            return response()->json([
                'message' => '认证失败'
            ], 401);
        }

        $user = Auth::user();
        $token = $user->createToken('chrome-extension')->plainTextToken;

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
            ],
            'token' => $token,
        ]);
    }

    public function user(Request $request)
    {
        return response()->json([
            'user' => $request->user()->only(['id', 'name', 'email']),
        ]);
    }

    public function savePage(Request $request)
    {
        $request->validate([
            'url' => 'required|url',
            'title' => 'required|string|max:500',
            'content' => 'nullable|string',
            'selected_text' => 'nullable|string',
            'tags' => 'nullable|array',
            'tags.*' => 'string|max:50',
        ]);

        $page = SavedPage::create([
            'user_id' => $request->user()->id,
            'url' => $request->url,
            'title' => $request->title,
            'content' => $request->input('content'),
            'selected_text' => $request->input('selected_text'),
            'tags' => $request->input('tags', []),
            'saved_at' => now(),
        ]);

        return response()->json([
            'page' => $page,
            'message' => '页面保存成功',
        ], 201);
    }

    public function listPages(Request $request)
    {
        $pages = SavedPage::where('user_id', $request->user()->id)
            ->orderBy('saved_at', 'desc')
            ->paginate($request->input('per_page', 20));

        return response()->json($pages);
    }

    /**
     * 批量同步接口
     * 接收扩展端离线时积累的数据，批量写入
     */
    public function sync(Request $request)
    {
        $request->validate([
            'items' => 'required|array',
            'items.*.type' => 'required|in:page,note',
            'items.*.data' => 'required|array',
            'items.*.client_id' => 'required|string',
        ]);

        $results = [];
        $user = $request->user();

        foreach ($request->input('items') as $item) {
            try {
                if ($item['type'] === 'page') {
                    $record = SavedPage::create(array_merge(
                        $item['data'],
                        ['user_id' => $user->id]
                    ));
                } else {
                    $record = Note::create(array_merge(
                        $item['data'],
                        ['user_id' => $user->id]
                    ));
                }

                $results[] = [
                    'client_id' => $item['client_id'],
                    'status' => 'synced',
                    'server_id' => $record->id,
                ];
            } catch (\Exception $e) {
                $results[] = [
                    'client_id' => $item['client_id'],
                    'status' => 'error',
                    'message' => $e->getMessage(),
                ];
            }
        }

        return response()->json([
            'synced' => count(array_filter($results, fn($r) => $r['status'] === 'synced')),
            'errors' => count(array_filter($results, fn($r) => $r['status'] === 'error')),
            'results' => $results,
        ]);
    }

    public function createNote(Request $request)
    {
        $request->validate([
            'content' => 'required|string',
            'source_url' => 'nullable|url',
            'source_title' => 'nullable|string|max:500',
        ]);

        $note = Note::create([
            'user_id' => $request->user()->id,
            'content' => $request->content,
            'source_url' => $request->input('source_url'),
            'source_title' => $request->input('source_title'),
        ]);

        return response()->json(['note' => $note], 201);
    }

    public function listNotes(Request $request)
    {
        $notes = Note::where('user_id', $request->user()->id)
            ->orderBy('created_at', 'desc')
            ->paginate(20);

        return response()->json($notes);
    }
}
```

### 数据模型

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SavedPage extends Model
{
    protected $fillable = [
        'user_id', 'url', 'title', 'content',
        'selected_text', 'tags', 'saved_at',
    ];

    protected $casts = [
        'tags' => 'array',
        'saved_at' => 'datetime',
    ];

    protected $attributes = [
        'tags' => '[]',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
```

### 数据库迁移

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::create('saved_pages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('url');
            $table->string('title', 500);
            $table->longText('content')->nullable();
            $table->text('selected_text')->nullable();
            $table->json('tags')->nullable();
            $table->timestamp('saved_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'saved_at']);
        });

        Schema::create('notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('content');
            $table->text('source_url')->nullable();
            $table->string('source_title', 500)->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
        });
    }

    public function down()
    {
        Schema::dropIfExists('notes');
        Schema::dropIfExists('saved_pages');
    }
};
```

## 踩坑记录

### 坑 1：Service Worker 中忘记 `return true`

```js
// ❌ 错误：异步响应不会发回
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  fetch('/api/data').then(r => r.json()).then(sendResponse);
});

// ✅ 正确：必须返回 true 告诉 Chrome "我会异步调用 sendResponse"
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  fetch('/api/data').then(r => r.json()).then(sendResponse);
  return true;
});
```

### 坑 2：Service Worker 被终止后 Alarm 不触发

Chrome 在某些情况下会延迟或跳过 Alarm。解决方案：

```js
// 在 Service Worker 唤醒时检查是否有遗漏的任务
self.addEventListener('activate', (event) => {
  event.waitUntil(
    checkPendingTasks().then(() => self.clients.claim())
  );
});

async function checkPendingTasks() {
  const data = await ExtensionStorage.get('pendingItems');
  if (data.pendingItems?.length > 0) {
    console.log('[SW] 发现待处理任务:', data.pendingItems.length);
    await processPendingItems(data.pendingItems);
  }
}
```

### 坑 3：Content Script 无法访问网页的 JS 变量

Content Script 运行在隔离环境中，`window.myApp` 这样的变量是访问不到的。需要注入脚本到页面上下文：

```js
// 在 Content Script 中注入页面脚本
function injectPageScript(code) {
  const script = document.createElement('script');
  script.textContent = code;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

// 注入一个消息桥
injectPageScript(`
  window.addEventListener('message', (event) => {
    if (event.data.type === 'FROM_EXTENSION') {
      // 这里可以访问网页的 JS 变量
      const data = window.__APP_STATE__;
      window.postMessage({ type: 'TO_EXTENSION', data }, '*');
    }
  });
`);
```

### 坑 4：CORS 问题

扩展请求 Laravel API 时可能遇到 CORS 错误。两种解决方案：

**方案 A：在 Laravel 中配置 CORS**

```php
// config/cors.php
return [
    'paths' => ['api/*'],
    'allowed_origins' => ['chrome-extension://YOUR_EXTENSION_ID'],
    'allowed_methods' => ['*'],
    'allowed_headers' => ['*'],
    'supports_credentials' => true,
];
```

**方案 B：使用 `host_permissions` 绕过 CORS**

在 `manifest.json` 中声明目标域名的 `host_permissions`，Chrome 扩展发出的请求不受 CORS 限制。

## 调试技巧

1. **Service Worker 调试**：`chrome://extensions` → 你的扩展 → "Service Worker" 链接 → 打开 DevTools
2. **查看日志**：Service Worker 的 Console 面板可以看到所有 `console.log`
3. **模拟唤醒/终止**：Service Worker 面板有 "Stop" 和 "Start" 按钮
4. **存储查看**：DevTools → Application → Storage → Extension Storage
5. **重载扩展**：修改代码后点击扩展卡片上的刷新按钮，或 `Ctrl+R`

## 总结

Chrome Extension Manifest V3 的核心变化是 Service Worker 取代了持久化后台脚本。这要求我们改变思维方式：

- **无状态优先**：不要依赖内存中的变量，所有持久化数据用 `chrome.storage`
- **异步优先**：消息传递、API 调用都是异步的，注意 `return true`
- **Alarm 替代定时器**：`chrome.alarms` 是 MV3 中唯一可靠的定时机制
- **离线优先**：扩展随时可能失去网络，做好本地缓存和队列

与 Laravel 后端的集成思路是清晰的：扩展端负责数据采集和 UI 交互，Laravel 负责数据持久化和业务逻辑。通过 Sanctum 认证 + 批量同步接口，可以实现可靠的离线-在线数据同步。

完整项目结构：

```
my-extension/
├── manifest.json
├── background.js          # Service Worker
├── popup.html             # Popup 界面
├── popup.js               # Popup 逻辑
├── content.js             # Content Script
├── content.css            # 注入样式
├── storage.js             # 存储工具类
├── api-client.js          # API 客户端
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

MV3 虽然有学习曲线，但它的安全性（禁止远程代码）和性能（Service Worker 不常驻内存）是值得的。掌握了 Service Worker 的生命周期管理，其他部分其实就是标准的 Web 开发。
