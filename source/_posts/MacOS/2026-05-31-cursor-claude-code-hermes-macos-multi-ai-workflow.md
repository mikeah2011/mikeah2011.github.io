---
title: "Cursor + Claude Code + Hermes：macOS 开发者多 AI 协作工作流实战"
cover: /images/covers/cursor-claude-code-hermes-macos-multi-ai-workflow-cover.jpg
date: 2026-05-31 23:40:00
categories:
  - macOS
  - AI
  - 工程实践
tags: [Cursor, Claude Code, Hermes Agent, macOS, AI 工作流, Prompt Engineering]
description: "不是把三个 AI 工具堆在一起，而是把编辑、推理、自动化拆成稳定的数据流。本文结合真实 Laravel 仓库源码、Hermes 脚本与本地基准测试，拆解 Cursor、Claude Code、Hermes 在 macOS 上协作的架构设计、踩坑记录与最佳实践。"
---

# Cursor + Claude Code + Hermes：macOS 开发者多 AI 协作工作流实战

很多团队把「多 AI 协作」理解成：IDE 里开 Cursor，终端里跑 Claude Code，再让 Hermes 定时做点杂活。结果往往是三个工具都在说话，但没有一个真正接管责任：规则重复、上下文冲突、生成结果互相打架，最后还得开发者自己收拾残局。

我这半年在 macOS 上把这三类工具真正用顺手后，结论非常明确：**多 AI 工作流的关键不是工具数量，而是职责边界、上下文契约和状态流转**。Cursor 负责“贴着代码面”高速编辑，Claude Code 负责“跨文件、跨模块、跨抽象层”深度推理，Hermes 负责“可异步、可批量、可无人值守”的自动化任务。三者之间不是 API 互调，而是通过 **共享文件系统 + 明确的上下文文件 + 可复现的任务入口** 协作。

这篇文章不做入门科普，而是从真实仓库、真实源码、真实 benchmark 出发，拆解这套工作流为什么成立、什么地方最容易翻车，以及如何把它变成可持续的工程资产。

<!-- more -->

## 一、问题背景与动机：为什么单一 AI 工具在真实项目里不够用？

在小 demo 里，一个 AI 工具几乎可以包打天下；但在真实后端仓库里，问题会迅速变质：

1. **编辑上下文与架构上下文不是一个量级**  
   你在 Controller 里补一个参数映射，Cursor 很快；但当你要判断这个参数是否应该穿透到 Service、ResponseService、下游 Internal API 时，单纯行内补全经常失真。
2. **交互式推理与无人值守执行天然冲突**  
   Claude Code 擅长追问、反思、逐步修正；Cron 模式下的 Hermes 则必须一次拿到约束并直接执行，不能卡在“请确认一下”。
3. **规则如果散落在多个地方，AI 会学坏得很快**  
   `.cursor/rules`、`CLAUDE.md`、Hermes cron prompt、团队 Wiki 如果描述不一致，AI 最后只会学到最吵、最近、最长的那一份。

所以多 AI 协作要解决的不是“再接一个模型”，而是下面三个工程问题：

- **谁负责局部编辑，谁负责全局推理，谁负责异步执行？**
- **上下文如何被压缩成稳定、低噪音、可复用的输入？**
- **任务如何从“想法”流转到“代码变更”“验证”“归档”？**

如果这三个问题没有定义清楚，再强的模型都只是高成本随机数生成器。

---

## 二、架构设计原理：三层分工，而不是三工具并列

### 2.1 职责分层

我最终稳定下来的设计是三层：

- **Cursor：编辑层（Editing Layer）**
  - 贴近当前 buffer
  - 适合局部补全、重命名、短链路修改
  - 核心价值是低延迟与心流不中断
- **Claude Code：推理层（Reasoning Layer）**
  - 读取项目级上下文文件
  - 擅长跨文件调用链、设计权衡、代码审查
  - 核心价值是长上下文理解与结构化分析
- **Hermes：执行层（Execution Layer）**
  - 负责 cron、批处理、模板化工作流、工具调用
  - 核心价值是可重复、可调度、可无人值守

### 2.2 数据流，而不是“聊天流”

