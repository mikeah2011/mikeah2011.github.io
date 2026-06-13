---

title: Hermes 子代理架构：leaf vs orchestrator 角色模型、工具屏蔽、审批策略
keywords: [Hermes, leaf vs orchestrator, 子代理架构, 角色模型, 工具屏蔽, 审批策略]
date: 2026-06-02 00:00:00
description: 深入剖析 Hermes Agent 子代理架构设计，详解 Leaf（叶节点）与 Orchestrator（编排者）两种角色模型的职责划分、工具屏蔽机制和安全审批策略。涵盖任务分解与并行执行、delegate_task 通信协议、深度控制防无限嵌套、上下文感知审批等核心实现，附 Python 代码示例与架构图，帮助开发者构建安全可控的多 Agent 协作系统。
tags:
- Hermes
- 子代理
- Agent
- Multi-Agent
- 任务分发
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---




# Hermes 子代理架构：leaf vs orchestrator 角色模型、工具屏蔽、审批策略

## 前言

当一个 AI Agent 面对复杂任务时，单打独斗往往不是最优解。就像一个高效的团队需要合理的分工协作，Agent 系统也需要将复杂任务拆解并分配给多个专职子代理执行。

Hermes Agent 的子代理架构（Subagent Architecture）就是为此而设计的。本文将深入分析两种子代理角色模型——**Leaf（叶节点）** 和 **Orchestrator（编排者）**——的设计理念、工具屏蔽机制、以及安全审批策略。

---

## 第一章：为什么需要子代理？

### 1.1 单 Agent 的瓶颈

一个单独的 Agent 在面对以下场景时会力不从心：

**场景一：上下文窗口限制**

```
任务：分析 10 个代码仓库并生成对比报告

单 Agent 方式：
1. 加载仓库 1 的代码 → 消耗 50K tokens
2. 加载仓库 2 的代码 → 消耗 50K tokens
...
10. 加载仓库 10 的代码 → 已经超出上下文窗口！

子 Agent 方式：
同时启动 10 个子 Agent，每个分析一个仓库
最后汇总结果 → 总消耗可控
```

**场景二：任务隔离需求**

```
任务：在生产环境执行数据库迁移，同时发送通知

单 Agent 方式：
同一个 Agent 既执行迁移又发通知
如果通知代码有 bug，可能影响迁移逻辑

子 Agent 方式：
子 Agent A：执行数据库迁移（高权限）
子 Agent B：发送通知（低权限）
互不干扰
```

**场景三：并行执行**

```
任务：同时检查 5 个 API 端点的健康状态

单 Agent 方式：串行检查，耗时 5 × 10s = 50s
子 Agent 方式：并行检查，耗时 max(10s) = 10s
```

### 1.2 子代理的核心价值

1. **任务分解**：将大任务拆分为可管理的小任务
2. **并行执行**：多个子代理同时工作
3. **上下文隔离**：每个子代理有独立的上下文
4. **权限控制**：不同子代理可以有不同权限
5. **故障隔离**：一个子代理失败不影响其他

---

## 第二章：Leaf vs Orchestrator 角色模型

### 2.1 角色定义

Hermes 定义了两种子代理角色：

**Leaf（叶节点代理）**：
- 专注于单一任务
- 不能创建子代理
- 工具集受限
- 轻量级，快速启动

**Orchestrator（编排者代理）**：
- 可以分解任务并创建子代理
- 拥有 `delegate_task` 工具
- 负责协调和汇总
- 更重，但更灵活

### 2.2 架构图

```
┌─────────────────────────────────────────────────┐
│                   主 Agent                       │
│                  (Orchestrator)                  │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐             │
│  │  子 Agent A   │  │  子 Agent B   │             │
│  │  (Leaf)      │  │  (Orchestrator)│             │
│  │              │  │              │             │
│  │ 工具: file,  │  │ 工具: delegate │             │
│  │       terminal│  │              │             │
│  └──────────────┘  │  ┌─────────┐ │             │
│                     │  │子Agent B1│ │             │
│  ┌──────────────┐  │  │ (Leaf)  │ │             │
│  │  子 Agent C   │  │  └─────────┘ │             │
│  │  (Leaf)      │  │  ┌─────────┐ │             │
│  │              │  │  │子Agent B2│ │             │
│  │ 工具: web,   │  │  │ (Leaf)  │ │             │
│  │       search │  │  └─────────┘ │             │
│  └──────────────┘  └──────────────┘             │
└─────────────────────────────────────────────────┘
```

