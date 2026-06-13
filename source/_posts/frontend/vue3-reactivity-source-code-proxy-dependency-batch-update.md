---

title: Vue 3 Reactivity 源码剖析：Proxy 拦截、依赖收集与批量更新的底层实现——从 effect() 到 trigger() 的响应式全链路
keywords: [Vue, Reactivity, Proxy, effect, trigger, 源码剖析, 拦截, 依赖收集与批量更新的底层实现, 的响应式全链路, 前端]
date: 2026-06-10 08:43:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- Vue
- Reactivity
- Proxy
- 源码分析
- 响应式
description: 深入 Vue 3 响应式系统的源码实现，从 Proxy 拦截、依赖收集（track）到批量更新（trigger + queueJob）的全链路剖析，结合实战代码和踩坑记录，帮你彻底理解 Vue 3 响应式的核心原理。
---


## 概述

Vue 3 的响应式系统是整个框架的核心基石。相比 Vue 2 基于 `Object.defineProperty` 的实现，Vue 3 用 `Proxy` 彻底解决了：

- **无法监听新增/删除属性** —— Vue 2 需要 `Vue.set()`
- **无法监听数组索引变化** —— Vue 2 需要 hack 重写数组方法
- **性能问题** —— Vue 2 递归遍历整个对象，Vue 3 惰性代理

这篇文章从源码级别拆解 Vue 3 响应式系统的四大核心模块：**reactive()**、**track()**、**trigger()**、**effect()**，以及连接它们的 **调度器（scheduler）** 和 **批量更新机制（queueJob）**。

## 核心概念：响应式系统的架构

Vue 3 响应式的核心设计可以用一句话概括：**用 Proxy 拦截属性访问，通过 effect 建立依赖关系，在属性变化时批量触发更新。**

整个流程：

```
reactive(obj)
  ├── get → track(target, key)     // 依赖收集
  └── set → trigger(target, key)   // 触发更新
            ↓
      scheduler → queueJob(job)    // 批量调度
            ↓
      nextTick → flushJobs()       // 异步批量执行
```

关键数据结构：

- **targetMap**：WeakMap，存储每个响应式对象的依赖映射
  - `WeakMap<target, Map<key, Set<effect>>>`
- **activeEffect**：当前正在执行的 effect 函数
- **effectStack**：防止嵌套 effect 导致的错误收集

## 实战代码：手写一个迷你 Vue 3 响应式系统

### 1. reactive() —— Proxy 拦截核心

```typescript
// mini-reactive.ts
type EffectFn = () => void
type Dependency = Set<EffectFn>

const targetMap = new WeakMap<object, Map<string | symbol, Dependency>>()
let activeEffect: EffectFn | null = null
const effectStack: EffectFn[] = []

export function reactive<T extends object>(target: T): T {
  return new Proxy(target, {
    get(target, key, receiver) {
      track(target, key)
      const result = Reflect.get(target, key, receiver)
      // 惰性代理：嵌套对象也转为 reactive
      if (typeof result === 'object' && result !== null) {
        return reactive(result)
      }
      return result
    },
    set(target, key, value, receiver) {
      const oldValue = (target as any)[key]
      const result = Reflect.set(target, key, value, receiver)
      // 只在值真正变化时触发
      if (oldValue !== value && (oldValue === oldValue || value === value)) {
        trigger(target, key)
      }
      return result
    },
    deleteProperty(target, key) {
      const hadKey = Reflect.has(target, key)
      const result = Reflect.deleteProperty(target, key)
      if (hadKey) {
        trigger(target, key)
      }
      return result
    }
  })
}
```

**关键点：**

- `Reflect.get` 保证正确的 `this` 绑定（`receiver` 参数）
- 惰性代理嵌套对象，避免 Vue 2 的全量递归问题
- `oldValue !== value` + NaN 检查（`value === value`）确保正确触发

### 2. track() —— 依赖收集

```typescript
export function track(target: object, key: string | symbol) {
  if (!activeEffect) return // 没有正在执行的 effect，无需收集

  let depsMap = targetMap.get(target)
  if (!depsMap) {
    depsMap = new Map()
    targetMap.set(target, depsMap)
  }

  let dep = depsMap.get(key)
  if (!dep) {
    dep = new Set()
    depsMap.set(key, dep)
  }

  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    // 反向收集：effect 被清理时，从所有依赖中移除自己
    activeEffect.deps.push(dep)
  }
}

// effect 的类型定义
interface ReactiveEffect extends Function {
  deps: Dependency[]
  options: { scheduler?: (effect: ReactiveEffect) => void }
}
```

**数据流向：**

```
target (Proxy)
  └── key
        └── Set<effect1, effect2, ...>  ← 这就是依赖关系
```

每个属性的依赖是一个 `Set<effect>`，保证不重复。

### 3. effect() —— 副作用函数注册

