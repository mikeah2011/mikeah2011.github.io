---
title: Flutter 性能优化实战：DevTools 分析、渲染优化、包体积裁剪
date: 2026-06-02 10:00:00
tags: [Flutter, 性能优化, DevTools, 渲染优化, 包体积]
keywords: [Flutter, DevTools, 性能优化实战, 分析, 渲染优化, 包体积裁剪, 移动端]
categories:
  - mobile
cover: https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&h=630&fit=crop
description: "Flutter性能优化实战指南，涵盖DevTools性能分析工具使用方法、渲染优化策略（减少rebuild/repaint）、包体积裁剪技巧（tree-shaking/资源治理/deferred loading）。通过实际项目案例讲解如何定位掉帧卡顿、内存泄漏等性能瓶颈，包含完整的代码示例和优化前后对比数据，助你打造流畅的Flutter应用。"
---


Flutter 的开发体验非常出色：一套代码多端运行、Hot Reload 高效、组件化表达能力强。但在项目从 Demo 走向真实业务后，性能问题几乎一定会出现：页面滚动偶发卡顿、首屏渲染不够稳定、动画掉帧、列表滑动时频繁重建、图片占用内存过高、安装包越来越大，甚至上线后还会出现内存持续上涨、切换页面数次后被系统回收的情况。

很多团队在遇到性能问题时，第一反应往往是“优化一下代码”或“把复杂 Widget 拆开”。这些做法并非无效，但如果没有建立一套基于数据的分析路径，优化就容易变成拍脑袋：你以为瓶颈在 build，实际上可能卡在 raster；你以为是图片太大，实际上是列表项频繁 repaint；你以为包体积是资源太多，实际上大头来自未裁剪的 native so 与字体资源。

这篇文章不谈泛泛而论的“最佳实践”，而是围绕 Flutter 性能优化中最常见、也最能落地的三条主线展开：

1. **如何用 DevTools 与 Timeline 先定位问题，而不是盲目改代码**。
2. **如何从渲染链路入手，优化 rebuild、repaint、图片与滚动性能**。
3. **如何对产物体积进行系统裁剪，包括 tree-shaking、资源治理与 deferred loading**。

文章会尽量按照“问题出现 → 监控与定位 → 原因分析 → 代码优化 → 验证结果”的顺序展开，同时补充实际项目中经常踩到的误区。你可以把它理解成一篇面向真实业务场景的 Flutter 性能优化实战手册。

---

# 一、先建立正确的性能优化观：不要一上来就改代码

Flutter 的性能问题本质上可以拆成三类：

- **UI 流畅性问题**：掉帧、卡顿、滚动不顺、动画不连贯。
- **资源占用问题**：内存过高、图片解码过重、对象泄漏、频繁 GC。
- **交付产物问题**：安装包大、下载慢、冷启动资源多、更新成本高。

这三类问题分别对应不同的关注指标：

- UI 流畅性更关注 **Frame 时间**、UI Thread / Raster Thread 的耗时、Shader 编译、build/layout/paint 的分布。
- 内存问题更关注 **堆内对象增长趋势**、Dart 对象分配、外部内存、图片缓存、页面关闭后的回收情况。
- 包体积问题更关注 **代码体积组成**、资源文件占比、字体与图片是否裁剪、动态加载策略是否合理。

很多 Flutter 开发者会把“性能优化”简单理解为“减少 setState”“加 const”“拆 Widget”。这些建议当然有价值，但必须明确一点：

> Flutter 优化不是靠背口诀，而是靠定位具体瓶颈。

例如：

- 一个页面 build 很快，但 raster 很慢，那么你继续拆 Widget 收益有限。
- 一个列表卡顿是因为每个 item 都在做大图解码，那么加 const 也解决不了问题。
- 一个页面切换后内存不降，根因可能是 controller、listener、stream 没有释放，而不是“图片太多”。
- 一个 APK 过大，主要可能是 ABI 没拆包、字体没子集化、第三方 SDK 引入了大量 native 依赖。

所以，真正有效的流程应该是：

**先测量，再定位；先验证，再优化；优化后复测。**

这也是全文的主线。

---

# 二、Flutter 性能问题到底发生在哪条链路上

要做好优化，先要理解 Flutter 一帧大致经历了什么。

从宏观上看，Flutter 每一帧都会经历如下过程：

1. 事件触发：用户输入、动画 tick、网络结果回调、setState 等。
2. Framework 层进行 Widget rebuild。
3. 生成和更新 Element / RenderObject。
4. 执行 layout、paint。
5. Engine 提交 Layer Tree。
6. Raster Thread 将图层栅格化并交给 GPU 显示。

如果设备是 60Hz，那么理论上一帧预算约为 **16.67ms**；如果是 120Hz，预算则更紧，约为 **8.33ms**。只要某一帧在 UI 线程或 Raster 线程上超出预算，就可能发生掉帧。

因此性能分析不能只看“build 慢不慢”，而要分清：

- **UI Thread 慢**：通常是 build/layout 复杂、状态变更范围过大、同步计算阻塞主线程。
- **Raster Thread 慢**：通常是重绘区域过大、图层复杂、阴影/裁剪/透明度开销高、图片过大、Shader 首次编译。
- **Platform / IO 层慢**：通常是磁盘、网络、MethodChannel 同步等待、初始化阶段任务过多。
- **Memory 压力大**：导致频繁 GC，间接影响帧稳定性。

这一层理解很重要，因为它决定了你查看 DevTools 时关注哪个图表、改哪个环节。

---

# 三、DevTools 是性能优化的起点：先把工具用对

Flutter 官方提供的 DevTools，是性能排查中最核心的工具集。很多人装过、打开过，但只停留在“看过图”，没有形成分析方法。其实只要掌握几个关键面板，就足够解决大部分性能问题。

## 3.1 DevTools 里最值得重点看的几个模块

在性能相关问题上，最常用的是以下几个部分：

1. **Performance**
   - 查看帧耗时图表。
   - 分析 UI / Raster 线程负载。
   - 结合 Timeline 观察 build、layout、paint、shader、GC 等事件。

2. **CPU Profiler**
   - 看某段时间内函数耗时。
   - 定位同步计算热点。
   - 排查解析 JSON、排序、数据预处理等 CPU 密集任务。

3. **Memory**
   - 观察堆大小变化。
   - 查看对象实例数增长。
   - 通过 Diff Snapshots 对比某页面前后是否有对象泄漏。

4. **Network**
   - 辅助排查图片、接口、资源加载时间。
   - 判断是否因为资源请求过慢导致首屏卡顿。

