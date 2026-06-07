# Dart 语言基础与 Widget 体系

## 定义

Flutter 是 Google 开发的跨平台 UI 框架，使用 Dart 语言作为其开发语言。Widget 是 Flutter 中一切 UI 构建的基本单元——界面中的按钮、文本、布局容器等都是 Widget。Flutter 的核心设计哲学是"**一切皆 Widget**"，通过组合（Composition）而非继承来构建复杂的用户界面。

**关键术语：**

- **Widget**：UI 的不可变描述，声明了"界面应该长什么样"
- **Element**：Widget 的实例化对象，管理 Widget 树与 RenderObject 树之间的连接
- **RenderObject**：负责实际的布局（layout）和绘制（paint）
- **State**：StatefulWidget 中可变的数据，驱动 UI 更新
- **BuildContext**：Widget 在树中的位置引用，用于向上查找祖先 Widget 提供的数据

## 核心原理

### 1. Dart 语言基础

Dart 是一种面向对象、基于类的语言，具有以下核心特性：

- **Sound null safety**：默认非空类型，使用 `?` 标记可空类型
- **异步编程**：`Future`、`Stream`、`async/await` 原生支持
- **Mixin**：通过 `mixin` 关键字实现代码复用（非继承）
- **Extension methods**：为现有类型添加方法
- **Generics**：泛型支持，如 `List<T>`、`Map<K, V>`
- **Isolates**：Dart 的并发模型，无共享内存的并行执行

```dart
// null safety
String name = 'Flutter';      // non-nullable
String? nickname = null;       // nullable

// async/await
Future<User> fetchUser() async {
  final response = await http.get(Uri.parse('/api/user'));
  return User.fromJson(jsonDecode(response.body));
}

// Mixin
mixin Draggable {
  void onDragStart() { /* ... */ }
  void onDragEnd() { /* ... */ }
}

class Widget with Draggable { }
```

### 2. Widget 树、Element 树、RenderObject 树

Flutter 维护三棵树协同工作：

```
Widget 树（配置描述）→ Element 树（生命周期管理）→ RenderObject 树（布局绘制）
```

- **Widget 树**：轻量、不可变，每次 `build()` 重新创建
- **Element 树**：持久化存在，对比新旧 Widget 决定是否更新 RenderObject
- **RenderObject 树**：执行实际的 layout 和 paint 操作

这个三树架构是 Flutter 高性能的关键——Widget 频繁重建但成本极低，真正昂贵的布局计算只在必要时发生。

### 3. StatelessWidget vs StatefulWidget

**StatelessWidget**：无状态，`build()` 方法只在首次构建和父 Widget 重建时调用。

```dart
class Greeting extends StatelessWidget {
  final String name;
  const Greeting({super.key, required this.name});

  @override
  Widget build(BuildContext context) {
    return Text('Hello, $name!');
  }
}
```

**StatefulWidget**：有状态，通过 `State` 对象管理可变数据，调用 `setState()` 触发重建。

```dart
class Counter extends StatefulWidget {
  const Counter({super.key});

  @override
  State<Counter> createState() => _CounterState();
}

class _CounterState extends State<Counter> {
  int _count = 0;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text('Count: $_count'),
        ElevatedButton(
          onPressed: () => setState(() => _count++),
          child: const Text('Increment'),
        ),
      ],
    );
  }
}
```

### 4. Widget 生命周期

**StatelessWidget 生命周期：**
1. `constructor` → 2. `createElement` → 3. `build`

**StatefulWidget 生命周期：**
1. `createState()` → 2. `initState()` → 3. `didChangeDependencies()` → 4. `build()` → 5. `didUpdateWidget()` → 6. `setState()` → 7. `deactivate()` → 8. `dispose()`

关键回调说明：
- `initState()`：仅调用一次，用于初始化（订阅、控制器创建）
- `didChangeDependencies()`：依赖的 InheritedWidget 变化时调用
- `didUpdateWidget(oldWidget)`：父 Widget 重建时调用，可在此对比新旧配置
- `dispose()`：释放资源（取消订阅、关闭控制器）

