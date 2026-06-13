---

title: Flutter 响应式布局实战：屏幕适配、折叠屏、平板适配策略
keywords: [Flutter, 响应式布局实战, 屏幕适配, 折叠屏, 平板适配策略]
date: 2026-06-01 10:00:00
tags:
- Flutter
- 响应式
- 屏幕适配
- 折叠屏
- 平板
- UI
categories:
- mobile
cover: https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
description: 本文系统讲透 Flutter 响应式布局与屏幕适配实战，涵盖折叠屏、平板、多端断点系统、MediaQuery 与 LayoutBuilder 分工、导航与网格策略，帮你从手机到大屏建立真正可维护的适配方案。
---



# Flutter 响应式布局实战：屏幕适配、折叠屏、平板适配策略

做 Flutter 一段时间之后，很多同学都会遇到一个非常现实的问题：**同一套界面，在小屏手机上看起来刚刚好，到了大屏手机、平板、折叠屏，甚至桌面端，布局就开始“散架”**。按钮太宽、列表太空、对话框太窄、导航不合适、横屏后信息利用率极低——这些都不是单纯把组件“拉伸一下”就能解决的问题。

Flutter 的优势是“一套代码多端运行”，但这句话如果落到 UI 层，前提其实是：你必须建立一套**可持续演进的响应式布局体系**。否则随着业务增长，页面会充满 `if (width > xxx)` 的分支判断，最后维护成本比写三套页面还高。

这篇文章我不打算只停留在“MediaQuery 怎么拿宽度”“LayoutBuilder 怎么用”的 API 层面，而是从真实项目视角，系统讲透 Flutter 响应式布局的设计方法、代码组织方式以及在手机、平板、折叠屏、桌面端上的适配策略。文中会尽量使用接近企业项目的写法，包含断点系统、约束抽象、组件封装、布局图示、多端效果对比，以及一个电商 App 的多端适配实战案例。

如果你正准备做下面这些事情，这篇文章会比较适合你：

- 已经在做 Flutter App，但页面只在手机上验证过；
- 希望同一套业务代码适配手机、平板、折叠屏甚至桌面；
- 发现团队里“屏幕适配”写法很乱，想统一一套工程化方案；
- 想知道什么时候用 `MediaQuery`，什么时候用 `LayoutBuilder`，什么时候该上断点系统；
- 想避免“大屏只是把小屏放大”这种伪适配。

---

## 一、为什么 Flutter 响应式布局不能只靠“按比例缩放”

很多项目最开始做适配时，都会走一条弯路：设计稿是 375 宽，于是把所有尺寸都按照屏幕宽度去同比例缩放。这个思路在“单一手机尺寸范围”里偶尔还能凑合，但一旦面对平板、桌面、折叠屏，就会立刻暴露问题。

### 1.1 比例缩放的核心问题

原因很简单：**界面不是海报，UI 结构比像素尺寸更重要。**

比如一个商品列表页：

- 在 390 宽手机上，通常是一列卡片流；
- 在 840 宽平板上，更适合两列或三列网格；
- 在 1200 宽桌面窗口中，左侧可以是筛选条件，右侧是商品网格；
- 在折叠屏展开状态下，可能中间还有铰链分隔区域，不能简单连续布局。

你会发现，这些变化并不是把原来尺寸放大 1.5 倍、2 倍就可以解决的，而是：

1. **信息架构会变**：导航位置、列表密度、详情展示形式都会变化；
2. **交互方式会变**：桌面有鼠标悬停、键盘快捷键，平板更适合双栏；
3. **可用区域会变**：折叠屏存在逻辑分割区域，横竖屏也会导致约束发生巨大变化；
4. **阅读节奏会变**：大屏不应该只是“更大的留白”，而应该承载更多信息。

所以，响应式布局的本质不是缩放，而是：**在不同约束条件下，选择最适合当前设备和窗口的布局结构。**

### 1.2 Flutter 布局真正依赖的是约束，不是设备类型

初学 Flutter 时，大家容易从“设备类型”出发思考：这是手机、这是平板、这是桌面。可在 Flutter 的布局体系里，更底层、更可靠的判断依据其实是**约束（Constraints）**。

Flutter 的布局规则可以简化为一句话：

> 父组件给子组件约束，子组件在约束内决定尺寸，父组件再决定子组件的位置。

所以我们在写响应式布局时，真正要关注的是：

- 当前可用宽度是多少？
- 高度是否受限？
- 安全区域是多少？
- 是否被分割成多个逻辑显示区域？
- 当前方向是横屏还是竖屏？
- 当前输入方式偏触控还是鼠标键盘？

当你把适配逻辑建立在这些约束上，而不是死板地写“如果是 iPad 就怎样”，你的页面才会具备长期可维护性。

---

## 二、响应式设计原则与 Flutter 布局系统

要把 Flutter 响应式布局做好，建议先建立几个统一原则。否则每个页面都各写一套，就很容易在后期变成维护灾难。

### 2.1 原则一：先定结构，再调尺寸

很多页面失败的原因是反过来做了——先把每个按钮、间距、字体调好，然后再试图把这些元素塞进大屏里。正确顺序应该是：

1. 先确定页面在不同宽度下的**结构变化**；
2. 再定义组件在结构内的**尺寸策略**；
3. 最后做细节上的视觉微调。

例如一个详情页可以这样设计：

```text
手机（窄屏）
┌──────────────────┐
│ 商品图            │
│ 标题              │
│ 价格              │
│ 规格              │
│ 详情 Tabs         │
└──────────────────┘

平板 / 横屏（中屏）
┌──────────┬──────────────┐
│ 商品图    │ 标题 / 价格    │
│           │ 规格 / 操作区   │
└──────────┴──────────────┘
│          详情 Tabs         │
└───────────────────────────┘

桌面（宽屏）
┌────筛选/推荐侧栏────┬────────商品详情主区────────┐
│                    │ 商品图 + 信息双栏           │
│                    │ 详情 Tabs / 评论 / 推荐     │
└────────────────────┴────────────────────────────┘
```

这就是典型的“结构先行”。

### 2.2 原则二：组件响应式优先于页面响应式

很多人做适配只在页面根部加一个 `if (width > 600)`，然后整页切换两个版本。这样做短期很快，但会导致：

- 逻辑重复；
- 组件复用差；
- 页面越来越多后难以统一；
- 断点变化时要改很多地方。

更好的方式是：**先让基础组件具备响应式能力，再组合成响应式页面。**

例如：

- `ResponsivePadding`：根据断点自动给不同边距；
- `ResponsiveGrid`：根据宽度自动切换列数；
- `AdaptiveScaffold`：自动切换 `BottomNavigationBar` / `NavigationRail` / 侧边栏；
- `ResponsiveText`：限制最大宽度、最大字号梯度；
- `AdaptiveDialog`：手机弹底部面板，桌面弹居中对话框。

这样页面的适配更多是“拼装策略”，而不是“从零判断”。

### 2.3 原则三：断点是产品语言，不是魔法数字

如果团队里充满下面这种代码：

```dart
if (width < 580) ...
if (width > 610 && width < 930) ...
if (width > 701) ...
```

后面你几乎不可能维护。

更好的方式是给断点命名，把它变成团队共识：

```dart
class AppBreakpoints {
  static const double compact = 600;
  static const double medium = 840;
  static const double expanded = 1200;
}
```