5. **App Size**
   - 分析构建产物各模块体积占比。
   - 对比不同版本包体积变化。

对于本文主题，最重要的是 **Performance、Memory、App Size**。

## 3.1.1 性能分析工具怎么选：先知道各自回答什么问题

很多团队的问题不是“不会打开 DevTools”，而是不清楚不同工具分别适合回答什么问题，结果要么只看一种图表，要么把本该用 Timeline 的问题拿去做肉眼猜测。下面这张表可以作为日常排查的快捷索引：

| 工具 / 面板 | 最适合定位的问题 | 关键观察指标 | 适用阶段 | 常见误区 |
| --- | --- | --- | --- | --- |
| Performance | 掉帧、卡顿、动画不顺、列表滑动不稳 | UI/Raster 耗时、jank 帧、Timeline 事件 | 首轮定位、优化前后对比 | 只看平均值，不看 worst frame |
| CPU Profiler | JSON 解析、排序、数据映射、同步阻塞 | 热点函数、自耗时、调用栈 | 怀疑主线程计算过重时 | 把 IO 问题误当成 CPU 问题 |
| Memory | 内存上涨、页面退出不回收、疑似泄漏 | Heap / External、Snapshot Diff、对象数量 | 生命周期治理、长时间使用场景 | 只截一次图，不做前后 Diff |
| App Size | 安装包过大、版本体积异常增长 | 代码、资源、字体、native so 占比 | 发版前、依赖升级后 | 只删图片，不分析真正大头 |
| Performance Overlay | 快速判断 UI 卡还是 Raster 卡 | 两条耗时柱状图是否超线 | 本地开发快速初筛 | 拿 overlay 代替正式分析 |

如果你只记一条经验，可以记住：**先用 Performance 定位交互链路，再用 CPU / Memory / App Size 做交叉验证**。这样能避免在错误方向上“优化得很努力，结果没收益”。

## 3.2 打开性能叠层，先做第一轮快速判断

在正式录制 Timeline 之前，可以先用 Flutter 自带的性能叠层做初筛：

```dart
MaterialApp(
  showPerformanceOverlay: true,
  home: const MyHomePage(),
)
```

也可以通过 Flutter Inspector 或命令行打开性能相关调试项。

性能叠层通常会展示两条图：

- 上方通常对应 rasterizer 相关耗时。
- 下方通常对应 UI 线程耗时。

当你滚动页面、切换 tab、播放动画时，如果发现：

- 下方柱子频繁超线，说明 UI 构建链路压力大。
- 上方柱子频繁超线，说明 raster / paint / 图层合成更可疑。

这一步虽然不如 Timeline 精准，但非常适合快速判断问题大致方向。

## 3.3 用 Profile 模式而不是 Debug 模式做分析

一个常见误区是：在 Debug 模式下看到卡顿，就直接开始优化。问题在于 Debug 模式本身存在额外开销，并不能代表真实运行表现。

做性能分析时，应尽量使用：

- **Profile 模式**：最适合性能分析。
- **Release 模式**：用于最终验证真实效果。

常见命令：

```bash
flutter run --profile
```

如果是分析包体积：

```bash
flutter build appbundle --analyze-size
```

如果是 iOS 也应使用对应的 profile/release 构建方式验证。

## 3.4 DevTools 分析的正确姿势

建议把分析过程标准化：

1. 明确场景，例如“首页首屏渲染”“商品列表快速滑动”“详情页进入动画”。
2. 进入 Profile 模式。
3. 打开 DevTools Performance。
4. 开始录制前，先让应用处于待测入口。
5. 开始录制，执行单一场景操作。
6. 停止录制，观察异常帧。
7. 再结合 Memory 或 CPU Profiler 做交叉验证。
8. 修改代码后重复同一场景复测。

这里的重点是“**单一场景、可复现、前后对比**”。

如果你一次录制里既滚动列表、又切换页面、又打开弹窗，那 Timeline 会很乱，很难知道某个尖峰到底来自哪个操作。

---

# 四、Timeline 分析实战：如何读懂一段卡顿记录

Timeline 是 Flutter 性能定位里最有价值的证据之一。它不是为了“看起来很专业”，而是为了告诉你：卡顿到底发生在什么线程、哪个阶段、哪一帧。

## 4.1 先看帧图，不要一上来钻到函数细节

打开 Performance 录制后，通常先看到的是一段帧耗时概览。这里最重要的是找出：

- 是否存在明显超过 16ms 的帧。
- 这些异常帧是偶发，还是连续出现。
- 异常主要出现在 UI 线程、Raster 线程，还是两者都有。

常见判断逻辑：

### 情况一：UI 线程尖峰明显

通常说明：

- build 范围太大。
- setState 影响面太广。
- 同步数据转换太重。
- 页面初始化做了过多串行任务。
- 列表 item build 成本高。

### 情况二：Raster 线程尖峰明显

通常说明：

- 重绘区域过大。
- 图层过于复杂。
- 大量透明度、裁剪、阴影、模糊效果。
- 大图解码/缩放开销高。
- 首次绘制触发 shader 编译。

### 情况三：UI 与 Raster 都高

这通常表示问题不是单点，而是页面整体复杂：

- 既有大范围 rebuild，又有重绘压力。
- 列表中每个 item 既复杂又不断变化。
- 页面首次进入同时做数据处理、布局和图片加载。

## 4.2 展开单帧，查看 build / layout / paint 分布

当发现某一帧异常后，要进一步展开这帧对应的 Timeline 事件。这里重点看：

- build 是否异常长。
- layout 是否反复执行。
- paint 是否超出预期。
- 是否有 Dart GC、图片解码、平台调用等事件插入。

如果 build 时间明显偏高，说明 Widget 树变更范围过大或单个构建逻辑太重。

如果 layout 时间高，常见原因包括：

- 深层嵌套布局。
- 不合理的 Intrinsic 计算。
- 列表中使用会触发额外测量的组件。
- 同一帧内多次布局失效。

如果 paint 时间高，则要重点怀疑：

- 自定义绘制复杂。
- 阴影、clip、opacity 使用过度。
- 列表项频繁重绘。
- 图片缩放与绘制成本大。

## 4.3 通过事件标记辅助分析业务逻辑

在复杂业务场景中，Timeline 里默认事件有时不够直观。这时可以通过 Dart Timeline API 给关键业务逻辑加标记，便于把“某次请求返回后的数据处理”与卡顿对应起来。

例如：

```dart
import 'dart:developer';

Future<void> loadData() async {
  Timeline.startSync('load-home-data');
  try {
    await repository.fetchData();
  } finally {
    Timeline.finishSync();
  }
}
```