### 2.3 角色选择决策

```python
def choose_role(task: Task) -> Role:
    """根据任务特征选择子代理角色"""
    
    # 如果任务可以独立完成，用 Leaf
    if task.is_independent and not task.requires_delegation:
        return Role.LEAF
    
    # 如果任务需要进一步拆分，用 Orchestrator
    if task.subtasks_count > 1:
        return Role.ORCHESTRATOR
    
    # 如果任务需要多种工具组合，用 Orchestrator
    if len(task.required_tools) > 3:
        return Role.ORCHESTRATOR
    
    # 默认用 Leaf（更轻量）
    return Role.LEAF
```

### 2.4 Leaf 代理的特征

```python
class LeafAgent:
    """叶节点代理：专注于执行，不能创建子代理"""
    
    # 能使用的工具
    allowed_tools = [
        "terminal",     # 执行 shell 命令
        "file",         # 文件操作
        "read_file",    # 读取文件
        "write_file",   # 写入文件
        "search_files", # 搜索文件
        "web",          # 网络请求
        "search",       # 搜索
    ]
    
    # 不能使用的工具
    blocked_tools = [
        "delegate_task",   # 不能创建子代理
        "send_message",    # 不能直接发送消息
        "memory",          # 不能修改全局记忆
    ]
    
    # 执行模式
    execution_mode = "autonomous"  # 自主执行，不与用户交互
    
    # 上下文
    context = {
        "conversation_history": [],  # 空的对话历史
        "tools": allowed_tools,      # 受限的工具集
        "constraints": [],           # 任务约束
    }
```

### 2.5 Orchestrator 代理的特征

```python
class OrchestratorAgent:
    """编排者代理：可以分解任务，协调子代理"""
    
    # 能使用的工具
    allowed_tools = [
        "delegate_task",   # 创建子代理（核心能力）
        "terminal",        # 执行 shell 命令
        "file",            # 文件操作
        "read_file",       # 读取文件
        "write_file",      # 写入文件
        "search_files",    # 搜索文件
    ]
    
    # 不能使用的工具
    blocked_tools = [
        "send_message",    # 不能直接发送消息
        "memory",          # 不能修改全局记忆
        "clarify",         # 不能向用户提问（cron 场景）
    ]
    
    # 执行模式
    execution_mode = "coordinating"  # 协调模式
    
    # 嵌套限制
    max_spawn_depth = 1  # 最多一层嵌套
```

---

## 第三章：工具屏蔽机制

### 3.1 为什么要屏蔽工具？

工具屏蔽是 Hermes 安全模型的核心组成部分。原因包括：

1. **最小权限原则**：每个子代理只应拥有完成任务所需的最小工具集
2. **防止滥用**：限制子代理的能力范围
3. **故障隔离**：即使子代理被恶意提示词控制，也无法执行危险操作
4. **资源控制**：限制子代理的资源消耗

### 3.2 工具屏蔽的实现

```python
class ToolFilter:
    """工具过滤器：根据代理角色过滤可用工具"""
    
    def __init__(self, role: Role, custom_blocklist: List[str] = None):
        self.role = role
        self.custom_blocklist = custom_blocklist or []
    
    def get_available_tools(self, all_tools: Dict[str, Tool]) -> Dict[str, Tool]:
        """获取当前角色可用的工具"""
        
        if self.role == Role.LEAF:
            # Leaf 代理：排除 delegate_task
            blocked = {"delegate_task", "send_message", "memory", "clarify"}
        elif self.role == Role.ORCHESTRATOR:
            # Orchestrator 代理：排除直接交互工具
            blocked = {"send_message", "memory", "clarify"}
        else:
            blocked = set()
        
        # 合并自定义屏蔽列表
        blocked.update(self.custom_blocklist)
        
        # 过滤工具
        return {
            name: tool for name, tool in all_tools.items()
            if name not in blocked
        }
```