然后在项目里统一说：

- `< 600`：手机紧凑布局；
- `600 ~ 839`：平板紧凑/折叠半展开布局；
- `840 ~ 1199`：平板横屏/小桌面布局；
- `>= 1200`：桌面宽屏布局。

此时断点不只是数值，更是一套设计语言。

### 2.4 Flutter 布局系统要点回顾

Flutter 的响应式能力，本质上建立在它成熟的布局系统之上。几个必须熟悉的核心组件：

- `Container` / `Padding` / `Align`：基础盒模型与位置控制；
- `Row` / `Column` / `Flex`：一维弹性布局；
- `Expanded` / `Flexible` / `Spacer`：剩余空间分配；
- `Wrap`：自动换行流式布局；
- `GridView` / `SliverGrid`：网格布局；
- `Stack` / `Positioned`：重叠布局；
- `ConstrainedBox` / `SizedBox` / `FractionallySizedBox`：尺寸控制；
- `LayoutBuilder`：根据父约束进行分支；
- `MediaQuery`：读取全局屏幕与环境信息；
- `OrientationBuilder`：根据方向变化切换布局。

这篇文章后面会重点讲：什么时候应该读取全局环境，什么时候应该依赖局部约束。

---

## 三、MediaQuery 与 LayoutBuilder 详解

在 Flutter 响应式布局里，`MediaQuery` 和 `LayoutBuilder` 几乎是出镜率最高的两个工具。但很多人虽然天天用，却并没有真的搞清楚两者职责边界。

### 3.1 MediaQuery：拿到“整个界面环境”

`MediaQuery` 适合读取的是**全局环境信息**，例如：

- 屏幕尺寸；
- 安全区域；
- 键盘高度；
- 文字缩放比例；
- 是否横屏；
- 显示特性（如折叠区域、刘海等）；
- 平台交互特征的一部分环境数据。

最常见写法：

```dart
final mediaQuery = MediaQuery.of(context);
final screenSize = mediaQuery.size;
final width = screenSize.width;
final height = screenSize.height;
final padding = mediaQuery.padding;
final viewInsets = mediaQuery.viewInsets;
final orientation = mediaQuery.orientation;
```

#### 什么时候该用 MediaQuery

典型场景包括：

1. 页面级断点判断；
2. 读取顶部状态栏 / 底部手势区安全距离；
3. 处理键盘弹出导致的底部输入区域抬升；
4. 读取 `displayFeatures` 判断折叠屏铰链区域；
5. 计算全屏弹层、弹窗最大宽度。

例如一个登录页容器最大宽度控制：

```dart
class LoginPage extends StatelessWidget {
  const LoginPage({super.key});

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final contentWidth = width > 480 ? 420.0 : width * 0.92;

    return Scaffold(
      body: Center(
        child: SizedBox(
          width: contentWidth,
          child: const LoginForm(),
        ),
      ),
    );
  }
}
```

这里的逻辑很自然，因为登录页整体就是围绕屏幕宽度决策的。

#### MediaQuery 的常见误区

误区一：**把所有响应式判断都写在 `MediaQuery.of(context).size.width` 上。**

如果一个组件位于侧边栏、弹窗、分栏区域中，那么真正决定它布局的往往不是整屏宽度，而是它自己拿到的父约束。此时继续拿整屏宽度判断，组件就会失真。

误区二：**在非常深的子组件中读取 MediaQuery 做局部布局决策。**

深层组件可能被包裹在局部容器里，这时它适合读局部约束，而不是全局屏幕。

### 3.2 LayoutBuilder：拿到“当前组件可用空间”

`LayoutBuilder` 的价值在于：**根据父组件传下来的约束动态构建子树。**

```dart
LayoutBuilder(
  builder: (context, constraints) {
    if (constraints.maxWidth < 600) {
      return const ProductListMobile();
    }
    return const ProductListTablet();
  },
)
```

这里的关键不是“设备是什么”，而是“这个组件此刻可用宽度是多少”。

#### LayoutBuilder 更适合哪些场景

1. 页面局部区域的响应式分栏；
2. 弹窗 / 卡片 / 列表项内部的布局变化；
3. 在父容器宽度变化时切换列数、间距、排列方式；
4. 桌面可拉伸窗口中某个面板的布局变化。

例如商品信息区在不同卡片宽度下切换排版：

```dart
class ProductMeta extends StatelessWidget {
  const ProductMeta({super.key, required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isCompact = constraints.maxWidth < 280;

        return isCompact
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(product.title, maxLines: 2),
                  const SizedBox(height: 8),
                  Text('¥${product.price}'),
                  const SizedBox(height: 8),
                  FilledButton(
                    onPressed: () {},
                    child: const Text('加入购物车'),
                  ),
                ],
              )
            : Row(
                children: [
                  Expanded(child: Text(product.title, maxLines: 2)),
                  const SizedBox(width: 12),
                  Text('¥${product.price}'),
                  const SizedBox(width: 12),
                  FilledButton(
                    onPressed: () {},
                    child: const Text('加入购物车'),
                  ),
                ],
              );
      },
    );
  }
}
```

这就是一个典型的“组件级响应式”。

### 3.3 MediaQuery 与 LayoutBuilder 如何分工

经验上，可以这样理解：

| 场景 | 更推荐 | 原因 |
|---|---|---|
| 判断整页是手机 / 平板 / 桌面 | MediaQuery | 这是全局视角 |
| 获取安全区域、键盘高度、折叠特征 | MediaQuery | 这些属于环境信息 |
| 组件在父容器不同宽度下切换布局 | LayoutBuilder | 依赖局部约束 |
| 列表项、卡片、弹窗内部响应式 | LayoutBuilder | 局部自适应更准确 |
| 大页面根布局 + 局部区域联动适配 | 两者结合 | 外层定模式，内层定细节 |

一个比较推荐的架构是：

```text
MediaQuery：决定页面属于哪一类布局模式
        ↓
LayoutBuilder：决定各区域在当前模式下如何使用自己的空间
```

例如：

- 页面根节点通过 `MediaQuery` 判断当前是否是 tablet；
- 左侧筛选面板内部通过 `LayoutBuilder` 判断卡片区是否要从 2 列变 3 列；
- 商品详情组件再根据自己的局部宽度切换标题和价格的排列方式。

### 3.4 一个组合示例

```dart
class ResponsiveProductPage extends StatelessWidget {
  const ResponsiveProductPage({super.key});

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final isDesktop = width >= 1200;
    final isTablet = width >= 600 && width < 1200;

    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            if (isDesktop) {
              return Row(
                children: [
                  const SizedBox(width: 280, child: FilterSidebar()),
                  Expanded(
                    child: ProductGridSection(
                      maxWidth: constraints.maxWidth - 280,
                    ),
                  ),
                ],
              );
            }

            if (isTablet) {
              return const ProductGridSection(maxWidth: null);
            }

            return const ProductListSection();
          },
        ),
      ),
    );
  }
}
```

这里并不是必须在 `LayoutBuilder` 中再读 `constraints.maxWidth` 做全局断点判断，而是展示一种思路：**外层负责模式切换，内层负责局部适配。**

---

## 四、断点系统设计：手机 / 平板 / 桌面

响应式布局能否长期维护，断点系统是决定性因素之一。好的断点系统要做到三件事：

1. 能表达产品设计意图；
2. 能覆盖主要设备形态；
3. 能让代码写起来稳定、统一。