或者：

```dart
Timeline.timeSync('parse-large-json', () {
  final result = parser.parse(rawJson);
  cacheResult(result);
});
```

这样在 DevTools Timeline 中就能直观看到业务片段与卡顿帧是否重合。对于排查首页初始化、复杂筛选、图表计算等场景尤其有效。

## 4.4 Timeline 分析中的几个常见误区

### 误区一：看到 build 多就一定是问题

Flutter build 本身并不等于“渲染昂贵”。Widget 是轻量描述对象，真正需要关心的是：

- build 是否频繁发生在不该发生的范围。
- build 是否伴随 layout / paint 的高成本。
- 单次 build 是否包含大量同步计算。

换句话说，**rebuild 多不一定糟糕，低效的 rebuild 才糟糕**。

### 误区二：只看平均值，不看最慢帧

用户感知卡顿，往往由少数极慢帧触发，而不是平均帧时间。一次 100ms 的掉帧，就足以让用户感知明显顿挫。

所以性能分析一定要关注：

- worst frame
- jank count
- 特定交互下的峰值帧

### 误区三：忽略首次渲染和二次渲染的差别

有些页面第一次进入卡，第二次就很顺，这通常与：

- shader 预热
- 图片缓存命中
- 列表复用后的稳定状态
- 首次数据解析

有关。因此分析时要区分“首次进入”和“重复进入”两个阶段。

---

# 五、Widget rebuild 优化：不是少 rebuild，而是精准 rebuild

在 Flutter 中，状态变化导致 Widget rebuild 是正常机制。真正的问题不是“重建”，而是“重建范围与频率失控”。

## 5.1 为什么页面会出现无意义的大范围 rebuild

最常见的原因有：

1. **setState 作用域过大**
   - 一个状态变化只影响标题文字，却让整个页面 Scaffold 下所有子树一起重建。

2. **状态提升过头**
   - 原本只属于局部组件的状态，被提升到父级，导致父级以下全部跟着刷新。

3. **依赖注入或状态管理使用不当**
   - Consumer / Selector / Obx / Provider 监听范围过大。
   - 一个列表中的所有 item 都监听了同一个全局状态变更。

4. **build 中创建不稳定对象**
   - 每次 build 都 new Controller、Formatter、FocusNode、Key、Style 等，导致子组件难以复用。

5. **列表 item 结构复杂且无拆分**
   - 每次局部变化都触发整项甚至整页重建。

## 5.2 优化原则一：缩小状态影响范围

看一个典型反例：

```dart
class CounterPage extends StatefulWidget {
  const CounterPage({super.key});

  @override
  State<CounterPage> createState() => _CounterPageState();
}

class _CounterPageState extends State<CounterPage> {
  int count = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Count: $count')),
      body: Column(
        children: [
          const HeavyBanner(),
          const ComplexChartArea(),
          const ExpensiveListSection(),
          ElevatedButton(
            onPressed: () {
              setState(() {
                count++;
              });
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }
}
```

表面上只是更新标题，但整个 `Scaffold` 下都会重新 build。更合理的做法是把变化区域收缩为更小的组件，或者借助 `ValueListenableBuilder`、`Selector` 等局部监听机制。

例如：

```dart
class CounterValue extends ValueNotifier<int> {
  CounterValue() : super(0);
}

class CounterTitle extends StatelessWidget {
  final CounterValue counter;
  const CounterTitle({super.key, required this.counter});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: counter,
      builder: (_, value, __) => Text('Count: $value'),
    );
  }
}
```

这样状态更新只影响真正依赖该数据的节点。

## 5.3 优化原则二：把静态子树“固定”下来

当某些子树本身不会变化时，应尽量让 Flutter 复用它们。

最简单的方式就是合理使用 `const`：

```dart
const SizedBox(height: 12)
const Text('标题')
const Icon(Icons.settings)
```

`const` 并不是性能银弹，但它有两个实际收益：

- 减少重复对象创建。
- 帮助框架更稳定地识别可复用子树。

更重要的是，**不要在 build 中反复创建本可复用的对象**，例如：

- `TextStyle`
- `EdgeInsets`
- `BorderRadius`
- `Duration`
- `ScrollController`（更不能放在 build 里）

例如反例：

```dart
Widget build(BuildContext context) {
  return Text(
    'Hello',
    style: TextStyle(
      fontSize: 16,
      fontWeight: FontWeight.w500,
      color: Colors.black,
    ),
  );
}
```

更好的方式：

```dart
static const titleStyle = TextStyle(
  fontSize: 16,
  fontWeight: FontWeight.w500,
  color: Colors.black,
);
```

虽然单次收益看似不大，但在大量列表项、频繁重建场景里会积少成多。

## 5.4 优化原则三：列表项必须局部更新

列表场景是 rebuild 问题最容易放大的地方。比如一个商品列表，用户只收藏了第 5 项，却导致整个 `ListView.builder` 中可见项全部 rebuild，这种问题在 DevTools 中非常常见。

优化策略包括：

1. 把 item 拆成更细粒度组件。
2. 让收藏按钮只监听当前 item 的收藏状态。
3. 使用 `Selector`、`InheritedModel`、局部 `ValueNotifier` 等方式精确依赖。
4. 避免在父列表 build 时构造复杂业务对象。

例如，列表项内将价格区、图片区、收藏按钮区分离，而不是整个卡片作为一个大组件监听所有变化。

## 5.5 使用 debug 工具观察 rebuild

Flutter 提供了一些调试手段帮助观察 rebuild，例如 `debugPrintRebuildDirtyWidgets`。开启后可以看到哪些 Widget 在重建。

不过要注意：

- 它适合开发期粗看，不适合作为最终结论。
- 看到某组件重建，不代表它一定是瓶颈。
- 仍然要回到 DevTools 的帧数据验证其是否真实影响性能。

## 5.6 何时应该拆 Widget

“拆 Widget”本身不是目的，目的是：

- 缩小状态传播范围。
- 提高静态子树复用概率。
- 让依赖关系更清晰。
- 让局部刷新可控。

如果只是为了“代码看起来更组件化”而随意拆分，但状态依赖仍挂在父层，性能未必会更好。

判断是否值得拆分，可以看两个标准：

1. 这个区域是否状态独立？
2. 这个区域是否构建成本明显、且可以避免无关刷新？

满足这两点，就值得拆。

---

# 六、RepaintBoundary：解决的不是 rebuild，而是 repaint

