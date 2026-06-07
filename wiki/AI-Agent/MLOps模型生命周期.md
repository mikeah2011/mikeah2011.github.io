# MLOps 模型生命周期

## 定义

MLOps（Machine Learning Operations）是将 DevOps 实践应用于机器学习模型的全生命周期管理，覆盖数据准备、模型训练、版本管理、部署、监控和迭代的工程化方法论。

## 核心原理

### 模型生命周期

```
数据准备 → 模型训练 → 评估验证 → 版本注册 → 部署上线 → 监控告警 → 迭代优化
    ↑                                                                    │
    └────────────────────────────────────────────────────────────────────┘
```

### MLflow 核心组件

| 组件 | 功能 | 用途 |
|------|------|------|
| MLflow Tracking | 实验跟踪 | 记录参数、指标、产物 |
| MLflow Models | 模型打包 | 统一模型格式、部署接口 |
| MLflow Model Registry | 模型注册 | 版本管理、阶段流转 |
| MLflow Projects | 项目管理 | 可复现的训练环境 |

```python
import mlflow

# 训练跟踪
with mlflow.start_run():
    mlflow.log_param("learning_rate", 0.001)
    mlflow.log_param("epochs", 10)
    
    model = train_model(train_data)
    
    mlflow.log_metric("accuracy", accuracy)
    mlflow.log_metric("f1_score", f1)
    
    mlflow.sklearn.log_model(model, "model")

# 模型注册
mlflow.register_model(
    "runs:/<run_id>/model",
    "production-agent-embedder"
)
```

### Kubeflow Pipelines

```python
@dsl.component
def preprocess(data_path: str) -> Output[Dataset]:
    ...

@dsl.component
def train(dataset: Dataset, lr: float) -> Output[Model]:
    ...

@dsl.component
def evaluate(model: Model) -> Output[Metrics]:
    ...

@dsl.pipeline(name="agent-training-pipeline")
def training_pipeline(data_path: str, learning_rate: float):
    data = preprocess(data_path=data_path)
    model = train(dataset=data.output, lr=learning_rate)
    evaluate(model=model.output)
```

### 模型漂移检测

| 漂移类型 | 检测方法 | 应对策略 |
|---------|---------|---------|
| 数据漂移 | KL 散度、KS 检验 | 重新训练 |
| 概念漂移 | 准确率下降监控 | 特征工程 + 重训练 |
| 上游漂移 | API 版本变更 | 适配器模式 |

### A/B 测试部署

```
流量分配
├── 90% → 当前生产模型（v1.2）
└── 10% → 新模型（v1.3）
         ├── 监控指标：准确率、延迟、Token 消耗
         └── 评估周期：7 天
              ├── 达标 → 全量切换
              └── 未达标 → 回滚
```

## 实战案例

来自博客文章：
- [MLOps：MLflow/Kubeflow 模型生命周期管理](/2026/06/05/MLOps-MLflow-Kubeflow/) - 训练到部署完整流程

## 相关概念

- [LLM 推理基础设施](LLM推理基础设施.md) - 模型部署与推理优化
- [Agent 评估体系](Agent评估体系.md) - 模型质量评估
- [Agent 成本优化](Agent成本优化.md) - 模型选择与成本控制

## 常见问题

### Q: MLflow vs Kubeflow 怎么选？
- MLflow：轻量级、单机友好、适合小团队
- Kubeflow：Kubernetes 原生、分布式训练、适合大规模

### Q: 如何监控模型漂移？
定期在 Golden Dataset 上评估模型表现，当准确率下降超过阈值（如 5%）时触发重训练。