### 4.1 为什么不建议直接写死“手机 / iPad / 桌面”

很多业务一开始会这样写：

```dart
if (Platform.isIOS && width >= 768) {
  // iPad
}
```

问题在于：

- Android 平板怎么办；
- 可折叠设备展开宽度也可能达到这个范围；
- 桌面窗口可以任意缩放，不存在固定设备宽度；
- Web 运行时浏览器宽度更加不稳定。

所以更可持续的思路是用**窗口宽度级别**定义布局模式。

### 4.2 一套实用断点设计

这里给一套在 Flutter 项目里比较好落地的断点：

```dart
enum WindowSizeClass {
  compact,
  medium,
  expanded,
  large,
}

class AppBreakpoints {
  static const compact = 600.0;
  static const medium = 840.0;
  static const expanded = 1200.0;

  static WindowSizeClass fromWidth(double width) {
    if (width < compact) return WindowSizeClass.compact;
    if (width < medium) return WindowSizeClass.medium;
    if (width < expanded) return WindowSizeClass.expanded;
    return WindowSizeClass.large;
  }
}
```

这套区间大致可以对应：

| 宽度区间 | 尺寸等级 | 常见场景 | 建议布局 |
|---|---|---|---|
| `< 600` | compact | 手机竖屏、小窗口 | 单列、底部导航 |
| `600 - 839` | medium | 大手机横屏、小平板、折叠半展开 | 双列、可选侧栏 |
| `840 - 1199` | expanded | 平板横屏、内嵌窗口、桌面窄窗 | 双栏 / 三栏、NavigationRail |
| `>= 1200` | large | 桌面宽屏、大平板横屏 | 侧栏 + 主区 + 详情区 |

### 4.3 把断点封装成上下文能力

推荐做法不是到处调用 `AppBreakpoints.fromWidth(...)`，而是包装成扩展或上下文工具：

```dart
extension ResponsiveContext on BuildContext {
  double get screenWidth => MediaQuery.sizeOf(this).width;

  WindowSizeClass get windowSizeClass {
    return AppBreakpoints.fromWidth(screenWidth);
  }

  bool get isCompact => windowSizeClass == WindowSizeClass.compact;
  bool get isMedium => windowSizeClass == WindowSizeClass.medium;
  bool get isExpanded => windowSizeClass == WindowSizeClass.expanded;
  bool get isLarge => windowSizeClass == WindowSizeClass.large;

  bool get isTabletLike =>
      windowSizeClass == WindowSizeClass.medium ||
      windowSizeClass == WindowSizeClass.expanded;

  bool get isDesktopLike =>
      windowSizeClass == WindowSizeClass.expanded ||
      windowSizeClass == WindowSizeClass.large;
}
```

使用时会很顺手：

```dart
if (context.isCompact) {
  return const MobileScaffold();
}

if (context.isTabletLike) {
  return const TabletScaffold();
}

return const DesktopScaffold();
```

### 4.4 断点不只决定列数，还决定交互结构

很多团队把断点理解成“宽度变了，Grid 列数加 1”。其实真正好的断点系统，还应该控制：

- 导航方式：BottomNavigationBar / NavigationRail / Drawer / Permanent Sidebar；
- 详情展示：push 新页 / 同页双栏 detail；
- 操作入口：悬浮按钮 / 顶部工具栏按钮 / 右键菜单；
- 信息密度：列表项高度、卡片宽度、留白策略；
- 弹层表现：底部弹出 / 对话框 / Popover。

可以把它理解成：

```text
断点 = 布局结构 + 交互形态 + 信息密度
```

### 4.5 推荐的响应式决策顺序

建议团队统一以下决策顺序：

1. 当前窗口属于哪个 Size Class；
2. 当前页面应该采用哪种结构模式；
3. 当前结构中的各区域如何分配空间；
4. 各组件根据局部约束微调内部排布。

这样你就能避免在最底层组件里随意做“全局判断”，让适配逻辑层次分明。

---

## 五、Flex 布局与自适应网格

Flutter 响应式布局的底层主力，仍然是 `Flex` 家族：`Row`、`Column`、`Expanded`、`Flexible`、`Wrap`。只要你把它们理解透了，很多适配都不需要上复杂方案。

### 5.1 Flex 的核心：剩余空间如何分配

先看一个经典例子：详情页顶部图文区域。

```dart
class ProductHeroSection extends StatelessWidget {
  const ProductHeroSection({super.key});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isWide = constraints.maxWidth >= 720;

        if (!isWide) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: const [
              ProductGallery(),
              SizedBox(height: 16),
              ProductInfoPanel(),
            ],
          );
        }

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: const [
            Expanded(
              flex: 5,
              child: ProductGallery(),
            ),
            SizedBox(width: 24),
            Expanded(
              flex: 4,
              child: ProductInfoPanel(),
            ),
          ],
        );
      },
    );
  }
}
```

这个例子很典型：

- 窄屏：纵向堆叠；
- 宽屏：横向双栏；
- 使用 `Expanded(flex: x)` 控制区域占比。

### 5.2 Expanded 与 Flexible 怎么选

两者都能参与弹性布局，但语义略有不同：

- `Expanded`：必须吃满分配到的剩余空间；
- `Flexible`：允许在剩余空间分配内根据子内容收缩。

一个经验口诀：

- 希望子区域“占满该占的空间”，优先 `Expanded`；
- 希望子区域“能弹性，但别强塞满”，用 `Flexible`。

例如工具栏按钮组在空间不足时更适合 `Flexible` + `Wrap` 组合：

```dart
class ProductToolbar extends StatelessWidget {
  const ProductToolbar({super.key});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 500) {
          return Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _buildActions(),
          );
        }

        return Row(
          children: [
            const Expanded(child: SearchBox()),
            const SizedBox(width: 12),
            ..._buildActions(),
          ],
        );
      },
    );
  }

  List<Widget> _buildActions() {
    return const [
      FilterChipWidget(label: '价格'),
      FilterChipWidget(label: '销量'),
      FilterChipWidget(label: '新品'),
    ];
  }
}
```

### 5.3 Wrap：处理“会溢出但不值得换页面结构”的场景

`Row` 最大的问题是：空间不够时会溢出。很多时候页面并不需要切结构，只是希望一行排不下就自动换行，这时 `Wrap` 非常适合。

常见场景：

- 筛选标签；
- 商品属性标签；
- 操作按钮组；
- 多个统计卡片的流式排布。

```dart
Wrap(
  spacing: 12,
  runSpacing: 12,
  children: specs.map((item) {
    return Chip(label: Text(item));
  }).toList(),
)
```

### 5.4 自适应网格：比固定列数更重要的是“期望卡片宽度”

做商品列表时，很多人第一反应是：

- 手机 2 列；
- 平板 3 列；
- 桌面 4 列。

这不算错，但不够优雅。更推荐的做法是：**先定义一个合理的卡片目标宽度，再根据容器宽度反推列数。**

例如：

```dart
int calculateCrossAxisCount(double width) {
  const minTileWidth = 220.0;
  const spacing = 16.0;

  final count = ((width + spacing) / (minTileWidth + spacing)).floor();
  return count.clamp(1, 6);
}
```

然后在 `GridView` 中使用：