### 3.3 工具屏蔽的层级

Hermes 的工具屏蔽是多层级的：

```
┌─────────────────────────────────────────┐
│           全局工具注册表                  │
│  (terminal, file, web, delegate_task...) │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│           Profile 级别过滤               │
│  (某些 Profile 可能禁用某些工具)          │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│           角色级别过滤                    │
│  (Leaf vs Orchestrator)                  │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│           任务级别过滤                    │
│  (特定任务可能额外禁用某些工具)           │
└─────────────────────────────────────────┘
```

### 3.4 屏蔽的执行方式

```python
class SafeToolWrapper:
    """安全工具包装器：在工具调用前进行权限检查"""
    
    def __init__(self, tool: Tool, agent_role: Role):
        self.tool = tool
        self.agent_role = agent_role
    
    async def execute(self, **kwargs):
        """安全执行工具"""
        
        # 权限检查
        if not self.is_allowed():
            raise ToolAccessDeniedError(
                f"Tool '{self.tool.name}' is not available for {self.agent_role} agents"
            )
        
        # 审批检查
        if self.requires_approval():
            approved = await self.request_approval(**kwargs)
            if not approved:
                raise ToolApprovalDeniedError(
                    f"Tool '{self.tool.name}' execution was denied by user"
                )
        
        # 执行工具
        return await self.tool.execute(**kwargs)
    
    def is_allowed(self) -> bool:
        """检查工具是否对当前角色可用"""
        return self.tool.name not in BLOCKED_TOOLS[self.agent_role]
```

### 3.5 动态工具屏蔽

某些场景下，工具屏蔽可以根据运行时条件动态调整：

```python
class DynamicToolFilter:
    """动态工具过滤器"""
    
    def __init__(self, base_filter: ToolFilter):
        self.base_filter = base_filter
        self.runtime_rules = []
    
    def add_rule(self, condition: Callable, tools_to_block: List[str]):
        """添加运行时规则"""
        self.runtime_rules.append((condition, tools_to_block))
    
    def get_available_tools(self, context: dict) -> Dict[str, Tool]:
        """根据运行时上下文获取可用工具"""
        tools = self.base_filter.get_available_tools(ALL_TOOLS)
        
        # 应用运行时规则
        for condition, blocked in self.runtime_rules:
            if condition(context):
                for tool_name in blocked:
                    tools.pop(tool_name, None)
        
        return tools
```

---

## 第四章：任务分发与结果汇总

### 4.1 任务分发策略

```python
class TaskDistributor:
    """任务分发器"""
    
    def __init__(self):
        self.strategies = {
            "parallel": self.parallel_distribute,
            "sequential": self.sequential_distribute,
            "priority": self.priority_distribute,
        }
    
    async def distribute(self, task: ComplexTask, strategy: str = "parallel"):
        """分发任务"""
        # 1. 任务分解
        subtasks = await self.decompose_task(task)
        
        # 2. 选择分发策略
        distributor = self.strategies[strategy]
        
        # 3. 执行分发
        results = await distributor(subtasks)
        
        # 4. 汇总结果
        return await self.aggregate_results(results)
    
    async def parallel_distribute(self, subtasks: List[SubTask]):
        """并行分发"""
        tasks = []
        for subtask in subtasks:
            role = choose_role(subtask)
            agent = create_subagent(role, subtask.context)
            tasks.append(agent.execute(subtask.prompt))
        
        # 并行执行，最多 max_concurrent 个并发
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return results
```

### 4.2 子代理创建