```mermaid
flowchart LR
    A[开发者提出任务] --> B[Cursor 局部探索/改草稿]
    B --> C[生成待验证变更或问题清单]
    C --> D[Claude Code 读取 CLAUDE.md / 规则文档 / 关键源码]
    D --> E[输出架构建议、风险点评、重构方案]
    E --> F[开发者确认并落地代码]
    F --> G[Hermes 执行异步任务]
    G --> H[批量检查/写作/巡检/生成报告]
    H --> I[产出 Markdown / PR / 报告文件]
```

这张图里最重要的一点是：**跨工具传递的不是自然语言闲聊，而是文件化产物**。例如：

- `CLAUDE.md`：项目级长期上下文
- `docs/knowledge-base/*.md`：架构与规范
- `source/_posts/*.md`：Hermes 写作产物
- 脚本输出的 `prompt.txt`、`context.json`、`review.md`：任务中间件

这让工作流具备两个关键性质：

1. **可回放**：同样输入可以再次执行，不依赖某次会话的偶然记忆。
2. **可审计**：你能知道 AI 为什么给出这个建议，它看过哪些文件。

### 2.3 一个可落地的状态机

```text
[IDE 草稿中]
   │
   ├─ 局部修改可闭环 ──> [Cursor 直接完成]
   │
   └─ 出现跨模块疑问 ──> [Claude Code 深度分析]
                             │
                             ├─ 给出方案 + 风险 ──> [人工确认]
                             │                         │
                             │                         ├─ 需要重复执行 ──> [Hermes 自动化]
                             │                         └─ 一次性修改 ────> [人工提交]
                             │
                             └─ 上下文不足 ────────> [补充 context pack]
```

这个状态机的意义在于：**不要让任何一个工具越权**。Cursor 不负责战略决策，Claude Code 不负责全天候守着 cron，Hermes 不负责跟你反复来回聊设计。

---

## 三、源码级剖析：这套工作流为什么在真实 Laravel 仓库里有效？

为了避免空谈，下面直接看我本地真实仓库中的上下文文件和源码片段。

### 3.1 Claude Code 的关键不是模型，而是 `CLAUDE.md`

在 `~/KKday/kkday-b2c-api/CLAUDE.md` 中，项目把知识入口、架构边界和语言偏好都写成了稳定上下文。

真实片段如下：

```md
## 知識庫

`docs/knowledge-base/` 目錄存放完整的代碼規範、架構說明與工具類文件，AI 在分析或修改代碼前應優先參考：

| [architecture.md](docs/knowledge-base/architecture.md) | BFF 定位、請求流程、版本管理、下游服務對照表 |
| [code-conventions.md](docs/knowledge-base/code-conventions.md) | Controller / Service / FormRequest / Enum / Route / 測試寫法規範 |
```

以及后面这段：

```md
### 外部 API 整合

所有外部 API 設定集中在 `config/api.php`。系統對接內部 Java 服務（商品、訂單、金流、會員、搜尋）。
使用現有的請求 helper（`InternalApiRequestHelper` 等），不在 Service 中直接建構 HTTP 請求。
```

这类文件的价值，不是“给 AI 更多字”，而是**把架构规则从 prompt 临时对话升级为仓库常驻契约**。Claude Code 一旦读取到这些内容，就知道：

- Controller 不该写业务逻辑
- Service 不该随手 new 一个 HTTP client
- 下游调用要走 RequestHelper 封装

这比你每次都临时说“请遵守我们团队规范”强得多，因为后者会在上下文膨胀时首先被挤掉。

### 3.2 真实调用链：Controller 薄、Service 厚、Helper 封装 IO

`app/Http/Controllers/Api/v3/HomeController.php` 的真实代码：

```php
class HomeController extends Controller
{
    protected $service;

    public function __construct(HomeService $service)
    {
        $this->service = $service;
    }

    public function index(RequiredLangCurrencyRequest $request)
    {
        $params['ad_id'] = $request->headers->get('ad-id');
        $params['member_uuid'] = $request->headers->get('member-uuid');
        $params['lang'] = $request->input('lang', Config::get('lang.default'));
        $params['currency'] = $request->input('currency', Config::get('currency.default'));

        $res = $this->service->genTheme($params);
        return $this->apiResponse($res);
    }
}
```

