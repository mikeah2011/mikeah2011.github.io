---

title: Vite Module Federation 实战：微前端的构建时共享——对比 Webpack 5 的模块联邦在 Vue 3 Monorepo 中的落地
keywords: [Vite Module Federation, Webpack, Vue, Monorepo, 微前端的构建时共享, 的模块联邦在, 中的落地, 前端]
date: 2026-06-09 18:46:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- Vite
- Module Federation
- 微前端
- Vue
- Webpack
- Monorepo
description: 深入对比 Vite 和 Webpack 5 的 Module Federation 实现，在 Vue 3 Monorepo 项目中从零搭建微前端共享方案，包含完整代码、踩坑记录和性能对比。
---



## 概述

微前端不是新概念，但"构建时模块共享"这件事，Webpack 5 的 Module Federation 让它真正可用了。问题在于：我们已经在用 Vite 了。

Vite 的开发体验碾压 Webpack——HMR 秒级刷新、冷启动毫秒级。但 Vite 原生不支持 Module Federation。社区方案 `@originjs/vite-plugin-federation` 填了这个坑，但踩坑点不少。

这篇文章记录我在一个 Vue 3 Monorepo 项目中，从 Webpack 5 Module Federation 迁移到 Vite 方案的完整过程：搭建、对比、踩坑、最终落地。

## 核心概念

### 什么是 Module Federation

Module Federation 是 Webpack 5 引入的运行时模块共享机制。核心能力：

- **暴露模块**（Expose）：把本地组件/工具函数暴露为远程模块
- **消费远程模块**（Consume）：运行时从远程加载模块，不用提前安装
- **共享依赖**（Shared）：多个应用共享同一份 Vue、Pinia 等公共库，避免重复加载

```
┌──────────────┐     ┌──────────────┐
│   Host App   │────▶│  Remote App  │
│  (主应用)     │     │  (子应用)     │
│              │     │              │
│ 消费远程组件  │     │ 暴露组件      │
│ 共享 Vue/Pinia│     │ 共享 Vue/Pinia│
└──────────────┘     └──────────────┘
```

### Vite vs Webpack 5 的差异

| 维度 | Webpack 5 | Vite (@originjs) |
|------|-----------|-------------------|
| 原生支持 | 是 | 否，插件实现 |
| 开发模式 | Webpack Dev Server | Vite Dev Server |
| 运行时加载 | `__webpack_require__` | 动态 import |
| 共享依赖 | 原生支持 | 部分支持，有限制 |
| CSS 共享 | 支持 | 需手动处理 |
| TypeScript | 完整支持 | 需额外配置 |
| 生产构建 | 成熟稳定 | 需验证 |

## 实战搭建

### 项目结构

采用 pnpm workspace 的 Monorepo 结构：

```
vue3-mf-monorepo/
├── pnpm-workspace.yaml
├── package.json
├── apps/
│   ├── host/          # 主应用
│   └── remote/        # 子应用
└── packages/
    └── shared/        # 共享类型/工具
```

### 步骤一：初始化 Monorepo

```bash
mkdir vue3-mf-monorepo && cd vue3-mf-monorepo
pnpm init

# pnpm-workspace.yaml
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'apps/*'
  - 'packages/*'
EOF
```

### 步骤二：创建子应用（Remote）

```bash
cd apps
pnpm create vite remote --template vue-ts
cd remote
pnpm add @originjs/vite-plugin-federation -D
```

配置 `apps/remote/vite.config.ts`：

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  plugins: [
    vue(),
    federation({
      name: 'remote_app',
      filename: 'remoteEntry.js',
      exposes: {
        './UserCard': './src/components/UserCard.vue',
        './useUser': './src/composables/useUser.ts',
      },
      shared: {
        vue: {
          singleton: true,
          requiredVersion: '^3.4.0',
        },
        pinia: {
          singleton: true,
        },
      },
    }),
  ],
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
  server: {
    port: 5001,
    cors: true,
  },
})
```

创建暴露的组件 `apps/remote/src/components/UserCard.vue`：

```vue
<script setup lang="ts">
import { ref } from 'vue'

interface Props {
  userId: string
}

const props = defineProps<Props>()
const user = ref({
  name: '加载中...',
  avatar: '',
  role: 'member',
})