```python
class SubAgentFactory:
    """子代理工厂"""
    
    def create(self, role: Role, context: SubAgentContext) -> SubAgent:
        """创建子代理"""
        
        # 1. 创建工具过滤器
        tool_filter = ToolFilter(role, context.custom_blocklist)
        available_tools = tool_filter.get_available_tools(ALL_TOOLS)
        
        # 2. 构建系统提示
        system_prompt = self.build_system_prompt(role, context)
        
        # 3. 创建子代理实例
        agent = SubAgent(
            role=role,
            tools=available_tools,
            system_prompt=system_prompt,
            max_iterations=context.max_iterations,
            timeout=context.timeout,
        )
        
        return agent
    
    def build_system_prompt(self, role: Role, context: SubAgentContext) -> str:
        """构建子代理的系统提示"""
        
        base_prompt = f"You are a {role.value} sub-agent."
        
        if role == Role.LEAF:
            role_prompt = """
You are a focused worker agent. Execute your assigned task efficiently.
- You CANNOT create sub-agents
- You CANNOT interact with the user directly
- You SHOULD report your results back clearly
- You SHOULD handle errors gracefully
"""
        elif role == Role.ORCHESTRATOR:
            role_prompt = """
You are an orchestrator agent. You can:
- Decompose complex tasks into subtasks
- Delegate subtasks to leaf agents using delegate_task
- Aggregate results from sub-agents
- Make decisions based on aggregated information
"""
        
        return base_prompt + role_prompt + context.additional_prompt
```

### 4.3 结果汇总

```python
class ResultAggregator:
    """结果汇总器"""
    
    async def aggregate(self, results: List[SubAgentResult], strategy: str = "merge"):
        """汇总多个子代理的结果"""
        
        if strategy == "merge":
            return await self.merge_results(results)
        elif strategy == "vote":
            return await self.vote_results(results)
        elif strategy == "chain":
            return await self.chain_results(results)
    
    async def merge_results(self, results: List[SubAgentResult]):
        """合并结果"""
        successful = [r for r in results if r.status == "success"]
        failed = [r for r in results if r.status != "success"]
        
        return AggregatedResult(
            summaries=[r.summary for r in successful],
            errors=[r.error for r in failed],
            total_tasks=len(results),
            successful_tasks=len(successful),
            failed_tasks=len(failed),
        )
    
    async def vote_results(self, results: List[SubAgentResult]):
        """投票结果（用于需要一致性的场景）"""
        # 统计各结果的出现频率
        from collections import Counter
        summaries = [r.summary for r in results if r.status == "success"]
        counter = Counter(summaries)
        
        # 返回出现最多的结论
        most_common = counter.most_common(1)[0]
        return AggregatedResult(
            consensus=most_common[0],
            confidence=most_common[1] / len(summaries),
            dissenting=[s for s in summaries if s != most_common[0]]
        )
```

---

## 第五章：审批策略

### 5.1 审批的必要性

某些工具的执行可能产生不可逆的后果，需要用户确认：

```python
# 这些操作通常需要审批
HIGH_RISK_TOOLS = {
    "terminal": ["rm -rf", "DROP TABLE", "DELETE FROM"],  # 危险命令
    "file": ["/etc/", "/var/", "~/.ssh/"],                 # 敏感路径
    "db_query": ["DELETE", "UPDATE", "ALTER"],             # 数据修改
    "send_message": [],                                     # 外部通信
}
```

### 5.2 审批策略类型

```python
class ApprovalPolicy(Enum):
    """审批策略"""
    NEVER = "never"           # 从不审批（完全自主）
    ALWAYS = "always"         # 总是审批（完全手动）
    HIGH_RISK = "high_risk"   # 仅高风险操作审批
    FIRST_TIME = "first_time" # 首次使用时审批
    CONTEXT_AWARE = "context_aware"  # 基于上下文判断
```

### 5.3 上下文感知的审批

```python
class ContextAwareApproval:
    """上下文感知的审批策略"""
    
    def __init__(self):
        self.risk_assessor = RiskAssessor()
        self.history = ApprovalHistory()
    
    async def should_approve(self, tool_name: str, params: dict, context: dict) -> bool:
        """判断是否需要审批"""
        
        # 1. 评估风险等级
        risk_level = self.risk_assessor.assess(tool_name, params, context)
        
        # 2. 检查历史记录
        similar_approved = self.history.find_similar(tool_name, params)
        
        # 3. 基于策略判断
        if risk_level == RiskLevel.LOW:
            return False  # 低风险不审批
        
        if risk_level == RiskLevel.MEDIUM:
            # 中风险：如果历史上类似操作都被批准，自动批准
            if similar_approved and all(approved for _, approved in similar_approved[-3:]):
                return False
            return True
        
        if risk_level == RiskLevel.HIGH:
            return True  # 高风险总是审批
        
        return True  # 默认审批
```