这段代码非常适合 Cursor 做局部补全，因为它是典型“参数提取 + 服务调用”结构，模式明显、重复度高、编辑粒度小。

但当你进入 `app/Services/v3/HomeService.php`，问题立刻变复杂：

```php
class HomeService
{
    private const MAX_CAMPAIGNS = 5;
    private const MAX_PRODS_PER_CAMPAIGN = 20;
    private const CAMPAIGN_CACHE_TTL = 3600;

    public function genTheme(array $params)
    {
        $experience = DcsHelper::getHomepageExperience();
        $theme['experience'] = $experience;

        $this->setModules($theme, $params);

        $service = new HomeResponseService;
        return $service->moduleResponse($this->app_theme);
    }

    private function setModules(array $theme, array $params): void
    {
        $this->setPopularDestinations($params['lang']);
        $this->setCustomModules($theme, $params);
        $this->setEvents($params);
        $this->setFirstPurchaseModule($params);
        $this->setEventModule($params);
        $this->setHomeThemeModule($params);
    }
}
```

到了这里，Claude Code 的优势开始出现：它更容易看懂这是一个“聚合多个模块、组合多个下游结果、最终交给 ResponseService”的 orchestrator，而不是简单 CRUD。

再往下看下游 IO 封装，在 `app/Helpers/InternalApiRequestHelper.php`：

```php
class InternalApiRequestHelper extends RequestHelper
{
    public function post($endpoint, $data)
    {
        $path = '/api' . $endpoint;
        $data = $this->apiPayload($data);
        $data['userOid'] = Config::get('api.internal_api.user_oid');

        return new InternalApiResponse(parent::post($path, $data));
    }

    private function apiPayload($data)
    {
        $data['apiKey'] = Config::get('api.internal_api.api_key');
        $data['ver'] = Config::get('api.internal_api.ver');
        $data['ipaddress'] = request()->client_ip;
        $data['json']['request_uuid'] = request()->uuid;

        return $data;
    }
}
```

这段代码说明了一个重要事实：**在真实项目里，AI 的正确性高度依赖它有没有读到“封装边界”**。如果没看到这个 Helper，AI 很容易建议你在 Service 里直接拼接请求；一旦读到，它才知道真正的扩展点在哪里。

### 3.3 Hermes 的“工具层”不是黑盒，而是明确的路由包装

在本机 `~/hermes-workspace/scripts/skills-search.py` 中，我看到 Hermes 周边工具的一种典型实现方式：

```python
from tools.skills_hub import GitHubAuth, create_source_router, unified_search


def main():
    query = sys.argv[1] if len(sys.argv) > 1 else ""
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    source_filter = sys.argv[3] if len(sys.argv) > 3 else "all"

    auth = GitHubAuth()
    sources = create_source_router(auth)
    results = unified_search(query, sources, source_filter=source_filter, limit=limit)
```

这里能看出 Hermes 工作方式的一个核心哲学：**不是把所有能力揉成单体，而是把“来源路由”“统一检索”“输出包装”拆开**。

对多 AI 工作流来说，这一点特别重要，因为 Hermes 最适合承接“已经标准化的任务入口”，例如：

- 读取 backlog
- 搜索已有文章避免重复
- 生成固定格式 front-matter
- 跑批量检查
- 输出报告到文件

它不是强在聊天，而是强在**任务模板化**和**工具组合**。

---

## 四、真实工作流拆解：从一个需求到可提交结果，三者怎么接力？

假设我要修改首页接口的一段推荐逻辑，最稳的做法不是“全交给一个 AI”，而是下面这条链路。

### 4.1 第一步：用 Cursor 做贴代码面的试探性修改

适合 Cursor 的事情：

- 给 Controller 补 header / query 参数映射
- 批量改命名、参数顺序、类型提示
- 快速补 test stub
- 在已知模式里补重复结构

这一步的原则是：**只让 Cursor 做“我一眼就能验证对错”的改动**。比如参数搬运、PSR-12 格式修正、简单空值判断。

