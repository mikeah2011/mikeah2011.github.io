# Agent 多租户架构

## 定义

Agent 多租户架构是指在 SaaS 场景下，为多个租户（Tenant）提供隔离的 AI Agent 服务，包括数据隔离、模型路由、用量计量和按租户计费的工程化方案。

## 核心原理

### 三种隔离模式

| 模式 | 隔离级别 | 成本 | 适用场景 |
|------|---------|------|---------|
| 共享模型 + 行级隔离 | 应用层 | 低 | 中小租户 |
| 按租户路由模型 | 模型层 | 中 | 不同 SLA 租户 |
| 独立部署 | 基础设施层 | 高 | 大客户/合规要求 |

### 数据隔离

```php
// Laravel 行级隔离
class TenantScopes implements TenantAware
{
    public function applyScope($builder)
    {
        $builder->where('tenant_id', tenant()->id);
    }
}

// 向量数据库隔离
// 方案1：按租户创建独立 Collection
// 方案2：共享 Collection + metadata 过滤
$embedding = EmbeddingService::create($text);
VectorDB::search($embedding, [
    'filter' => ['tenant_id' => tenant()->id],
    'top_k' => 10
]);
```

### LLM Token 计量与计费

```python
class TokenMeter:
    def record(self, tenant_id, model, tokens_in, tokens_out):
        cost = self.calculate_cost(model, tokens_in, tokens_out)
        DB.table('token_usage').insert({
            'tenant_id': tenant_id,
            'model': model,
            'input_tokens': tokens_in,
            'output_tokens': tokens_out,
            'cost_usd': cost,
            'created_at': now()
        })
    
    def calculate_cost(self, model, tokens_in, tokens_out):
        prices = {
            'gpt-4o': (0.005, 0.015),      # per 1K tokens
            'gpt-3.5-turbo': (0.0005, 0.0015),
            'claude-3.5-sonnet': (0.003, 0.015),
        }
        p_in, p_out = prices[model]
        return (tokens_in * p_in + tokens_out * p_out) / 1000
```

### 按租户模型路由

```python
class TenantModelRouter:
    def route(self, tenant_id, task_type):
        config = TenantConfig::get(tenant_id)
        
        # 免费租户 → 便宜模型
        if config.plan == 'free':
            return 'gpt-3.5-turbo'
        
        # 专业租户 → 按任务类型选择
        if config.plan == 'pro':
            return {
                'simple_query': 'gpt-3.5-turbo',
                'complex_reasoning': 'gpt-4o',
                'code_generation': 'claude-3.5-sonnet'
            }.get(task_type, 'gpt-3.5-turbo')
        
        # 企业租户 → 自定义模型
        return config.custom_model
```

### 速率限制

按租户维度的多级限流：

```
全局限流（API 总量）
    ↓
租户限流（每租户 QPS）
    ↓
用户限流（每用户 QPS）
    ↓
接口限流（敏感接口额外限制）
```

## 实战案例

来自博客文章：
- [AI Agent 多租户实战](/2026/06/05/AI-Agent-多租户实战/) - SaaS 场景下的隔离与计量

## 相关概念

- [Agent 成本优化](Agent成本优化.md) - 租户级别的成本控制
- [Agent 安全与护栏](Agent安全与护栏.md) - 租户级别的安全隔离
- [Agent 流式响应](Agent流式响应.md) - 流式响应的用量计量

## 常见问题

### Q: 共享模型如何防止租户间数据泄露？
系统提示中注入租户上下文 + 向量检索时强制租户过滤 + 输出 PII 检测。

### Q: Token 计量精度怎么保证？
使用 LLM API 返回的 usage 字段（最准确），备选方案是 Tokenizer 估算。
