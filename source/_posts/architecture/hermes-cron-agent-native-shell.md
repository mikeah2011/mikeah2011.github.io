---

title: Hermes Cron 调度器深度剖析：agent-native 调度 vs shell cron 的本质区别
keywords: [Hermes Cron, agent, native, vs shell cron, 调度器深度剖析, 调度, 的本质区别]
date: 2026-06-02 00:00:00
description: 深度对比 Hermes Agent-Native Cron 调度器与传统 Shell Cron 的本质区别。从任务模型、上下文继承、触发方式、资源管理、错误处理六大维度展开分析，详解声明式 YAML 配置、时间轮调度、事件驱动触发、API 配额感知、优先级队列等核心实现，附完整代码示例与架构图，帮助开发者理解 AI Agent 时代调度系统的设计范式演进。
tags:
- Hermes
- Cron
- 调度器
- AI Agent
- 自动化
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---




# Hermes Cron 调度器深度剖析：agent-native 调度 vs shell cron 的本质区别

## 前言

几乎每个开发者都用过 cron。`0 2 * * * /usr/bin/backup.sh` —— 这种简洁的时间表达式已经统治了任务调度领域几十年。但当你需要调度的不是 shell 脚本，而是一个 AI Agent 的对话会话时，传统 cron 的模型就显得力不从心了。

Hermes Agent 引入了一种全新的调度范式：**agent-native scheduling**。本文将深入分析这种范式的设计理念、技术实现，以及它与传统 shell cron 的本质区别。

---

## 第一章：传统 Cron 的局限性

### 1.1 Shell Cron 的工作模型

传统 cron 的模型极其简单：

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  crontab    │────▶│  cron 守护   │────▶│  执行命令    │
│  定义任务    │     │  进程       │     │  (fork+exec) │
└─────────────┘     └─────────────┘     └─────────────┘
```

```bash
# crontab 示例
0 2 * * * /usr/bin/backup.sh >> /var/log/backup.log 2>&1
*/5 * * * * /usr/bin/check_health.sh
0 9 * * 1 /usr/bin/weekly_report.sh
```

这个模型的假设：

1. **任务是无状态的**：每次执行都是独立的，不依赖之前的执行结果
2. **输入是固定的**：任务的参数在 crontab 中写死
3. **输出是日志**：结果写入文件或发送邮件
4. **没有上下文**：每次执行不知道之前发生了什么

### 1.2 AI Agent 调度的需求

当调度对象从 shell 脚本变为 AI Agent 时，需求发生了根本变化：

| 维度 | Shell 脚本 | AI Agent |
|------|-----------|----------|
| 状态 | 无状态 | 有对话历史 |
| 上下文 | 无 | 需要加载上下文 |
| 执行模式 | 一次性运行 | 持续对话 |
| 输入 | 命令行参数 | 自然语言 prompt |
| 输出 | stdout/stderr | 对话结果 |
| 错误处理 | 退出码 | 语义理解 |
| 资源消耗 | CPU/内存 | CPU/内存/API 配额 |

### 1.3 传统 cron 调度 Agent 的痛点

如果强行用 shell cron 调度 Agent：

```bash
# 痛点 1：无法传递上下文
0 9 * * * hermes run "检查昨天的部署状态" --profile work

# 痛点 2：无法处理多轮对话
0 10 * * * hermes run "分析代码库并生成报告" 
# 这可能需要多轮交互，但 cron 无法处理

# 痛点 3：无法基于条件触发
# cron 只能基于时间，无法基于事件