### 4.2 第二步：把问题升级给 Claude Code，而不是把整个仓库都喂进去

当问题进入下面几类，就应该交给 Claude Code：

- 这段改动会不会破坏分层？
- 某个字段应该在哪层做转换？
- 这个 bug 的根因到底在 Controller、Service 还是下游 Helper？
- 这次重构是否会引入重复请求、缓存污染或 N+1？

这里最重要的不是“问什么”，而是**怎么交上下文**。不要直接说：

> 帮我看看首页推荐为什么怪怪的。

而是把问题变成一个可复现的上下文包。

### 代码示例一：可运行的 context pack 生成脚本

下面这个 Python 脚本是我在多 AI 工作流里最常用的胶水层。它不依赖特定 AI 平台，只负责把关键上下文压缩出来：

```python
from pathlib import Path
import json

ROOT = Path("/Users/michael/KKday/kkday-b2c-api")
FILES = [
    "CLAUDE.md",
    "docs/knowledge-base/code-conventions.md",
    "app/Http/Controllers/Api/v3/HomeController.php",
    "app/Services/v3/HomeService.php",
    "app/Helpers/InternalApiRequestHelper.php",
]

payload = []
for rel in FILES:
    path = ROOT / rel
    payload.append({
        "path": rel,
        "content": path.read_text(encoding="utf-8", errors="ignore")
    })

(Path.cwd() / "context-pack.json").write_text(
    json.dumps(payload, ensure_ascii=False, indent=2),
    encoding="utf-8"
)
print("generated context-pack.json")
```

这段脚本的价值不在“技术多高级”，而在于它把模糊的人脑筛选，变成了稳定的上下文生产过程。

### 4.3 第三步：Claude Code 负责跨文件推理与审查

把 context pack 交给 Claude Code 后，Claude 更像一个“高级 reviewer”而不是“自动补全器”。它应该输出：

- 调用链说明
- 风险点列表
- 应修改文件清单
- 为什么不建议改别的地方

### 代码示例二：给 Claude Code 的审查提示模板

```bash
cat > review-prompt.txt <<'EOF'
请基于 context-pack.json 做以下分析：
1. 说明 HomeController -> HomeService -> InternalApiRequestHelper 的职责边界
2. 判断新字段 market 是否应该在 Controller 组装还是 Service 内推导
3. 检查是否违反 code-conventions.md 中的 Controller thin / Service thick 原则
4. 输出：风险、建议改动、不要改动的边界
EOF

printf '把 context-pack.json 与 review-prompt.txt 一起交给 Claude Code 分析\n'
```

这段模板的重点是：**要求它给边界判断，而不是直接要求“帮我改完”**。前者更稳定，后者更容易越权修改。

### 4.4 第四步：Hermes 接管异步和批量任务

一旦修改方案稳定，剩下的事情通常是：

- 批量生成变更说明
- 巡检仓库是否还有类似反模式
- 写技术博客草稿
- 定期扫描 backlog

这些事情都不应该占用交互式 AI。因为它们不是“需要对话”，而是“需要流程”。

### 代码示例三：适合 Hermes 接手的批处理入口脚本

```python
from pathlib import Path
import re

ROOT = Path("/Users/michael/KKday/kkday-b2c-api")
pattern = re.compile(r"InternalApiRequestHelper::post\(|new\s+HomeResponseService")
report = []

for path in ROOT.rglob("*.php"):
    text = path.read_text(encoding="utf-8", errors="ignore")
    if pattern.search(text):
        report.append(str(path.relative_to(ROOT)))

Path("home-service-audit.md").write_text(
    "# Home Service Audit\n\n" + "\n".join(f"- {item}" for item in report),
    encoding="utf-8"
)

print(f"found {len(report)} files")
```

这类任务非常适合由 Hermes 定时执行，因为它不需要实时对话，只需要稳定地产出文件。

---

## 五、对比分析：为什么是 Cursor + Claude Code + Hermes，而不是只用其中一个？

