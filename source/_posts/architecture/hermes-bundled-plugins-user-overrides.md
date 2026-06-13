---

title: Hermes 模型发现机制：bundled plugins + user overrides 的优先级覆盖与延迟加载
date: 2026-06-02 12:00:00
tags: [Hermes, AI Agent, 模型发现, 插件系统, 延迟加载]
keywords: [Hermes, AI Agent, 模型发现, 插件系统, 延迟加载]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: >-
---

在一个 AI Agent 系统里，模型接入层最容易在“看起来简单”时埋下长期复杂度。表面上，模型发现似乎只是在运行前把 provider、model、base_url、api_key 几个字段拼起来；但一旦系统走向插件化、多 profile、用户自定义 provider、按场景切换能力，以及命令行冷启动性能优化，所谓“模型发现”就不再是一个配置读取动作，而变成了一条完整的运行时决策链。

Hermes 在这块的设计很有意思：一方面，它把模型提供者做成了可以通过插件目录扩展的 ProviderProfile；另一方面，又没有把所有东西都塞进统一的 plugin loader，而是刻意拆成两条路径：

1. **通用插件系统**负责扫描 bundled plugins、user plugins、project plugins、entry-point plugins；
2. **providers 专属注册表**负责模型提供者的发现、注册、覆盖与按需加载。

这就形成了本文的核心主题：**bundled plugins + user overrides 的优先级覆盖与延迟加载**。

如果你之前已经读过我那篇《Hermes ProviderProfile 架构深度剖析：模型提供者的声明式注册与运行时钩子机制》，会知道 Hermes 如何把一个 provider 表达成声明式 profile，并在运行时参与模型路由、兼容层和请求生命周期。那篇文章关注的是 **ProviderProfile 自身的对象抽象与 hooks 机制**；而这一篇聚焦的是更偏底层的系统问题：

- Hermes 到底从哪里发现模型提供者？
- 为什么 bundled plugin 和 user override 要分层？
- 名称冲突时，谁覆盖谁，为什么？
- 通用 plugin loader 和 provider loader 为什么不直接合并？
- 什么时候发现，什么时候不发现？为什么要延迟加载？
- 如果我想扩展自定义 provider，应该把代码放到哪里、遵守什么约束？
- 性能、调试、踩坑上，真实使用中最容易出问题的点是什么？

本文会结合 Hermes 源码，围绕 `providers/__init__.py` 与 `hermes_cli/plugins.py` 两条主线展开，尽量把“为什么这样设计”讲清楚，而不是只停留在“代码怎么写”。

---


## 一、先给结论：Hermes 的模型发现不是单纯扫描，而是“分层发现 + 延迟求值”

先用一句话概括：

> Hermes 的模型发现机制，本质上是一个“按来源分层、按名称覆盖、按首次访问触发”的注册系统。

这里有三个关键词：

### 1. 分层发现

模型提供者可以来自多个来源：

- 仓库内置的 bundled provider plugins：`plugins/model-providers/<name>/`
- 用户目录下的 user provider plugins：`$HERMES_HOME/plugins/model-providers/<name>/`
- 历史兼容的 legacy provider modules：`providers/<name>.py`

这些来源不是平铺并列，而是有明确顺序。

### 2. 按名称覆盖

Hermes 并不是把所有 provider 都当成唯一 UUID 注册，而是使用 profile 的 `name` 作为 canonical key，再辅以 `aliases` 做别名映射。这样一来，**后加载者如果注册同名 provider，会直接覆盖前者**。

这就是 user override 的本质：不需要修改 Hermes 仓库，也不需要 fork 内置 provider，只要在用户目录里放一个同名 provider plugin，最后注册进表时自然会替换 bundled 版本。

### 3. 按首次访问触发

Hermes 并不会在进程一启动就 eagerly import 所有模型 provider。`providers/__init__.py` 里写得非常直白：

```python
def get_provider_profile(name: str) -> ProviderProfile | None:
    if not _discovered:
        _discover_providers()
    canonical = _ALIASES.get(name, name)
    return _REGISTRY.get(canonical)
```

也就是说，**只有第一次真正调用 `get_provider_profile()` 或 `list_providers()` 时，provider discovery 才会发生**。这就是延迟加载的第一层。

而在更上层，`hermes_cli/plugins.py` 对一般插件系统也做了类似的 idempotent lazy discovery，并且在 CLI 入口里专门避开了对某些命令的 eager plugin import，以减少 500~650ms 的冷启动损耗。

因此，如果你从架构角度看 Hermes，会发现它并不是“一个插件系统”，而是：

- 通用插件系统解决 **工具、平台、hook、CLI 命令、后端能力插件**；
- provider 专属系统解决 **模型 profile 的懒发现与可覆盖注册**；
- 两者通过 `kind: model-provider` 这个桥接点彼此感知，但不互相抢活。

这套拆分，正是优先级覆盖与延迟加载能够同时成立的前提。

---

## 二、源码入口：模型提供者为什么单独走 `providers/__init__.py`

先看 `providers/__init__.py` 顶部的模块注释，已经把设计意图写得很清楚：

```python
"""Provider module registry.

Provider profiles can live in two places:

1. Bundled plugins: ``plugins/model-providers/<name>/`` (shipped with hermes-agent)
2. User plugins: ``$HERMES_HOME/plugins/model-providers/<name>/``

Each plugin directory contains:
  - ``__init__.py`` — calls ``register_provider(profile)`` at import
  - ``plugin.yaml`` — manifest (name, kind: model-provider, version, description)

Discovery is lazy: the first call to ``get_provider_profile()`` or
``list_providers()`` scans both locations and imports every plugin. User
plugins override bundled plugins on name collision (last-writer-wins), so
third parties can monkey-patch or replace any built-in profile without
editing the repo.
"""
```

这段说明里至少藏着四个关键信息。

### 1. 模型提供者虽然以插件目录形式存在，但不走通用插件加载流程

你会发现 Hermes 并没有说“provider plugins 由 `discover_plugins()` 统一发现”，而是说：**provider profiles live in two places**，然后由 `providers/__init__.py` 自己扫描和导入。

这是一个很重要的架构决策。

如果模型 provider 也像普通 plugin 一样走通用 loader，会带来两个问题：

- provider 注册时机可能受 `plugins.enabled`、`plugins.disabled`、`kind` 分支影响，导致“模型能否被发现”掺杂进一般插件策略；
- provider profile 的生命周期与工具/hook 注册完全不同，它更像一个全局运行时基础设施，而不是某个可选工具集。

Hermes 通过把 provider registry 拆出去，让模型发现具备更稳定的语义：

- `get_provider_profile()` 触发 discovery；
- `register_provider()` 写入 provider 注册表；
- `_REGISTRY` 和 `_ALIASES` 是 provider 维度的唯一真相。

### 2. provider 插件目录本身仍然保持“插件化包装”

Hermes 没有回退成单纯的 `providers/foo.py`，而是允许 provider 放在：

```text
plugins/model-providers/<name>/
```

每个目录至少包含：

- `plugin.yaml`
- `__init__.py`

也就是说，它仍然复用了“插件目录是一等扩展单元”的组织方式，只是发现器不是通用的 plugin manager，而是 provider 专属注册表。

这带来的好处是：

- 目录结构统一，贡献者学习成本低；
- provider 内部可以有相对导入、子模块、适配层、schema 文件；
- 将来若需要打包/分发，也和 Hermes 其他插件体系保持同一种布局。

### 3. 覆盖语义是显式设计，不是偶然副作用

注释中直接写了：

