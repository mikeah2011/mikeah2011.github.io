---

title: TanStack Query (React Query) 实战：服务端状态管理——缓存策略、乐观更新与 Laravel API 的最佳配合
keywords: [TanStack Query, React Query, Laravel API, 服务端状态管理, 缓存策略, 乐观更新与, 的最佳配合]
date: 2026-06-05 10:00:00
tags:
- TanStack Query
- React
- 前端
- 状态管理
- Laravel API
categories:
- frontend
description: 深入解析 TanStack Query（React Query）在真实项目中的服务端状态管理实战：从 QueryClient、useQuery、useMutation 核心概念，到 staleTime 与 gcTime 缓存策略配置、乐观更新的完整 onMutate/onError/onSettled 流程、与 Laravel API 的分页配合、无限滚动、全局错误拦截，再到 TanStack Query vs SWR 选型对比，帮助前端开发者告别 useEffect 手动管理服务端数据的痛点，构建体验更流畅的 React 应用。
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
---



## 引言：客户端状态 vs 服务端状态的本质区别

在现代前端开发中，"状态管理"是一个被反复讨论的话题。从 Redux 到 Zustand，从 MobX 到 Jotai，开发者们对客户端状态的管理已经积累了丰富的经验。然而，随着前后端分离架构的深入发展，我们逐渐发现一个被长期忽视的问题：**服务端状态（Server State）和客户端状态（Client State）本质上是两种完全不同的东西**。

**客户端状态**是前端应用内部拥有的、完全由前端控制的数据，比如表单输入、模态框的开关状态、当前选中的 Tab 页签、主题颜色偏好等。这类数据的特点是：它们的"真相来源"（Source of Truth）就在客户端，不需要与服务端同步。你可以随意读写它们，不会有任何一致性问题。

**服务端状态**则是存储在服务器上、通过 API 获取的数据，比如用户列表、商品详情、订单信息等。这类数据有几个显著特征：

1. **异步获取**：必须通过网络请求获取，存在延迟和失败的可能。每次获取都可能因为网络波动、服务器繁忙等原因而失败，你必须处理各种边界情况。
2. **非你所有**：数据属于服务端，前端只是"借用"，其他人随时可能修改它。你无法像对待客户端状态那样完全控制它的生命周期。
3. **可能过时**：你缓存的数据可能已经被别人更新了，但它不会主动通知你。你无法在不发请求的情况下知道数据是否还是最新的。
4. **需要同步**：你需要在多个页面、多个组件之间共享同一份数据，并保持一致性。同一个用户列表在不同页面展示时，必须确保数据是一致的。

传统的做法是将服务端数据当作客户端状态来管理——请求一次，存入 Redux Store，然后在各处消费。这种做法的问题在于，你需要手动处理缓存、失效、重新获取、乐观更新、去重等大量复杂逻辑，而这些逻辑往往散落在应用的各个角落，难以维护。一个中等规模的应用中，你可能会发现自己在编写大量的 `useEffect` 来手动管理数据的获取时机，用 `isLoading` 和 `error` 状态来处理各种边界情况，还要维护一个全局的缓存 Map 来避免重复请求。代码量迅速膨胀，bug 也随之而来。

**TanStack Query（原 React Query）** 正是为了解决这个问题而诞生的。它不是又一个状态管理库，而是一个**服务端状态管理库**。它将服务端数据的获取、缓存、同步和更新封装为一套声明式的 API，让开发者能够以极低的心智负担处理复杂的服务端状态场景。它的核心理念是：既然服务端状态有其独特的问题域，那就不应该把它硬塞进通用的状态管理方案中，而应该用专门的工具来解决。

本文将以 Laravel API 为后端，深入探讨 TanStack Query 在真实项目中的缓存策略、乐观更新以及与 Laravel 的最佳配合方式。无论你是初次接触 TanStack Query，还是已经在项目中使用但希望深入了解其高级特性，这篇文章都将为你提供实用的指导。

---

## TanStack Query 核心概念

在深入实战之前，我们先快速梳理 TanStack Query 的三个核心概念。这些概念构成了整个库的基石，理解它们是掌握后续高级用法的前提。

### QueryClient

`QueryClient` 是 TanStack Query 的"大脑"，它是整个查询系统的管理者，负责维护全局的缓存状态。你可以把它想象成一个智能的数据仓库管理员——它知道哪些数据已经被缓存、哪些数据已经过期、哪些请求正在进行中、哪些数据需要被清理。