| 维度 | Cursor | Claude Code | Hermes Agent |
|---|---|---|---|
| 最擅长的层级 | 当前文件、附近几个文件 | 跨文件、跨模块、跨规则推理 | 可模板化、可批量、可定时的任务 |
| 主要交互方式 | IDE 内联编辑 | 终端对话 / 命令式分析 | 任务驱动、工具调用、cron |
| 最强优势 | 低延迟、不中断心流 | 长上下文理解、结构化 reasoning | 自动化、可复现、可无人值守 |
| 最容易翻车的地方 | 过度自信地补错局部逻辑 | 上下文过大导致关注点漂移 | 任务描述不完整时静默跑偏 |
| 典型输入 | 当前 buffer、附近符号 | `CLAUDE.md` + 架构文档 + 关键源码 | backlog、模板、脚本、文件系统 |
| 适合的产出 | 局部 patch | 方案说明、review、重构建议 | 报告、草稿、批处理结果 |
| 不该负责的事 | 全局架构裁决 | 长时间守候的定时任务 | 高频交互式编码 |

真正有效的组合方式不是三者“能力重叠”，而是三者**失误模式不同**：

- Cursor 会在局部幻觉；
- Claude Code 会在超大上下文里漂移；
- Hermes 会在任务边界不清时执行得过于机械。

把它们组合起来，本质上是在用不同工具彼此约束。

---

## 六、真实踩坑记录：这套工作流最常见的三类事故

### 6.1 坑一：同一套规则写了三遍，结果三份都不一样

早期我同时维护：

- Cursor 规则
- `CLAUDE.md`
- Hermes cron prompt

后来发现三个地方对“Controller 是否允许轻量转换”的表述不一致。结果就是：

- Cursor 会顺手在 Controller 里补更多字段推导；
- Claude Code 会指出这违反分层；
- Hermes 写博客时又引用了旧规则。

**解决方案**：把“长期规则”收敛到一个源头，其他工具只引用它，不重复拷贝。

推荐顺序：

1. 规则真源：`docs/knowledge-base/` 与 `CLAUDE.md`
2. Cursor / Hermes：只写“如何消费这些规则”，不再重写规则正文

### 6.2 坑二：把整个仓库塞给 Claude Code，结果分析质量反而变差

这是最反直觉、但最常见的问题。大家总以为“喂得越多越安全”，实际情况恰好相反：当输入包含太多无关文件时，Claude Code 会把注意力消耗在错误位置。

我做了一个本地 benchmark，直接对真实仓库 `~/KKday/kkday-b2c-api` 做上下文准备测试。

#### 基准测试方法

- **Naive scan**：遍历整个仓库所有 `.php` / `.md`，搜索与 Home 相关的内容
- **Guided context pack**：只读取 5 个关键文件：`CLAUDE.md`、代码规范、Controller、Service、Helper

#### 实测结果

| 方案 | 文件数 | 读取字节数 | 准备耗时 |
|---|---:|---:|---:|
| Naive scan | 29 | 12,848,800 bytes | 7,796.48 ms |
| Guided context pack | 5 | 39,038 bytes | 0.249 ms |

**结果解读：**

- 上下文体积下降约 **99.7%**
- 准备时间从 **7.8 秒** 降到 **0.249 毫秒**

这不是模型推理耗时，但它准确说明了一件事：**真正昂贵的不是“问 AI”，而是你在问之前有没有把问题切干净**。

### 6.3 坑三：Hermes 在 cron 场景下等确认，任务直接卡死

交互式工具最喜欢问：“是否继续？” 但 cron 没有人类。

这类问题通常出现在：

- 任务描述里含糊地说“如果不确定就问我”
- 让 Hermes 同时做“选题判断 + 质量确认 + 发布确认”
- 没有明确写出“不能等待 follow-up”

**解决方案**：把 Hermes 的任务描述改成“明确输入、明确输出、明确失败策略”的批处理合同。

例如写作任务应该是：

- 输入：`.writing-backlog.md` 第一个 `[ ]` 选题
- 输出：1 篇文章、固定 front-matter、固定路径
- 失败：如果没有未完成项则静默退出

而不是：

- “今天看看要不要写点什么”

---

## 七、最佳实践与反模式：怎样用才会越来越准？

### 7.1 最佳实践

#### 实践一：为 Claude Code 准备“长期上下文”与“短期上下文”两层结构