> User plugins override bundled plugins on name collision (last-writer-wins)

这非常关键。很多系统里的覆盖关系其实是“碰巧后扫到的文件把前面字典键盖掉了”，文档里不敢承认、测试里也不固化，最后变成半隐式行为。Hermes 则明确把 **last-writer-wins** 当成用户 override 能力的一部分。

### 4. lazy discovery 是性能设计，而不是简单优化

源码注释不是说“为了快，所以懒一点”，而是直接把 lazy 作为 registry 合约的一部分：

- `get_provider_profile()`：第一次访问才 discover；
- `list_providers()`：第一次枚举才 discover。

换句话说，provider discovery 不是进程初始化阶段的前置步骤，而是一个 **on-demand capability resolution**。

---

## 三、核心注册结构：`_REGISTRY`、`_ALIASES` 与 last-writer-wins

Hermes provider registry 的核心数据结构非常小，但设计得很“硬”。

```python
_REGISTRY: dict[str, ProviderProfile] = {}
_ALIASES: dict[str, str] = {}
_discovered = False
```

对应的注册函数也非常直接：

```python
def register_provider(profile: ProviderProfile) -> None:
    _REGISTRY[profile.name] = profile
    for alias in profile.aliases:
        _ALIASES[alias] = profile.name
```

表面看只是两个 dict，实际上已经把优先级覆盖的语义完整编码了进去。

### 1. `_REGISTRY` 是 canonical name 到 profile 的映射

`profile.name` 是 provider 的唯一主键。无论 bundled 还是 user，只要最终 `name` 相同：

```python
_REGISTRY[profile.name] = profile
```

后写入的对象直接覆盖前者。

这就是 last-writer-wins 的底层实现。

### 2. `_ALIASES` 是别名到 canonical name 的投影

如果一个 provider profile 声明了多个别名：

```python
for alias in profile.aliases:
    _ALIASES[alias] = profile.name
```

那么别名冲突时同样遵循后注册覆盖前注册。

这意味着用户 override 不只是“替换 provider 主名对应的 profile”，也可以顺便重写 alias 的指向关系。这在自定义 provider 想兼容旧命令或旧配置名时非常有用。

### 3. `get_provider_profile()` 的查找是两段式

```python
def get_provider_profile(name: str) -> ProviderProfile | None:
    if not _discovered:
        _discover_providers()
    canonical = _ALIASES.get(name, name)
    return _REGISTRY.get(canonical)
```

查找顺序是：

1. 若未 discover，先 discover；
2. 先用 `_ALIASES` 把传入名称规范化；
3. 再到 `_REGISTRY` 查 canonical profile。

这意味着：

- alias 解析与 registry 存储解耦；
- 只要 alias 最终指向某个 canonical name，调用方无须关心 profile 实际来自 bundled 还是 user；
- override 对上层完全透明。

### 4. 为什么不用“优先级数值”而直接用扫描顺序？

有些系统喜欢给每个 plugin/source 搞一套 `priority=100/200/300`，然后统一排序。Hermes 在 provider registry 这里选择了更简单也更稳的办法：**来源顺序直接决定覆盖顺序**。

对应 `_discover_providers()`：

```python
# 1. Bundled plugins
# 2. User plugins
# 3. Legacy per-file modules
```

每一层都顺序导入，注册发生在 import 时。只要 `register_provider()` 是覆盖写入，最终结果自然成立。

这样的好处是：

- 实现简单，语义清晰；
- 不需要在 manifest 再引入一套额外优先级协议；
- 用户 override 的心智模型很直观：**“用户目录比内置目录后加载，所以用户赢”**。

代价是：

- 你不能在同一来源内部再靠数字优先级微调；
- 如果未来要支持更多复杂组合来源，需要谨慎维护扫描顺序契约。

但对于 Hermes 当前的 provider 场景，这个取舍非常合理。

---

## 四、真正的发现顺序：bundled → user → legacy

`_discover_providers()` 是本文最值得精读的函数之一。

```python
def _discover_providers() -> None:
    global _discovered
    if _discovered:
        return
    _discovered = True

    # 1. Bundled plugins — shipped with hermes-agent.
    if _BUNDLED_PLUGINS_DIR.is_dir():
        for child in sorted(_BUNDLED_PLUGINS_DIR.iterdir()):
            if not child.is_dir() or child.name.startswith(("_", ".")):
                continue
            _import_plugin_dir(child, "bundled")

    # 2. User plugins — under $HERMES_HOME/plugins/model-providers/<name>/.
    user_dir = _user_plugins_dir()
    if user_dir is not None:
        for child in sorted(user_dir.iterdir()):
            if not child.is_dir() or child.name.startswith(("_", ".")):
                continue
            _import_plugin_dir(child, "user")

    # 3. Legacy single-file profiles at providers/<name>.py.
    try:
        import pkgutil
        import providers as _pkg
        for _importer, modname, _ispkg in pkgutil.iter_modules(_pkg.__path__):
            if modname.startswith("_") or modname == "base":
                continue
            try:
                importlib.import_module(f"providers.{modname}")
            except ImportError as exc:
                logger.warning(
                    "Failed to import legacy provider module %s: %s", modname, exc
                )
    except Exception:
        pass
```

### 1. `_discovered = True` 提前设置，是为了防重入

注意这里不是在 discovery 全部完成后才标记，而是一进入函数就：

```python
_discovered = True
```

这是一个很典型的防重入写法。因为 provider plugin 的 `__init__.py` 在 import 时可能间接触发别的 provider lookup，如果此时还没标记 discovered，就可能再次进入 `_discover_providers()`，造成递归导入或重复注册。

提前置位的含义是：

- “我已经进入 discovery 过程了”；
- 即使中途有间接调用，也不要重跑一遍。

这是稳定性细节，博客里值得强调，因为很多人写 lazy loader 时喜欢最后才置位，结果在复杂 import graph 下很容易炸。

### 2. bundled 先扫，是“默认基线”

内置 provider 目录：

```python
_BUNDLED_PLUGINS_DIR = Path(__file__).resolve().parent.parent / "plugins" / "model-providers"
```

这一层是 Hermes 的默认能力基线。换句话说，**bundled plugin 不是为了让用户安装，而是为了给系统提供开箱即用的 provider 集合**。

之所以先扫它，是因为它承担“默认值”的角色：

- 先把官方/内置 provider 注册进来；
- 后续 user plugin 再选择性覆盖。

### 3. user 后扫，是 override 的核心机制

```python
user_dir = get_hermes_home() / "plugins" / "model-providers"
```

这一层并不是与 bundled 并列补充，而是一个**覆盖层**。其位置在第二步不是偶然：

- 如果 user plugin 与 bundled 同名，则覆盖 bundled；
- 如果 user plugin 是新名字，则新增 provider；
- 如果 user plugin 重写 alias，也会覆盖旧 alias 指向。

这是典型的 overlay 模型：

```text
Bundled Base Layer
        ↑
User Override Layer
```

### 4. legacy 模块最后加载，是纯兼容兜底

第三步通过 `pkgutil.iter_modules()` 加载 `providers/*.py`：

- 不是推荐路径；
- 只是为了兼容历史或 editable install 的老扩展方式；
- 文档注释也明确写了 “New profiles should prefer the plugin layout.”

但有一个需要注意的点：**legacy 是最后导入的**。这意味着如果 legacy module 和前两层注册了同名 provider，理论上 legacy 也会覆盖前者。

从“新架构优先”的角度看，这似乎有些反直觉。但结合它的用途就好理解了：