通常在应用的最顶层创建并提供：

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 分钟内数据被认为是新鲜的
      retry: 2,                  // 失败后重试 2 次
      refetchOnWindowFocus: true, // 窗口聚焦时自动刷新过时数据
    },
    mutations: {
      retry: 0, // 写操作不重试，避免重复提交
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <YourApp />
    </QueryClientProvider>
  );
}
```

`QueryClient` 提供了丰富的全局配置能力，包括默认的过期时间、重试策略、错误处理等。更重要的是，它暴露了 `invalidateQueries`、`setQueryData`、`prefetchQuery` 等方法，让你可以在任意位置（包括组件外部）对缓存进行操作。这在处理跨组件的缓存同步时非常有用，例如在路由守卫中预取数据，或者在 WebSocket 消息处理器中更新缓存。

一个应用通常只需要一个 `QueryClient` 实例。在服务端渲染（SSR）场景中，每个请求需要创建一个新的实例以避免不同用户之间的数据交叉污染。

### useQuery

`useQuery` 是 TanStack Query 最核心的 Hook，用于声明式地获取和缓存数据。你只需要告诉它两件事：用什么 key 来标识这个查询（`queryKey`），以及如何获取数据（`queryFn`）：

```tsx
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

interface User {
  id: number;
  name: string;
  email: string;
}

function useUser(userId: number) {
  return useQuery<User>({
    queryKey: ['users', userId],
    queryFn: async () => {
      const { data } = await axios.get(`/api/users/${userId}`);
      return data.data;
    },
    enabled: !!userId, // 条件查询：只有 userId 存在时才发起请求
  });
}
```

`useQuery` 返回一个包含丰富状态的对象。最常用的几个字段如下：

- **`data`**：缓存的数据。在首次加载完成前为 `undefined`。
- **`isLoading`**：首次加载中（没有缓存数据且正在请求）。这个状态只在查询从未成功过时为 `true`。
- **`isFetching`**：任何正在进行中的请求，包括后台刷新。与 `isLoading` 的区别非常重要——当 `isLoading` 为 `false` 而 `isFetching` 为 `true` 时，说明有缓存数据正在后台更新，用户看到的是旧数据（但不会看到加载状态）。
- **`isError`**：查询是否出错。
- **`error`**：错误信息对象。
- **`refetch`**：手动触发重新获取的函数。

一个常见的误解是将 `isLoading` 和 `isFetching` 混为一谈。理解它们的区别对于实现良好的用户体验至关重要：`isLoading` 控制的是"是否显示加载占位符"，而 `isFetching` 控制的是"是否显示静默刷新指示器"。

### useMutation

`useMutation` 用于处理写操作（创建、更新、删除），它是与 `useQuery` 互补的存在。如果说 `useQuery` 是"读"，那 `useMutation` 就是"写"：

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';

function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (newUser: Omit<User, 'id'>) => {
      const { data } = await axios.post('/api/users', newUser);
      return data.data;
    },
    onSuccess: () => {
      // 成功后使用户列表缓存失效，触发重新获取
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
```

`useMutation` 提供了完整的生命周期钩子，这些钩子按照以下顺序执行：

1. `onMutate`：在 `mutationFn` 执行之前调用（用于乐观更新）。
2. `mutationFn`：实际的异步操作。
3. 成功时：`onSuccess` → `onSettled`
4. 失败时：`onError` → `onSettled`

这些生命周期钩子是实现乐观更新的关键，我们将在后面的章节详细讨论。

---

## 缓存策略深度实战

缓存是 TanStack Query 最核心的能力，也是最容易被误解的部分。正确理解缓存机制，是用好 TanStack Query 的关键。

### staleTime vs gcTime 的正确理解

很多开发者初次接触 TanStack Query 时，容易混淆 `staleTime` 和 `gcTime`（v4 中称为 `cacheTime`，v5 已重命名）。理解它们的区别是正确使用缓存的前提。

**`staleTime`（数据"过期"时间）**：控制的是数据多久之后变成"过时"（stale）状态。默认值为 `0`，意味着数据一旦被缓存，立即被视为过时。过时的数据仍然会被展示（用户不会看到闪烁的加载状态），但当使用该数据的组件重新挂载时，TanStack Query 会在后台发起一次重新请求来刷新数据。

**`gcTime`（垃圾回收时间）**：控制的是数据多久之后被从缓存中彻底清除。默认值为 5 分钟（`1000 * 60 * 5`）。当一个查询不再被任何组件使用时（比如用户导航到了其他页面），TanStack Query 会启动一个定时器，超过 `gcTime` 后将该缓存条目从内存中移除。

用一个生活化的比喻来理解：假设你在冰箱里存了一块面包。`staleTime` 是面包的"保质期"——保质期内你可以放心吃，过期后你仍然可以吃，但最好再去买一个新的（后台刷新）。`gcTime` 是你清理冰箱的周期——过期太久的面包会被扔掉（缓存清除），下次需要时只能重新购买（重新请求）。

下面是在不同业务场景下设置这两个参数的推荐实践：