```dart
class AdaptiveProductGrid extends StatelessWidget {
  const AdaptiveProductGrid({super.key, required this.products});

  final List<Product> products;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final crossAxisCount = calculateCrossAxisCount(constraints.maxWidth);

        return GridView.builder(
          padding: const EdgeInsets.all(16),
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: crossAxisCount,
            crossAxisSpacing: 16,
            mainAxisSpacing: 16,
            childAspectRatio: 0.72,
          ),
          itemCount: products.length,
          itemBuilder: (context, index) {
            return ProductCard(product: products[index]);
          },
        );
      },
    );
  }
}
```

这样的好处是：

- 宽度变化更连续；
- 桌面缩窗时更自然；
- 网页端也更容易适配；
- 卡片不会出现过宽或过窄的极端情况。

### 5.5 使用 Sliver 做复杂滚动页面时的响应式

如果你的页面是复杂电商首页，通常会使用 `CustomScrollView + SliverList + SliverGrid`。这时响应式思路不变：**关键还是在构建 Sliver 前先根据约束算好布局参数。**

```dart
class HomeContent extends StatelessWidget {
  const HomeContent({super.key});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final gridCount = calculateCrossAxisCount(constraints.maxWidth);

        return CustomScrollView(
          slivers: [
            const SliverToBoxAdapter(child: BannerSection()),
            SliverPadding(
              padding: const EdgeInsets.all(16),
              sliver: SliverGrid(
                delegate: SliverChildBuilderDelegate(
                  (context, index) => ProductCard(product: products[index]),
                  childCount: products.length,
                ),
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: gridCount,
                  crossAxisSpacing: 16,
                  mainAxisSpacing: 16,
                  childAspectRatio: 0.72,
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
```

### 5.6 一个多端效果对比示意

```text
手机（1~2列）
┌────────┐
│ 商品卡片 │
├────────┤
│ 商品卡片 │
└────────┘

平板（2~3列）
┌──────┬──────┐
│ 卡片1 │ 卡片2 │
├──────┼──────┤
│ 卡片3 │ 卡片4 │
└──────┴──────┘

桌面（4~5列 + 侧栏）
┌──筛选──┬────┬────┬────┬────┐
│        │卡片1│卡片2│卡片3│卡片4│
│        ├────┼────┼────┼────┤
│        │卡片5│卡片6│卡片7│卡片8│
└────────┴────┴────┴────┴────┘
```

响应式网格最关键的不是“列数公式”，而是：**让内容密度和阅读节奏在不同宽度下都合理。**

---

## 六、折叠屏适配：铰链检测、展开/折叠状态

折叠屏是很多 Flutter 项目在 2024 年之后越来越难回避的话题。它麻烦的点不在于“屏幕更大”，而在于：**折叠屏可能不是一个完整连续的矩形显示区域。**

### 6.1 折叠屏适配为什么不能当普通平板处理

普通平板虽然大，但内容区域通常是连续的。而折叠屏可能存在：

- 中间铰链区域不可用；
- 两侧屏幕被逻辑切成两个 pane；
- 展开与折叠状态频繁切换；
- 某些姿态下更像手机，某些姿态下更像双屏设备。

如果你只是简单根据宽度把页面切成双栏，很容易出现内容正好落在铰链上、按钮被分割、图片显示不完整等问题。

### 6.2 Flutter 中与折叠屏相关的环境信息

Flutter 可以通过 `MediaQuery.displayFeatures` 获取显示特征，这里面可能包含：

- 折叠区域；
- 铰链；
- 打孔 / 刘海等不规则区域。

一个基础读取示例：

```dart
final mediaQuery = MediaQuery.of(context);
final displayFeatures = mediaQuery.displayFeatures;
```

这些 `displayFeatures` 可以帮助我们识别是否存在物理或逻辑分割区域。

### 6.3 识别铰链区域的基本思路

```dart
Rect? findHinge(BuildContext context) {
  final features = MediaQuery.of(context).displayFeatures;

  for (final feature in features) {
    if (feature.type == DisplayFeatureType.hinge ||
        feature.type == DisplayFeatureType.fold) {
      return feature.bounds;
    }
  }
  return null;
}
```

拿到 `Rect` 之后，我们就能知道：

- 铰链位于中间的纵向区域，还是横向区域；
- 当前是左右双屏，还是上下双屏；
- 可用内容区域应该如何被切分。

### 6.4 按铰链切分双 pane 布局

假设当前是左右分割，我们可以把页面切成两个逻辑区域：

```dart
class FoldAwareScaffold extends StatelessWidget {
  const FoldAwareScaffold({super.key});

  @override
  Widget build(BuildContext context) {
    final hinge = findHinge(context);
    final screenWidth = MediaQuery.sizeOf(context).width;

    if (hinge == null) {
      return const ProductListPage();
    }

    final leftWidth = hinge.left;
    final rightWidth = screenWidth - hinge.right;

    return Row(
      children: [
        SizedBox(
          width: leftWidth,
          child: const ProductListPane(),
        ),
        SizedBox(width: hinge.width),
        SizedBox(
          width: rightWidth,
          child: const ProductDetailPane(),
        ),
      ],
    );
  }
}
```

这里的关键点不是示例代码本身，而是思路：**一旦存在折叠特征，布局应该围绕 pane 进行组织，而不是继续把整个屏幕当成单一区域。**

### 6.5 折叠 / 展开状态下的页面策略

实际项目中，建议把折叠屏分成几种模式：

1. **折叠态 / 窄屏态**：按手机布局处理；
2. **半展开或中间铰链分割态**：按双 pane 处理；
3. **完全展开但可视区域连续**：按平板布局处理；
4. **横向分割态**：上部内容 + 下部详情 / 工具区域。

例如一个商品页可以这样约定：

- 折叠时：商品列表点击后跳转详情页；
- 展开并检测到左右铰链：左侧列表，右侧详情；
- 无铰链但宽度足够：使用平板双栏布局；
- 横向分割：上区展示主内容，下区展示操作栏或辅助信息。

### 6.6 实战建议：避免内容穿过铰链

这个原则非常重要：

- 大图不要横跨铰链；
- 输入框不要居中跨过铰链；
- 重要按钮不要放在折叠中线；
- 轮播图、视频、地图等强连续内容，优先限制到单 pane 中。

一个布局示意：

```text
折叠屏展开（左右双 pane）
┌──────────┬────铰链────┬──────────┐
│ 商品列表   │            │ 商品详情   │
│ 搜索 / 分类 │            │ 图片 / 规格 │
│ 卡片流      │            │ 加购 / 推荐 │
└──────────┴────────────┴──────────┘
```

不要这样：

```text
┌────────────────────────────────────┐
│          大图横跨整个区域             │  ← 中间刚好被铰链切断
└────────────────────────────────────┘
```

### 6.7 推荐封装一个 FoldInfo

折叠屏判断逻辑最好不要散落在页面里，建议统一封装：

```dart
class FoldInfo {
  final bool hasHinge;
  final bool isVerticalSplit;
  final Rect? bounds;

  const FoldInfo({
    required this.hasHinge,
    required this.isVerticalSplit,
    required this.bounds,
  });

  factory FoldInfo.fromContext(BuildContext context) {
    final features = MediaQuery.of(context).displayFeatures;

    for (final feature in features) {
      if (feature.type == DisplayFeatureType.hinge ||
          feature.type == DisplayFeatureType.fold) {
        return FoldInfo(
          hasHinge: true,
          isVerticalSplit: feature.bounds.width < feature.bounds.height,
          bounds: feature.bounds,
        );
      }
    }

    return const FoldInfo(
      hasHinge: false,
      isVerticalSplit: false,
      bounds: null,
    );
  }
}
```

