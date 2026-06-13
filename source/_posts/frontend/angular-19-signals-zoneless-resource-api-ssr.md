---
title: Angular 19+ Signals 实战：Zoneless 变更检测、Resource API 与 SSR——对比 Vue/React 的现代 Angular 复兴
keywords: [Angular, Signals, Zoneless, Resource API, SSR, Vue, React, 变更检测, 的现代, 复兴]
date: 2026-06-10 03:37:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
  - Angular
  - Signals
  - Zoneless
  - Resource API
  - SSR
  - 前端框架
description: 深入 Angular 19+ Signals 体系，涵盖 Zoneless 变更检测、Resource API、Signal Inputs/Outputs，对比 Vue/React 的响应式方案，并附带完整可运行的 SSR 示例。
---


## 概述

Angular 在 2026 年迎来了一个真正的分水岭——**Signals 成为默认的响应式原语**，Zone.js 被彻底移除。这不是渐进式改良，而是对 Angular 响应式模型的根本性重构。

对于习惯了 Vue `ref`/`reactive` 或 React `useState`/`useReducer` 的开发者来说，Angular Signals 既熟悉又陌生：它的 API 设计明显受到 Vue 的启发（`signal()`、`computed()`、`effect()`），但又深度集成了 Angular 的依赖注入、模板系统和 SSR 管线。

本文将从实战角度出发，覆盖以下核心内容：

- Angular Signals 的基础 API 和心智模型
- Zoneless 变更检测的工作原理
- Resource API：异步数据获取的信号化
- Signal Inputs/Outputs：组件 API 的革新
- SSR 中的信号处理
- 与 Vue Composition API / React Hooks 的横向对比

<!-- more -->

## 核心概念

### 1. Signal 是什么

Signal 本质上是一个**值容器**，当你读取它时会建立依赖关系，当你写入它时会通知所有依赖方更新。

```typescript
import { signal, computed, effect } from '@angular/core';

// 创建一个 signal
const count = signal(0);

// 读取值
console.log(count()); // 0

// 写入值
count.set(1);
count.update(prev => prev + 1);

// 派生值（类似 Vue 的 computed）
const doubled = computed(() => count() * 2);

// 副作用（类似 Vue 的 watchEffect）
effect(() => {
  console.log('count changed:', count());
});
```

这和 Vue 的响应式几乎一模一样。但 Angular 的实现有一个关键区别：**它是编译器级集成的**。

### 2. 信号与模板的绑定

Angular 模板会自动跟踪模板表达式中读取的 signal：

```typescript
@Component({
  selector: 'app-counter',
  template: `
    <button (click)="decrement()">-</button>
    <span>{{ count() }}</span>
    <button (click)="increment()">+</button>
    <p>Doubled: {{ doubled() }}</p>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush, // Zoneless 下这是默认值
})
export class CounterComponent {
  count = signal(0);
  doubled = computed(() => this.count() * 2);

  increment() {
    this.count.update(v => v + 1);
  }

  decrement() {
    this.count.update(v => v - 1);
  }
}
```

模板中每次调用 `count()` 时，Angular 的编译器会在底层自动注册一个依赖。当 `count` 变化时，只有依赖它的视图部分会被重新渲染——这就是**细粒度变更检测**。

### 3. Zoneless 变更检测

在传统 Angular 中，Zone.js 通过 monkey-patching `setTimeout`、`Promise`、`addEventListener` 等 API 来检测变化。这带来两个问题：

1. **性能开销**：每次异步操作后都要跑一次完整的变更检测
2. **可预测性差**：变更检测时机由 Zone.js 决定，开发者难以精确控制

Zoneless 模式下，变更检测**只在 signal 变化时触发**：

```typescript
// 以前的写法（需要 Zone.js）
ngOnInit() {
  this.http.get('/api/data').subscribe(data => {
    this.data = data; // Zone.js 自动触发变更检测
  });
}

// Zoneless 写法
data = signal<Data | null>(null);
error = signal<string | null>(null);

async loadData() {
  try {
    const result = await lastValueFrom(this.http.get('/api/data'));
    this.data.set(result); // signal 变化自动触发局部更新
  } catch (e) {
    this.error.set(e.message);
  }
}
```

注意 Zoneless 模式下 `ChangeDetectionStrategy.OnPush` 不再是可选项——它就是默认行为。

## 实战代码

### 场景一：用 Resource API 做异步数据获取

Resource API 是 Angular 19+ 引入的声明式数据获取方案，灵感来自 TanStack Query，但与 Signals 深度集成：

```typescript
import { resource, signal } from '@angular/core';