```tsx
// 场景一：实时性要求高的数据（如聊天消息、在线状态）
// staleTime 为 0 表示数据立即过时，每次聚焦都会重新获取
// gcTime 较短，因为这些数据不需要长期缓存
const messagesQuery = useQuery({
  queryKey: ['messages', chatRoomId],
  queryFn: () => fetchMessages(chatRoomId),
  staleTime: 0,
  gcTime: 1000 * 60 * 2,  // 2 分钟后清除缓存
  refetchInterval: 5000,   // 每 5 秒轮询一次
});

// 场景二：变化不频繁的配置数据（如系统设置、字典数据）
// 长 staleTime 避免频繁请求，长 gcTime 保持缓存可用
const configQuery = useQuery({
  queryKey: ['app-config'],
  queryFn: fetchAppConfig,
  staleTime: 1000 * 60 * 30,  // 30 分钟内认为新鲜
  gcTime: 1000 * 60 * 60,     // 1 小时后清除缓存
});

// 场景三：用户个人资料（中等实时性）
// 适中的 staleTime，永久缓存以支持离线访问
const profileQuery = useQuery({
  queryKey: ['profile', userId],
  queryFn: () => fetchProfile(userId),
  staleTime: 1000 * 60 * 5,  // 5 分钟内新鲜
  gcTime: Infinity,           // 永不清除，手动管理
});

// 场景四：搜索结果（变化频繁，但用户可能来回切换搜索词）
// staleTime 设为适中值，gcTime 较长以支持用户回退搜索
const searchQuery = useQuery({
  queryKey: ['search', searchTerm],
  queryFn: () => searchProducts(searchTerm),
  staleTime: 1000 * 60 * 2,  // 2 分钟内新鲜
  gcTime: 1000 * 60 * 10,    // 10 分钟后清除
  enabled: searchTerm.length >= 2, // 至少输入 2 个字符才搜索
});
```

### 缓存失效与自动重新获取

TanStack Query 的缓存失效机制是其最强大的特性之一。当数据被修改后，你需要告诉 TanStack Query 相关的缓存已过时，它会自动在后台重新获取数据：

```tsx
const queryClient = useQueryClient();

// 使所有以 ['users'] 开头的查询失效
// 这会匹配 ['users']、['users', 1]、['users', 'list'] 等所有以 'users' 开头的 key
queryClient.invalidateQueries({ queryKey: ['users'] });

// 精确失效：只使特定用户的查询失效
queryClient.invalidateQueries({ queryKey: ['users', userId] });

// 使所有查询失效（极端情况，如登出）
queryClient.invalidateQueries();

// 只使当前不在屏幕上展示的查询失效（避免重新渲染）
queryClient.invalidateQueries({
  queryKey: ['users'],
  refetchType: 'none', // 不重新获取，仅标记为过时
});
```

在实际项目中，我推荐将缓存失效逻辑封装在自定义 Hook 中，与 `useMutation` 紧密结合，这样可以确保每次写操作后缓存都会被正确地更新：

```tsx
function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userData: Partial<User>) =>
      axios.put(`/api/users/${userData.id}`, userData).then(res => res.data.data),

    // 成功后根据场景选择不同的缓存更新策略
    onSuccess: (updatedUser) => {
      // 策略一：直接使列表缓存失效（触发重新请求，保证数据最新）
      queryClient.invalidateQueries({ queryKey: ['users'] });

      // 策略二：直接更新缓存中的单条数据（更高效，无额外请求）
      // 适用于你确定服务端返回的数据就是最新数据的场景
      queryClient.setQueryData(['users', updatedUser.id], updatedUser);
    },
  });
}
```

策略一和策略二各有优劣。策略一保证数据一定是最新的，但会触发一次额外的网络请求。策略二更加高效，但如果在你更新缓存的同时有其他人也修改了同一条数据，缓存中的数据可能不是最新的。通常建议：对于列表数据使用策略一（因为列表数据的关联更复杂），对于单条详情数据使用策略二。

### 预取（Prefetch）与分页缓存

预取是提升用户体验的重要手段。当用户的行为具有可预测性时，提前获取数据可以消除等待时间，让应用感觉更加流畅：

```tsx
// 典型场景：用户悬停在链接上时预取详情
// 这利用了用户鼠标移动到链接和实际点击之间的时间差
function UserLink({ userId }: { userId: number }) {
  const queryClient = useQueryClient();

  const prefetchUser = () => {
    queryClient.prefetchQuery({
      queryKey: ['users', userId],
      queryFn: () => fetchUser(userId),
      staleTime: 1000 * 60 * 5, // 5 分钟内不需要再次预取
    });
  };

  return (
    <Link
      to={`/users/${userId}`}
      onMouseEnter={prefetchUser}
      onFocus={prefetchUser}
    >
      查看用户
    </Link>
  );
}
```

分页场景下的预取更为实用。当用户在查看第 2 页时，提前预取第 3 页，用户翻到下一页时会立即看到数据，无需等待：