- legacy 主要服务老用户、开发态、历史扩展；
- 最后加载意味着老扩展仍然保有兼容覆盖能力，不会因为新插件机制出现就失效。

如果你是实际扩展者，我的建议是：

- **不要依赖 legacy 覆盖语义做新功能**；
- 它存在的主要价值是“别把老东西搞挂”。

---

## 五、导入策略的细节：为什么 bundled 和 user 的模块命名不一样

再看 `_import_plugin_dir()`：

```python
def _import_plugin_dir(plugin_dir: Path, source: str) -> None:
    init_file = plugin_dir / "__init__.py"
    if not init_file.exists():
        return

    safe_name = plugin_dir.name.replace("-", "_")
    if source == "bundled":
        module_name = f"plugins.model_providers.{safe_name}"
    else:
        module_name = f"_hermes_user_provider_{safe_name}"

    if module_name in sys.modules:
        return

    try:
        spec = importlib.util.spec_from_file_location(
            module_name, init_file, submodule_search_locations=[str(plugin_dir)]
        )
        if spec is None or spec.loader is None:
            return
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
    except Exception as exc:
        logger.warning(
            "Failed to load %s provider plugin %s: %s", source, plugin_dir.name, exc
        )
        sys.modules.pop(module_name, None)
```

这是理解“延迟加载如何不把 import 系统搞乱”的另一个关键点。

### 1. bundled plugin 使用稳定 import path

```python
module_name = f"plugins.model_providers.{safe_name}"
```

源码注释说得很直接：

> Give bundled plugins a stable import path so relative imports within the plugin work.

也就是说，bundled provider 本身就是 Hermes 仓库的一部分，它可以合理地使用包内相对导入、共享模块路径等能力。给它一个稳定且可预期的 module namespace，是为了支持这种开发体验。

### 2. user plugin 使用唯一动态 module name

```python
module_name = f"_hermes_user_provider_{safe_name}"
```

源码注释继续解释：

> User plugins load via spec_from_file_location with a unique module name so multiple HERMES_HOME profiles don't alias each other.

这个设计有两个目的：

#### 其一，避免与 bundled 命名空间冲突

如果用户目录下也有一个 `openai` provider，而你把它也导成 `plugins.model_providers.openai`，那就会直接污染/替换 bundled 模块本身，影响 Python 模块缓存语义。

#### 其二，避免多 profile 之间 `sys.modules` 别名污染

Hermes 是 profile-aware 的，`HERMES_HOME` 可以切换。假如不同 profile 下都有一个叫 `kimi` 的用户 provider，若模块名不唯一，很容易在同一进程内因为 `sys.modules` 缓存而串用旧模块。

因此，用户 provider 必须用独立命名空间加载。

### 3. `sys.modules` 先注册再执行，是为了支持包内相对导入

```python
module = importlib.util.module_from_spec(spec)
sys.modules[module_name] = module
spec.loader.exec_module(module)
```

这是 Python 动态导入里比较规范的写法。先把 module 塞进 `sys.modules`，再执行文件内容，可以确保模块在执行期间进行相对导入时，解释器知道它是谁。

### 4. 失败时记得 `pop`，避免脏模块残留

```python
except Exception as exc:
    ...
    sys.modules.pop(module_name, None)
```

这也是非常重要的细节。如果导入一半失败，`sys.modules` 里保留一个半初始化模块，后续再导入同名模块时就可能命中脏缓存，形成极难排查的伪成功状态。

Hermes 在这里明确回滚，说明作者对插件加载稳定性是有经验教训积累的。

---

## 六、通用插件系统如何与 provider discovery 协同，而不是打架

看到这里，很多读者会问：既然有 `hermes_cli/plugins.py` 这个强大的通用插件系统，为什么 provider 不直接复用？

答案就藏在 `hermes_cli/plugins.py` 的 discovery 主流程里。

先看插件系统总注释：

```python
Discovers, loads, and manages plugins from four sources:

1. Bundled plugins – <repo>/plugins/<name>/
2. User plugins   – ~/.hermes/plugins/<name>/
3. Project plugins – ./.hermes/plugins/<name>/
4. Pip plugins     – packages that expose the hermes_agent.plugins entry-point group.

Later sources override earlier ones on name collision, so a user or project
plugin with the same name as a bundled plugin replaces it.
```

这个系统显然已经很通用了。问题在于：**它处理的不是 provider profile，而是“可被 register(ctx) 激活的泛化插件能力”**。

更关键的是，在 `discover_and_load()` 中有一个专门的分支：

```python
if manifest.kind == "model-provider":
    loaded = LoadedPlugin(manifest=manifest, enabled=True)
    self._plugins[lookup_key] = loaded
    logger.debug(
        "Skipping '%s' (model-provider, handled by providers/ discovery)",
        lookup_key,
    )
    continue
```

这几行几乎就是系统架构图的文字版说明：

- 通用 plugin scanner **能识别** model-provider；
- 但它**不负责加载** model-provider；
- 只把 manifest 记录下来用于 introspection/listing；
- 真正的导入与注册交给 `providers/__init__.py`。

### 这套协同设计解决了什么问题？

#### 1. 统一“插件目录生态”，但不混淆加载责任

对于用户来说，provider 仍然长得像插件：

```text
plugins/model-providers/my-provider/
  ├── plugin.yaml
  └── __init__.py
```

对于系统来说，它又不是普通 plugin：

- 不受一般 `plugins.enabled` 的 opt-in 策略控制；
- 不通过 `register(ctx)` 把自己挂进工具、hook、CLI 命令表；
- 而是通过 `register_provider(profile)` 进入 provider registry。

#### 2. 避免“双重导入”破坏覆盖语义

源码里那段注释非常值得引用：

> a second import would create two ProviderProfile instances and break the "last writer wins" override semantics between bundled and user plugins.

这是设计中最微妙的一点。

假设一个 model-provider 同时被：

- 通用 plugin manager 导入一次；
- provider registry discovery 再导入一次；

那么它在 import side effect 中执行的 `register_provider(profile)` 就会跑两遍。此时：

- 同名 provider 可能被意外重复覆盖；
- alias 可能被重写两次；
- 更糟的是，两个不同 module namespace 下创建的 `ProviderProfile` 实例不是同一个对象，调试时会非常混乱。

Hermes 通过“识别但不加载”的策略，把这个坑提前堵住了。

#### 3. 通用插件系统仍然可以展示 model-provider 的元信息

因为 `manifest` 被收录到 `_plugins` 里，所以像 `hermes plugins list` 这类命令依旧可以知道：

- 这个 model-provider 插件存在；
- 它来自 bundled/user/project/entrypoint 哪个来源；
- 它的 manifest 信息是什么。

这使得用户体验上“看起来还是统一的插件体系”，而内部实现上“加载责任严格分离”。

这是一种非常成熟的架构做法。

---

## 七、bundled plugins 与 user overrides 的优先级设计，为什么这么合理

现在我们从更高层总结 Hermes 的优先级策略。

### 1. provider 维度的优先级

对模型提供者而言，真实优先级是：

```text
bundled provider plugin
    < user provider plugin
    < legacy providers/*.py（兼容末位覆盖）
```

而核心覆盖规则是：

```text
同名 profile.name：后注册覆盖前注册
同名 alias：后注册覆盖前注册
```

### 2. 通用插件维度的优先级

对一般 plugin manager 而言，优先级是：

```text
bundled < user < project < entrypoint（按最终 dedup 结果取赢家）
```

这一点在 `discover_and_load()` 里通过 `winners[manifest.key or manifest.name] = manifest` 实现。后面来源覆盖前面来源。

