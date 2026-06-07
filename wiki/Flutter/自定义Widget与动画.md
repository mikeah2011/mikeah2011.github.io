# 自定义 Widget 与动画

## 定义

自定义 Widget 与动画是 Flutter 提供的高级 UI 扩展能力，允许开发者突破标准组件库的限制，创建高度定制化的视觉效果和交互体验。

- **CustomPainter**：Flutter 中用于自定义绘制的核心类，基于 `Canvas` API 实现像素级别的图形绘制。
- **Canvas 绘制**：底层图形绘制 API，支持路径（Path）、贝塞尔曲线、圆弧、渐变、阴影、图片混合等操作。
- **AnimationController**：显式动画的控制器，管理动画的播放状态（开始、停止、反转、重复）和时间进度。
- **隐式动画（Implicit Animation）**：Flutter 内置的自动过渡动画，当属性值改变时自动插值，如 `AnimatedContainer`、`AnimatedOpacity`。
- **显式动画（Explicit Animation）**：需要开发者手动控制 AnimationController 的动画，可精确控制时间、曲线和帧率。
- **手势处理（Gesture Handling）**：通过 `GestureDetector` 和 `Listener` 捕获用户的点击、拖拽、缩放、旋转等手势事件。

---

## 核心原理

### CustomPainter 的绘制体系

CustomPainter 与 CustomPaint Widget 配合工作，构成 Flutter 自定义绘制的完整链路：

```
CustomPaint (Widget)
├── painter       // 在 child 之后绘制的 CustomPainter
├── foregroundPainter // 在 child 之前绘制的 CustomPainter
├── child         // 子 Widget（可选）
└── size          // 画布尺寸（由父约束决定）

CustomPainter (绘制逻辑)
├── paint(Canvas canvas, Size size)  // 核心绘制方法
└── shouldRepaint(covariant CustomPainter oldDelegate)  // 判断是否需要重绘
```

**Canvas API 核心方法**：
- `canvas.drawLine()` — 绘制直线
- `canvas.drawRect()` / `canvas.drawRRect()` — 矩形 / 圆角矩形
- `canvas.drawCircle()` / `canvas.drawOval()` — 圆 / 椭圆
- `canvas.drawPath()` — 路径绘制（贝塞尔曲线、自定义形状）
- `canvas.drawArc()` — 圆弧
- `canvas.drawVertices()` — 顶点绘制（三角形网格）
- `canvas.clipRect()` / `canvas.clipPath()` — 裁剪区域
- `canvas.save()` / `canvas.restore()` — 状态栈管理（变换矩阵、裁剪等）
- `canvas.transform()` — 仿射变换（平移、旋转、缩放）

**Paint 画笔配置**：
```dart
final paint = Paint()
  ..color = Colors.blue           // 颜色
  ..strokeWidth = 2.0             // 线宽
  ..style = PaintingStyle.stroke  // stroke/fill
  ..strokeCap = StrokeCap.round   // 线帽
  ..shader = LinearGradient(...)  // 渐变着色器
  ..maskFilter = MaskFilter.blur(BlurStyle.normal, 3.0) // 模糊
  ..blendMode = BlendMode.multiply; // 混合模式
```

### 动画系统架构

Flutter 的动画系统分层设计：

```
                    ┌─────────────────────┐
  Widget 层         │ AnimatedBuilder     │  AnimatedContainer
                    │ AnimatedWidget      │  TweenAnimationBuilder
                    ├─────────────────────┤
  动画抽象层         │ Animation<T>        │  值的插值和曲线
                    │ CurvedAnimation     │
                    ├─────────────────────┤
  控制层            │ AnimationController │  时间驱动、状态管理
                    │ Ticker              │  帧回调（~60fps）
                    ├─────────────────────┤
  底层              │ SchedulerBinding     │  渲染管线集成
                    └─────────────────────┘
```