```tsx
function useUsersPage(page: number) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['users', 'list', { page }],
    queryFn: () => fetchUsers(page),
    placeholderData: keepPreviousData, // 切换页码时保留上一页数据
  });

  // 预取下一页
  useEffect(() => {
    if (query.data?.meta.current_page < query.data?.meta.last_page) {
      queryClient.prefetchQuery({
        queryKey: ['users', 'list', { page: page + 1 }],
        queryFn: () => fetchUsers(page + 1),
      });
    }
  }, [page, query.data, queryClient]);

  return query;
}
```

这里的 `keepPreviousData` 是一个非常实用的选项，它在新数据加载完成前继续展示上一页的数据，避免了页面闪烁和布局抖动。在 v5 中，这个选项替代了原来的 `keepPreviousData: true`，更加语义化。同时配合 `isPreviousData` 返回值，你可以在 UI 中显示一个微妙的加载指示器，告诉用户数据正在更新。

---

## 乐观更新（Optimistic Updates）

乐观更新是提升交互体验的关键技术。其核心思想是：**在服务端响应之前，先在客户端更新 UI，让用户立即看到操作结果**。如果服务端操作失败，再回滚到之前的状态。这种模式让用户感觉应用非常快速和响应灵敏，即使网络延迟实际上可能需要几百毫秒甚至更多。

### useMutation 的 onMutate/onError/onSettled 流程

实现乐观更新需要用到 `useMutation` 的三个生命周期钩子：

1. **`onMutate`**：在 `mutationFn` 执行之前调用。这里进行乐观更新，并返回一个"回滚快照"。这个快照非常重要——如果操作失败，我们需要用它来恢复到之前的状态。
2. **`onError`**：在 `mutationFn` 抛出异常时调用。这里使用回滚快照恢复之前的状态，确保用户不会看到错误的乐观更新结果。
3. **`onSettled`**：无论成功还是失败都会调用。这里进行缓存失效，确保最终数据一致性。即使乐观更新成功了，服务端的数据可能和我们预测的不完全一致，所以始终需要用 `invalidateQueries` 来保证最终一致性。

完整的执行流程如下：

```
用户点击 → onMutate（乐观更新 UI + 取消正在进行的查询）
         → mutationFn（发送请求到服务端）
         → 成功 → onSuccess → onSettled（失效缓存，重新获取）
         → 失败 → onError（回滚 UI） → onSettled（失效缓存，重新获取）
```

### 与 Laravel API 的配合示例

#### 示例一：点赞功能

点赞是一个典型的乐观更新场景——用户期望点击后立即看到反馈，不希望有任何延迟。如果每次点赞都要等待网络响应，用户体验会非常糟糕。

**Laravel API 端：**

```php
// routes/api.php
Route::post('/posts/{post}/like', [PostController::class, 'toggleLike']);

// PostController.php
public function toggleLike(Post $post)
{
    $user = auth()->user();

    if ($post->likedBy($user)) {
        $post->unlike($user);
    } else {
        $post->like($user);
    }

    return response()->json([
        'data' => [
            'liked' => $post->likedBy($user),
            'likes_count' => $post->likes()->count(),
        ],
    ]);
}
```

**React 端（乐观更新）：**

```tsx
function useToggleLike(postId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      axios.post(`/api/posts/${postId}/like`).then(res => res.data.data),

    onMutate: async () => {
      // 第一步：取消正在进行的该查询的请求，避免覆盖我们的乐观更新
      await queryClient.cancelQueries({ queryKey: ['posts', postId] });

      // 第二步：保存当前数据作为回滚快照
      const previousPost = queryClient.getQueryData(['posts', postId]);

      // 第三步：乐观更新缓存数据
      // 预测服务端的响应并立即更新 UI
      queryClient.setQueryData(['posts', postId], (old: any) => ({
        ...old,
        liked: !old.liked,
        likes_count: old.liked ? old.likes_count - 1 : old.likes_count + 1,
      }));

      // 返回快照，供 onError 使用
      return { previousPost };
    },

    onError: (err, variables, context) => {
      // 发生错误时回滚到快照
      if (context?.previousPost) {
        queryClient.setQueryData(['posts', postId], context.previousPost);
      }
      // 显示友好的错误提示
      toast.error('操作失败，请稍后重试');
    },

    onSettled: () => {
      // 无论成功失败，都失效缓存以确保数据一致
      queryClient.invalidateQueries({ queryKey: ['posts', postId] });
    },
  });
}
```

在组件中使用这个 Hook 非常简洁：

```tsx
function LikeButton({ post }: { post: Post }) {
  const toggleLike = useToggleLike(post.id);

  return (
    <button
      onClick={() => toggleLike.mutate()}
      disabled={toggleLike.isPending}
      className={post.liked ? 'liked' : ''}
    >
      {post.liked ? '❤️' : '🤍'} {post.likes_count}
    </button>
  );
}
```