### 3. 为什么 provider 不跟通用 plugin 一样还支持 project 层？

这是个很有意思的差异。

通用插件系统支持：

- bundled
- user
- project
- entry-point

而 provider registry 当前只支持：

- bundled
- user
- legacy

为什么？

我认为这是 Hermes 有意为之，至少体现出两个取舍：

#### 其一，模型 provider 是更高风险的基础设施

工具插件 project 级别覆盖比较自然，因为它们通常只影响当前仓库/项目的行为；但模型 provider 涉及：

- 认证与密钥来源；
- provider 路由；
- 请求格式兼容性；
- 账单与网络出口；
- 全局模型默认值。

如果允许任意项目目录下的 `.hermes/plugins/model-providers/` 直接覆盖运行时 provider，风险面会显著扩大。

#### 其二，profile + user override 已经覆盖了主要需求

Hermes 本身有 profile 概念，`HERMES_HOME` 又是 profile-aware 的。所以很多“按环境切 provider”的需求，完全可以通过：

- 切 profile；
- 在不同 profile 的用户插件目录中放不同 provider override；
- 配置中切不同 provider name；

来解决，不一定需要 project-scope provider override。

### 4. 为什么 bundled backend 自动加载，而 user backend 仍然需要 opt-in

在 `hermes_cli/plugins.py` 里，还有另一条值得对比的优先级规则：

```python
if manifest.source == "bundled" and manifest.kind in {"backend", "platform"}:
    self._load_plugin(manifest)
    continue
```

也就是说：

- **bundled backend/platform 自动加载**；
- **user-installed backend/platform 仍然需要 `plugins.enabled`**。

这跟 provider registry 的“bundled + user 都会 discover”看起来不同，但背后的逻辑很一致：

- bundled 是 Hermes 自己随发行版交付的“可信基线”；
- user plugin 是本地扩展代码，默认应视为不可信，需要显式启用；
- provider override 之所以不走这一套 opt-in，是因为 provider registry 本身已经是一个更窄、更基础的发现通道，且入口路径受控在 `plugins/model-providers/` 下。

换句话说，Hermes 把“覆盖能力”和“信任边界”做了分层，而不是一刀切。

---

## 八、延迟加载的两层含义：provider lazy discovery 与 CLI lazy plugin discovery

“延迟加载”在 Hermes 里不是一个点，而是两层设计。

---

### 第一层：provider registry 的按需 discovery

这是最直接的一层：

```python
if not _discovered:
    _discover_providers()
```

它的好处有三点。

#### 1. 避免 CLI 每次启动都扫描/导入全部 provider

不是每个 Hermes 命令都需要 provider 信息。比如：

- `hermes logs`
- `hermes version`
- `hermes plugins list`
- 某些本地维护命令

如果一进入 Python 进程就 import 全部 provider plugin，那么：

- provider 依赖链可能很重；
- 部分 provider 模块可能 import SDK、读取缓存、初始化辅助逻辑；
- 冷启动性能会被无关功能拖慢。

#### 2. 只有真正需要 provider profile 时才付 discovery 成本

典型触发点包括：

- provider resolution；
- model picker；
- auxiliary runtime provider selection；
- 某些需要 profile metadata 的 UI / setup 流程。

这是一种典型的 **pay-as-you-go** 模式。

#### 3. 降低初始化期副作用风险

provider plugin 是 import-time self registration：

```python
# __init__.py 里大概率会 register_provider(profile)
```

如果全部在程序一启动就 import，任何一个 provider plugin 的异常都可能过早暴露，影响并不需要 provider 的流程。lazy discovery 可以把故障边界收缩到“真的需要 provider 时”。

---

### 第二层：CLI 对通用 plugin discovery 的延迟跳过

Hermes 在 CLI 入口 `hermes_cli/main.py` 里还有一层非常务实的优化。

源码注释：

```python
# Skipped when the invocation is already targeting a known built-in
# subcommand — ``hermes --help``, ``hermes version``, ``hermes logs``,
# etc.  This avoids eagerly importing every bundled plugin module
# (google.cloud.pubsub_v1, aiohttp, grpc, PIL …) which costs
# 500-650ms on typical installs.
```

对应代码：

```python
if _plugin_cli_discovery_needed():
    ...
    discover_plugins()
```

这段非常有代表性，因为它说明 Hermes 团队不是在抽象层面空谈“懒加载”，而是已经量化了它的收益：

- eager import every bundled plugin module
- 会额外带来 **500~650ms** 启动成本

而且注释还点名了重量级依赖示例：

- `google.cloud.pubsub_v1`
- `aiohttp`
- `grpc`
- `PIL`

这说明 plugin 生态足够丰富之后，冷启动性能不再只是 Python import 数量问题，而是依赖树问题。你只要提前导入几个重依赖，就会让“只是想看个 help”的命令明显变慢。

### 为什么这一层与 provider discovery 有关？

因为 model-provider plugins 正是被通用 plugin system 识别但跳过加载的一类。如果 Hermes 没有这层分工：

- CLI 入口为了拿到所有 plugin CLI 命令，可能被迫 import model providers；
- provider plugins 再引入自己的 SDK 或适配层；
- 冷启动成本进一步恶化。

因此，**provider 独立 lazy discovery + CLI 通用插件延迟发现**，实际上是互相强化的一组设计。

---

## 九、架构图：把模型发现链路画出来

为了避免只看函数名，我们用文字版架构图把整个流程串起来。

### 1. 静态目录布局

```text
Hermes Repo
├── providers/
│   ├── __init__.py              # provider registry / lazy discovery
│   ├── base.py                  # ProviderProfile 定义
│   └── *.py                     # legacy provider modules
│
├── plugins/
│   ├── model-providers/
│   │   ├── alibaba-coding-plan/
│   │   │   ├── plugin.yaml
│   │   │   └── __init__.py
│   │   └── ...
│   ├── web/
│   ├── image_gen/
│   ├── platforms/
│   └── ...
│
└── hermes_cli/
    ├── plugins.py               # general plugin manager
    └── main.py                  # CLI lazy discovery gate
```

### 2. 运行时发现链路

```text
用户命令 / 运行时逻辑
        │
        ▼
需要 provider profile ?
        │
        ├─ 否 → 不触发 providers discovery
        │
        └─ 是
            │
            ▼
    providers.get_provider_profile(name)
            │
            ├─ _discovered == False ?
            │      └─ 是 → _discover_providers()
            │
            ▼
    扫描 bundled provider plugins
            │
            ▼
    import __init__.py → register_provider(profile)
            │
            ▼
    扫描 user provider plugins
            │
            ▼
    import __init__.py → register_provider(profile)
            │                └─ 同名则覆盖 bundled
            ▼
    扫描 legacy providers/*.py
            │
            ▼
    alias 归一化 → _REGISTRY 查 canonical profile
            │
            ▼
    返回 ProviderProfile
```

### 3. 与通用插件系统的关系

```text
discover_plugins()
    │
    ├─ 扫描 plugins/* manifests
    │
    ├─ 遇到 backend/platform → 可能自动加载
    │
    ├─ 遇到 standalone → 受 plugins.enabled 控制
    │
    └─ 遇到 kind == model-provider
            │
            └─ 只记录 manifest，不 import 模块
                  ↓
             providers/__init__.py 负责真正导入
```

从这张图能看出 Hermes 的设计目标非常明确：

- **目录可以统一**；
- **发现器必须分治**；
- **加载要按需要发生**；
- **覆盖要靠顺序而不是魔法配置**。