很多人会把 `RepaintBoundary` 当作“万能优化开关”，看到卡顿就包一层。这样做常常适得其反。因为它解决的是**重绘隔离问题**，不是状态构建问题。

## 6.1 RepaintBoundary 的核心作用

Flutter 在绘制时，会根据 Render Tree 的脏区域决定哪些部分需要 repaint。如果一个复杂区域中的局部内容频繁变化，而其余大部分内容其实不变，那么如果没有隔离，整个父区域都可能被重新绘制。

`RepaintBoundary` 的价值在于：

- 将某个子树隔离成独立的绘制边界。
- 当边界内外变化互不影响时，减少不必要的重绘传播。
- 在复杂静态区域与小范围动态区域并存时尤其有效。

## 6.2 典型适用场景

### 场景一：列表中的独立动画区域

例如商品卡片中有一个角标闪烁动画，如果不隔离，这个角标动画可能导致整张卡片甚至列表区域频繁重绘。

### 场景二：地图、图表、海报等复杂静态背景

上层只有一个小浮层或拖拽控件在变化，底部大背景其实不变，这时给静态复杂区域加 `RepaintBoundary` 收益通常较明显。

### 场景三：长列表中的复杂 item

如果列表项本身绘制复杂，但滚动过程中每项都作为独立可缓存区域存在，适当使用边界可以降低重复绘制成本。

## 6.3 什么时候不要乱用 RepaintBoundary

不建议在以下情况盲目添加：

1. **本身区域很小、绘制很轻**
   - 额外图层管理成本可能超过收益。

2. **内容本来就频繁整体变化**
   - 例如整块区域每帧都在变化，加边界意义不大。

3. **页面上边界过多**
   - 会增加图层数量和内存压力，反而不利。

4. **问题根因其实是 build 或 layout**
   - 这时你加 `RepaintBoundary` 没有实质帮助。

## 6.4 如何验证 RepaintBoundary 是否真的有效

最重要的是“**加前、加后对比 Timeline 与渲染表现**”。

你可以这样验证：

1. 记录未加边界时某交互的 Timeline。
2. 观察 Raster 耗时和卡顿帧。
3. 在怀疑区域加入 `RepaintBoundary`。
4. 用同样的手法复测。
5. 比较 Raster 峰值、平均耗时、jank 数量。

如果没有明显下降，就说明这个边界并非瓶颈所在。

## 6.5 一个实战判断标准

当你看到这种页面结构时，可以优先考虑绘制隔离：

- 背景复杂但稳定。
- 前景局部频繁变化。
- 滚动或动画过程中只是局部区域在更新。
- Raster 时间高于 UI 时间。

如果符合这些特征，`RepaintBoundary` 往往值得试。

## 6.6 一个可直接运行的 repaint 隔离示例

下面这个示例模拟“复杂静态卡片 + 局部倒计时角标”的真实业务场景。未优化版本里，倒计时每秒刷新会让整张卡片跟着重建和重绘；优化版本则把变化区域限制在角标本身，并通过 `RepaintBoundary` 隔离复杂图片区。

```dart
import 'dart:async';
import 'package:flutter/material.dart';

void main() {
  runApp(const MaterialApp(home: RepaintDemoPage()));
}

class RepaintDemoPage extends StatelessWidget {
  const RepaintDemoPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('RepaintBoundary Demo')),
      body: ListView.builder(
        itemCount: 20,
        itemBuilder: (_, index) => ProductCard(index: index),
      ),
    );
  }
}

class ProductCard extends StatelessWidget {
  final int index;
  const ProductCard({super.key, required this.index});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const RepaintBoundary(
              child: _ProductImage(),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('商品 #$index', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  const Text('这里模拟比较复杂但相对稳定的商品描述区域'),
                  const SizedBox(height: 8),
                  const _CountdownBadge(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProductImage extends StatelessWidget {
  const _ProductImage();

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Image.network(
        'https://picsum.photos/seed/flutter/240/240',
        width: 96,
        height: 96,
        fit: BoxFit.cover,
        cacheWidth: 192,
        cacheHeight: 192,
      ),
    );
  }
}

class _CountdownBadge extends StatefulWidget {
  const _CountdownBadge();

  @override
  State<_CountdownBadge> createState() => _CountdownBadgeState();
}

class _CountdownBadgeState extends State<_CountdownBadge> {
  late final Timer _timer;
  int _seconds = 60;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {
        _seconds = _seconds == 0 ? 60 : _seconds - 1;
      });
    });
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.red.shade50,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Text('剩余 $_seconds 秒'),
      ),
    );
  }
}
```

这段代码很适合配合 `debugRepaintRainbowEnabled` 或 DevTools Performance 一起观察：如果你把 `RepaintBoundary` 去掉，再滚动列表、等待角标刷新，通常会更容易看到 Raster 峰值抬高。

### 真实项目里的两个坑

- **坑一：边界放错位置**。把整个 `ListView` 或整个页面包成边界，往往收益不大，甚至会增加图层成本。
- **坑二：局部状态没拆开**。如果倒计时状态仍然在父组件里统一 `setState`，即使加了边界，build 范围还是太大，效果会被抵消。

---

# 七、图片优化：Flutter 页面卡顿与内存暴涨的高发区

图片是移动端性能问题中的重灾区。在 Flutter 项目里，很多卡顿、内存占用、包体膨胀问题，最后都能追溯到图片使用不当。

## 7.1 图片问题通常表现为什么

常见现象包括：

- 列表滑动时偶发掉帧。
- 首屏进入时短暂卡住。
- 页面停留后内存显著上涨。
- 部分低端机出现 OOM。
- 包体积中图片资源占比过高。

这些问题通常与以下因素相关：

- 原图尺寸远大于展示尺寸。
- 使用 PNG 存放照片类资源。
- 同屏大量图片同时解码。
- 图片缓存策略不合理。
- 详情页大图切换过于激进。
- 占位图、缩略图、原图没有分层治理。

## 7.2 首先理解：显示尺寸小，不代表解码成本小

这是最常见的误区之一。

例如你展示的是一个 100x100 的缩略图，但实际加载的是一张 4000x3000 的原图。即便最终 UI 上只显示成小方块，解码阶段依然可能消耗巨大内存与 CPU。

所以图片优化第一原则是：

> **尽量让解码尺寸接近展示尺寸。**

在 Flutter 中，可以使用 `cacheWidth`、`cacheHeight` 之类参数帮助控制解码目标尺寸。

例如：

```dart
Image.network(
  imageUrl,
  width: 100,
  height: 100,
  fit: BoxFit.cover,
  cacheWidth: 200,
  cacheHeight: 200,
)
```