#### 示例二：购物车操作

购物车的增减数量同样适合乐观更新，因为用户期望购物车操作是即时的：

```tsx
function useUpdateCartItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: number; quantity: number }) =>
      axios.patch(`/api/cart/items/${itemId}`, { quantity })
        .then(res => res.data.data),

    onMutate: async ({ itemId, quantity }) => {
      await queryClient.cancelQueries({ queryKey: ['cart'] });

      const previousCart = queryClient.getQueryData(['cart']);

      // 乐观更新：重新计算购物车总价
      queryClient.setQueryData(['cart'], (old: any) => {
        const items = old.items.map((item: any) =>
          item.id === itemId
            ? { ...item, quantity, subtotal: item.price * quantity }
            : item
        );
        return {
          ...old,
          items,
          total: items.reduce((sum: number, item: any) => sum + item.subtotal, 0),
        };
      });

      return { previousCart };
    },

    onError: (err, variables, context) => {
      if (context?.previousCart) {
        queryClient.setQueryData(['cart'], context.previousCart);
      }
      toast.error('更新失败，请重试');
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });
}
```

需要注意的是，乐观更新要求你的 `setQueryData` 逻辑必须能够正确预测服务端的响应。如果预测逻辑过于复杂或容易出错，乐观更新反而会带来糟糕的用户体验——用户先看到"正确"的乐观结果，然后闪烁为错误结果（回滚），最后又恢复为正确结果（重新获取）。这种"闪烁"比没有乐观更新更糟糕。在这种情况下，使用普通的 loading 状态可能更为稳妥。

#### 示例三：待办事项列表的添加和删除

```tsx
function useAddTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (title: string) =>
      axios.post('/api/todos', { title }).then(res => res.data.data),

    onMutate: async (title) => {
      await queryClient.cancelQueries({ queryKey: ['todos'] });

      const previousTodos = queryClient.getQueryData(['todos']);

      // 创建一个临时的待办项，带有临时 ID
      const tempTodo = {
        id: Date.now(), // 临时 ID，最终会被服务端返回的真实 ID 替换
        title,
        completed: false,
        created_at: new Date().toISOString(),
      };

      queryClient.setQueryData(['todos'], (old: any) => ({
        ...old,
        data: [tempTodo, ...old.data],
      }));

      return { previousTodos };
    },

    onError: (err, title, context) => {
      if (context?.previousTodos) {
        queryClient.setQueryData(['todos'], context.previousTodos);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}
```

---

## 与 Laravel API 的最佳配合

### API 响应格式规范

为了让前端更高效地处理数据，Laravel API 应当提供统一的响应格式。一致的接口规范可以减少前端的类型转换和错误处理代码，提升开发效率。

**成功响应（单条数据）：**

```json
{
  "data": {
    "id": 1,
    "name": "张三",
    "email": "zhangsan@example.com"
  },
  "meta": {}
}
```

**列表响应（分页）：**

```json
{
  "data": [
    { "id": 1, "name": "张三" },
    { "id": 2, "name": "李四" }
  ],
  "meta": {
    "current_page": 1,
    "last_page": 5,
    "per_page": 15,
    "total": 72
  }
}
```

**错误响应：**

```json
{
  "message": "验证失败",
  "errors": {
    "email": ["邮箱格式不正确"],
    "name": ["姓名不能为空"]
  }
}
```

在 Laravel 端，可以通过 API Resource 和 `additional` 方法轻松实现这种格式：

```php
// 单条数据
return new UserResource($user);

// 分页数据，附带元信息
return UserResource::collection($users)->additional([
    'meta' => [
        'current_page' => $users->currentPage(),
        'last_page' => $users->lastPage(),
        'per_page' => $users->perPage(),
        'total' => $users->total(),
    ],
]);
```

在前端，可以定义统一的类型和请求工具来匹配这种格式：

```tsx
interface ApiResponse<T> {
  data: T;
  meta?: Record<string, any>;
}

interface PaginatedData<T> {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}

// 封装 axios 实例，统一配置
const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});
```

### 分页数据处理（Laravel Paginator ↔ TanStack Query）

Laravel 的分页器和 TanStack Query 可以完美配合。以下是处理分页数据的推荐模式：

```tsx
function useUsers(params: { page?: number; search?: string; per_page?: number }) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: async (): Promise<PaginatedData<User>> => {
      const { data } = await api.get('/users', { params });
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

function UserList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const { data, isLoading, isFetching, isError, error } = useUsers({
    page,
    search,
    per_page: 15,
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <ErrorMessage error={error} />;

  return (
    <div>
      {/* 后台刷新指示器：当 isFetching 为 true 但 isLoading 为 false 时 */}
      {isFetching && <LinearProgress />}

      <UserSearch
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(1); // 搜索时重置到第一页
        }}
      />

      <Table>
        {data!.data.map(user => (
          <UserRow key={user.id} user={user} />
        ))}
      </Table>

      <Pagination
        currentPage={data!.meta.current_page}
        totalPages={data!.meta.last_page}
        onPageChange={setPage}
      />

      <div className="text-sm text-gray-500">
        共 {data!.meta.total} 条记录，第 {data!.meta.current_page} / {data!.meta.last_page} 页
      </div>
    </div>
  );
}
```