---

### 对比一览表

| 维度 | 通用插件系统 (`hermes_cli/plugins.py`) | Provider 专属注册表 (`providers/__init__.py`) |
|------|----------------------------------------|----------------------------------------------|
| 发现范围 | bundled / user / project / entry-point | bundled / user / legacy |
| 加载时机 | CLI 入口按需（部分命令跳过） | 首次调用 `get_provider_profile()` 时 |
| 覆盖策略 | 后来源覆盖前来源（dedup 取赢家） | 同名 `profile.name` last-writer-wins |
| model-provider 处理 | 识别 manifest，跳过模块加载 | 负责真正导入与注册 |
| 信任边界 | bundled backend 自动加载；user backend 需 `plugins.enabled` | bundled 与 user 均 discover；legacy 兜底兼容 |
| 注册接口 | `register(ctx)` | `register_provider(profile)` |
| 性能优化 | 500~650ms 冷启动跳过非必要 import | 按需 discovery，不预热 |

---

## 十、源码走读：关键类与方法一览

本节把和本文主题最相关的类、方法做一轮集中走读，方便你后续自己继续深挖。

### 1. `providers.register_provider(profile)`

职责：

- 将 provider 写入 canonical registry；
- 将其 aliases 写入 alias registry；
- 通过 dict 覆盖实现 last-writer-wins。

设计要点：

- 零复杂度；
- 无排序逻辑；
- 无显式 priority 字段；
- 覆盖语义完全由导入顺序保证。

### 2. `providers.get_provider_profile(name)`

职责：

- 触发 lazy discovery；
- 完成 alias → canonical name 的归一化；
- 返回对应 ProviderProfile。

设计要点：

- 对调用方屏蔽来源差异；
- user override 对上层透明。

### 3. `providers.list_providers()`

职责：

- 触发 lazy discovery；
- 枚举 `_REGISTRY.values()`；
- 做对象级去重。

去重代码：

```python
seen: set[int] = set()
result: list[ProviderProfile] = []
for profile in _REGISTRY.values():
    pid = id(profile)
    if pid not in seen:
        seen.add(pid)
        result.append(profile)
```

这里按 `id(profile)` 去重，而不是按 name 去重，说明 Hermes 假设 registry 内可能存在多键指向同对象的情况，但最终只想返回唯一实例列表。这是一个偏稳妥的实现。

### 4. `providers._import_plugin_dir(plugin_dir, source)`

职责：

- 动态构建 module spec；
- 导入 provider plugin 包；
- 支持 bundled 的稳定命名空间；
- 支持 user 的隔离命名空间；
- 在失败时清理 `sys.modules`。

设计要点：

- 是 provider lazy discovery 的真正执行器；
- 对 import side effect 安全性考虑较多。

### 5. `providers._discover_providers()`

职责：

- 按顺序触发三层来源的 discovery；
- 用扫描顺序编码覆盖语义；
- 用 `_discovered` 做一次性加载与防重入。

设计要点：

- 是本文主角中的主角；
- “顺序即优先级”的思想在这里体现得最直接。

### 6. `hermes_cli.plugins.PluginManager.discover_and_load()`

职责：

- 统一扫描 bundled / user / project / entrypoint plugin manifests；
- 对不同 `kind` 应用不同的加载策略；
- 做 dedup、enable/disable 判定、自动加载与 opt-in 加载。

与本文最相关的是两个分支：

#### 分支一：跳过 `kind == model-provider`

```python
if manifest.kind == "model-provider":
    loaded = LoadedPlugin(manifest=manifest, enabled=True)
    self._plugins[lookup_key] = loaded
    continue
```

#### 分支二：bundled backend/platform 自动加载

```python
if manifest.source == "bundled" and manifest.kind in {"backend", "platform"}:
    self._load_plugin(manifest)
    continue
```

这两个分支一起，说明 Hermes 对不同插件类别的策略并不一致，而是按“信任级别 + 生命周期角色”分别对待。

### 7. `hermes_cli.plugins._parse_manifest()`

这部分也很有意思。Hermes 支持通过启发式识别插件种类：

```python
if kind == "standalone" and "kind" not in data:
    init_file = plugin_dir / "__init__.py"
    if init_file.exists():
        source_text = init_file.read_text(errors="replace")[:8192]
        if (
            "register_memory_provider" in source_text
            or "MemoryProvider" in source_text
        ):
            kind = "exclusive"
        elif (
            "register_provider" in source_text
            and "ProviderProfile" in source_text
        ):
            kind = "model-provider"
```

也就是说，就算 manifest 没显式写 `kind: model-provider`，Hermes 也可能通过源码特征把它识别成 model-provider。

这非常实用，但也意味着：

- 这是为了兼容与容错，不应该成为你新插件设计时依赖的“正式接口”；
- 最稳妥的做法仍然是在 `plugin.yaml` 里明确写上 `kind: model-provider`。

### 8. `hermes_cli.main._plugin_cli_discovery_needed()` + CLI 入口条件加载

这一层的职责不是 provider 注册，而是：

- 避免对所有命令都 eager discover_plugins；
- 只在可能用到 plugin CLI 命令时，才做通用 plugin discovery。

它间接保护了 provider 体系不被无意义地提早导入。

---

## 十一、配置覆盖实战：如何用 user override 替换 bundled provider

下面进入实战部分。由于这篇文章主要分析机制，不会假设某个具体 provider 的全部字段，但我们可以给出一个符合当前架构的覆盖模式。

### 场景：我想替换内置的某个 provider profile

假设 Hermes bundled 里已经有一个 provider：

```text
plugins/model-providers/alibaba-coding-plan/
```

现在你希望在不改 Hermes 仓库的前提下：

- 重新定义它的 aliases；
- 修改默认模型；
- 调整 base_url；
- 或者干脆 monkey patch 这个 provider 的运行时 profile 行为。

### 做法一：在用户目录创建同名 provider plugin

目录路径：

```text
~/.hermes/plugins/model-providers/alibaba-coding-plan/
├── plugin.yaml
└── __init__.py
```

`plugin.yaml` 示例：

```yaml
name: alibaba-coding-plan
kind: model-provider
version: 1.0.0
description: User override for bundled alibaba coding provider
```

`__init__.py` 示例：

```python
from providers import register_provider
from providers.base import ProviderProfile

profile = ProviderProfile(
    name="alibaba-coding-plan",
    aliases=["acp", "alibaba-plan", "coding-plan"],
    # 其他字段依具体 ProviderProfile 定义填写
)

register_provider(profile)
```

### 为什么这样就能覆盖？

因为 provider discovery 顺序是：

1. 先 import bundled `alibaba-coding-plan`
2. 后 import user `alibaba-coding-plan`
3. 第二次 `register_provider(profile)` 会执行：

```python
_REGISTRY[profile.name] = profile
```

于是 `_REGISTRY["alibaba-coding-plan"]` 最终指向用户版本。

如果你还改了 aliases，那么：

```python
_ALIASES[alias] = profile.name
```

也会把相关别名重写到用户版本上。

### 做法二：保留原名，增加新别名以平滑迁移

有时你不想完全推翻内置 provider，而是想：

- 保持原 provider 名称不变，兼容旧配置；
- 增加团队内部约定别名，比如 `corp-openai`、`internal-fast`。

这时候 user override 的好处是：你可以只重建 profile 壳层，让旧入口和新入口同时指向新的 provider profile。

### 做法三：不要直接修改 Hermes 仓库内 bundled 插件

这是我最推荐强调的一条实践原则：