这里并不是机械地等于展示尺寸，而是结合设备像素比做合理放大。

## 7.3 列表页优先用缩略图，而不是一把梭原图

一个成熟的图片策略，至少应区分：

- 列表缩略图
- 首屏中图
- 详情原图

很多团队的问题在于接口只返回一张图，列表、详情、分享海报都用它。这会让列表滚动性能与内存压力直接变差。

理想情况下应在服务端或 CDN 层提供多规格图片，客户端按场景取用。

## 7.4 合理控制预缓存，而不是滥用 precacheImage

`precacheImage` 在一些场景很有用，例如：

- 下一页立即会展示的头图。
- 即将进入的详情页首图。
- 启动页后紧接着要出现的品牌图。

但如果你一次性预缓存太多大图，会带来：

- 首屏初始化变慢。
- 内存快速上涨。
- 低端设备更容易触发回收。

因此预缓存要遵循“高确定性、小批量、短路径收益明显”的原则。

## 7.5 图片格式的选择同样影响性能与体积

一般来说：

- **JPEG / WebP**：适合照片类资源。
- **PNG**：适合透明背景、图标、简单图形，但体积往往更大。
- **SVG**：适合矢量图标或简单插画，但复杂 SVG 渲染也可能有性能成本。
- **AVIF / WebP**：在支持策略合适时，往往能进一步压缩体积。

在实际工程中，常见收益最大的并不是“换一种神奇格式”，而是：

1. 先把超大图裁到合理尺寸。
2. 再用合适的格式压缩。
3. 再按场景区分缩略图与原图。

## 7.6 使用缓存库时关注的不是“能缓存”，而是“缓存策略”

不少项目会使用 `cached_network_image` 等库，但引入缓存不等于性能自然变好。

你仍然需要明确：

- 最大缓存量是多少。
- 磁盘缓存和内存缓存策略如何。
- 列表快速滑动时是否造成大量无效请求。
- 失败重试是否过于激进。
- 占位图是否本身很重。

尤其在瀑布流、商品流、社交 feed 场景中，图片的“请求、解码、缓存、回收”必须整体考虑。

## 7.7 图片导致内存问题时，如何在 DevTools 中验证

可以按如下步骤操作：

1. 打开 Memory 面板。
2. 记录进入页面前内存基线。
3. 进入图片密集页面并滚动。
4. 观察堆内存与外部内存增长。
5. 退出页面后观察是否明显回落。

如果页面退出后内存迟迟不回落，可能是：

- 图片缓存仍保留过多。
- 页面对象未释放。
- 控件树或控制器有泄漏。

此时可以配合 Snapshot 与 Diff 继续分析。

---

# 八、包体积裁剪：从“能跑”到“交付高质量”

在不少 Flutter 项目里，功能增长到一定阶段后，大家才发现一个现实问题：安装包已经很大了。对用户来说，包体积过大带来的问题包括：

- 下载转化率下降。
- 首次安装耗时更长。
- 弱网场景流失更明显。
- 海外市场和低存储设备用户体验更差。

Flutter 包体积治理必须系统做，而不是靠一次性删几张图片。

## 8.1 先用 analyze-size 找出大头在哪里

构建时可以使用：

```bash
flutter build appbundle --analyze-size
```

构建完成后，可以在 DevTools 的 App Size 工具中查看详细组成。通常需要关注：

- Dart 代码体积
- native so 体积
- 资源文件（图片、字体、json、音视频）
- 第三方插件带来的平台侧依赖

很多时候真正的大头不是你以为的 Dart 业务代码，而是：

- 多 ABI 同时打进包里
- 未裁剪的字体
- 大量资源文件
- 某些第三方 SDK 附带的大型原生库

## 8.2 tree-shaking：先理解“为什么能减小”

Tree-shaking 的本质是：

> 在构建时移除不可达、未使用的代码与资源引用。

Flutter 在 release 构建中会进行一定程度的 tree-shaking，尤其对 Dart 代码和图标字体子集会有帮助。但前提是你的代码结构足够“可裁剪”。

如果你存在以下情况，tree-shaking 效果就会变差：

- 动态反射式使用大量类或资源。
- 一个工具库被粗暴引入，但实际上只用其中很小部分。
- 大而全的聚合依赖过多。
- 通过统一入口间接持有很多其实不会被用到的代码路径。

因此工程上应尽量：

- 避免不必要的大型依赖。
- 只引入真正使用的 package。
- 定期清理废弃页面、旧功能、冗余工具代码。
- 对图标字体进行子集化管理。

## 8.3 字体资源治理：很容易被忽视的大头

很多项目会直接引入完整图标字体或多语言字体文件，这在初期感觉方便，但体积会持续累积。

几个常见优化点：

1. **图标子集化**
   - 只保留实际使用的 icon glyph。

2. **按需引入自定义字体字重**
   - 不要把 Light、Regular、Medium、Bold、Black 全部带上，除非业务真的使用。

3. **减少重复字体家族**
   - 一套设计系统如果混用多种字体，体积与渲染复杂度都会上升。

4. **确认多语言资源策略**
   - 某些复杂字库对体积影响非常明显，应采用合理的产品策略。

## 8.4 资源文件治理：不要让 assets 成为黑洞

典型问题包括：

- 已废弃活动页图片仍在项目中。
- 同一资源多个分辨率版本没有统一治理。
- 本地 JSON、Lottie、音频文件长期堆积。
- 明明可走 CDN 的资源却全部内置进包。

建议建立资产治理清单：

- 定期扫描未引用资源。
- 大图改为远程下发。
- 本地仅保留启动关键资源与高频必要资源。
- 统一资源命名与分层目录，避免重复。

## 8.5 ABI 拆分：Android 体积优化的硬收益项

如果你的包中包含原生 so，且同时打入多个 ABI，那么包体积往往会比较可观。对 Android 来说，使用 App Bundle 或按 ABI 拆分，可以显著降低单用户实际下载体积。

尤其当你接入了：

- 音视频 SDK
- 地图 SDK
- 机器学习推理库
- 图像处理库

这类原生依赖时，ABI 管理非常关键。

## 8.6 deferred loading：把“不必首包加载”的内容延后

对于大型应用，deferred loading 是非常值得关注的高级优化手段。它的核心思想不是“总量减少”，而是：

> **把非首屏、非高频、非关键路径功能，从主包加载路径中移出去，延后到真正需要时再加载。**

适合 deferred loading 的场景包括：