### 5.4 审批的用户体验

```python
class ApprovalUI:
    """审批用户界面"""
    
    async def request_approval(self, tool_name: str, params: dict, reason: str) -> bool:
        """请求用户审批"""
        
        # 格式化审批请求
        message = f"""
⚠️  Approval Required
━━━━━━━━━━━━━━━━━━━
Tool: {tool_name}
Parameters: {json.dumps(params, indent=2)}
Reason: {reason}

Do you approve this action? (y/n/details)
"""
        
        # 在终端显示
        print(message)
        
        # 等待用户响应
        while True:
            response = input("> ").strip().lower()
            
            if response in ["y", "yes"]:
                return True
            elif response in ["n", "no"]:
                return False
            elif response == "details":
                await self.show_detailed_info(tool_name, params)
            else:
                print("Please enter y/n/details")
```

### 5.5 子代理的审批传递

当子代理需要审批时，审批请求需要传递到主 Agent：

```python
class ApprovalPropagator:
    """审批传播器"""
    
    async def propagate_approval(
        self, 
        subagent: SubAgent, 
        tool_name: str, 
        params: dict
    ) -> bool:
        """将审批请求从子代理传播到主 Agent"""
        
        # 子代理不能直接与用户交互
        # 需要通过主 Agent 进行审批
        
        approval_request = ApprovalRequest(
            source=subagent.id,
            tool=tool_name,
            params=params,
            timestamp=datetime.now()
        )
        
        # 发送到主 Agent 的审批队列
        result = await self.main_agent.request_approval(approval_request)
        
        return result.approved
```

---

## 第六章：嵌套限制与深度控制

### 6.1 为什么限制嵌套深度？

无限制的嵌套会导致：

1. **资源爆炸**：每层嵌套都消耗 API 配额
2. **调试困难**：深层嵌套的错误难以追踪
3. **失控风险**：子代理可能无限创建子代理
4. **延迟增加**：每层嵌套都增加通信开销

### 6.2 深度限制的实现

```python
class SpawnDepthController:
    """生成深度控制器"""
    
    def __init__(self, max_depth: int = 1):
        self.max_depth = max_depth
        self.current_depth = 0
    
    def can_spawn(self) -> bool:
        """检查是否可以生成子代理"""
        return self.current_depth < self.max_depth
    
    def spawn_context(self) -> dict:
        """获取子代理的生成上下文"""
        if not self.can_spawn():
            raise MaxDepthExceededError(
                f"Cannot spawn sub-agent: max depth {self.max_depth} reached"
            )
        
        self.current_depth += 1
        return {
            "depth": self.current_depth,
            "max_depth": self.max_depth,
            "can_spawn": self.current_depth < self.max_depth,
            "role": Role.LEAF if self.current_depth >= self.max_depth else Role.ORCHESTRATOR
        }
```

### 6.3 深度对角色的影响

```
深度 0: 主 Agent (Orchestrator)
  │
  ├── 深度 1: 子代理 A (Orchestrator - 如果 max_depth > 1)
  │     ├── 深度 2: 子代理 A1 (Leaf - 已达最大深度)
  │     └── 深度 2: 子代理 A2 (Leaf - 已达最大深度)
  │
  └── 深度 1: 子代理 B (Leaf - 如果是叶节点任务)
```

---

## 第七章：通信协议

### 7.1 子代理与主代理的通信

```python
@dataclass
class SubAgentMessage:
    """子代理消息格式"""
    id: str                          # 消息 ID
    source: str                      # 来源子代理 ID
    target: str                      # 目标（主代理 ID）
    type: str                        # 消息类型
    content: dict                    # 消息内容
    timestamp: datetime              # 时间戳
    
class MessageType(Enum):
    TASK_RESULT = "task_result"      # 任务结果
    ERROR_REPORT = "error_report"    # 错误报告
    APPROVAL_REQUEST = "approval_request"  # 审批请求
    STATUS_UPDATE = "status_update"  # 状态更新
    RESOURCE_REQUEST = "resource_request"  # 资源请求
```

### 7.2 结果报告格式