# 痛点 4：资源竞争
# 多个 cron 任务同时运行时，可能争抢 API 配额
```

---

## 第二章：Agent-Native 调度的设计理念

### 2.1 核心思想

Agent-native scheduling 的核心思想是：**调度器本身就是一个 Agent 组件**，而不是外部的系统工具。

```
┌──────────────────────────────────────────┐
│              Hermes Agent                │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ 对话引擎  │  │ 工具系统  │  │ Cron   │ │
│  │          │  │          │  │ 调度器  │ │
│  └──────────┘  └──────────┘  └────────┘ │
│                      ▲            │      │
│                      │            ▼      │
│               ┌──────────────────────┐   │
│               │    Agent 上下文      │   │
│               │  (对话历史、工具、    │   │
│               │   配置、Profile)     │   │
│               └──────────────────────┘   │
└──────────────────────────────────────────┘
```

关键区别：

1. **调度器是 Agent 的一部分**：不是外部进程，而是 Agent 的内部组件
2. **任务是 Agent 会话**：不是 shell 命令，而是完整的 Agent 对话
3. **上下文自动继承**：任务自动获得当前 Profile 的配置和技能
4. **结果是 Agent 输出**：不是日志，而是结构化的对话结果

### 2.2 设计原则

Hermes Cron 调度器遵循以下设计原则：

**原则一：声明式配置**

```yaml
# ~/.hermes/cron/jobs.yaml
jobs:
  daily-standup:
    schedule: "0 9 * * 1-5"  # 工作日早上 9 点
    prompt: "帮我生成今天的 standup 报告，包含昨天的 git 提交和今天的计划"
    profile: work
    notify: slack
    
  weekly-report:
    schedule: "0 17 * * 5"   # 周五下午 5 点
    prompt: "生成本周的工作总结报告"
    profile: work
    timeout: 300
```

**原则二：上下文感知**

```yaml
backup-check:
  schedule: "0 8 * * *"
  prompt: "检查昨晚的数据库备份是否成功，如果有问题立即通知"
  context:
    load_skills: ["database-admin", "notification"]
    env:
      DB_HOST: "prod-db.example.com"
```

**原则三：结果驱动**

```yaml
api-health:
  schedule: "*/5 * * * *"
  prompt: "检查 API 健康状态"
  on_success:
    silent: true  # 成功时不通知
  on_failure:
    notify: slack
    retry: 3