**AnimationController 工作原理**：
1. 接收 `vsync` 参数（通常传入 `this` 即 SingleTickerProviderStateMixin），绑定到渲染管线
2. 内部持有 `Ticker`，在每帧触发 `tick()`，更新 `value`（0.0 → 1.0）
3. 支持 `.forward()`、`.reverse()`、`.repeat()`、`.stop()`、`.reset()` 控制
4. 通过 `Tween` 将 0.0-1.0 映射到目标类型（颜色、尺寸、偏移等）

**隐式 vs 显式动画对比**：

| 特性 | 隐式动画 | 显式动画 |
|------|---------|---------|
| 复杂度 | 低 | 高 |
| 控制精度 | 属性级 | 帧级 |
| 触发方式 | 属性改变自动触发 | 手动调用 controller |
| 典型 Widget | `AnimatedContainer` | `AnimatedBuilder` + `AnimationController` |
| 适用场景 | 简单属性过渡 | 复杂序列动画、手势驱动动画 |

### 手势处理体系

Flutter 手势系统基于竞技场（Arena）机制：

```
用户触摸事件
    ↓
GestureBinding（事件分发）
    ↓
HitTest（命中测试：渲染树从叶到根遍历）
    ↓
GestureDetector 注册的识别器进入竞技场
    ↓
竞技场仲裁：单击 vs 双击 vs 长按 vs 拖拽
    ↓
获胜者回调（onTap / onDoubleTap / onPanUpdate 等）
```

**核心手势识别器**：
- `TapGestureRecognizer` — 点击（单击、双击、长按）
- `PanGestureRecognizer` — 拖拽（平移）
- `ScaleGestureRecognizer` — 缩放（含双指缩放和旋转）
- `HorizontalDragGestureRecognizer` / `VerticalDragGestureRecognizer` — 单方向拖拽
- `GestureRecognizer` — 自定义手势

---

## 实战案例

### 自定义绘制与动画手势

完整实现参考：[Flutter 自定义 Widget 实战：CustomPainter 动画手势处理](/categories/Flutter/Flutter-自定义-Widget-实战-CustomPainter-动画-手势处理/)

**案例一：自定义进度环**

```dart
class ProgressRingPainter extends CustomPainter {
  final double progress; // 0.0 ~ 1.0
  final Color color;
  final double strokeWidth;

  ProgressRingPainter({
    required this.progress,
    required this.color,
    this.strokeWidth = 8.0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - strokeWidth) / 2;

    // 背景环
    canvas.drawCircle(
      center, radius,
      Paint()
        ..color = color.withOpacity(0.2)
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth,
    );

    // 进度弧
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -pi / 2,           // 从 12 点钟方向开始
      2 * pi * progress,  // 扫过角度
      false,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(covariant ProgressRingPainter old) =>
      progress != old.progress || color != old.color;
}
```

**案例二：手势驱动的拖拽 Widget**

```dart
class DraggableCircle extends StatefulWidget {
  @override
  _DraggableCircleState createState() => _DraggableCircleState();
}

class _DraggableCircleState extends State<DraggableCircle>
    with SingleTickerProviderStateMixin {
  Offset _position = Offset.zero;
  late AnimationController _snapController;
  late Animation<Offset> _snapAnimation;

  @override
  void initState() {
    super.initState();
    _snapController = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: 300),
    );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onPanUpdate: (details) {
        setState(() => _position += details.delta);
      },
      onPanEnd: (details) {
        // 松手后弹回原位
        _snapAnimation = Tween<Offset>(
          begin: _position,
          end: Offset.zero,
        ).animate(CurvedAnimation(
          parent: _snapController,
          curve: Curves.elasticOut,
        ));
        _snapController.forward(from: 0);
      },
      child: AnimatedBuilder(
        animation: _snapController,
        builder: (context, child) {
          final pos = _snapController.isAnimating
              ? _snapAnimation.value
              : _position;
          return Transform.translate(
            offset: pos,
            child: child,
          );
        },
        child: CircleAvatar(radius: 40, child: Icon(Icons.drag_handle)),
      ),
    );
  }
}
```