interface User {
  id: number;
  name: string;
  email: string;
}

@Component({
  selector: 'app-user-list',
  template: `
    @if (users.isLoading()) {
      <div class="skeleton">加载中...</div>
    }

    @if (users.error(); as err) {
      <div class="error">加载失败：{{ err.message }}</div>
    }

    @if (users.value(); as userList) {
      <ul>
        @for (user of userList; track user.id) {
          <li>{{ user.name }} - {{ user.email }}</li>
        }
      </ul>
    }

    <button (click)="page.update(p => p + 1)">下一页</button>
  `,
})
export class UserListComponent {
  private http = inject(HttpClient);
  page = signal(1);

  users = resource({
    // request 依赖 page signal
    request: () => ({ page: this.page() }),
    // loader 根据 request 变化自动重新执行
    loader: async ({ request }) => {
      const data = await lastValueFrom(
        this.http.get<User[]>(`/api/users?page=${request.page}`)
      );
      return data;
    },
  });
}
```

Resource API 的核心优势：

- **声明式依赖**：`request` 函数自动追踪 signal 依赖
- **自动重新加载**：`page` 变化时自动重新请求
- **内置状态**：`isLoading()`、`error()`、`value()` 三件套
- **竞态处理**：内部自动取消过期请求

### 场景二：Signal Inputs/Outputs

组件输入输出现在也可以用 signal 来声明：

```typescript
@Component({
  selector: 'app-user-card',
  template: `
    <div class="card" [class.active]="active()">
      <h3>{{ name() }}</h3>
      <p>{{ bio() || '暂无简介' }}</p>
      <button (click)="handleClick()">操作</button>
    </div>
  `,
})
export class UserCardComponent {
  // Signal Input：父组件传值时自动更新
  name = input.required<string>();
  bio = input<string>();
  active = input(false);

  // Signal Output：声明式事件发射
  cardClicked = output<string>();

  handleClick() {
    this.cardClicked.emit(this.name());
  }
}
```

父组件使用：

```typescript
@Component({
  template: `
    <app-user-card
      [name]="user().name"
      [bio]="user().bio"
      (cardClicked)="onCardClick($event)"
    />
  `,
})
export class ParentComponent {
  user = signal<User>({ id: 1, name: '张三', bio: 'Angular 开发者' });

  onCardClick(name: string) {
    console.log('点击了：', name);
  }
}
```

### 场景三：多 Signal 组合与状态管理

对于复杂的状态逻辑，可以用 class + signal 封装：

```typescript
@Injectable({ providedIn: 'root' })
export class CartState {
  private items = signal<CartItem[]>([]);
  private coupon = signal<string | null>(null);

  // 只读派生状态
  readonly cartItems = this.items.asReadonly();
  readonly totalPrice = computed(() => {
    const base = this.items().reduce(
      (sum, item) => sum + item.price * item.quantity, 0
    );
    const discount = this.coupon() === 'SAVE10' ? 0.9 : 1;
    return base * discount;
  });
  readonly itemCount = computed(() =>
    this.items().reduce((sum, item) => sum + item.quantity, 0)
  );