```python
@dataclass
class SubAgentResult:
    """子代理执行结果"""
    task_id: str                     # 任务 ID
    agent_id: str                    # 子代理 ID
    status: str                      # success | error | timeout | cancelled
    summary: str                     # 结果摘要
    output: Optional[str] = None     # 完整输出
    error: Optional[str] = None      # 错误信息
    token_usage: dict = None         # Token 使用统计
    duration: float = 0              # 执行时长（秒）
    metadata: dict = None            # 额外元数据
```

### 7.3 错误传播

```python
class ErrorPropagator:
    """错误传播器"""
    
    def propagate(self, error: Exception, subagent_id: str, task_id: str):
        """将子代理的错误传播到主代理"""
        
        error_report = SubAgentMessage(
            id=generate_id(),
            source=subagent_id,
            target="main_agent",
            type=MessageType.ERROR_REPORT,
            content={
                "task_id": task_id,
                "error_type": type(error).__name__,
                "error_message": str(error),
                "traceback": traceback.format_exc(),
                "recoverable": self.is_recoverable(error),
            },
            timestamp=datetime.now()
        )
        
        return error_report
    
    def is_recoverable(self, error: Exception) -> bool:
        """判断错误是否可恢复"""
        recoverable_errors = [
            TimeoutError,
            ConnectionError,
            RateLimitError,
        ]
        return any(isinstance(error, e) for e in recoverable_errors)
```

---

## 第八章：实际应用场景

### 8.1 场景一：并行代码分析

```python
# 主 Agent 的 prompt
"""
分析以下 5 个代码仓库的代码质量：
1. /repos/backend-api
2. /repos/frontend-app
3. /repos/mobile-app
4. /repos/shared-lib
5. /repos/devops-scripts

对每个仓库：
- 检查代码风格一致性
- 分析潜在的 bug
- 评估测试覆盖率
- 提供改进建议

最后生成综合报告。
"""

# 执行方式
async def analyze_repos(repos: List[str]):
    # 创建 5 个 Leaf 子代理并行分析
    tasks = []
    for repo in repos:
        tasks.append({
            "goal": f"分析 {repo} 的代码质量",
            "toolsets": ["terminal", "file"],
            "context": f"仓库路径: {repo}"
        })
    
    results = await delegate_task(tasks=tasks)
    
    # 汇总结果
    report = aggregate_analysis(results)
    return report
```

### 8.2 场景二：多系统集成测试

```python
# 测试多个微服务的集成
async def integration_test():
    tasks = [
        {
            "goal": "测试用户服务的注册和登录功能",
            "toolsets": ["terminal", "web"],
        },
        {
            "goal": "测试订单服务的创建和查询功能",
            "toolsets": ["terminal", "web"],
        },
        {
            "goal": "测试支付服务的扣款和退款功能",
            "toolsets": ["terminal", "web"],
        },
    ]
    
    results = await delegate_task(tasks=tasks)
    
    # 检查所有服务的集成
    if all(r["status"] == "success" for r in results):
        print("✅ 所有集成测试通过")
    else:
        print("❌ 部分集成测试失败")
```

### 8.3 场景三：文档生成流水线

```python
# 生成项目的完整文档
async def generate_docs(project_path: str):
    # Orchestrator 子代理协调整个流程
    orchestrator = create_subagent(
        role=Role.ORCHESTRATOR,
        prompt=f"为 {project_path} 生成完整文档"
    )
    
    # Orchestrator 会自动分解任务：
    # 1. Leaf A: 分析代码结构
    # 2. Leaf B: 提取 API 文档
    # 3. Leaf C: 生成 README
    # 4. Leaf D: 生成 CHANGELOG
    
    result = await orchestrator.execute()
    return result
```

### 8.4 场景四：批量数据处理

```python
# 处理多个数据文件
async def process_data_files(files: List[str]):
    tasks = []
    for file in files:
        tasks.append({
            "goal": f"处理数据文件 {file}：清洗、转换、验证",
            "toolsets": ["terminal", "file"],
            "context": f"文件路径: {file}"
        })
    
    # 分批处理，每批最多 3 个并发
    results = []
    for batch in chunks(tasks, 3):
        batch_results = await delegate_task(tasks=batch)
        results.extend(batch_results)
    
    return results
```