**案例三：自定义贝塞尔曲线动画**

```dart
class WavePainter extends CustomPainter {
  final double animationValue; // 0.0 ~ 1.0

  WavePainter(this.animationValue);

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(0, size.height / 2);

    for (double x = 0; x <= size.width; x++) {
      final y = size.height / 2 +
          sin((x / size.width * 2 * pi) + (animationValue * 2 * pi)) * 20;
      path.lineTo(x, y);
    }

    canvas.drawPath(
      path,
      Paint()
        ..color = Colors.blue
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3.0,
    );
  }

  @override
  bool shouldRepaint(covariant WavePainter old) =>
      animationValue != old.animationValue;
}
```

---

## 相关概念

- [[RenderObject]] - CustomPainter 底层实际操作的是 RenderObject 层的绘制
- [[Ticker 与 vsync]] - AnimationController 的帧同步机制
- [[StatefulWidget 生命周期]] - 动画 Controller 的创建和销毁时机
- [[Transform 变换]] - Widget 层级的矩阵变换（平移、旋转、缩放）
- [[Hero 动画]] - 页面过渡中的共享元素动画
- [[Sliver]] - 自定义滚动区域中的高级绘制
- [[主题与国际化]] - 动画颜色应跟随主题变化
- [[性能优化]] - shouldRepaint 的合理实现对性能至关重要

---

## 常见问题

### 1. CustomPainter 的 shouldRepaint 返回 true 导致性能问题怎么办？

`shouldRepaint` 应该做精细的比较，仅在实际影响绘制的属性变化时返回 `true`。对于复杂对象，实现 `==` 和 `hashCode` 或逐字段比较。如果 CustomPainter 被频繁重建，考虑使用 `RepaintBoundary` 隔离重绘区域。

### 2. AnimationController 的 vsync 参数是什么？

`vsync` 将动画绑定到屏幕刷新率（通常 60fps），避免屏幕不可见时浪费 CPU。在 State 中混入 `SingleTickerProviderStateMixin`（单个 controller）或 `TickerProviderStateMixin`（多个 controller），然后传 `this` 作为 vsync。

### 3. 如何实现多个动画的串联和并联？

- **串联（顺序执行）**：使用 `Interval` 将 AnimationController 的 0-1 分段给不同 Tween，或使用 `AnimationController` + 多个 `CurvedAnimation` 配合 `Interval`
- **并联（同时执行）**：创建多个 AnimationController，或使用一个 controller 同时驱动多个 Tween

### 4. GestureDetector 为什么有时不响应手势？

可能原因：
- Widget 被不可见的 Widget 覆盖（用 `IgnorePointer` 或 `AbsorbPointer` 检查）
- 手势识别器在竞技场中输了（如单击被双击抢占，需等双击超时后才回调）
- 设置了 `behavior: HitTestBehavior.translucent` 但子 Widget 拦截了事件
- `GestureDetector` 的 `child` 为 `null`，导致没有可命中区域

### 5. Canvas 绘制的图片模糊怎么办？

确保绘制时考虑设备像素比（`MediaQuery.of(context).devicePixelRatio`）。在 `paint()` 中用 `canvas.scale(pixelRatio)` 放大画布，同时 `shouldRepaint` 中判断像素比变化。或使用 `FilterQuality.high` 设置 Paint 的滤镜质量。

### 6. 如何在 CustomPainter 中绘制文本？

使用 `TextPainter` 类：
```dart
final textPainter = TextPainter(
  text: TextSpan(text: 'Hello', style: TextStyle(color: Colors.black, fontSize: 16)),
  textDirection: TextDirection.ltr,
)..layout();
textPainter.paint(canvas, Offset(x, y));
```

注意必须调用 `layout()` 后才能 `paint()`，且需要指定 `textDirection`。