这样在页面里用起来会清爽很多。

---

## 七、平板适配：Master-Detail、NavigationRail

如果说手机布局核心是“聚焦单任务”，那平板布局核心往往是：**同时展示更多上下文信息。**

所以平板适配不能只是“把手机列表拉宽”。最常见、也最有价值的策略就是：

- Master-Detail 双栏；
- `NavigationRail` 侧边导航；
- 更高密度的信息区块；
- 更稳定的工具栏和筛选区。

### 7.1 Master-Detail 是平板最值得优先考虑的模式

所谓 Master-Detail，就是：

- 左边是列表 / 主导航 / 内容概览；
- 右边是当前选中项的详情。

例如订单管理、商品管理、消息中心、邮件客户端都非常适合。

#### 手机与平板效果对比

```text
手机
列表页 -> 点击 -> push 到详情页

平板
┌────────列表────────┬────────详情────────┐
│ 商品A              │ 商品A 的图文详情    │
│ 商品B              │ 规格、评论、操作栏   │
│ 商品C              │                    │
└───────────────────┴────────────────────┘
```

### 7.2 一个 Master-Detail 的 Flutter 实现示例

```dart
class ProductMasterDetailPage extends StatefulWidget {
  const ProductMasterDetailPage({super.key});

  @override
  State<ProductMasterDetailPage> createState() =>
      _ProductMasterDetailPageState();
}

class _ProductMasterDetailPageState extends State<ProductMasterDetailPage> {
  Product? selectedProduct;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final isTablet = width >= 840;

    if (!isTablet) {
      return ProductListPage(
        onTapProduct: (product) {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => ProductDetailPage(product: product),
            ),
          );
        },
      );
    }

    return Scaffold(
      body: Row(
        children: [
          SizedBox(
            width: 320,
            child: ProductListPane(
              selectedProduct: selectedProduct,
              onTapProduct: (product) {
                setState(() {
                  selectedProduct = product;
                });
              },
            ),
          ),
          const VerticalDivider(width: 1),
          Expanded(
            child: selectedProduct == null
                ? const EmptyDetailPlaceholder()
                : ProductDetailPane(product: selectedProduct!),
          ),
        ],
      ),
    );
  }
}
```

这种设计会显著提升平板上的效率，因为用户不需要在列表页和详情页之间来回跳转。

### 7.3 NavigationRail：平板与桌面过渡最自然的导航方案

在手机上我们通常使用 `BottomNavigationBar` 或 `NavigationBar`。但当宽度增加时，底部导航就显得有点浪费空间，也不够稳定。此时更合适的是 `NavigationRail`。

一个自适应导航示例：

```dart
class AdaptiveHomeShell extends StatefulWidget {
  const AdaptiveHomeShell({super.key});

  @override
  State<AdaptiveHomeShell> createState() => _AdaptiveHomeShellState();
}

class _AdaptiveHomeShellState extends State<AdaptiveHomeShell> {
  int index = 0;

  final pages = const [
    HomePage(),
    CategoryPage(),
    CartPage(),
    ProfilePage(),
  ];

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final useRail = width >= 840;

    if (!useRail) {
      return Scaffold(
        body: pages[index],
        bottomNavigationBar: NavigationBar(
          selectedIndex: index,
          onDestinationSelected: (value) => setState(() => index = value),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.home_outlined), label: '首页'),
            NavigationDestination(icon: Icon(Icons.grid_view_outlined), label: '分类'),
            NavigationDestination(icon: Icon(Icons.shopping_cart_outlined), label: '购物车'),
            NavigationDestination(icon: Icon(Icons.person_outline), label: '我的'),
          ],
        ),
      );
    }

    return Scaffold(
      body: Row(
        children: [
          NavigationRail(
            selectedIndex: index,
            onDestinationSelected: (value) => setState(() => index = value),
            labelType: NavigationRailLabelType.all,
            destinations: const [
              NavigationRailDestination(
                icon: Icon(Icons.home_outlined),
                label: Text('首页'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.grid_view_outlined),
                label: Text('分类'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.shopping_cart_outlined),
                label: Text('购物车'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.person_outline),
                label: Text('我的'),
              ),
            ],
          ),
          const VerticalDivider(width: 1),
          Expanded(child: pages[index]),
        ],
      ),
    );
  }
}
```

### 7.4 平板上的信息密度要更高，但不能无脑塞更多内容

平板比手机空间大，但并不意味着所有内容都应该一起展示。实战中建议这样处理：

- 手机上“二级页”的部分内容，可以在平板上合并到主页面；
- 列表项可以稍微降低高度，增加信息密度；
- 筛选面板可以常驻，但不宜挤压主内容过度；
- 详情页辅助信息区可以直接展开，不必都做折叠面板。

### 7.5 平板弹层策略

手机上很多东西适合 `showModalBottomSheet`，但到了平板上，底部弹层往往显得很怪。比如筛选面板、地址选择、优惠券列表，在平板上更适合：

- 居中对话框；
- 右侧抽屉；
- anchored panel；
- 双栏内嵌编辑区域。

可以统一封装一个自适应弹层：

```dart
Future<void> showAdaptiveFilter(BuildContext context) async {
  final width = MediaQuery.sizeOf(context).width;

  if (width < 600) {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => const FilterPanel(),
    );
    return;
  }

  await showDialog(
    context: context,
    builder: (_) => const Dialog(
      child: SizedBox(
        width: 520,
        child: FilterPanel(),
      ),
    ),
  );
}
```

---

## 八、桌面适配：窗口大小约束、鼠标/键盘交互

Flutter 的桌面适配和移动端最大的不同，不在于“分辨率更高”，而在于：**窗口是可以被用户任意拉伸的，且交互方式明显不同。**

### 8.1 桌面适配的第一原则：不要默认全屏宽度一定足够

在桌面上，用户完全可能把你的窗口缩到 700 宽，也可能拉到 1800 宽。因此桌面适配最忌讳：

- 认为桌面一定是多栏；
- 认为控件可以无限拉宽；
- 不给正文设置最大阅读宽度。

典型问题包括：

- 表单输入区拉成一整条横线，体验极差；
- 文章正文一行过长，可读性下降；
- 对话框与卡片无限变宽，视觉失衡。

### 8.2 给主要内容区域设置最大宽度

这是桌面端非常重要的一个技巧。

```dart
class CenteredContent extends StatelessWidget {
  const CenteredContent({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1280),
        child: child,
      ),
    );
  }
}
```

这种做法的好处是：

- 宽屏下内容不会散掉；
- 阅读区域更集中；
- 设计稿更容易控制；
- 与 Web 端体验更一致。

### 8.3 桌面布局推荐：固定侧栏 + 可扩展主区 + 上下文面板

很多业务系统在桌面上的理想结构通常是：

```text
┌─侧边导航─┬────────主内容────────┬─上下文面板─┐
│          │ 列表 / 表格 / 编辑器  │ 筛选 / 明细  │
│          │                     │ 活动日志等   │
└──────────┴─────────────────────┴────────────┘
```

这类结构在 Flutter 中通常用 `Row + ConstrainedBox + Expanded` 就能搭出来，并不复杂。