> **如果你要做本地定制，优先用 user override，不要直接改 bundled provider。**

原因很简单：

- 升级 Hermes 时不会被覆盖；
- 变更边界更清晰；
- 可以在不同 profile 下放不同 override；
- 调试时更容易判断“到底是官方逻辑还是本地逻辑”。

---

## 十二、扩展自定义模型提供者：推荐目录、最小实现与设计建议

如果你不是要 override 内置 provider，而是要新增一个 provider，Hermes 的推荐方式也是走 plugin layout。

### 1. 推荐目录结构

```text
~/.hermes/plugins/model-providers/my-provider/
├── plugin.yaml
├── __init__.py
└── adapter.py           # 可选
```

### 2. 最小 `plugin.yaml`

```yaml
name: my-provider
kind: model-provider
version: 0.1.0
description: My custom inference provider
```

### 3. 最小 `__init__.py`

```python
from providers import register_provider
from providers.base import ProviderProfile

profile = ProviderProfile(
    name="my-provider",
    aliases=["mp", "my-infer"],
)

register_provider(profile)
```

当然，真实世界的 `ProviderProfile` 往往会有更多字段，比如：

- provider 标识
- base_url
- 默认 model
- temperature 语义
- reasoning 能力说明
- 兼容层参数
- 特殊请求/响应钩子

这部分你可以参考已有 bundled provider 的实现风格，以及我上一篇 ProviderProfile 文章里对声明式字段与运行时 hook 的拆解。

### 4. 推荐把重逻辑放到子模块，不要把 `__init__.py` 写成巨石

因为 provider discovery 是 import-time registration，所以 `__init__.py` 应该尽量承担：

- 组装 profile；
- 调用 `register_provider(profile)`；
- 少做副作用。

不推荐：

- 在 `__init__.py` 顶层做网络请求；
- 顶层读取大量远程 catalog；
- 顶层初始化重型 SDK；
- 顶层执行需要环境变量完整就绪的逻辑。

更推荐：

```python
from .adapter import build_profile
from providers import register_provider

register_provider(build_profile())
```

然后在 `adapter.py` 里继续拆分：

- 静态元数据
- 能力声明
- 请求兼容层
- 运行时 hook

### 5. 自定义 provider 的命名建议

强烈建议遵循：

- 小写
- 使用 `-` 连接单词
- 避免和官方 provider 常见别名冲突
- 如果是团队私有版本，带组织前缀更安全

例如：

- `acme-openai-proxy`
- `team-gemini-gateway`
- `corp-kimi-router`

这样可以避免未来 Hermes 官方新增同名 provider 时出现覆盖歧义。

---

## 十三、调试技巧：如何确认到底加载了哪个 provider

模型发现一旦涉及 override，最难的问题往往不是“为什么没生效”，而是：

> 到底现在生效的是 bundled 版本，还是 user override 版本？

下面给几种我认为最实用的排查方法。

### 技巧一：打开插件调试日志

`hermes_cli/plugins.py` 提供了：

```python
HERMES_PLUGINS_DEBUG=1
```

虽然 provider 发现不完全走通用 plugin loader，但对于通用插件 manifest 扫描、kind 识别、跳过/加载决策，这个日志非常有帮助。

源码里会输出类似：

- 扫描了哪些目录；
- 解析到了哪些 manifest；
- 哪些插件被识别为 `model-provider`；
- 哪些被跳过、为什么跳过。

### 技巧二：给 provider `__init__.py` 加轻量日志

在本地自定义 provider 时，可以临时写：

```python
import logging
logger = logging.getLogger(__name__)
logger.warning("loading user provider override: my-provider")
```

由于 provider 是按 import self-register 的，这条日志可以直接告诉你：

- discovery 是否触发了；
- 具体导入的是哪个模块路径；
- 是否发生了多次导入。

调试完记得去掉或降级到 debug。

### 技巧三：检查 `sys.modules` 中的 module name

因为 bundled 和 user provider 的 module naming 不一样：

- bundled：`plugins.model_providers.<name>`
- user：`_hermes_user_provider_<name>`

如果你在本地调试 Python 进程，可以观察 `sys.modules`，快速判断实际导入来源。

### 技巧四：直接验证 provider registry 的最终结果

最靠谱的调试方式，永远是看 registry 最终态，而不是猜扫描过程。

比如你可以在开发环境写一个临时脚本：

```python
from providers import list_providers, get_provider_profile

for p in list_providers():
    print(p.name, p.aliases)

print(get_provider_profile("my-provider"))
print(get_provider_profile("my-alias"))
```

重点看：

- profile.name 是否出现；
- aliases 是否如你预期；
- alias 查找是否落到你想要的 canonical provider。

### 技巧五：确认是否被 legacy provider 反向覆盖

这是一个很容易忽略的坑。

因为 discovery 顺序是：

```text
bundled → user → legacy
```

如果你的开发环境里恰好还有历史遗留的 `providers/foo.py`，它可能在最后把 user override 又盖掉。出现这种“明明用户插件已经写好了，却还是不生效”的情况时，一定要排查 legacy 模块是否存在。

### 技巧六：确认插件目录名与 profile.name 的关系

provider plugin 目录名只是 discovery 扫描入口，**真正参与覆盖的是 `profile.name`**。

也就是说，这种情况会出问题：

- 目录名叫 `openai-override`
- 但 `ProviderProfile.name` 写成了 `openai2`

那么它不会覆盖 bundled `openai`，而只是新增一个 `openai2` provider。

如果你的目标是 override，必须确保：

```python
profile.name == 被覆盖 provider 的 canonical name
```

---

## 十四、延迟加载下的性能优化建议：如何写不拖慢启动的 provider plugin

Hermes 已经在框架层做了 lazy discovery，但如果 provider 作者自己写得太“重”，依然会把首次 provider 解析时刻拖得很慢。下面是一些实践建议。

### 建议一：避免 import-time 进行网络请求

错误示范：

```python
# __init__.py
catalog = requests.get("https://example.com/models").json()
profile = build_profile(catalog)
register_provider(profile)
```

这样会把 provider discovery 变成网络阻塞点。更好的做法是：

- profile 先使用静态或缓存数据；
- 真正需要 catalog 时，在更晚的运行时路径再请求；
- 或者像 `hermes_cli/model_catalog.py` 一样，提供 TTL cache + stale fallback。

### 建议二：避免顶层 import 大而全 SDK

如果某个 SDK 只有在真实发请求时才需要，不要在 provider `__init__.py` 顶层就 import。

比如：

```python
def build_client(...):
    import heavyweight_sdk
    return heavyweight_sdk.Client(...)
```

比：

```python
import heavyweight_sdk
```

更适合 lazy architecture。

### 建议三：把 profile 声明与 runtime adapter 分开

可以采用这样的分层：

```text
__init__.py         # 注册 profile
profile.py          # ProviderProfile 组装
runtime.py          # 真正调用 SDK / HTTP 的逻辑
compat.py           # 协议兼容层
```

这样 discovery 时只需要构造 profile，不需要把所有运行时逻辑都激活。

### 建议四：尽量让 alias、默认 model、能力声明是纯静态数据

越多信息能在本地纯静态给出，provider discovery 越轻。

比如：

- 默认模型列表
- aliases
- 兼容能力标记
- 默认 API mode
- 文本描述

都适合直接静态定义。

### 建议五：善用磁盘缓存，而不是每次重算

Hermes 自己的 `hermes_cli/model_catalog.py` 就是很典型的例子：

- 进程内缓存
- 磁盘缓存
- TTL
- 远程拉取失败时退回 stale cache