```

### 2.3 与 Shell Cron 的本质区别

| 特性 | Shell Cron | Agent-Native Cron |
|------|-----------|-------------------|
| 任务本质 | 系统命令 | Agent 会话 |
| 上下文 | 无 | 完整的 Agent 上下文 |
| 输入方式 | 命令行参数 | 自然语言 prompt |
| 输出格式 | 文本日志 | 结构化结果 |
| 错误处理 | 退出码 | 语义理解 |
| 依赖管理 | 手动 | 自动（Profile/技能） |
| 触发方式 | 仅时间 | 时间 + 事件 + 条件 |
| 资源管理 | 无 | API 配额感知 |

---

## 第三章：Hermes Cron 的技术实现

### 3.1 调度器架构

```
┌─────────────────────────────────────────────┐
│              Hermes Cron Scheduler           │
│                                             │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 时间轮   │  │ 事件监听  │  │ 条件评估  │  │
│  │ (Timer  │  │ (Event   │  │ (Condition│  │
│  │  Wheel) │  │  Listener│  │  Evaluator│  │
│  └────┬────┘  └────┬─────┘  └─────┬─────┘  │
│       │            │              │         │
│       ▼            ▼              ▼         │
│  ┌─────────────────────────────────────┐    │
│  │         Job Queue (优先级队列)       │    │
│  └─────────────────┬───────────────────┘    │
│                    │                        │
│                    ▼                        │
│  ┌─────────────────────────────────────┐    │
│  │      Execution Engine               │    │
│  │  ┌──────────┐  ┌───────────────┐   │    │
│  │  │ Session  │  │ Context       │   │    │
│  │  │ Manager  │  │ Loader        │   │    │
│  │  └──────────┘  └───────────────┘   │    │
│  └─────────────────────────────────────┘    │
│                    │                        │
│                    ▼                        │
│  ┌─────────────────────────────────────┐    │
│  │      Result Handler                 │    │
│  │  ┌──────┐  ┌──────┐  ┌──────────┐ │    │
│  │  │ Notify│  │ Store│  │ Trigger  │ │    │
│  │  └──────┘  └──────┘  └──────────┘ │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### 3.2 Job 定义格式

```python
@dataclass
class CronJob:
    """Hermes Cron Job 定义"""
    name: str                           # 任务名称
    schedule: str                       # Cron 表达式或事件触发器
    prompt: str                         # Agent 提示词
    profile: str = "default"            # 使用的 Profile
    timeout: int = 300                  # 超时时间（秒）
    max_retries: int = 0                # 最大重试次数
    
    # 触发配置
    trigger_type: str = "schedule"      # schedule | event | condition
    event_filter: Optional[dict] = None # 事件过滤器
    condition: Optional[str] = None     # 条件表达式
    
    # 上下文配置
    load_skills: List[str] = field(default_factory=list)
    load_plugins: List[str] = field(default_factory=list)
    env: Dict[str, str] = field(default_factory=dict)
    
    # 结果处理
    on_success: dict = field(default_factory=lambda: {"silent": False})
    on_failure: dict = field(default_factory=lambda: {"notify": "default"})
    output_format: str = "text"         # text | json | markdown
```

### 3.3 调度表达式

Hermes Cron 支持多种调度表达式：

```yaml
# 1. 标准 Cron 表达式
schedule: "0 2 * * *"           # 每天凌晨 2 点
schedule: "*/5 * * * *"         # 每 5 分钟
schedule: "0 9 * * 1-5"         # 工作日早上 9 点

# 2. 自然语言（由 Agent 解释）
schedule: "every day at 9am"
schedule: "every Monday morning"
schedule: "after each deployment"

# 3. 事件触发
trigger: event
event_filter:
  type: "deployment_complete"
  environment: "production"

# 4. 条件触发
trigger: condition
condition: "api_error_rate > 0.05"
check_interval: 60  # 每 60 秒检查一次
```

### 3.4 会话管理

每个 Cron Job 执行时，会创建一个独立的 Agent 会话：

```python
class CronSessionManager:
    """管理 Cron Job 的 Agent 会话"""
    
    async def create_session(self, job: CronJob) -> Session:
        """为 Cron Job 创建会话"""
        # 1. 加载 Profile 配置
        profile = load_profile(job.profile)
        
        # 2. 加载指定的技能
        skills = []
        for skill_name in job.load_skills:
            skill = load_skill(skill_name)
            skills.append(skill)
        
        # 3. 创建会话
        session = Session(
            profile=profile,
            skills=skills,
            context=job.env,
            is_cron=True,
            job_name=job.name
        )
        
        # 4. 注入 Cron 特有的系统提示
        session.add_system_message(
            f"You are running as a scheduled cron job named '{job.name}'. "
            f"Execute the task described in the prompt autonomously. "
            f"Do not ask for user confirmation unless the task explicitly requires it."
        )
        
        return session
    
    async def execute_job(self, job: CronJob) -> JobResult:
        """执行 Cron Job"""
        session = await self.create_session(job)
        
        try:
            # 发送 prompt 并等待完整响应
            response = await session.chat(
                job.prompt,
                timeout=job.timeout
            )
            
            return JobResult(
                job_name=job.name,
                status="success",
                output=response.content,
                token_usage=response.usage,
                duration=response.duration
            )
            
        except TimeoutError:
            return JobResult(
                job_name=job.name,
                status="timeout",
                error=f"Job timed out after {job.timeout}s"
            )
        except Exception as e:
            return JobResult(
                job_name=job.name,
                status="error",
                error=str(e)
            )
        finally:
            await session.close()
```

### 3.5 时间轮实现

Hermes 使用时间轮（Timing Wheel）算法来高效管理大量定时任务：

```python
class TimingWheel:
    """时间轮调度器"""
    
    def __init__(self, tick_interval=1, wheel_size=60):
        self.tick_interval = tick_interval  # 每 tick 的秒数
        self.wheel_size = wheel_size        # 轮的槽数
        self.wheel = [[] for _ in range(wheel_size)]
        self.current_slot = 0
        self.overflow_wheel = None
    
    def add_job(self, job: CronJob, next_run: datetime):
        """添加任务到时间轮"""
        delay = (next_run - datetime.now()).total_seconds()
        ticks = int(delay / self.tick_interval)
        
        if ticks < self.wheel_size:
            # 放入当前轮
            slot = (self.current_slot + ticks) % self.wheel_size
            self.wheel[slot].append(job)
        else:
            # 放入溢出轮
            if not self.overflow_wheel:
                self.overflow_wheel = TimingWheel(
                    self.tick_interval * self.wheel_size,
                    self.wheel_size
                )
            self.overflow_wheel.add_job(job, next_run)
    
    def tick(self) -> List[CronJob]:
        """推进一个 tick，返回需要执行的任务"""
        self.current_slot = (self.current_slot + 1) % self.wheel_size
        jobs = self.wheel[self.current_slot]
        self.wheel[self.current_slot] = []
        
        # 从溢出轮补充
        if self.overflow_wheel:
            overflow_jobs = self.overflow_wheel.tick()
            for job in overflow_jobs:
                self.add_job(job, job.next_run)
        
        return jobs
```

---

## 第四章：事件驱动调度

### 4.1 事件系统

Hermes 的事件系统允许 Cron Job 基于事件触发，而不是时间：

```python
class EventBus:
    """事件总线"""
    
    def __init__(self):
        self.listeners = defaultdict(list)
        self.history = deque(maxlen=1000)
    
    def emit(self, event_type: str, data: dict):
        """发射事件"""
        event = Event(
            type=event_type,
            data=data,
            timestamp=datetime.now()
        )
        self.history.append(event)
        
        for listener in self.listeners[event_type]:
            asyncio.create_task(listener.handle(event))
    
    def on(self, event_type: str, listener: Callable):
        """注册事件监听器"""
        self.listeners[event_type].append(listener)
```

### 4.2 事件触发示例

```yaml
# 部署完成后自动检查
deploy-check:
  trigger: event
  event_filter:
    type: "deployment_complete"
    environment: "production"
  prompt: |
    部署刚刚完成，版本: {{ event.version }}
    请执行以下检查：
    1. API 健康检查
    2. 核心功能冒烟测试
    3. 错误日志检查
    4. 性能指标对比

# 代码合并后自动审查
code-review:
  trigger: event
  event_filter:
    type: "pull_request_merged"
    branch: "main"
  prompt: |
    PR #{{ event.pr_number }} 已合并到 main
    请审查合并的代码变更，检查：
    1. 潜在的 bug
    2. 安全问题
    3. 性能影响
```

### 4.3 条件触发

```yaml
# API 错误率告警
api-alert:
  trigger: condition
  condition: |
    metrics.api_error_rate > 0.05 
    OR metrics.response_time_p99 > 2000
  check_interval: 60
  prompt: |
    API 指标异常：
    - 错误率: {{ metrics.api_error_rate }}
    - P99 延迟: {{ metrics.response_time_p99 }}ms
    请分析原因并提供修复建议。
  cooldown: 300  # 触发后 5 分钟内不重复触发
```

---

## 第五章：资源管理与配额

### 5.1 API 配额感知

AI Agent 的执行成本主要来自 LLM API 调用。Hermes Cron 调度器内置了配额管理：

```python
class QuotaManager:
    """API 配额管理器"""
    
    def __init__(self, config):
        self.daily_limit = config.get("daily_token_limit", 1000000)
        self.monthly_limit = config.get("monthly_token_limit", 30000000)
        self.daily_usage = 0
        self.monthly_usage = 0
        self.job_priorities = config.get("job_priorities", {})
    
    async def check_quota(self, job: CronJob) -> bool:
        """检查是否有足够的配额执行任务"""
        estimated_tokens = self.estimate_tokens(job)
        
        if self.daily_usage + estimated_tokens > self.daily_limit:
            if job.priority == "critical":
                # 关键任务仍然执行，但记录超额
                logger.warning(f"Job '{job.name}' exceeds daily quota but is critical")
                return True
            return False
        
        return True
    
    def estimate_tokens(self, job: CronJob) -> int:
        """估算任务的 token 消耗"""
        # 基于 prompt 长度和历史执行数据
        base_estimate = len(job.prompt) * 2  # 粗略估算
        historical = self.get_historical_usage(job.name)
        return max(base_estimate, historical)
```

### 5.2 优先级队列

```python
class PriorityJobQueue:
    """优先级任务队列"""
    
    def __init__(self):
        self.queue = []
        self.priority_weights = {
            "critical": 0,
            "high": 1,
            "normal": 2,
            "low": 3
        }
    
    def enqueue(self, job: CronJob):
        """入队"""
        heapq.heappush(self.queue, (
            self.priority_weights.get(job.priority, 2),
            job.next_run.timestamp(),
            job
        ))
    
    def dequeue(self) -> Optional[CronJob]:
        """出队"""
        if self.queue:
            _, _, job = heapq.heappop(self.queue)
            return job
        return None
```

### 5.3 并发控制

```python
class ConcurrencyController:
    """并发控制器"""
    
    def __init__(self, max_concurrent=3):
        self.max_concurrent = max_concurrent
        self.running_jobs = {}
        self.semaphore = asyncio.Semaphore(max_concurrent)
    
    async def execute_with_limit(self, job: CronJob) -> JobResult:
        """带并发限制的任务执行"""
        async with self.semaphore:
            self.running_jobs[job.name] = datetime.now()
            try:
                result = await self.execute_job(job)
                return result
            finally:
                del self.running_jobs[job.name]
    
    def get_running_jobs(self) -> Dict[str, datetime]:
        """获取正在运行的任务"""
        return self.running_jobs.copy()
```

---

## 第六章：错误处理与重试

### 6.1 错误分类

```python
class JobError(Enum):
    """任务错误类型"""
    TIMEOUT = "timeout"              # 执行超时
    API_ERROR = "api_error"          # LLM API 错误
    QUOTA_EXCEEDED = "quota_exceeded" # 配额超限
    CONTEXT_ERROR = "context_error"  # 上下文加载失败
    TOOL_ERROR = "tool_error"        # 工具执行错误
    UNKNOWN = "unknown"              # 未知错误
```

### 6.2 重试策略

```python
class RetryPolicy:
    """重试策略"""
    
    def __init__(self, max_retries=3, backoff="exponential"):
        self.max_retries = max_retries
        self.backoff = backoff
    
    def should_retry(self, error: JobError, attempt: int) -> bool:
        """判断是否应该重试"""
        if attempt >= self.max_retries:
            return False
        
        # 某些错误不重试
        non_retryable = [JobError.QUOTA_EXCEEDED, JobError.CONTEXT_ERROR]
        if error in non_retryable:
            return False
        
        return True
    
    def get_delay(self, attempt: int) -> float:
        """获取重试延迟"""
        if self.backoff == "exponential":
            return min(2 ** attempt, 300)  # 最大 5 分钟
        elif self.backoff == "linear":
            return attempt * 60  # 每次增加 1 分钟
        else:
            return 60  # 固定 1 分钟
```

### 6.3 熔断机制

```python
class CircuitBreaker:
    """熔断器：防止失败任务反复执行"""
    
    def __init__(self, failure_threshold=5, reset_timeout=300):
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self.failure_count = 0
        self.last_failure_time = None
        self.state = "closed"  # closed | open | half-open
    
    def record_failure(self):
        """记录失败"""
        self.failure_count += 1
        self.last_failure_time = datetime.now()
        
        if self.failure_count >= self.failure_threshold:
            self.state = "open"
            logger.warning(f"Circuit breaker opened after {self.failure_count} failures")
    
    def can_execute(self) -> bool:
        """检查是否可以执行"""
        if self.state == "closed":
            return True
        
        if self.state == "open":
            # 检查是否到了半开时间
            if (datetime.now() - self.last_failure_time).seconds > self.reset_timeout:
                self.state = "half-open"
                return True
            return False
        
        # half-open 状态允许尝试一次
        return True
    
    def record_success(self):
        """记录成功"""
        self.failure_count = 0
        self.state = "closed"
```

---

## 第七章：结果处理与通知

### 7.1 结果格式化

```python
class ResultFormatter:
    """结果格式化器"""
    
    @staticmethod
    def format_for_slack(result: JobResult) -> dict:
        """Slack 格式"""
        color = "good" if result.status == "success" else "danger"
        return {
            "attachments": [{
                "color": color,
                "title": f"Cron Job: {result.job_name}",
                "fields": [
                    {"title": "Status", "value": result.status, "short": True},
                    {"title": "Duration", "value": f"{result.duration}s", "short": True},
                    {"title": "Output", "value": result.output[:1000]}
                ],
                "footer": f"Tokens: {result.token_usage.total}"
            }]
        }
    
    @staticmethod
    def format_for_email(result: JobResult) -> str:
        """邮件格式"""
        return f"""
Cron Job Report: {result.job_name}
==============================
Status: {result.status}
Time: {result.timestamp}
Duration: {result.duration}s

Output:
{result.output}

Token Usage:
- Input: {result.token_usage.input}
- Output: {result.token_usage.output}
- Total: {result.token_usage.total}
"""
```

### 7.2 通知路由

```yaml
notifications:
  slack:
    webhook: ${SLACK_WEBHOOK_URL}
    channel: "#hermes-cron"
  
  email:
    smtp_host: "smtp.example.com"
    from: "hermes@example.com"
    to: "admin@example.com"
  
  discord:
    webhook: ${DISCORD_WEBHOOK_URL}

jobs:
  daily-report:
    schedule: "0 9 * * *"
    on_success:
      notify: slack
    on_failure:
      notify: [slack, email]  # 失败时同时通知
```

---

## 第八章：监控与调试

### 8.1 执行历史

```python
class JobHistory:
    """任务执行历史"""
    
    def __init__(self, storage_path="~/.hermes/cron/history.db"):
        self.db = sqlite3.connect(storage_path)
        self._init_schema()
    
    def record(self, result: JobResult):
        """记录执行结果"""
        self.db.execute("""
            INSERT INTO job_history 
            (job_name, status, timestamp, duration, token_usage, output, error)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            result.job_name,
            result.status,
            result.timestamp,
            result.duration,
            json.dumps(result.token_usage),
            result.output,
            result.error
        ))
        self.db.commit()
    
    def get_stats(self, job_name: str, days: int = 30) -> dict:
        """获取统计信息"""
        cursor = self.db.execute("""
            SELECT 
                COUNT(*) as total_runs,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
                AVG(duration) as avg_duration,
                SUM(token_usage) as total_tokens
            FROM job_history
            WHERE job_name = ? AND timestamp > datetime('now', ?)
        """, (job_name, f"-{days} days"))
        
        return dict(cursor.fetchone())
```

### 8.2 调试命令

```bash
# 查看所有任务
hermes cron list

# 查看任务详情
hermes cron inspect daily-report

# 手动触发任务
hermes cron run daily-report

# 查看执行历史
hermes cron history daily-report --days 7

# 查看任务日志
hermes cron logs daily-report --follow

# 验证 Cron 表达式
hermes cron validate "0 9 * * 1-5"
# Output: "Every weekday at 9:00 AM"

# 模拟执行（不实际运行）
hermes cron dry-run daily-report
```

### 8.3 健康检查

```python
class CronHealthCheck:
    """Cron 调度器健康检查"""
    
    def check(self) -> dict:
        return {
            "scheduler_running": self.is_scheduler_running(),
            "active_jobs": self.get_active_job_count(),
            "queue_depth": self.get_queue_depth(),
            "running_jobs": self.get_running_jobs(),
            "recent_failures": self.get_recent_failures(),
            "quota_remaining": self.get_quota_remaining(),
            "last_tick_time": self.get_last_tick_time()
        }
```

---

## 第九章：与外部调度器的集成

### 9.1 与系统 Cron 的对比

```bash
# 系统 crontab
crontab -e
0 2 * * * /usr/bin/backup.sh

# Hermes Cron
hermes cron add daily-backup --schedule "0 2 * * *" --prompt "执行数据库备份"
```

| 方面 | 系统 Cron | Hermes Cron |
|------|----------|-------------|
| 配置方式 | crontab 文件 | YAML 配置 |
| 任务类型 | Shell 命令 | Agent 会话 |
| 日志管理 | syslog/文件 | 内置历史 |
| 监控 | 无 | 内置健康检查 |
| 重试 | 无 | 内置重试机制 |
| 通知 | 邮件 | Slack/Email/Discord |

### 9.2 与 Kubernetes CronJob 的对比

```yaml
# Kubernetes CronJob
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-report
spec:
  schedule: "0 9 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: report
            image: hermes-cli:latest
            command: ["hermes", "run", "生成日报"]

# Hermes Cron（更简洁）
hermes cron add daily-report \
  --schedule "0 9 * * *" \
  --prompt "生成日报"
```

### 9.3 与 GitHub Actions 的集成

```yaml
# .github/workflows/hermes-cron.yml
name: Hermes Cron Jobs
on:
  schedule:
    - cron: '0 9 * * 1-5'

jobs:
  daily-standup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Hermes Job
        run: |
          hermes cron run daily-standup
```

---

## 第十章：最佳实践

### 10.1 Job 设计原则

```yaml
# ✅ 好的设计
jobs:
  api-health-check:
    schedule: "*/5 * * * *"
    prompt: |
      检查 API 健康状态：
      1. GET /health
      2. 检查响应时间
      3. 检查错误率
    timeout: 60
    on_success:
      silent: true  # 正常时不打扰
    on_failure:
      notify: slack

# ❌ 不好的设计
jobs:
  do-everything:
    schedule: "0 * * * *"
    prompt: "检查所有系统状态并生成报告"
    timeout: 3600  # 超长超时说明任务太大
```

### 10.2 Prompt 编写指南

```yaml
# ✅ 好的 prompt：具体、可执行、有输出格式
prompt: |
  检查今天的部署状态：
  1. 运行 `kubectl get pods -n production` 检查 Pod 状态
  2. 运行 `kubectl top pods -n production` 检查资源使用
  3. 检查最近 10 分钟的错误日志
  
  输出格式：
  - 如果一切正常：输出 "✅ 部署状态正常"
  - 如果有问题：列出具体问题和建议

# ❌ 不好的 prompt：模糊、不可执行
prompt: "检查一下系统有没有问题"
```

### 10.3 资源配额建议

```yaml
quota:
  daily_token_limit: 500000
  monthly_token_limit: 15000000
  
  job_limits:
    max_concurrent: 3
    max_daily_runs: 100
    
  priority_groups:
    critical:
      reserved_quota: 0.2  # 20% 配额预留给关键任务
    normal:
      shared_quota: 0.8
```

---

## 总结

Hermes 的 Agent-Native Cron 调度器相比传统 shell cron 有以下本质区别：

1. **任务是 Agent 会话**，不是 shell 命令
2. **上下文自动继承**，不需要手动配置环境
3. **触发方式多样化**：时间、事件、条件
4. **内置资源管理**：配额感知、优先级队列、并发控制
5. **智能错误处理**：重试、熔断、语义错误分析
6. **结果驱动**：格式化输出、多渠道通知

这些特性使得 Hermes Cron 不仅仅是一个"定时执行器"，而是一个真正的"智能调度系统"。在 AI Agent 日益融入工作流的今天，这种 agent-native 的调度范式将成为标配。

## 相关阅读

- [Hermes 子代理架构：leaf vs orchestrator 角色模型、工具屏蔽、审批策略](/post/hermes-leaf-orchestrator/)
- [Hermes 技能同步机制：bundled skills → user space 的增量同步与用户修改保留策略](/post/hermes-bundled-skills-user-space/)
- [Hermes Skill vs Plugin 扩展点对比：什么时候用 Skill，什么时候用 Plugin？](/post/hermes-skill-plugin/)

---

*本文基于 Hermes Agent v0.4.x 架构分析，相关 API 可能随版本迭代而变化。*