### 5. Composition vs Inheritance

Flutter 强烈推荐**组合优于继承**：

```dart
// ❌ 不推荐：继承
class GreenButton extends ElevatedButton { ... }

// ✅ 推荐：组合
class GreenButton extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
      onPressed: () {},
      child: const Text('Click me'),
    );
  }
}
```

### 6. 渲染管线（Rendering Pipeline）

Flutter 的渲染流程：

1. **Build 阶段**：调用 `build()` 生成 Widget 子树
2. **Layout 阶段**：从根节点向下传递约束（Constraints），从叶节点向上返回尺寸（Size）。"Constraints go down, sizes go up"
3. **Paint 阶段**：从根节点向下遍历，每个 RenderObject 绘制自身
4. **Compositing 阶段**：将绘制层合成最终画面
5. **Rasterization 阶段**：GPU 光栅化为像素输出到屏幕

**Repaint Boundary**：通过 `RepaintBoundary` Widget 隔离重绘区域，避免不必要的重绘传播。

### 7. Key 的作用

Key 帮助 Flutter 在 Widget 重建时正确匹配 Element：

- **ValueKey**：基于值匹配
- **ObjectKey**：基于对象引用匹配
- **UniqueKey**：每次都是唯一，强制重建
- **GlobalKey**：全局唯一，可跨树访问 State

```dart
ListView(
  children: items.map((item) =>
    ListTile(
      key: ValueKey(item.id),  // 帮助 Flutter 识别列表项
      title: Text(item.name),
    ),
  ).toList(),
)
```

## 实战案例

详细的 Dart 语言基础与 Widget 体系实战内容，请参阅博客文章：

👉 [Flutter 3.x 实战：Dart 语言基础与 Widget 体系详解](/categories/Flutter/Flutter-3x-实战-Dart-语言基础与-Widget-体系详解/)

该文章涵盖了：
- Dart 语言核心语法速览（类型系统、异步编程、集合操作）
- Widget 树构建与优化实战
- StatelessWidget 与 StatefulWidget 的选择策略
- 生命周期回调的最佳实践
- 自定义 Widget 开发完整示例
- 渲染性能分析与优化技巧

## 相关概念

- [状态管理选型](/wiki/Flutter/状态管理选型) — Widget 状态管理方案对比（Riverpod/Bloc/GetX），理解 `setState` 的局限性与进阶状态管理
- [路由与导航](/wiki/Flutter/路由与导航) — Widget 树中的页面跳转与导航管理，GoRouter 声明式路由

## 常见问题

### Q1: 什么时候用 StatelessWidget，什么时候用 StatefulWidget？

如果 Widget 不需要维护任何可变状态，用 StatelessWidget。如果需要根据用户交互、异步数据等改变显示内容，用 StatefulWidget。实际开发中，很多 StatefulWidget 可以通过状态管理库（如 Riverpod）替代为 StatelessWidget。

### Q2: setState() 的性能问题？

`setState()` 会重建整个 State 对应的 Widget 子树。如果子树较大，应将其拆分为更小的 StatefulWidget，缩小 `setState` 影响范围。也可以使用 `const` 构造函数标记不变的 Widget，Flutter 会跳过对它们的重建。

### Q3: Key 什么时候必须使用？

在以下场景必须使用 Key：
- 有状态 Widget 在列表中 reorder
- 使用 `AnimatedSwitcher` 等需要区分新旧 Widget 的场景
- 不同类型的 Widget 在同一位置切换（如条件渲染）

### Q4: 为什么 Widget 要设计为不可变？

不可变 Widget 使得 Flutter 可以高效地对比新旧配置（diff），且无需担心并发修改问题。重建 Widget 的成本很低（只是创建 Dart 对象），真正昂贵的布局和绘制由 RenderObject 管理，且通过 Element 树做最小化更新。

### Q5: BuildContext 是什么？

`BuildContext` 本质上就是 `Element` 对象的接口。它代表了 Widget 在树中的位置，用于通过 `context.findAncestorWidgetOfExactType<T>()` 或 `Provider.of<T>(context)` 等方式向上查找祖先提供的数据。