这一思路非常适合“模型列表会变化，但 discovery 不能每次联网”的场景。对于你自定义 provider，如果需要动态 catalog，也应该照着这个思路做，而不是在 import-time 直接拉远程接口。

### 建议六：延迟加载不是只看首次启动，也要看失败路径

很多人只关心“正常情况快不快”，但对于插件系统来说，“失败情况是否快速失败”同样重要。

比如：

- 缺 SDK 时应抛出清晰 ImportError，而不是多层嵌套后超时；
- 缺环境变量时应延后到真正调用时再报，而不是在 profile 注册时直接崩；
- 某些可选依赖应 fail-soft，而不是把整个 provider discovery 拖死。

这也是 Hermes 把 discovery 与 runtime resolution 拆开的价值所在。

---

## 十五、与模型目录/运行时 provider 解析的关系：发现不是终点，只是上游

理解 provider discovery，还有一个很重要的点：**发现到 profile，不等于最终请求就已经准备好了**。

Hermes 里还有一层更靠后的运行时 provider 解析逻辑，例如代码搜索结果显示 `cron/scheduler.py`、`agent/curator.py`、`agent/auxiliary_client.py` 等模块都会调用：

```python
from hermes_cli.runtime_provider import resolve_runtime_provider
```

这说明 provider discovery 只是上游基础设施，后面还会发生：

- requested provider 名称解析；
- 显式 `provider/model/base_url/api_key` 覆盖；
- 配置文件路由；
- fallback chain；
- auth/credential pool 绑定；
- API mode 决策。

为什么这点值得强调？

因为很多时候用户以为“我把 provider plugin 覆盖了，为什么行为还没变”。实际上可能发生的是：

- provider discovery 确实已经返回了新的 profile；
- 但后续 `resolve_runtime_provider()` 又受显式命令行参数、环境变量、fallback 配置影响；
- 最终走的还是另一条 runtime route。

也就是说，排查问题时要分清三层：

```text
层 1：provider 是否被发现？
层 2：provider 是否被选中？
层 3：provider 是否以你预期的参数执行？
```

本文聚焦层 1，但真实调试时常常是三层一起看。

---

## 十六、Hermes 在“配置覆盖”上的几个典型思路，值得借鉴

虽然 provider registry 本身非常简洁，但 Hermes 在全系统范围内处理“覆盖”问题有几条一致的设计哲学，在这里总结一下，能帮助你更好理解为什么它会这么写。

### 1. 用来源顺序表达优先级，而不是用魔法数字

无论是 provider discovery 还是一般 plugin scanner，Hermes 都更倾向于：

- 先扫描默认层；
- 后扫描用户层；
- 后者覆盖前者。

这是一种非常稳定的 overlay 思想。

### 2. 用 canonical key 做注册真相，用 alias 做兼容入口

这在 provider registry 里体现为 `_REGISTRY + _ALIASES`；在一般 plugin system 里体现为 `manifest.key or manifest.name`。

本质上都是：

- 系统内部需要稳定 canonical identity；
- 对外又要容纳历史命名、简写、分层路径键。

### 3. 让“覆盖”成为受支持能力，而不是偶然副作用

Hermes 不怕文档里直接写“last-writer-wins”。这说明团队愿意为这种行为背书，也更容易给用户建立正确预期。

### 4. 延迟加载优先于全局预热

如果某种能力不是所有命令、所有场景都用得到，就不应该让它成为全局启动成本。

这一点对 Agent 类应用尤其重要，因为 Agent 往往生态大、依赖多、插件多，如果没有 lazy strategy，很容易在 CLI 上做出“重量级 GUI 程序”的冷启动体验。

---

## 十七、踩坑记录：实际使用和扩展时最容易出问题的点

这一节我按“症状 → 原因 → 建议”的格式总结一些典型坑位。

### 坑一：目录放对了，但 provider 没生效

**症状**：你已经把插件放到了 `~/.hermes/plugins/model-providers/foo/`，但是运行时还是老 provider。

**常见原因**：

1. `__init__.py` 没有调用 `register_provider(profile)`；
2. `profile.name` 写成了新名字，不是你想覆盖的 canonical name；
3. provider discovery 根本还没触发；
4. legacy `providers/foo.py` 在最后又把它盖回去了。

**建议**：

- 先确认 `get_provider_profile("foo")` 的返回对象到底是谁；
- 再确认有没有 legacy module；
- 最后再看 runtime provider resolution 是否另有显式覆盖。

### 坑二：manifest 写了，但通用插件列表里状态不对

**症状**：`hermes plugins list` 能看到 provider plugin，但显示 enabled/disabled 状态让人迷惑。

**原因**：

model-provider 在通用 plugin manager 里是“记录 manifest 但跳过模块加载”的特殊对象。因此它在列表中的状态，不能简单等同于“已经走完 provider registry 导入”。

**建议**：

- 把 `hermes plugins list` 当成“manifest 可见性”检查；
- 把 `providers.list_providers()` / `get_provider_profile()` 当成“真实注册状态”检查。

### 坑三：provider plugin 顶层逻辑太重，第一次切模型卡很久

**症状**：CLI 启动还行，但第一次进入模型相关命令、setup 或实际对话时卡顿明显。

**原因**：

你把重型初始化放在 provider import-time 了，lazy discovery 只是把成本从启动时挪到了第一次访问时，并没有消除。

**建议**：

- 把网络请求、SDK 初始化推迟到真正发请求时；
- import-time 只保留静态 profile 装配。

### 坑四：alias 冲突导致命名异常

**症状**：某个别名原来指向 provider A，后来突然跑到 provider B。

**原因**：

alias 也是 last-writer-wins。只要后导入 provider 注册了同名 alias，就会直接重写 `_ALIASES[alias]`。

**建议**：

- 给团队私有 provider 使用更独特的 aliases；
- override 前先确认官方 provider 已经占用了哪些别名；
- 不要把通用词当 alias，比如 `fast`、`main`、`default` 这种特别容易踩雷。

### 坑五：把 provider 当普通 plugin 写了 `register(ctx)`

**症状**：插件文件看着也没问题，但 provider 根本没进 provider registry。

**原因**：

model-provider 不是靠 `register(ctx)` 注册的，而是靠 import side effect 调用 `register_provider(profile)`。

**建议**：

牢记两套接口的区别：

- 一般插件：`register(ctx)`
- 模型提供者：`register_provider(profile)`

### 坑六：以为 user plugin 会自动启用所有普通 backend

**症状**：你在 `~/.hermes/plugins/web/foo/` 放了一个 web backend，结果它没工作。

**原因**：

对通用 plugin manager 来说，**bundled backend 自动加载，但 user backend 仍受 `plugins.enabled` 控制**。这和 model-provider 的 provider registry 是两套规则。

**建议**：

不要把 provider discovery 的行为类比到所有插件类型上。

### 坑七：多 profile 环境中出现旧 provider 模块“串味”

**症状**：切 profile 后仍然像在用旧 profile 的用户 provider。

**原因**：

通常是你自己写的插件内部用了全局状态缓存，或者错误假设了固定 `HERMES_HOME`。Hermes 框架层面对 user provider 已经通过唯一 module name 做了隔离，但你插件自己的缓存未必 profile-aware。

**建议**：

- 不要在 provider 模块里长期缓存 profile-specific 路径；
- 读取 `get_hermes_home()` 时尽量在运行时读取，而不是 import-time 固化。

---

## 十八、如果让我评价这套设计，它好在哪里，也还有什么边界