---

## 第九章：性能优化

### 9.1 子代理复用

```python
class SubAgentPool:
    """子代理池：复用子代理实例"""
    
    def __init__(self, max_pool_size=10):
        self.pool = {}
        self.max_pool_size = max_pool_size
    
    async def acquire(self, role: Role, context: dict) -> SubAgent:
        """获取子代理（优先从池中取）"""
        pool_key = self._get_pool_key(role, context)
        
        if pool_key in self.pool and self.pool[pool_key]:
            agent = self.pool[pool_key].pop()
            agent.reset()  # 重置状态
            return agent
        
        # 池中没有，创建新的
        return create_subagent(role, context)
    
    async def release(self, agent: SubAgent):
        """释放子代理回池"""
        pool_key = self._get_pool_key(agent.role, agent.context)
        
        if pool_key not in self.pool:
            self.pool[pool_key] = []
        
        if len(self.pool[pool_key]) < self.max_pool_size:
            self.pool[pool_key].append(agent)
```

### 9.2 结果缓存

```python
class ResultCache:
    """结果缓存"""
    
    def __init__(self, ttl=3600):
        self.cache = {}
        self.ttl = ttl
    
    def get(self, task_hash: str) -> Optional[SubAgentResult]:
        """获取缓存的结果"""
        if task_hash in self.cache:
            result, timestamp = self.cache[task_hash]
            if (datetime.now() - timestamp).seconds < self.ttl:
                return result
        return None
    
    def set(self, task_hash: str, result: SubAgentResult):
        """缓存结果"""
        self.cache[task_hash] = (result, datetime.now())
```

---

## 第十章：最佳实践

### 10.1 子代理设计原则

```python
# ✅ 好的设计：单一职责
tasks = [
    {"goal": "分析代码结构", ...},
    {"goal": "生成测试用例", ...},
    {"goal": "编写文档", ...},
]

# ❌ 不好的设计：职责不清
tasks = [
    {"goal": "做所有事情", ...},
]
```

### 10.2 工具集选择

```python
# ✅ 好的选择：最小必要工具
toolsets = ["terminal", "file"]  # 只给需要的工具

# ❌ 不好的选择：过度授权
toolsets = ["terminal", "file", "web", "browser", "discord", "send_message"]
```

### 10.3 错误处理

```python
# ✅ 好的错误处理
results = await delegate_task(tasks=tasks)
for i, result in enumerate(results):
    if result["status"] == "failed":
        logger.error(f"Task {i} failed: {result['error']}")
        # 重试或降级处理

# ❌ 不好的错误处理
results = await delegate_task(tasks=tasks)
# 假设所有任务都成功了...
```

---

## 总结

Hermes 的子代理架构通过以下设计实现了高效、安全的多 Agent 协作：

1. **Leaf vs Orchestrator 角色模型**：清晰的职责划分，Leaf 专注于执行，Orchestrator 专注于协调
2. **工具屏蔽机制**：多层级的安全防护，确保子代理只能访问必要的工具
3. **审批策略**：灵活的审批机制，从完全自主到完全手动，支持上下文感知
4. **深度控制**：防止子代理无限嵌套，确保系统稳定性
5. **通信协议**：标准化的消息格式和错误传播机制

这套架构使得 Hermes 能够高效地处理复杂的多步骤任务，同时保持安全性和可控性。在 AI Agent 越来越复杂的今天，这种子代理架构将成为构建可靠 Agent 系统的关键基础设施。

## 相关阅读

- [Hermes Cron 调度器深度剖析：agent-native 调度 vs shell cron 的本质区别](/post/hermes-security-model-cron-context-subagent-isolation-prompt-injection/)
- [Hermes Skill vs Plugin 扩展点对比：什么时候用 Skill，什么时候用 Plugin？](/post/hermes-skill-plugin/)
- [AI Agent 编排模式实战：ReAct/Plan-and-Execute/Multi-Agent 协作架构设计](/post/ai-agent-orchestration-patterns-react-plan-execute-multi-agent/)

---

*本文基于 Hermes Agent v0.4.x 架构分析，相关 API 可能随版本迭代而变化。*