```typescript
export function effect(fn: () => void, options: { scheduler?: (effect: ReactiveEffect) => void } = {}) {
  const effectFn: ReactiveEffect = Object.assign(() => {
    // 清理旧依赖，防止已删除属性的 effect 继续触发
    cleanup(effectFn)
    // 入栈，支持嵌套 effect
    effectStack.push(effectFn)
    activeEffect = effectFn
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }, {
    deps: [],
    options
  })

  // 非 lazy 立即执行一次，建立依赖
  if (!options.lazy) {
    effectFn()
  }

  return effectFn
}

function cleanup(effectFn: ReactiveEffect) {
  effectFn.deps.forEach(dep => dep.delete(effectFn))
  effectFn.deps.length = 0
}
```

**踩坑点：cleanup 是必须的**

如果没有 `cleanup`，一个 effect 可能同时依赖 `obj.a` 和 `obj.b`。当 `obj.a` 被删除后再添加 `obj.c`，effect 会同时在 `a`、`b`、`c` 三个依赖集合中，导致 `a` 被重新设置时也触发不必要的执行。

### 4. trigger() —— 触发更新

```typescript
export function trigger(target: object, key: string | symbol) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return

  const effects = new Set<ReactiveEffect>()

  const dep = depsMap.get(key)
  if (dep) {
    dep.forEach(effect => {
      // 防止 effect 执行时再次触发自身（无限循环）
      if (effect !== activeEffect) {
        effects.add(effect)
      }
    })
  }

  effects.forEach(effect => {
    // 如果有 scheduler，交给调度器处理（批量更新的核心）
    if (effect.options.scheduler) {
      effect.options.scheduler(effect)
    } else {
      effect()
    }
  })
}
```

**为什么需要 Set 去重？**

当 `trigger(target, 'a')` 同时收集了同一个 effect 两次（比如 `target.a` 和 `target.a` 分别在不同地方被访问），`Set` 保证只触发一次。

### 5. 批量更新：queueJob + scheduler

```typescript
// 调度器：收集 job，异步批量执行
const queue: ReactiveEffect[] = []
let isFlushing = false
const resolvedPromise = Promise.resolve()

export function queueJob(job: ReactiveEffect) {
  if (!queue.includes(job)) {
    queue.push(job)
  }
  if (!isFlushing) {
    isFlushing = true
    resolvedPromise.then(() => {
      flushJobs()
    })
  }
}

function flushJobs() {
  // 按 effect 注册顺序排序
  queue.sort((a, b) => {
    // 父 effect 先于子 effect 执行
    return a.id! - b.id!
  })
  
  for (const job of queue) {
    job()
  }
  
  queue.length = 0
  isFlushing = false
}

let jobId = 0
export function effect(fn: () => void, options: { scheduler?: Function } = {}) {
  const effectFn = Object.assign(() => {
    cleanup(effectFn)
    effectStack.push(effectFn)
    activeEffect = effectFn
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }, {
    deps: [],
    id: jobId++,
    options
  })
  
  if (!options.lazy) {
    effectFn()
  }
  
  return effectFn
}
```

**批量更新的原理：**

```
set(obj, 'a', 1)  →  queueJob(effect1)     →  本次 tick 结束
set(obj, 'b', 2)  →  queueJob(effect2)     →  批量 flush
set(obj, 'c', 3)  →  queueJob(effect3)     →  只触发一次 DOM 更新
                                              ↓
                                    flushJobs() 一次性执行所有 effect
```

多个数据变化只触发一次 DOM 更新，这就是 Vue 3 高性能的关键。

## 踩坑记录

### 踩坑 1：effect 中修改触发收集的属性导致无限循环

```typescript
// ❌ 错误示例
effect(() => {
  obj.count = obj.count + 1  // set 触发 → trigger → effect 再次执行 → 无限循环
})
```

**解决：** trigger 中过滤 `activeEffect`，effect 执行期间不会再次触发自己。

### 踩坑 2：响应式对象解构丢失响应性

```typescript
const state = reactive({ count: 0, name: 'Nova' })

// ❌ 解构后丢失响应性
const { count, name } = state
effect(() => {
  console.log(count)  // 永远是 0，不会更新
})

// ✅ 使用 toRefs 保持响应性
import { toRefs } from 'vue'
const { count, name } = toRefs(state)
effect(() => {
  console.log(count.value)  // 响应式更新
})
```

**原理：** `toRefs` 将每个属性包装为 `Ref`，内部通过 `get`/`set` 代理访问 `reactive` 对象的属性。

### 踩坑 3：Map/Set 的响应式处理

```typescript
const map = reactive(new Map())

// ✅ Vue 3 对 Map/Set 提供了专门的 Proxy handler
map.set('key', 'value')    // 触发更新
map.get('key')              // 依赖收集
map.has('key')              // 依赖收集
map.delete('key')           // 触发更新
map.forEach(() => {})       // 遍历时收集迭代依赖

// ❌ 但是不能直接替换整个 Map
// map = new Map()  // Proxy 的 set 拦截不适用，因为 map 是 const
```

### 踩坑 4：computed 的惰性求值与缓存