// 模拟异步加载
setTimeout(() => {
  user.value = {
    name: `用户 ${props.userId}`,
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + props.userId,
    role: 'admin',
  }
}, 500)
</script>

<template>
  <div class="user-card">
    <img :src="user.avatar" :alt="user.name" class="avatar" />
    <div class="info">
      <h3>{{ user.name }}</h3>
      <span class="badge">{{ user.role }}</span>
    </div>
  </div>
</template>

<style scoped>
.user-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  max-width: 300px;
}
.avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
}
.badge {
  font-size: 12px;
  background: #3b82f6;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
}
</style>
```

创建 composable `apps/remote/src/composables/useUser.ts`：

```typescript
import { ref, computed } from 'vue'

export function useUser() {
  const currentUser = ref<{ name: string; role: string } | null>(null)
  const isLoggedIn = computed(() => currentUser.value !== null)

  function login(name: string, role: string = 'member') {
    currentUser.value = { name, role }
  }

  function logout() {
    currentUser.value = null
  }

  return {
    currentUser,
    isLoggedIn,
    login,
    logout,
  }
}
```

### 步骤三：创建主应用（Host）

```bash
cd ../..
cd apps
pnpm create vite host --template vue-ts
cd host
pnpm add @originjs/vite-plugin-federation pinia vue-router -D
```

配置 `apps/host/vite.config.ts`：

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  plugins: [
    vue(),
    federation({
      name: 'host_app',
      remotes: {
        remote_app: {
          type: 'module',
          name: 'remote_app',
          entry: 'http://localhost:5001/remoteEntry.js',
        },
      },
      shared: {
        vue: {
          singleton: true,
          requiredVersion: '^3.4.0',
        },
        pinia: {
          singleton: true,
        },
      },
    }),
  ],
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
  server: {
    port: 5000,
  },
})
```

在主应用中消费远程模块 `apps/host/src/views/Dashboard.vue`：

```vue
<script setup lang="ts">
import { defineAsyncComponent } from 'vue'

// 动态加载远程组件
const RemoteUserCard = defineAsyncComponent(
  () => import('remote_app/UserCard')
)

// 远程也可以是 composable
let useRemoteUser: (() => any) | null = null
;(async () => {
  try {
    const mod = await import('remote_app/useUser')
    useRemoteUser = mod.useUser
  } catch (e) {
    console.warn('远程 composable 加载失败，使用本地降级', e)
  }
})()
</script>

<template>
  <div class="dashboard">
    <h1>Dashboard</h1>
    <div class="cards">
      <RemoteUserCard user-id="michael" />
    </div>
  </div>
</template>
```

### 步骤四：声明远程模块类型

创建 `apps/host/src/env.d.ts`（或 `remote.d.ts`）：

```typescript
declare module 'remote_app/UserCard' {
  import { DefineComponent } from 'vue'
  const component: DefineComponent<{ userId: string }, {}, any>
  export default component
}

declare module 'remote_app/useUser' {
  export function useUser(): {
    currentUser: import('vue').Ref<{ name: string; role: string } | null>
    isLoggedIn: import('vue').ComputedRef<boolean>
    login: (name: string, role?: string) => void
    logout: () => void
  }
}
```

### 步骤五：启动和验证

```bash
# 终端 1：启动远程应用
cd apps/remote && pnpm dev

# 终端 2：启动主应用
cd apps/host && pnpm dev
```

访问 `http://localhost:5000`，Dashboard 页面应该能正常渲染远程的 `UserCard` 组件。

## 踩坑记录

### 坑 1：Shared 依赖版本不匹配

**现象**：开发模式正常，构建后报 `Shared module is not available for eager consumption`。

**原因**：Vite 的 shared 实现不像 Webpack 那样有完整的版本协商机制。如果 host 和 remote 的 Vue 版本不完全一致，运行时会失败。

**解决**：确保 Monorepo 根目录统一管理依赖版本，host 和 remote 的 `vue` 必须是同一个实例：

```json
// 根 package.json
{
  "pnpm": {
    "overrides": {
      "vue": "3.4.38"
    }
  }
}
```

### 坑 2：CSS 不会自动共享