### 8.4 鼠标悬停与桌面反馈

桌面端不能只复用触摸交互。至少应该补齐以下行为：

- hover 态高亮；
- 鼠标指针样式变化；
- 右键菜单；
- 滚轮滚动体验；
- 可点击元素更明确的反馈。

例如一个可 hover 的商品卡片：

```dart
class HoverProductCard extends StatefulWidget {
  const HoverProductCard({super.key, required this.child});

  final Widget child;

  @override
  State<HoverProductCard> createState() => _HoverProductCardState();
}

class _HoverProductCardState extends State<HoverProductCard> {
  bool hovering = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => hovering = true),
      onExit: (_) => setState(() => hovering = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        transform: Matrix4.identity()..translate(0.0, hovering ? -2.0 : 0.0),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: hovering
              ? [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.08),
                    blurRadius: 18,
                    offset: const Offset(0, 8),
                  ),
                ]
              : [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.04),
                    blurRadius: 8,
                    offset: const Offset(0, 4),
                  ),
                ],
        ),
        child: widget.child,
      ),
    );
  }
}
```

### 8.5 键盘交互与焦点管理

桌面端适合引入更多快捷能力：

- `/` 聚焦搜索框；
- `Esc` 关闭弹层；
- 方向键切换列表项；
- `Enter` 打开详情；
- `Cmd/Ctrl + K` 打开命令面板。

Flutter 中可以通过 `Shortcuts`、`Actions`、`FocusableActionDetector` 等机制组织键盘交互。

一个最小示例：

```dart
class SearchShortcutWrapper extends StatelessWidget {
  const SearchShortcutWrapper({super.key, required this.child, required this.focusNode});

  final Widget child;
  final FocusNode focusNode;

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: {
        const SingleActivator(LogicalKeyboardKey.slash): ActivateIntent(),
      },
      child: Actions(
        actions: {
          ActivateIntent: CallbackAction<ActivateIntent>(
            onInvoke: (intent) {
              focusNode.requestFocus();
              return null;
            },
          ),
        },
        child: child,
      ),
    );
  }
}
```

### 8.6 桌面滚动体验与滚动行为

桌面通常更适合：

- 明确的滚动条；
- 鼠标滚轮支持；
- 触控板平滑滚动；
- 大区域可滚动但不要过度嵌套滚动。

如果页面里同时有主区、侧栏、表格，很容易出现多层滚动打架的问题。实战建议：

- 尽量保证主滚动只有一个；
- 必须多滚动容器时，明确每个区域的固定高度或边界；
- 表格、长列表放在独立可滚动区时，父层不要再包一个无限高度滚动。

---

## 九、OrientationBuilder 与横竖屏切换

很多团队做响应式，只判断宽度，不管方向。结果就是在大手机横屏或小平板竖屏时，体验经常很奇怪。

### 9.1 OrientationBuilder 的价值

`OrientationBuilder` 可以让你在方向变化时快速切换布局策略：

```dart
OrientationBuilder(
  builder: (context, orientation) {
    return orientation == Orientation.portrait
        ? const PortraitLayout()
        : const LandscapeLayout();
  },
)
```

它适合的场景包括：

- 视频页横屏进入沉浸模式；
- 表单页横屏改成双列；
- 图片详情横屏展示更多辅助信息；
- 商品详情页横屏把图和信息并排。

### 9.2 横竖屏不是唯一依据，要与宽度一起看

有一个常见误区：

```dart
if (orientation == Orientation.landscape) {
  return TabletLayout();
}
```

这很危险，因为手机横屏并不一定真的拥有足够可用宽度。更合理的方式是方向和宽度联合判断：

```dart
class ProductAdaptiveHero extends StatelessWidget {
  const ProductAdaptiveHero({super.key});

  @override
  Widget build(BuildContext context) {
    return OrientationBuilder(
      builder: (context, orientation) {
        final width = MediaQuery.sizeOf(context).width;
        final useSplit = orientation == Orientation.landscape && width >= 700;

        return useSplit
            ? const ProductHeroLandscape()
            : const ProductHeroPortrait();
      },
    );
  }
}
```

### 9.3 横屏状态下要重点关注哪些问题

1. 安全区域变化，尤其是带刘海和手势区设备；
2. 顶部 AppBar 是否仍然必要；
3. 列表项高度是否过高；
4. 图片、轮播图是否被压扁；
5. 输入法弹出时剩余可视区域是否足够。

### 9.4 一种实用策略：方向只做“增强”，不要做“依赖”

我更推荐把方向看成布局增强条件，而不是唯一条件。

例如：

- 默认按宽度系统确定页面结构；
- 当方向变为横屏时，再在某些局部区域增加信息密度；
- 避免做“只有横屏才可用”的关键交互。

这样能大幅降低方向切换带来的复杂度。

---

## 十、自定义约束系统与 SizeConfig

当页面多起来之后，你会发现只靠 `MediaQuery` 和一些零散函数还不够。团队需要一套更统一的响应式基础设施。这里最常见的做法，就是建立**自定义约束系统**或 `SizeConfig`。

### 10.1 SizeConfig 该解决什么问题

它不是为了“偷懒少写几行”，而是为了：

- 统一读取屏幕 / 窗口信息；
- 提供断点与布局模式判断；
- 统一页面边距、栅格、间距、内容最大宽度；
- 减少魔法数字散落；
- 为组件层提供稳定、可复用的尺寸语言。

### 10.2 一个实用版 SizeConfig

```dart
class SizeConfig {
  final Size screenSize;
  final EdgeInsets padding;
  final Orientation orientation;
  final WindowSizeClass sizeClass;

  const SizeConfig({
    required this.screenSize,
    required this.padding,
    required this.orientation,
    required this.sizeClass,
  });

  double get width => screenSize.width;
  double get height => screenSize.height;

  bool get isPortrait => orientation == Orientation.portrait;
  bool get isCompact => sizeClass == WindowSizeClass.compact;
  bool get isMedium => sizeClass == WindowSizeClass.medium;
  bool get isExpanded => sizeClass == WindowSizeClass.expanded;
  bool get isLarge => sizeClass == WindowSizeClass.large;

  double get pageHorizontalPadding {
    switch (sizeClass) {
      case WindowSizeClass.compact:
        return 16;
      case WindowSizeClass.medium:
        return 20;
      case WindowSizeClass.expanded:
        return 24;
      case WindowSizeClass.large:
        return 32;
    }
  }

  double get contentMaxWidth {
    switch (sizeClass) {
      case WindowSizeClass.compact:
        return width;
      case WindowSizeClass.medium:
        return 840;
      case WindowSizeClass.expanded:
        return 1080;
      case WindowSizeClass.large:
        return 1280;
    }
  }

  factory SizeConfig.of(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    return SizeConfig(
      screenSize: mediaQuery.size,
      padding: mediaQuery.padding,
      orientation: mediaQuery.orientation,
      sizeClass: AppBreakpoints.fromWidth(mediaQuery.size.width),
    );
  }
}
```

使用时：

```dart
final size = SizeConfig.of(context);

return Padding(
  padding: EdgeInsets.symmetric(horizontal: size.pageHorizontalPadding),
  child: Center(
    child: ConstrainedBox(
      constraints: BoxConstraints(maxWidth: size.contentMaxWidth),
      child: child,
    ),
  ),
);
```

