# TanStack Query：服务端状态管理

## 定义

TanStack Query（原 React Query）将**服务端状态**（异步获取、非你所有、可能过时、需同步）与客户端状态明确区分，提供声明式 API 管理服务端数据的获取、缓存、同步和更新，取代手动 `useEffect` + `useState` 管理异步数据的方式。

## 核心原理

### 服务端状态 vs 客户端状态

| 维度 | 客户端状态 | 服务端状态 |
|---|---|---|
| 获取方式 | 同步（已有） | 异步（需要请求） |
| 所有权 | 你的 | 服务端的 |
| 过时性 | 不会过时 | 可能随时过时 |
| 管理工具 | useState/Zustand/Jotai | TanStack Query/SWR |

### 三核心 API

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// 1. QueryClient：全局缓存管理器（在 App 顶层配置）
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000 }  // 5 分钟内不重新获取
  }
})

// 2. useQuery：声明式数据获取
function UserList() {
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['users', { page: 1 }],
    queryFn: () => fetch('/api/users?page=1').then(r => r.json()),
    staleTime: 5 * 60 * 1000,  // 数据 5 分钟内视为新鲜
    gcTime: 10 * 60 * 1000     // 未使用数据 10 分钟后回收
  })
}

// 3. useMutation：写操作
function CreateUser() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (newUser) => fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify(newUser)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    }
  })
}
```

### 关键概念辨析

| 概念 | 含义 | 默认值 |
|---|---|---|
| `staleTime` | 数据视为"新鲜"的时间，新鲜期内不会重新获取 | 0（立即过期） |
| `gcTime` | 未使用的缓存数据保留时间，超时后垃圾回收 | 5 分钟 |
| `isLoading` | 首次加载中（无缓存数据） | - |
| `isFetching` | 任何请求进行中（含后台刷新） | - |

### 乐观更新完整流程

```typescript
const mutation = useMutation({
  mutationFn: updateTodo,
  
  // 1. 乐观更新前：快照当前数据
  onMutate: async (newTodo) => {
    await queryClient.cancelQueries({ queryKey: ['todos'] })
    const previous = queryClient.getQueryData(['todos'])
    queryClient.setQueryData(['todos'], (old) =>
      old.map(todo => todo.id === newTodo.id ? newTodo : todo)
    )
    return { previous }
  },
  
  // 2. 失败时回滚
  onError: (err, newTodo, context) => {
    queryClient.setQueryData(['todos'], context.previous)
  },
  
  // 3. 无论成败：重新获取最新数据
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] })
  }
})
```

### 与 Laravel API 配合

```typescript
// 分页查询
function useUsers(page: number) {
  return useQuery({
    queryKey: ['users', page],
    queryFn: () => fetch(`/api/users?page=${page}`).then(r => r.json()),
    placeholderData: keepPreviousData  // 切页时保持旧数据
  })
}

// 无限滚动
function useInfiniteUsers() {
  return useInfiniteQuery({
    queryKey: ['users'],
    queryFn: ({ pageParam }) =>
      fetch(`/api/users?cursor=${pageParam}`).then(r => r.json()),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor
  })
}
```

## 实战案例

来自博客文章：
- [TanStack Query (React Query) 实战：服务端状态管理——缓存策略、乐观更新与 Laravel API 的最佳配合](/2026/06/05/TanStack-Query-React-Query-实战-服务端状态管理-缓存策略-乐观更新-Laravel-API/)

## 相关概念

- [tRPC 端到端类型安全](tRPC端到端类型安全.md) - tRPC 常与 TanStack Query 配合使用
- [React 状态管理选型](React状态管理选型.md) - 客户端状态管理（Zustand/Jotai）
- [Laravel 缓存策略](../PHP-Laravel/缓存策略.md) - 后端缓存与前端缓存的协同

## 常见问题

### Q: staleTime 和 gcTime 有什么区别？
staleTime 控制"何时重新获取"（数据新鲜期），gcTime 控制"何时删除缓存"（垃圾回收期）。staleTime=0 意味着每次挂载都重新获取，gcTime=5min 意味着组件卸载后缓存保留 5 分钟。

### Q: 和 SWR 有什么区别？
TanStack Query 功能更丰富（mutations、无限查询、离线支持），API 更声明式。SWR 更轻量，适合简单场景。

### Q: 需要配合 Redux/Zustand 吗？
通常不需要。TanStack Query 管理服务端状态，Zustand/Jotai 管理客户端状态（主题、表单、UI 状态），两者互补而非替代。