  addItem(product: Product) {
    this.items.update(items => {
      const existing = items.find(i => i.productId === product.id);
      if (existing) {
        return items.map(i =>
          i.productId === product.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [...items, { productId: product.id, name: product.name, price: product.price, quantity: 1 }];
    });
  }

  applyCoupon(code: string) {
    this.coupon.set(code);
  }

  clear() {
    this.items.set([]);
    this.coupon.set(null);
  }
}
```

使用方式：

```typescript
@Component({
  selector: 'app-cart',
  template: `
    <div class="cart-summary">
      <span>{{ cart.itemCount() }} 件商品</span>
      <span>总价：¥{{ cart.totalPrice() | number:'1.2-2' }}</span>
    </div>
  `,
})
export class CartComponent {
  cart = inject(CartState);
}
```

## 踩坑记录

### 坑 1：Signal 的相等性判断

Angular signal 默认用 `Object.is` 判断新旧值。对于对象类型，即使内容相同，引用不同也会触发更新：

```typescript
// 这会导致重复渲染！
const user = signal({ name: '张三' });

// ❌ 每次都创建新引用
user.set({ name: '张三' });

// ✅ 用 equal 选项自定义比较
const user = signal(
  { name: '张三' },
  { equal: (a, b) => a.name === b.name }
);
```

### 坑 2：computed 中不能有副作用

`computed` 应该是纯函数，不要在里面调 API 或发请求：

```typescript
// ❌ 错误：computed 中发请求
const data = computed(async () => {
  return await fetch('/api/data').then(r => r.json());
});

// ✅ 正确：用 resource 或 effect 处理异步
const data = resource({
  request: () => this.params(),
  loader: async ({ request }) => {
    return await lastValueFrom(this.http.get('/api/data', { params: request }));
  },
});
```

### 坑 3：effect 的清理函数

`effect` 返回的清理函数必须是同步的：

```typescript
// ❌ 错误
effect((onCleanup) => {
  const timer = setInterval(() => console.log('tick'), 1000);
  onCleanup(async () => {
    await someAsyncCleanup(); // 不行！
  });
});

// ✅ 正确
effect((onCleanup) => {
  const timer = setInterval(() => console.log('tick'), 1000);
  onCleanup(() => {
    clearInterval(timer); // 同步清理
  });
});
```

### 坑 4：SSR 中的 hydration

Angular SSR 会将服务端渲染的 HTML 水合到客户端。如果 signal 的初始值在服务端和客户端不同，会导致 hydration mismatch：

```typescript
@Component({
  template: `
    <p>当前时间：{{ time() }}</p>
  `,
})
export class TimeComponent {
  // ❌ 服务端和客户端时间不同，会导致 hydration 错误
  time = signal(new Date().toLocaleTimeString());

  // ✅ 在 afterNextRender 中初始化
  time = signal('');

  constructor() {
    afterNextRender(() => {
      this.time.set(new Date().toLocaleTimeString());
    });
  }
}
```

## 与 Vue / React 的对比

| 维度 | Angular Signals | Vue Composition API | React Hooks |
|------|----------------|-------------------|-------------|
| 响应式原语 | `signal()` | `ref()` / `reactive()` | `useState()` |
| 派生值 | `computed()` | `computed()` | `useMemo()` |
| 副作用 | `effect()` | `watchEffect()` | `useEffect()` |
| 依赖追踪 | 编译器自动追踪 | 运行时自动追踪 | 手动声明依赖数组 |
| 状态管理 | Service + signal | Pinia | Context + useReducer |
| SSR hydration | `afterNextRender()` | `onMounted()` + SSR | `useEffect()` + SSR |
| 变更检测粒度 | 组件级（signal 级别更新） | 组件级（虚拟 DOM diff） | 组件级（虚拟 DOM diff） |
| 调度机制 | 批量更新 + 微任务 | 微任务 | 合成事件 + 批量更新 |

**关键区别总结：**

- **Vue** 的响应式最"魔法"——`reactive()` 让你几乎忘了响应式的存在，但调试时容易困惑
- **React** 最显式——每个状态变化都需要你手动管理，心智负担最重
- **Angular Signals** 走中间路线——API 风格像 Vue，但编译器参与让它更可控，调试也更友好

## 总结

Angular 19+ 的 Signals 体系标志着 Angular 从"框架决定一切"转向"开发者声明意图、框架智能执行"的范式。具体来说：

1. **Zoneless 是真正的性能分水岭**——告别 Zone.js 的全局变更检测，转向精确的细粒度更新
2. **Resource API 让异步数据管理不再需要第三方库**——TanStack Query 级别的开发体验，但与 Angular 深度集成
3. **Signal Inputs/Outputs 简化了组件通信**——告别 `@Input()` 装饰器和 `EventEmitter`
4. **SSR 支持更成熟**——`afterNextRender` 和 hydration 机制解决了服务端渲染的常见痛点

如果你还在用 Angular 15 或更早版本，现在是升级的最佳时机。Signals 不仅是 API 的变化，更是 Angular 应用架构思维方式的变化——从"命令式地触发变更检测"转向"声明式地描述状态依赖"。

这种思维方式的转变，才是真正值得投资学习的部分。