当 `search` 参数变化时，TanStack Query 会自动识别 `queryKey` 的变化并发起新的请求。由于 `queryKey` 包含了完整的查询参数，不同参数组合的缓存是独立的——用户搜索"A"的结果被缓存后，切换到搜索"B"再切回"A"时会立即展示缓存数据。这意味着用户在不同搜索词之间切换时，体验非常流畅。

### 错误处理与全局拦截

在实际项目中，推荐在 axios 层面统一处理常见的 HTTP 错误，同时利用 TanStack Query 的 `QueryCache` 和 `MutationCache` 处理查询级别的错误。这种分层处理的方式可以让错误处理逻辑清晰有序：

```tsx
// API 错误拦截：处理所有 HTTP 级别的错误
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response) {
      const { status, data } = error.response;

      switch (status) {
        case 401:
          // Token 过期或未登录，清除本地状态并跳转登录页
          queryClient.clear();
          window.location.href = '/login';
          break;
        case 403:
          toast.error('没有权限执行此操作');
          break;
        case 422:
          // 验证错误，通常在组件内通过 error.response.data.errors 处理
          // 这里不弹 toast，让组件自行展示字段级错误
          break;
        case 429:
          toast.error('请求过于频繁，请稍后再试');
          break;
        case 500:
          toast.error('服务器错误，请稍后再试');
          break;
      }
    } else if (error.request) {
      // 请求已发出但未收到响应
      toast.error('网络连接失败，请检查网络');
    }
    return Promise.reject(error);
  }
);

// TanStack Query 全局错误处理：决定哪些错误需要冒泡到 ErrorBoundary
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      throwOnError: (error: any) => {
        // 对于 4xx 错误，不抛出异常，让组件自行处理
        // 对于 5xx 或网络错误，抛出异常以触发 ErrorBoundary
        return !error?.response || error.response.status >= 500;
      },
    },
  },
});
```

你也可以在 `QueryCache` 和 `MutationCache` 的全局回调中处理错误，这在需要统一处理特定类型错误时非常有用：

```tsx
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error: any, query) => {
      // 全局查询错误处理
      if (error?.response?.status === 401) {
        queryClient.clear();
        router.navigate('/login');
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error: any) => {
      // 全局变更错误处理
      if (error?.response?.status === 422) {
        // 显示 Laravel 验证错误
        const errors = error.response.data.errors;
        Object.values(errors).flat().forEach((msg: any) => {
          toast.error(msg);
        });
      }
    },
  }),
});
```

---

## 高级技巧

### 无限滚动（Infinite Scroll）

TanStack Query 内置了对无限滚动的支持，通过 `useInfiniteQuery` 可以轻松实现。与传统的分页不同，无限滚动让用户通过滚动来加载更多数据，而非点击翻页按钮：

```tsx
function useInfiniteUsers(search?: string) {
  return useInfiniteQuery({
    queryKey: ['users', 'infinite', search],
    queryFn: async ({ pageParam = 1 }) => {
      const { data } = await api.get('/users', {
        params: { page: pageParam, search, per_page: 20 },
      });
      return data;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { current_page, last_page } = lastPage.meta;
      return current_page < last_page ? current_page + 1 : undefined;
    },
  });
}

function InfiniteUserList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteUsers();

  // 使用 IntersectionObserver 实现自动加载
  const observerRef = useRef<IntersectionObserver>();
  const lastElementRef = useCallback(
    (node: HTMLDivElement) => {
      if (isFetchingNextPage) return;
      if (observerRef.current) observerRef.current.disconnect();

      observerRef.current = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && hasNextPage) {
          fetchNextPage();
        }
      });

      if (node) observerRef.current.observe(node);
    },
    [isFetchingNextPage, hasNextPage, fetchNextPage]
  );

  if (isLoading) return <Skeleton count={10} />;

  // 将所有页的数据展平为一个数组
  const allUsers = data?.pages.flatMap(page => page.data) ?? [];

  return (
    <div>
      {allUsers.map((user, index) => (
        <div
          key={user.id}
          ref={index === allUsers.length - 1 ? lastElementRef : undefined}
        >
          <UserCard user={user} />
        </div>
      ))}
      {isFetchingNextPage && <LoadingSpinner />}
      {!hasNextPage && allUsers.length > 0 && (
        <p className="text-center text-gray-500 py-4">已经到底啦～</p>
      )}
    </div>
  );
}
```