### 10.3 再进一步：做成 InheritedWidget 或 Theme 扩展

如果项目更大，建议把这些响应式 token 放入：

- `InheritedWidget`；
- `ThemeExtension`；
- 独立的 design token 层。

这样你可以把“页面边距、卡片宽度、导航模式、栅格密度”统一托管，而不是到处 new 一个 `SizeConfig`。

### 10.4 自定义约束系统的真正价值

成熟项目里，响应式不是某一个页面临时写出来的逻辑，而是基础设施的一部分。一个好的约束系统至少应统一以下维度：

- 断点；
- 页面最大宽度；
- 区块横向边距；
- 栅格列间距；
- 列表项最小/最大宽度；
- 导航形态切换点；
- 弹层尺寸策略；
- 不同端的交互增强能力。

如果这些规则都沉淀下来，新页面的适配速度会快很多。

---

## 十一、实战案例：电商 App 多端适配

前面讲了很多原则和局部技巧，这一节我们把它们串起来，做一个更接近真实业务的电商 App 多端适配方案。

假设我们有四个核心页面：

1. 首页；
2. 分类 / 商品列表页；
3. 商品详情页；
4. 购物车页。

目标是：同一套 Flutter 代码，能在手机、折叠屏、平板、桌面上都维持较好的体验。

### 11.1 首页适配策略

首页常见模块：

- 顶部搜索；
- Banner；
- 分类宫格；
- 活动卡片；
- 商品推荐流。

#### 手机布局

```text
搜索栏
Banner
分类 4x2
活动卡片纵向排列
商品推荐 2列
底部导航
```

#### 平板布局

```text
顶部工具栏 + 搜索
Banner 更宽
分类 6~8 个一行
活动卡片横向双列
商品推荐 3列
NavigationRail / 双栏布局
```

#### 桌面布局

```text
左侧导航 / 分类树
中间首页内容
右侧活动/推荐/最近浏览面板
商品推荐 4~5列
```

一个简化版首页骨架：

```dart
class EcommerceHomePage extends StatelessWidget {
  const EcommerceHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final size = SizeConfig.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: size.contentMaxWidth),
            child: LayoutBuilder(
              builder: (context, constraints) {
                final isDesktop = constraints.maxWidth >= 1200;
                final isTablet = constraints.maxWidth >= 840;

                if (isDesktop) {
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      SizedBox(width: 240, child: CategorySidebar()),
                      SizedBox(width: 24),
                      Expanded(child: HomeFeed()),
                      SizedBox(width: 24),
                      SizedBox(width: 280, child: RightContextPanel()),
                    ],
                  );
                }

                if (isTablet) {
                  return const Row(
                    children: [
                      Expanded(flex: 7, child: HomeFeed()),
                      SizedBox(width: 20),
                      Expanded(flex: 3, child: RightContextPanel()),
                    ],
                  );
                }

                return const HomeFeed();
              },
            ),
          ),
        ),
      ),
    );
  }
}
```

### 11.2 商品列表页适配策略

列表页最适合体现响应式能力，因为它天然涉及网格、筛选、分页、排序。

#### 手机

- 顶部搜索 + 筛选入口；
- 筛选通过底部弹层展示；
- 商品列表 2 列或大卡片单列；
- 点击商品进入详情页。

#### 平板

- 左侧可展开筛选区域；
- 右侧商品网格 3 列；
- 某些情况下可做 Master-Detail。

#### 桌面

- 左侧常驻筛选；
- 右侧商品网格 4~5 列；
- 顶部工具栏显示排序、视图模式、批量操作。

布局示意：

```text
桌面商品列表
┌──筛选区──┬────────────────商品网格────────────────┐
│ 分类      │ 工具栏 排序 价格 销量 视图切换         │
│ 品牌      ├────┬────┬────┬────┬────┤
│ 价格区间   │卡片1│卡片2│卡片3│卡片4│卡片5│
│ 标签      ├────┼────┼────┼────┼────┤
│          │卡片6│卡片7│卡片8│卡片9│卡片10│
└──────────┴──────────────────────────────────────┘
```

### 11.3 商品详情页适配策略

详情页是最容易“只适配手机”的页面，因为大家习惯把它写成一长串 Column。真正要多端适配，建议拆成以下区块：

- 商品图片区；
- 基础信息区；
- 购买操作区；
- 详情内容区；
- 推荐商品区。

#### 手机

纵向堆叠：图在上、信息在下。

#### 横屏 / 平板

顶部图文双栏，详情继续下方展开。

#### 折叠屏展开 + 铰链双 pane

左侧图与规格概览，右侧详情/评论/推荐。

#### 桌面

可以增加悬浮购买区、右侧上下文推荐、评论摘要等。

一个自适应详情头部：

```dart
class ProductDetailHero extends StatelessWidget {
  const ProductDetailHero({super.key});

  @override
  Widget build(BuildContext context) {
    final fold = FoldInfo.fromContext(context);

    if (fold.hasHinge && fold.isVerticalSplit) {
      return const FoldSplitProductHero();
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 720) {
          return const ProductHeroPortrait();
        }
        return const ProductHeroWide();
      },
    );
  }
}
```

### 11.4 购物车页适配策略

购物车页面在大屏上很适合把结算摘要固定出来。

#### 手机

- 商品列表在上；
- 底部固定结算栏；
- 优惠券/地址通过弹层选择。

#### 平板 / 桌面

- 左侧购物车商品列表；
- 右侧固定订单摘要、优惠、配送、支付方式；
- 编辑、选择、删除操作更适合桌面工具栏。

```text
平板 / 桌面购物车
┌────────────────商品清单────────────────┬────订单摘要────┐
│ 勾选 商品图 标题 规格 单价 数量 小计     │ 商品总额        │
│ 勾选 商品图 标题 规格 单价 数量 小计     │ 优惠券          │
│ 勾选 商品图 标题 规格 单价 数量 小计     │ 运费            │
│                                        │ 应付金额        │
│                                        │ 去结算按钮      │
└───────────────────────────────────────┴──────────────┘
```

### 11.5 自适应 Scaffold 统一导航壳层

对于一个完整电商 App，建议统一封装壳层：

- 手机：`NavigationBar`；
- 平板：`NavigationRail`；
- 桌面：永久侧边导航。

```dart
class AdaptiveShopShell extends StatelessWidget {
  const AdaptiveShopShell({super.key, required this.index, required this.child});

  final int index;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;

    if (width < 840) {
      return Scaffold(
        body: child,
        bottomNavigationBar: _BottomNav(index: index),
      );
    }

    if (width < 1200) {
      return Scaffold(
        body: Row(
          children: [
            _RailNav(index: index),
            const VerticalDivider(width: 1),
            Expanded(child: child),
          ],
        ),
      );
    }

    return Scaffold(
      body: Row(
        children: [
          _SideNav(index: index),
          const VerticalDivider(width: 1),
          Expanded(child: child),
        ],
      ),
    );
  }
}
```

### 11.6 多端适配的一个组织建议

建议按照下面层级组织代码：

```text
lib/
  responsive/
    breakpoints.dart
    size_config.dart
    fold_info.dart
    adaptive_scaffold.dart
    responsive_grid.dart
  features/
    home/
    product/
    cart/
```

也就是说，把“响应式能力”沉淀成基础设施，而不是分散在每个业务目录里复制粘贴。

---

## 十二、常见踩坑与解决方案