站在架构师视角，我会说 Hermes 这套模型发现机制最大的优点有四个。

### 优点一：极简而稳定

provider registry 代码量非常小，但功能上已经支持：

- bundled baseline
- user override
- alias mapping
- lazy discovery
- dynamic import isolation
- legacy compatibility

小系统做对了，往往比大而全的系统更可靠。

### 优点二：把“覆盖”做成一等能力

很多框架默认只想让用户“新增”，不想让用户“替换”。Hermes 允许 user override bundled provider，本质上给了高级用户更强的自治能力。

这对 AI 基础设施尤其重要，因为 provider 接入经常需要：

- 走代理；
- 换网关；
- 改认证方式；
- 修补上游 API 的兼容性问题；
- 临时接私有模型路由层。

### 优点三：性能意识非常强

从 provider lazy discovery，到 CLI 跳过无意义 plugin discovery，再到源码中明确记录 500~650ms 冷启动开销，说明 Hermes 在“能扩展”和“别拖慢所有人”之间做了细致平衡。

### 优点四：分层边界清晰

通用 plugin manager 不去夺 provider 的控制权，provider registry 也不反过来试图承担工具、平台、CLI 命令的发现责任。这种边界清晰，通常意味着系统能长期演进。

---

当然，它也有一些边界和潜在演进方向。

### 边界一：provider 的来源层级还比较少

当前 provider registry 主要是 bundled + user + legacy，没有 project 层，也没有 entry-point 层。对大多数用户足够，但对极端企业场景可能还不够细。

### 边界二：覆盖策略靠顺序，缺少更显式的冲突诊断

现在的 last-writer-wins 很清爽，但当冲突发生时，如果没有额外日志，用户未必立刻知道“谁覆盖了谁”。未来如果能提供更友好的 registry explain 功能，会更易调试。

### 边界三：import-side-effect 注册天然要求插件作者自律

这种模式实现简洁，但也意味着 provider 作者必须克制顶层副作用，否则 discovery 就会变重、变脆。好在 Hermes 自身的整体风格已经在尽量引导正确写法。

---

## 十九、给实践者的落地建议清单

如果你准备在 Hermes 上真正扩展或定制模型发现体系，我给一份尽量务实的 checklist：

### 当你想覆盖内置 provider 时

- 优先使用 `~/.hermes/plugins/model-providers/<same-name>/`
- 确保 `ProviderProfile.name` 与被覆盖对象一致
- 明确写 `kind: model-provider`
- 不要直接改仓库内 bundled 代码
- 检查是否有 legacy `providers/*.py` 抢最后覆盖权

### 当你想新增 provider 时

- 使用唯一、清晰、组织化的 provider 名称
- 把 aliases 设计得尽量不冲突
- import-time 只做 profile 注册
- 重逻辑放运行时子模块
- 不要依赖启发式 kind 识别，manifest 里明确声明

### 当你想优化性能时

- 禁止 import-time 网络调用
- 避免 import-time 初始化重型 SDK
- 尽量静态化 profile 元数据
- 需要动态模型列表时走 TTL + 磁盘缓存
- 测量首次 provider 解析耗时，而不是只测 CLI 启动时间

### 当你在排查覆盖问题时

- 先看 provider registry 最终态，不要只看文件是否存在
- 检查 alias 是否被重写
- 检查 runtime provider resolution 是否还有后续覆盖
- 检查 profile-specific 环境与缓存是否串用
- 必要时给 `__init__.py` 增加临时日志

---

## 二十、总结：Hermes 模型发现机制的核心价值，不是“能扫到插件”，而是“能安全地晚一点扫到，并允许用户盖过去”

最后做一个收束。

如果只用一句话总结本文，我会说：

> Hermes 的模型发现机制，真正厉害的地方不在于“支持插件化 provider”，而在于它把 provider 插件做成了一个**有默认基线、可用户覆盖、且只在真正需要时才激活**的基础设施层。

从源码实现上看，它的关键设计包括：

- 使用 `providers/__init__.py` 建立独立的 provider registry；
- 用 `_REGISTRY` 与 `_ALIASES` 管 canonical name 和 alias；
- 用扫描顺序编码优先级：bundled → user → legacy；
- 用 `register_provider()` 的覆盖写入实现 last-writer-wins；
- 用首次访问触发 `_discover_providers()` 实现 lazy discovery；
- 用稳定/隔离的 module naming 处理 bundled 与 user 导入差异；
- 在通用 plugin manager 中把 `kind == model-provider` 识别出来，但刻意不二次导入；
- 在 CLI 入口避免无意义 eager plugin discovery，把性能损耗控制在真正需要的场景里。

对使用者来说，这套机制带来的直接收益是：

- **开箱即用**：bundled providers 提供官方默认能力；
- **本地自治**：user overrides 可以安全替换内置 provider；
- **调试可控**：覆盖规则简单，冲突路径清晰；
- **性能友好**：不用为每次命令行调用支付整套 provider/plugin import 成本。

对架构设计者来说，这套实现还提供了一个很好的经验：

- 不要为了“统一”把所有插件都塞进一个大一统 loader；
- 真正重要的是按能力角色划分生命周期；
- 当某类插件承担基础设施职责时，给它单独的 discovery path 往往更合理；
- 而 overlay 覆盖与 lazy loading，往往是复杂 Agent 系统长期可维护性的关键。

如果你后续还想继续深挖，我建议顺着本文再看两条线：

1. `ProviderProfile` 如何参与更晚的 `resolve_runtime_provider()` 过程；
2. 各类 backend/provider registry（如 image_gen、web、browser）与 model-provider registry 的异同。

---

## 相关阅读

- [Hermes ProviderProfile 架构深度剖析：模型提供者的声明式注册与运行时钩子机制](/categories/架构/Hermes-ProviderProfile-架构深度剖析-模型提供者的声明式注册与运行时钩子机制/)
- [Hermes 插件系统深度剖析：PluginContext 注册、tool、CLI slash command 扩展点](/categories/架构/Hermes-插件系统深度剖析-PluginContext注册-tool-CLI-slash-command扩展点/)
- [Hermes Skill vs Plugin 扩展点对比：什么时候用 Skill，什么时候用 Plugin](/categories/架构/Hermes-Skill-vs-Plugin-扩展点对比-什么时候用-Skill-什么时候用-Plugin/)
- [Hermes Cron 调度器深度剖析：agent-native 调度 vs shell cron 的本质区别](/categories/架构/Hermes-Cron-调度器深度剖析-agent-native-调度-vs-shell-cron-本质区别/)
- [Hermes MCP 集成架构：动态工具发现、stdio/SSE/HTTP 传输、prompt injection 检测](/categories/架构/Hermes-MCP-集成架构-动态工具发现-stdio-SSE-HTTP传输-prompt-injection检测/)
- [AI Agent Orchestration Patterns 2026：Supervisor/Router/Swarm/DAG 编排模式选型](/categories/架构/AI-Agent-Orchestration-Patterns-2026-Supervisor-Router-Swarm-DAG-编排模式选型/)
- [AI Agent 框架的未来趋势：记忆系统、多模态、工具标准化、本地推理的发展方向](/categories/架构/AI-Agent-框架的未来趋势-记忆系统-多模态-工具标准化-本地推理的发展方向/)
- [AI Agent 评估实战：LLM-as-Judge、Benchmark 设计与回归测试](/categories/架构/AI-Agent-评估实战-LLM-as-Judge-Benchmark-设计与回归测试/)
这会帮助你真正建立一个完整的 Hermes “能力发现 → 运行时选择 → 实际执行”认知闭环。