与 Laravel 配合时，需要确保 API 返回的分页数据包含 `current_page` 和 `last_page` 字段，这样前端就可以准确判断是否还有下一页。Laravel 默认的分页器已经包含了这些字段，可以直接使用。

### 查询依赖（Dependent Queries）

有时一个查询的参数依赖于另一个查询的结果。比如你需要先获取当前用户的信息，然后根据用户的组织 ID 来获取该组织的成员列表。TanStack Query 通过 `enabled` 选项优雅地处理这种场景：

```tsx
function useUserWithOrganization(userId: number) {
  // 第一步：获取用户信息
  const userQuery = useQuery({
    queryKey: ['users', userId],
    queryFn: () => fetchUser(userId),
  });

  // 第二步：依赖用户信息获取其组织详情
  // 只有当 userQuery.data 存在且包含 organization_id 时才发起请求
  const orgQuery = useQuery({
    queryKey: ['organizations', userQuery.data?.organization_id],
    queryFn: () => fetchOrganization(userQuery.data!.organization_id),
    enabled: !!userQuery.data?.organization_id,
  });

  return {
    user: userQuery.data,
    organization: orgQuery.data,
    isLoading: userQuery.isLoading || (userQuery.isSuccess && orgQuery.isLoading),
    error: userQuery.error || orgQuery.error,
  };
}
```

这种模式的关键在于 `enabled` 选项：当它为 `false` 时，查询不会执行，直到条件变为 `true`。这比在 `queryFn` 内部进行条件判断更加声明式，也更容易被 TanStack Query 的缓存系统正确处理。

### 并行查询（Parallel Queries）

当多个查询之间没有依赖关系时，TanStack Query 会自动并行执行它们，最大限度地利用网络带宽：

```tsx
function Dashboard() {
  // 这三个查询会并行发起请求，总耗时等于最慢的那个
  const usersQuery = useQuery({
    queryKey: ['stats', 'users'],
    queryFn: fetchUserStats,
  });
  const ordersQuery = useQuery({
    queryKey: ['stats', 'orders'],
    queryFn: fetchOrderStats,
  });
  const revenueQuery = useQuery({
    queryKey: ['stats', 'revenue'],
    queryFn: fetchRevenueStats,
  });

  const isLoading = usersQuery.isLoading || ordersQuery.isLoading || revenueQuery.isLoading;

  if (isLoading) return <DashboardSkeleton />;

  return (
    <div className="grid grid-cols-3 gap-4">
      <StatCard title="用户数" value={usersQuery.data?.count} icon="👥" />
      <StatCard title="订单数" value={ordersQuery.data?.count} icon="📦" />
      <StatCard title="收入" value={revenueQuery.data?.amount} icon="💰" />
    </div>
  );
}
```

如果查询数量是动态的（比如根据配置决定要加载哪些数据源），可以使用 `useQueries`：

```tsx
function useMultipleUsers(userIds: number[]) {
  return useQueries({
    queries: userIds.map(id => ({
      queryKey: ['users', id],
      queryFn: () => fetchUser(id),
      staleTime: 1000 * 60 * 5,
    })),
    // 可选：当所有查询都成功时才认为整体成功
    combine: (results) => ({
      data: results.map(result => result.data),
      isLoading: results.some(result => result.isLoading),
      isError: results.some(result => result.isError),
      isFetching: results.some(result => result.isFetching),
    }),
  });
}
```

---

## 与 SWR 的对比及选型建议

在服务端状态管理领域，除了 TanStack Query，Vercel 团队的 **SWR** 也是一个广受欢迎的选择。SWR 的名字来源于 "stale-while-revalidate" 策略——一种 HTTP 缓存策略，即先返回过时的缓存数据，同时在后台重新验证并更新。

以下是两者的核心对比：

| 特性 | TanStack Query | SWR |
|------|---------------|-----|
| 包体积 | ~13KB (gzip) | ~4KB (gzip) |
| Mutations | 内置 `useMutation` + 完整生命周期 | 无内置，需自行封装 |
| 乐观更新 | 内置支持（onMutate/onError/onSettled） | 需手动通过 `mutate` 实现 |
| 缓存控制 | 精细的 staleTime/gcTime 分离 | 仅有 `dedupingInterval` |
| 无限滚动 | 内置 `useInfiniteQuery` | 需手动实现 |
| 开发者工具 | React Query Devtools（非常强大） | 无官方 Devtools |
| 预取 | 内置 `prefetchQuery` | 需手动调用 `mutate` |
| 框架支持 | React / Vue / Svelte / Solid / Angular | 仅 React |
| 查询依赖 | 通过 `enabled` 优雅实现 | 需借助条件 key |
| 分页 | 内置 `keepPreviousData` | 内置 `keepPreviousData` |
| 重试策略 | 可配置次数、延迟、条件 | 可配置次数、延迟 |
| 窗口聚焦刷新 | 内置支持 | 内置支持 |