- 很少进入的二级业务模块。
- 大型图表、编辑器、富媒体功能。
- 按地区或角色才会使用的功能分支。
- 首包不需要的管理后台型页面。

但 deferred loading 并非没有成本，需要平衡：

- 首次进入该模块时的加载体验。
- 模块拆分边界是否清晰。
- 路由与依赖是否容易解耦。
- 测试与发布复杂度是否增加。

在大型 Flutter 工程中，deferred loading 往往适合“重模块”而不是零散页面。

## 8.7 包体积治理的落地流程

建议把包体积优化做成固定流程，而不是版本末尾突击：

1. 每个里程碑版本都导出 size report。
2. 对比前后增长项。
3. 超阈值时必须给出增长说明。
4. 新引入依赖需说明体积影响。
5. 清理无用资源与废弃功能。
6. 对重模块评估 deferred loading。

只有把“体积变化”纳入工程治理，包才不会失控增长。

## 8.8 一个可落地的包体积治理清单

实际项目里，包体积失控往往不是单点问题，而是“依赖 + 资源 + 平台库 + 字体”一起堆出来的。与其临近发版时临时救火，不如把常见手段整理成固定检查项：

| 优化项 | 典型做法 | 主要收益 | 适用场景 | 注意事项 |
| --- | --- | --- | --- | --- |
| Dart 代码裁剪 | 清理废弃页面、拆分大而全工具库、减少无用依赖 | 减少主包代码体积 | 功能迭代快的业务项目 | 动态注册/反射式写法会削弱 tree-shaking |
| 资源治理 | 删除未引用 assets、图片压缩、多规格下发 | 降低安装包与运行时内存 | 活动素材多、图片多的项目 | 不要把高频启动资源全部远程化 |
| 字体裁剪 | 子集化 icon/font、减少字重 | 直接减少 assets 体积 | 自定义字体较多的项目 | 先统计真实使用字形再裁 |
| ABI / App Bundle | 用 AAB、按 ABI 拆分原生 so | 显著减少 Android 实际下载体积 | 接入音视频/地图/AI SDK 的项目 | 需验证各 ABI 渠道包完整性 |
| Deferred Loading | 重模块按需延后加载 | 缩短首包路径、优化首装体验 | 大型多模块应用 | 路由、依赖、测试链路更复杂 |

### 一个容易被忽视的现实问题

很多团队在 `pubspec.yaml` 中移除了资源声明，就以为资源已经不进包了；但如果构建脚本、原生工程或第三方 SDK 仍引用这些内容，最终产物里仍可能保留相关文件。因此包体积治理不能只看 Flutter 层，还要结合原生目录、插件依赖和实际 size report 交叉确认。

### 包体积优化时的实战误区

1. **只盯着图片，不看 native so**：很多包膨胀的真正大头是音视频、地图、AI 推理库。
2. **只看单次绝对值，不看版本增量**：真正该治理的是“哪个版本突然涨了 15MB”。
3. **为了减包过度远程化**：把启动强依赖资源都改远程，会把包体积问题转化成启动与弱网问题。
4. **没有为低频模块设置准入门槛**：营销、活动、富媒体模块经常是体积失控源头。

---

# 九、内存泄漏检测：不是只有 OOM 才算内存问题

Flutter 中的内存问题，很多不是直接崩溃，而是以“越来越卡”“切页几次后变慢”“后台切回前台容易被回收”等形式出现。背后往往是对象没有及时释放，或者缓存策略失控。

## 9.1 常见内存泄漏来源

在日常开发中，最常见的几类泄漏包括：

1. **Controller 未 dispose**
   - `AnimationController`
   - `ScrollController`
   - `TabController`
   - `TextEditingController`
   - `PageController`

2. **StreamSubscription 未取消**
   - 页面销毁后仍在监听数据流。

3. **Timer 未清理**
   - 定时器持续持有页面状态对象。

4. **Listener 未移除**
   - `addListener` 后没有 `removeListener`。

5. **闭包错误持有 BuildContext 或 State**
   - 异步回调、全局单例中保留页面引用。

6. **缓存无限增长**
   - Map、List、图片缓存、对象池没有上限或淘汰策略。

## 9.2 用 DevTools Memory 看增长趋势

内存分析的第一步不是立刻抓快照，而是先看曲线。

一个健康的页面通常表现为：

- 进入页面后内存上升。
- 操作过程中有波动。
- 离开页面后出现一定程度回落。
- GC 后总体趋势不会持续单边上升。

如果你反复进入/退出某个页面，内存曲线不断抬高且不回落，就很值得怀疑存在泄漏。

## 9.3 Snapshot 与 Diff 的实战用法

比较实用的一种方式是：

1. 在进入页面前做一次 Snapshot。
2. 进入页面，完成操作，再退出页面。
3. 做第二次 Snapshot。
4. 使用 Diff 对比前后对象数量变化。

重点关注：

- 某类页面 State 是否持续累积。
- Controller、Listener、业务 Model 是否没有释放。
- 图片对象、Uint8List、缓存容器是否增长异常。

例如，如果一个详情页退出后，`DetailPageState` 实例数仍不断累加，就说明生命周期管理有问题。

## 9.4 代码层面的内存治理习惯

建议形成以下固定习惯：

### 一、所有可释放对象都显式管理生命周期

```dart
class _DemoPageState extends State<DemoPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final ScrollController _scrollController;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this);
    _scrollController = ScrollController();
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }
}
```

### 二、异步回调前检查 mounted

```dart
Future<void> loadData() async {
  final result = await repository.fetch();
  if (!mounted) return;
  setState(() {
    data = result;
  });
}
```

这样可以避免页面销毁后仍更新状态，也能减少很多隐性引用问题。

### 三、全局缓存必须有上限与清理策略

例如：

- 最大条目数
- LRU 淘汰
- 按页面场景主动清理
- 前后台切换时降级清理

### 四、谨慎使用全局单例持有页面对象

单例是泄漏高发区，尤其是在工具类、埋点类、播放器管理器中。

---

# 十、实际案例：一个商品列表页的性能优化全过程

下面通过一个比较典型的业务页面，把前面的分析与优化串起来。假设这是一个电商商品列表页，用户反馈的问题是：

- 首次进入页面白屏时间略长。
- 快速滑动时偶发卡顿。
- 点击收藏时列表有轻微闪动。
- 使用十几分钟后内存变高。

## 10.1 初始现象与分析目标

页面特征如下：

- 顶部有轮播 Banner。
- 中间有筛选栏。
- 下方是商品卡片列表。
- 每个 item 包含商品图、标题、价格、券信息、倒计时角标、收藏按钮。
- 列表图片直接使用原图 URL。
- 收藏状态由父级统一 `setState` 维护。