```typescript
function computed<T>(getter: () => T) {
  let value: T
  let dirty = true  // 脏标记：是否需要重新计算

  const effectFn = effect(getter, {
    lazy: true,
    scheduler: () => {
      if (!dirty) {
        dirty = true
        // computed 依赖的值变了，通知使用 computed 的 effect
        trigger(computedObj, 'value')
      }
    }
  })

  const computedObj = {
    get value() {
      if (dirty) {
        value = effectFn()
        dirty = false
      }
      track(computedObj, 'value')
      return value
    }
  }

  return computedObj
}
```

**computed 的双重角色：**

- 作为 effect：依赖变化时设置 `dirty = true`（通过 scheduler）
- 作为响应式数据：`value` 被访问时 track，被 set 时 trigger

### 踩坑 5：watchEffect 的清理函数

```typescript
import { watchEffect } from 'vue'

const stop = watchEffect((onCleanup) => {
  const controller = new AbortController()

  // 注册清理函数：下次 effect 重新执行或停止时调用
  onCleanup(() => {
    controller.abort()
  })

  fetch('/api/data', { signal: controller.signal })
    .then(res => res.json())
    .then(data => {
      // 更新状态
    })
})

// 手动停止时也会调用清理函数
stop()
```

## Vue 3 响应式 vs Vue 2 响应式对比

| 特性 | Vue 2 (defineProperty) | Vue 3 (Proxy) |
|------|----------------------|---------------|
| 新增属性 | 需要 `Vue.set()` | 自动拦截 |
| 删除属性 | 需要 `Vue.delete()` | 自动拦截 |
| 数组索引 | 无法直接监听 | 自动拦截 |
| 性能 | 启动时全量递归 | 惰性代理，按需拦截 |
| Map/Set | 不支持 | 原生支持 |
| 嵌套对象 | 深度递归转换 | 访问时才转换 |
| TypeScript | 类型推导差 | 完美类型推导 |

## 实战场景：Vue 3 响应式在 Laravel 项目中的应用

### 场景：SPA 状态管理

在 Laravel 9+ + Vue 3 项目中，用响应式系统管理全局状态：

```typescript
// stores/user.ts
import { reactive, computed } from 'vue'

interface User {
  id: number
  name: string
  email: string
  permissions: string[]
}

const state = reactive<{ user: User | null; loading: boolean }>({
  user: null,
  loading: false
})

export function useUser() {
  const isLoggedIn = computed(() => state.user !== null)

  const hasPermission = (perm: string) => {
    return state.user?.permissions.includes(perm) ?? false
  }

  async function fetchUser() {
    state.loading = true
    try {
      const res = await fetch('/api/user', {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json'
        }
      })
      if (res.ok) {
        state.user = await res.json()
      }
    } finally {
      state.loading = false
    }
  }

  function logout() {
    state.user = null
  }

  return { state, isLoggedIn, hasPermission, fetchUser, logout }
}
```

### 场景：响应式表单验证

```typescript
// composables/useForm.ts
import { reactive, computed } from 'vue'

export function useForm<T extends Record<string, any>>(initial: T) {
  const form = reactive({ ...initial })
  const errors = reactive<Record<string, string>>({})
  const touched = reactive<Record<string, boolean>>({})

  const isValid = computed(() => {
    return Object.keys(errors).length === 0
  })

  function validate(field: string, rules: ((val: any) => string | null)[]) {
    const error = rules.reduce<string | null>((err, rule) => {
      return err || rule(form[field])
    }, null)

    if (error) {
      errors[field] = error
    } else {
      delete errors[field]
    }
  }

  function reset() {
    Object.assign(form, initial)
    Object.keys(errors).forEach(k => delete errors[k])
    Object.keys(touched).forEach(k => touched[k] = false)
  }

  return { form, errors, touched, isValid, validate, reset }
}

// 使用
const { form, errors, touched, isValid, validate } = useForm({
  email: '',
  password: ''
})

// 监听变化自动验证
effect(() => {
  touched.email = true
  validate('email', [
    v => v ? null : '邮箱不能为空',
    v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : '邮箱格式不正确'
  ])
})
```

## 总结

Vue 3 响应式系统的精髓在于四个环环相扣的模块：

1. **reactive()** 用 Proxy 拦截属性操作，实现惰性代理
2. **track()** 在属性被访问时收集 effect 依赖，建立 `target → key → effect` 的映射关系
3. **trigger()** 在属性变化时找到并执行所有依赖的 effect
4. **scheduler + queueJob** 通过微任务异步批量执行，确保多次数据变化只触发一次 DOM 更新

理解这套机制，你就能：

- 知道为什么响应式对象解构会丢失响应性
- 知道为什么 `watchEffect` 需要清理函数
- 知道为什么 computed 只在依赖变化时重新计算
- 在调试 Vue 应用时快速定位响应式相关的问题

源码不过几百行，但设计精妙。建议对照 [Vue 3 源码仓库](https://github.com/vuejs/core/tree/main/packages/reactivity/src) 一步步跟读，效果远好于死记硬背。