**选型建议：**

- **选择 TanStack Query**：如果你的项目涉及大量的写操作（典型的 CRUD 应用），需要乐观更新、无限滚动等高级特性，或者你需要一个功能全面、社区活跃的方案。大多数中大型 React 项目推荐使用 TanStack Query。特别是当你的后端是 Laravel、Django、Rails 这类提供完整 RESTful API 的框架时，TanStack Query 的 mutation 管理和缓存失效机制能够与之完美配合。
- **选择 SWR**：如果你的项目以读取为主（如博客、文档站点、新闻聚合），追求极致的包体积，或者你已经在使用 Vercel 全家桶（Next.js + Vercel 部署）。SWR 的简洁 API 在简单场景下非常优雅，学习成本也更低。

值得注意的是，两个库都在积极发展中。TanStack Query 在 v5 中进一步优化了 API 设计和类型安全性，而 SWR 也在不断增强其缓存能力。选型时最重要的是根据项目的实际需求来决定，而不是盲目追求功能的全面性或包体积的精简。

---

## 总结

TanStack Query 不仅仅是一个数据请求库，它是一个完整的**服务端状态管理解决方案**。通过将服务端数据的生命周期——获取、缓存、失效、更新——抽象为声明式的 API，它极大地简化了前端开发中的复杂度。

在与 Laravel API 配合的最佳实践中，以下几点值得牢记：

1. **统一 API 响应格式**：Laravel 的 API Resource 加上统一的 `data` + `meta` 结构，可以让前端的类型定义和数据处理更加一致。一套清晰的接口规范是前后端高效协作的基础。
2. **合理设置缓存策略**：根据数据的实时性需求设置不同的 `staleTime`，而非一味使用默认值。高频变动的数据设置较短的 staleTime，配置类数据可以设置较长的 staleTime。同时合理设置 `gcTime`，避免不必要的内存占用。
3. **善用乐观更新**：对于点赞、购物车等用户期望即时反馈的操作，使用 `onMutate` + `setQueryData` 实现乐观更新，再通过 `onSettled` + `invalidateQueries` 确保最终一致性。但要注意乐观更新的适用场景——预测逻辑过于复杂时，不如使用常规的 loading 状态。
4. **预取提升体验**：在用户行为可预测的场景（如分页、悬停链接、搜索建议）中使用 `prefetchQuery`，让用户几乎感受不到加载延迟。分页场景下配合 `keepPreviousData` 使用效果更佳。
5. **全局错误处理**：在 axios 拦截器和 QueryCache/MutationCache 两个层面分别处理错误。HTTP 级别的错误（如 401、500）在拦截器中统一处理，业务逻辑级别的错误在组件或全局 Cache 回调中处理，确保用户体验的一致性。
6. **利用 Devtools 调试**：React Query Devtools 是调试缓存问题的利器，在开发阶段务必启用。它可以让你直观地看到每个查询的缓存状态、数据内容、请求状态等信息，大大降低调试难度。
7. **封装自定义 Hook**：将每个 API 端点的查询和变更逻辑封装为自定义 Hook（如 `useUsers`、`useCreateUser`），这样不仅代码更整洁，还能在多个组件间共享相同的缓存 key 和配置。

服务端状态管理是一个看似简单但实际充满细节的领域。TanStack Query 通过精巧的抽象和灵活的 API，让我们能够以更少的代码、更低的心智负担来处理这些细节。希望本文的内容能够帮助你在实际项目中更好地运用 TanStack Query，构建出体验更流畅、维护更轻松的前端应用。如果你还在用 `useEffect` + `useState` 手动管理服务端数据，现在就是迁移到 TanStack Query 的最佳时机。

---

## 相关阅读

- [Zustand 实战：轻量级 React 状态管理——对比 Redux/Jotai/Recoil 的工程选型与最佳实践](/categories/前端/Zustand-实战-轻量级React状态管理-对比Redux-Jotai-Recoil的工程选型与最佳实践/)
- [Jotai 实战：原子化状态管理——对比 Zustand/Redux 的细粒度响应式与 React Suspense 集成](/categories/前端/Jotai-实战-原子化状态管理-对比Zustand-Redux的细粒度响应式与React-Suspense集成/)
- [tRPC 实战：端到端类型安全的 API 层——TypeScript 全栈开发者告别 OpenAPI 代码生成的新范式](/categories/前端/tRPC-实战-端到端类型安全API层-TypeScript全栈告别OpenAPI代码生成/)
- [React 19 Compiler 实战：自动记忆化取代 useMemo/useCallback——React 性能优化范式的根本性转变](/categories/前端/2026-06-04-react-19-compiler-auto-memoization-revolution/)