目标不是“全面重写”，而是用最少的改动解决主要问题。

## 10.2 第一步：用 DevTools Performance 录制列表滑动

在 Profile 模式下录制“进入页面后连续快速滑动 5 秒”的场景，发现：

- UI 线程偶有尖峰，但不算特别夸张。
- Raster 线程尖峰更明显。
- 个别帧超过 20ms，卡顿主要出现在图片密集区域。

初步判断：

- 问题不只是 rebuild，更大概率与图片绘制和重绘有关。

## 10.3 第二步：观察收藏操作时的 rebuild 范围

打开调试日志后发现，每次点击收藏：

- 整个列表区域都会重新 build。
- 当前屏幕内多个 item 同时重建。

根因很明确：

- 收藏状态存放在父级列表页面。
- 点击某个 item 后父级 `setState`，导致整个列表子树重建。

### 优化动作一：将收藏状态下沉到 item 局部监听

改造方式：

- 把每个 item 的收藏状态放入独立状态对象。
- 收藏按钮区域单独做局部监听。
- 父级仅负责列表数据源，不承担每个 item 的细粒度 UI 刷新。

优化后再次录制，发现点击收藏时：

- UI 尖峰显著减小。
- 屏幕闪动感明显下降。

下面是一段更贴近日常业务、可以直接运行的局部刷新示例。核心点在于：列表页面不再因为某个商品收藏状态变化而整体 `setState`，而是每个 item 只监听自己的 `ValueNotifier<bool>`。

```dart
import 'package:flutter/material.dart';

void main() {
  runApp(const MaterialApp(home: FavoriteListPage()));
}

class ProductVm {
  final String title;
  final ValueNotifier<bool> isFavorite;

  ProductVm({required this.title, bool initialFavorite = false})
      : isFavorite = ValueNotifier(initialFavorite);

  void dispose() => isFavorite.dispose();
}

class FavoriteListPage extends StatefulWidget {
  const FavoriteListPage({super.key});

  @override
  State<FavoriteListPage> createState() => _FavoriteListPageState();
}

class _FavoriteListPageState extends State<FavoriteListPage> {
  late final List<ProductVm> _products;

  @override
  void initState() {
    super.initState();
    _products = List.generate(
      30,
      (index) => ProductVm(title: '商品 $index'),
    );
  }

  @override
  void dispose() {
    for (final product in _products) {
      product.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('局部刷新列表示例')),
      body: ListView.builder(
        itemCount: _products.length,
        itemBuilder: (_, index) => FavoriteItem(product: _products[index]),
      ),
    );
  }
}

class FavoriteItem extends StatelessWidget {
  final ProductVm product;
  const FavoriteItem({super.key, required this.product});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text(product.title),
      subtitle: const Text('只有收藏按钮会响应当前 item 的状态变化'),
      trailing: ValueListenableBuilder<bool>(
        valueListenable: product.isFavorite,
        builder: (_, isFavorite, __) {
          return IconButton(
            icon: Icon(
              isFavorite ? Icons.favorite : Icons.favorite_border,
              color: isFavorite ? Colors.red : Colors.grey,
            ),
            onPressed: () => product.isFavorite.value = !isFavorite,
          );
        },
      ),
    );
  }
}
```

### 这类改造在真实项目里最容易踩的坑

- **坑一：父组件仍然持有“全列表刷新”的副作用逻辑**。例如点击收藏后父层同时重新排序、重新过滤、重新创建整个列表数据，局部监听收益会被吞掉。
- **坑二：在 item build 中临时 new `ValueNotifier` / Controller**。这样会导致状态反复丢失，还可能引入内存泄漏。
- **坑三：局部刷新后没有复测**。建议在优化前后都录制“快速点击收藏 10 次”的 Timeline，确认 UI 尖峰是否真正下降。

## 10.4 第三步：定位 Raster 尖峰来源

继续看 Timeline，发现商品 item 中：

- 图片绘制相关耗时较高。
- 倒计时角标每秒刷新，导致 item 频繁重绘。

### 优化动作二：给倒计时角标与复杂图片区分层

做了两件事：

1. 将倒计时角标区域拆成独立组件，避免每秒刷新影响整个卡片。
2. 对商品图片区域与角标区域进行合理的 `RepaintBoundary` 隔离。

复测后：

- Raster 峰值下降。
- 快速滑动时丢帧次数减少。

需要强调的是，这一步并不是“所有 item 外包一层边界”，而是针对频繁变化与复杂静态区域做隔离。

## 10.5 第四步：图片优化

进一步分析发现，列表里展示的是 120x120 的商品图，但实际请求的是 2000px 以上原图。

### 优化动作三：切换缩略图并指定合理解码尺寸

具体做法：

- 接口改为返回商品缩略图 URL。
- 客户端展示时设置合适的 `cacheWidth`、`cacheHeight`。
- 详情页再加载高清图。

复测结果通常会带来三重收益：

- 列表滚动更稳。
- 内存峰值下降。
- 图片加载等待更短。

## 10.6 第五步：首屏白屏问题分析

继续录制首次进入场景，发现首页初始化时串行执行了这些任务：

- 拉 Banner 数据
- 拉商品列表
- 拉筛选项配置
- 解析本地城市信息 JSON
- 初始化埋点 SDK
- 预取推荐数据

其中一部分任务并非首屏强依赖。

### 优化动作四：拆分首屏关键路径

改造策略：

- 首屏只保留 Banner、首屏商品列表、必要筛选项。
- 埋点非关键初始化延后。
- 本地大 JSON 解析移出首帧阶段，必要时放入 isolate。
- 推荐数据预取延迟到首帧后执行。

优化后首屏体感显著改善。

## 10.7 第六步：内存增长问题分析

在 Memory 面板中重复“进入列表 → 进详情 → 返回 → 再进详情”多次后发现：

- 内存持续缓慢上涨。
- 详情页相关对象数量未完全回落。

最终排查到：

- 详情页 `ScrollController` 未 dispose。
- 图片查看器中的监听器未解除。
- 某个促销倒计时 Timer 在页面退出后仍运行。

### 优化动作五：补全生命周期管理

修复这些问题后，再做 Diff Snapshot：

- 详情页对象累积现象消失。
- 长时间使用后的内存斜率趋于平缓。

## 10.8 第七步：包体积顺手治理

在 App Size 中发现：

- 活动素材占用了较大 assets 体积。
- 某营销模块虽然使用率低，但引入了一整套富媒体资源。
- 自定义字体包含了过多未使用字重。