这一节我集中讲一些 Flutter 响应式布局里非常常见、而且经常浪费排查时间的坑。

### 12.1 坑一：在 `ListView` / `GridView` 外再套无限高度 Column

表现通常是：

- `Vertical viewport was given unbounded height`；
- 页面滚动异常；
- 响应式切换后布局炸掉。

#### 原因

`ListView`、`GridView` 需要明确的滚动方向约束，而你在 `Column` 中直接放它们时，如果没有 `Expanded` 或固定高度，它们就拿不到边界。

#### 解决

```dart
Column(
  children: [
    const Toolbar(),
    Expanded(
      child: GridView.builder(...),
    ),
  ],
)
```

如果页面本来就是整体滚动，优先考虑 `CustomScrollView + Sliver`，不要把多个滚动容器硬拼。

### 12.2 坑二：Row 溢出，但误以为是适配问题

很多 yellow/black overflow 其实不是“没适配”，而是你用错了布局组件。

#### 典型情况

- 一行放标题、价格、按钮、标签；
- 字数一多，`Row` 直接爆；
- 然后你开始加各种 `MediaQuery` 判断。

#### 正解

- 能压缩的区域加 `Expanded`；
- 需要换行的改用 `Wrap`；
- 极窄宽度下切结构。

### 12.3 坑三：把字体也按屏幕宽度线性放大

这在移动端非常常见。结果就是：

- 平板标题大得夸张；
- 桌面正文过大，密度失衡；
- 用户系统字体缩放又叠加一次，直接失控。

#### 建议

- 字体应采用有限档位，而不是无上限比例缩放；
- 大屏主要增加的是布局层级和信息密度，不是把所有文字都放大；
- 同时要考虑 `textScaleFactor`。

### 12.4 坑四：只在模拟器看一个尺寸就认为适配完成

真实项目里最容易漏的情况包括：

- 小屏 Android 设备；
- 大屏 Android 设备；
- iPad 竖屏 / 横屏；
- 折叠屏展开 / 半展开；
- 桌面窄窗口；
- Web 浏览器随意缩放窗口。

#### 建议的验证矩阵

至少覆盖以下宽度：

- 360；
- 390；
- 600；
- 720；
- 840；
- 1024；
- 1280；
- 1440。

并且至少验证：

- 竖屏；
- 横屏；
- 键盘弹出；
- 长文本；
- 空状态；
- 加载态；
- 错误态。

### 12.5 坑五：把响应式逻辑写死在页面里，后期无法复用

一开始看似快，后期会变成：

- 每个页面都自己判断断点；
- 相同页面边距写了几十遍；
- 网格规则不统一；
- 新同学根本不知道该复用哪一套。

#### 解决

把这些统一抽象出来：

- `AppBreakpoints`；
- `SizeConfig`；
- `AdaptiveScaffold`；
- `ResponsiveGrid`；
- `AdaptiveDialog`；
- `ResponsivePagePadding`。

### 12.6 坑六：折叠屏只测“宽度”，不测 `displayFeatures`

这是很多项目踩得最深的坑。宽度足够并不代表可视区域连续。**只要面向折叠屏，就一定要关注 `MediaQuery.displayFeatures`。**

### 12.7 坑七：桌面直接复用移动端交互，不做 hover / focus / shortcut

结果是桌面端虽然能跑，但体验很“像被放大的手机 App”。

#### 建议

至少补齐：

- 可点击元素 hover 态；
- 焦点可见；
- 搜索快捷键；
- Esc 关闭弹层；
- 表格或列表方向键导航。

### 12.8 坑八：大屏留白很多，但信息密度没有提升

这是“伪适配”最典型的症状。页面虽然没坏，但大屏价值完全没有被利用。你需要问自己：

- 大屏是否能减少页面跳转；
- 是否能同时显示列表与详情；
- 是否能让筛选常驻；
- 是否能提供更多上下文；
- 是否能提升操作效率。

如果答案都是否，那你的页面大概率只是“放大版手机页面”。

---

## 十三、一套可落地的 Flutter 响应式实践清单

如果你准备在团队里推进响应式布局，下面这份清单很适合作为落地顺序：

### 第一步：先建立统一断点

- 定义 compact / medium / expanded / large；
- 不允许业务代码里出现大量魔法数字宽度判断；
- 输出到公共响应式模块。

### 第二步：统一页面容器与内容最大宽度

- 页面边距 token；
- 桌面正文最大宽度；
- 弹窗最大宽度；
- 表单最大宽度。

### 第三步：抽象通用适配壳层

- `AdaptiveScaffold`；
- `AdaptiveNavigation`；
- `AdaptiveDialog`；
- `ResponsiveGrid`。

### 第四步：优先改高收益页面

先改这些最能体现价值的页面：

- 列表页；
- 详情页；
- 表单页；
- 设置页；
- 管理后台或消息页。

### 第五步：补齐大屏与桌面交互

- hover；
- focus；
- 快捷键；
- 滚动条；
- 右键或上下文菜单（若业务需要）。

### 第六步：建立验证矩阵

- 多宽度截图；
- 横竖屏；
- 折叠屏；
- 桌面缩窗；
- 长文本、空态、错误态。

---

## 十四、结语：响应式布局不是“兼容工作”，而是产品能力

很多团队会把“屏幕适配”理解成开发后期的一项兼容性任务：产品功能都做完了，最后再补一补平板和桌面。这种思路通常会导致两种结果：

1. 适配工作量巨大，因为原始页面结构就没为多端设计；
2. 最后做出来的只是“能显示”，不是“体验合理”。

更好的思路是：**把响应式布局当成产品能力的一部分，从一开始就设计结构、断点和交互策略。**

Flutter 在这方面其实已经给了我们非常强的基础：

- `MediaQuery` 负责全局环境；
- `LayoutBuilder` 负责局部约束；
- `Flex` 和 `Grid` 负责结构伸缩；
- `OrientationBuilder` 负责方向增强；
- `displayFeatures` 负责折叠屏识别；
- `NavigationRail`、`Shortcuts`、`MouseRegion` 等帮助你拓展到平板与桌面。

真正决定项目适配质量的，不是你会不会这些 API，而是你有没有建立一套统一的响应式设计方法：

- 用断点描述布局层级；
- 用约束驱动而不是设备名驱动；
- 用组件响应式支撑页面响应式；
- 用大屏去提升效率，而不是制造空白；
- 用基础设施沉淀团队经验。

如果让我把全文收束成一句最核心的建议，那就是：

> **Flutter 响应式布局的关键，不是“让页面在所有屏幕上都看起来一样”，而是“让页面在每一种屏幕上都以最合适的方式工作”。**

当你真正按这个思路去设计手机、平板、折叠屏和桌面端界面时，“一套代码多端复用”才会从宣传语，变成工程现实。

## 相关阅读

- [Flutter 自定义 Widget 实战：CustomPainter、动画、手势处理](/categories/Flutter/Flutter-自定义-Widget-实战-CustomPainter-动画-手势处理/)
- [Flutter 性能优化实战：DevTools 分析、渲染优化、包体积裁剪](/categories/Flutter/Flutter-性能优化实战-DevTools-分析-渲染优化-包体积裁剪/)
- [Flutter 暗黑模式实战：ThemeData 动态切换与主题持久化](/categories/Flutter/Flutter-暗黑模式实战-ThemeData-动态切换与主题持久化/)