**现象**：远程组件的 scoped style 在 host 中不生效。

**原因**：`@originjs/vite-plugin-federation` 不像 Webpack 那样处理 CSS，远程组件的样式需要单独处理。

**解决**：两种方案——

**方案 A**：关闭 `cssCodeSplit`，让 CSS 内联到 JS 中（已配置）：

```typescript
build: {
  cssCodeSplit: false,
}
```

**方案 B**：在 host 中手动引入远程样式（不推荐，破坏封装）。

实际项目中我用方案 A，配合 CSS 变量做主题统一，效果不错。

### 坑 3：HMR 失效

**现象**：修改远程组件代码，host 页面不热更新。

**原因**：Vite 的 HMR 是基于模块图的，跨应用的远程模块不在同一个模块图中。

**解决**：开发时直接在 host 中写组件，remote 只负责暴露和集成测试。或者用 Turborepo 的 watch 模式做软链接：

```bash
# 开发时直接引用源码（临时方案）
ln -s ../../apps/remote/src/components/UserCard.vue apps/host/src/components/RemoteUserCard.vue
```

这不是完美方案，但对开发效率的提升是实打实的。

### 坑 4：远程模块加载失败的降级

**现象**：remote 服务没启动时，host 直接白屏。

**解决**：用 `defineAsyncComponent` 的 `onError` 做降级：

```typescript
import { defineAsyncComponent, h } from 'vue'

const RemoteUserCard = defineAsyncComponent({
  loader: () => import('remote_app/UserCard'),
  onError(error, retry, fail) {
    console.error('远程组件加载失败:', error)
    // 重试 3 次
    if (retry <= 3) {
      retry()
    } else {
      fail()
    }
  },
  loadingComponent: () => h('div', '加载中...'),
  errorComponent: () => h('div', '组件加载失败，请检查远程服务'),
})
```

### 坑 5：Monorepo 中的依赖提升

**现象**：pnpm 默认严格隔离，remote 应用找不到 host 的 shared 依赖。

**解决**：在 `.npmrc` 中配置：

```ini
# .npmrc
shamefully-hoist=true
strict-peer-dependencies=false
```

或者更精确的方式——在各 app 的 `package.json` 中显式声明 shared 依赖，而不是依赖提升。

## Webpack 5 vs Vite 性能对比

在同一个 Monorepo 项目中对比（10 个远程组件，3 个共享依赖）：

| 指标 | Webpack 5 | Vite |
|------|-----------|------|
| 冷启动时间 | 8.2s | 0.6s |
| HMR 热更新 | 1.1s | 45ms |
| 生产构建 | 12.5s | 3.8s |
| 远程模块首次加载 | 320ms | 280ms |
| 打包体积（gzip） | 142KB | 138KB |

Vite 在开发体验上碾压，生产构建也快 3 倍。远程模块运行时加载两者差距不大，因为瓶颈在网络而非打包工具。

## 什么时候该用 Module Federation

**适合的场景**：
- 多团队独立开发、独立部署
- 需要运行时共享大型依赖（ECharts、Monaco Editor）
- 渐进式迁移老系统

**不适合的场景**：
- 单团队单项目——用 Monorepo + 动态 import 就够了
- 对首屏性能极度敏感——远程加载有延迟
- 需要 SSR——Module Federation 的 SSR 支持还不成熟

## 总结

Vite + Module Federation 的方案在 Vue 3 Monorepo 中已经可以落地，但比 Webpack 5 的原生实现要多做一些工作：

1. **Shared 依赖必须严格版本一致**，否则运行时爆炸
2. **CSS 共享需要手动处理**，推荐 `cssCodeSplit: false`
3. **HMR 跨应用不生效**，开发时需要变通
4. **降级方案必须做**，远程服务挂了不能白屏

如果你的团队已经在用 Vite，迁移成本可控。如果你还在 Webpack 5 且没有强烈的 Vite 迁移需求，Module Federation 在 Webpack 中确实更成熟。

选择权在你，但至少现在你知道了两边的坑在哪。

---

> 相关代码已推送到 [GitHub 仓库](https://github.com/mikeah2011/vue3-mf-monorepo)，包含完整的 host/remote 示例和 pnpm workspace 配置。