### 优化动作六：资源与模块拆分

- 清理废弃活动素材。
- 合并与压缩部分图片资源。
- 低频营销模块评估 deferred loading。
- 精简字体字重。

最终不仅性能更稳定，发版包体积也得到控制。

---

# 十一、性能优化中的高频误区清单

为了帮助你在项目里少走弯路，这里把最常见的误区集中列出来。

## 11.1 误区：看到卡顿就疯狂加 const

`const` 有价值，但它解决不了：

- 大图解码
- Raster 线程过重
- 内存泄漏
- 同步计算阻塞

它只是优化体系中的一个小点。

## 11.2 误区：所有复杂组件都包 RepaintBoundary

错误使用会带来更多图层与内存开销。必须结合重绘模式与 Timeline 验证收益。

## 11.3 误区：列表卡顿一定是 ListView 的锅

真正的根因常常在 item 内容本身：

- 图片太大
- item build 太重
- 局部动画影响整项重绘
- 每项都做同步格式化与计算

## 11.4 误区：只在高端测试机上看效果

高端机能掩盖很多问题。性能优化必须尽量覆盖：

- 中低端 Android 机型
- 高刷新率设备
- 首次安装场景
- 弱网和冷启动场景

## 11.5 误区：优化后不复测

没有数据对比的优化，很容易只是“代码变复杂了”。

务必保留：

- 优化前录制
- 优化后录制
- 关键指标对比
- 结论归因

---

# 十二、推荐一套可长期执行的 Flutter 性能治理流程

如果你希望团队不是“出问题再救火”，而是持续稳定地管理性能，建议建立如下流程。

## 12.1 开发阶段

- 新页面提测前，至少完成一次 Profile 模式自测。
- 对复杂列表、动画页、图表页进行专项录制。
- 规范 controller / listener / timer 生命周期管理。
- 对图片资源与接口缩略图方案进行评审。

## 12.2 联调阶段

- 用 DevTools 验证关键交互场景。
- 对卡顿场景保留录制证据。
- 若引入大型 SDK，同步关注 App Size 变化。

## 12.3 发版前

- 跑一次包体积分析。
- 核查资源增量。
- 复测首屏、列表滑动、核心动画、图片密集场景。
- 检查高频页面的内存回收情况。

## 12.4 线上阶段

- 结合埋点采集关键性能指标。
- 关注启动耗时、页面打开耗时、崩溃与 OOM 指标。
- 将性能问题与具体版本变更关联。

只有形成闭环，性能优化才不会停留在“某个同学特别懂”的个人经验层面。

---

# 十三、一个实用的 Flutter 性能优化检查表

最后给出一份可以直接用于项目自查的清单。

## 13.1 DevTools 与定位

- [ ] 是否在 Profile 模式下分析？
- [ ] 是否针对单一场景录制 Timeline？
- [ ] 是否区分 UI 线程与 Raster 线程瓶颈？
- [ ] 是否保留优化前后对比结果？

## 13.2 rebuild 优化

- [ ] setState 作用域是否过大？
- [ ] 状态是否可以进一步局部化？
- [ ] 列表项是否只更新必要区域？
- [ ] 是否避免在 build 中创建重对象？
- [ ] 静态子树是否合理使用 const 与复用？

## 13.3 repaint 优化

- [ ] 是否存在局部变化导致大区域重绘？
- [ ] RepaintBoundary 是否用在真正需要隔离的区域？
- [ ] 是否验证过加边界前后的 Raster 改善？

## 13.4 图片优化

- [ ] 是否存在原图缩略显示？
- [ ] 是否根据展示尺寸控制解码大小？
- [ ] 列表、详情、预览图是否分规格？
- [ ] 图片缓存是否有策略与边界？

## 13.5 包体积优化

- [ ] 是否定期生成 size report？
- [ ] 是否清理未使用资源与依赖？
- [ ] 字体是否做了子集化与字重裁剪？
- [ ] 是否评估低频重模块的 deferred loading？
- [ ] Android 是否合理使用 App Bundle / ABI 拆分？

## 13.6 内存治理

- [ ] Controller / Timer / Subscription 是否都被释放？
- [ ] 页面退出后内存是否明显回落？
- [ ] 是否用 Snapshot / Diff 分析过可疑页面？
- [ ] 是否存在无限增长缓存？

---

# 十四、结语：性能优化的关键不在技巧，而在方法论

Flutter 的性能优化并不神秘。难点不在于 API 本身，而在于很多团队缺少一套稳定的方法论：遇到问题时，不知道先测哪里；改完以后，不知道是否真的有效；包体积增长时，也没有持续治理机制。

如果把本文浓缩成一句话，那就是：

> **性能优化不是“做几个技巧”，而是围绕 DevTools 建立定位—优化—验证的闭环。**

当你在项目中真正把这套闭环跑起来后，会发现很多性能问题并不需要“大手术”：

- 一次合理的 Timeline 录制，就能区分是 UI 卡还是 Raster 卡。
- 一次局部状态收缩，就能消掉列表的大范围 rebuild。
- 一个正确放置的 RepaintBoundary，就能降低无意义重绘。
- 一次图片规格治理，就能同时改善流畅度、内存和包体积。
- 一次系统性的 size 分析，就能避免安装包持续失控。
- 一次 Memory Diff，就能抓出长期潜伏的 controller 泄漏。

对 Flutter 应用来说，真正成熟的性能优化不是“追求极限跑分”，而是让用户在核心路径上始终感觉顺滑、稳定、轻量、可持续迭代。

如果你准备从今天开始做 Flutter 性能治理，最好的起点不是先改代码，而是：

1. 打开 DevTools。
2. 选一个最常被用户抱怨的场景。
3. 录一次 Timeline。
4. 找到最慢的那一帧。
5. 用数据驱动你的下一次优化。

当你习惯这样工作后，性能优化就不再是一件“玄学”事情，而会变成一项可度量、可复用、可沉淀的工程能力。

## 相关阅读

- [Flutter 状态管理实战：Riverpod、Bloc、GetX 选型对比与最佳实践](/post/flutter-riverpod-bloc-getx/)
- [Flutter 响应式布局实战：屏幕适配、折叠屏、平板适配策略](/post/flutter/)
- [Flutter 测试实战：Unit、Widget、Integration 三层测试体系](/post/flutter-unit-widget-integration/)
- Flutter CI/CD 实战：GitHub Actions 自动化构建测试发布
- [Flutter 自定义 Widget 实战：CustomPainter、动画、手势处理](/post/flutter-widget-custompainter/)