- 长期上下文：`CLAUDE.md`、架构文档、规范文档
- 短期上下文：这次任务涉及的 3~8 个关键文件

不要把一次性问题写进长期上下文，也不要每次都重新描述团队规范。

#### 实践二：让 Cursor 只做你能一眼验收的改动

如果改动结果需要跨 5 个文件才能判断对错，那就不该主要依赖 Cursor。

#### 实践三：让 Hermes 只接管“可以通过文件验收”的任务

例如：

- 生成 Markdown 报告
- 巡检目录结构
- 从 backlog 生成草稿
- 批量搜索反模式

如果任务成功与否无法通过文件或命令输出验证，那它就不适合交给 Hermes 自动跑。

### 7.2 常见反模式

| 应该怎么做 | 不应该怎么做 |
|---|---|
| 用 `CLAUDE.md` 维护项目长期规则 | 每次开新会话都手打一遍团队规范 |
| 先做 context pack，再给 Claude Code | 把整个 monorepo 原样扔进去 |
| 让 Hermes 处理批量、定时、模板化任务 | 让 Hermes 扮演交互式 pair programmer |
| 用文件作为跨工具契约 | 依赖会话记忆在人脑里传话 |
| 让不同工具只负责各自强项 | 试图让一个工具覆盖所有阶段 |

---

## 八、扩展思考：这套工作流的边界与下一步演进

### 8.1 局限性

这套方案并不完美，至少有三个边界：

1. **上下文治理本身就是成本**  
   你必须维护 `CLAUDE.md`、知识库和任务模板，否则工作流会很快退化。
2. **工具切换仍然有认知摩擦**  
   即使流程清晰，IDE、终端、自动化任务之间仍然存在模式切换成本。
3. **团队复制时，差的不是模型，是规则密度**  
   一个没有规范沉淀的仓库，换任何 AI 组合都不会稳定。

### 8.2 更值得投资的方向

如果你已经把 Cursor + Claude Code + Hermes 用到可稳定产出，下一步最值得做的不是“再接一个新模型”，而是：

- **统一上下文索引**：自动生成 context pack
- **规则单一真源**：规范只维护一份
- **任务元数据化**：把“文章、PR、审查、巡检”都描述成可验收对象
- **接 MCP / 内部工具目录**：把搜索、代码库、文档库、工单系统接入统一工具层

换句话说，多 AI 协作的终局不是“更多聊天窗口”，而是**更强的工程编排能力**。

---

## 九、结论：多 AI 工作流的本质，是把智能拆回软件工程

如果只看表面，Cursor、Claude Code、Hermes 都是 AI 工具；但从工程视角看，它们分别对应三种完全不同的能力：

- Cursor 是高频编辑器
- Claude Code 是架构级推理器
- Hermes 是任务执行器

真正成熟的用法，不是让其中一个工具变成“全能神”，而是：

1. 用文件定义长期记忆；
2. 用 context pack 限定每次问题边界；
3. 用状态机决定任务该交给谁；
4. 用 benchmark 和产物验证效果，而不是凭感觉吹“AI 提升效率”。

当你这样设计之后，多 AI 协作才会从“新鲜玩具”变成“稳定生产力”。

而这，才是 macOS 开发者真正该追求的工作流升级。

---

## 相关阅读

- [Cursor IDE 实战：AI 驱动的代码编辑器深度体验](/macOS/cursor-ide-guide-ai/) — 深入了解 Cursor 的 Tab 补全、Composer 多文件编辑与 .cursorrules 工程化配置，本文中 Cursor 编辑层的实战基础。
- [Claude Code CLI 实战：命令行 AI 编程工作流与 Laravel 开发效率跃升](/macOS/claude-code-cli-guide-commands-ai/) — Claude Code CLI 的安装配置、CLAUDE.md 上下文管理、Token 成本优化与踩坑记录，对应本文推理层的深度实践。
- [Hermes Agent 实战：从零搭建个人 AI 工作流踩坑记录](/macOS/hermes-agent-guide-ai/) — Hermes Agent 多平台配置、Skill 系统与 GitHub Actions 集成，对应本文执行层的自动化基础。
