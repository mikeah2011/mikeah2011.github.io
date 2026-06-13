---

title: MLOps 实战：MLflow/Kubeflow 模型生命周期管理——从训练到部署的工程化流水线
keywords: [MLOps, MLflow, Kubeflow, 模型生命周期管理, 从训练到部署的工程化流水线]
date: 2026-06-02 12:00:00
tags:
- MLOps
- MLflow
- Kubeflow
- 模型部署
- CI/CD
- AI
categories:
- ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: MLOps 工程化实战指南，深入讲解 MLflow Tracking 实验跟踪、Model Registry 模型版本管理、Kubeflow Pipelines 流水线编排与 KFServing 模型服务部署。涵盖 Google MLOps 成熟度模型、端到端机器学习流水线构建、模型漂移检测与 A/B 测试，包含完整 Python 代码示例与踩坑案例，帮助团队从手动 Notebook 部署迈向自动化 CI/CD for ML 的生产级实践。
---



## 引言：从模型开发到生产部署的鸿沟

在机器学习领域，有一个广为人知的统计：**87% 的机器学习项目从未投入生产**。这不是因为模型不够好，而是因为从"Jupyter Notebook 里的模型"到"生产环境中的可靠服务"之间，存在着巨大的工程鸿沟。

MLOps（Machine Learning Operations）正是为解决这一问题而诞生的工程实践。它将 DevOps 的理念应用于机器学习，覆盖了从数据准备、模型训练、版本管理、部署到监控的完整生命周期。

本文将深入探讨 MLOps 的核心实践，并通过 MLflow 和 Kubeflow 两个主流工具，展示如何构建端到端的机器学习工程化流水线。

---

## 第一章：MLOps 概念与成熟度模型

### 1.1 什么是 MLOps？

MLOps 是机器学习（ML）、数据工程（DE）和 DevOps 的交叉领域，旨在：

1. **缩短模型从开发到生产的时间**
2. **提高模型的可靠性和可重复性**
3. **实现模型的持续监控和迭代**
4. **降低运维成本和风险**

### 1.2 MLOps 成熟度模型

Google 提出了三个层级的 MLOps 成熟度模型：

```
Level 0: 手动过程
├── 手动训练模型
├── 手动打包和部署
├── 无监控
└── 适用：POC、原型

Level 1: ML 流水线自动化
├── 自动化训练流水线
├── 持续训练（CT）
├── 实验跟踪
└── 适用：少数模型、小团队

Level 2: CI/CD + CT 自动化
├── CI/CD for ML
├── 自动化测试
├── 自动化部署
├── 模型监控和漂移检测
└── 适用：大规模生产、企业级
```

### 1.3 MLOps 核心组件

```
┌─────────────────────────────────────────────────────┐
│                    MLOps 平台                        │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ 数据管理 │  │ 实验管理 │  │ 模型管理 │          │
│  │          │  │          │  │          │          │
│  │ · 数据集 │  │ · 实验   │  │ · 注册表 │          │
│  │ · 特征库 │  │ · 跟踪   │  │ · 版本   │          │
│  │ · 数据   │  │ · 比较   │  │ · 阶段   │          │
│  │   验证   │  │ · 可视化 │  │ · 部署   │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ 流水线   │  │ 部署     │  │ 监控     │          │
│  │          │  │          │  │          │          │
│  │ · 编排   │  │ · 服务   │  │ · 漂移   │          │
│  │ · 调度   │  │ · 批量   │  │ · 性能   │          │
│  │ · 依赖   │  │ · 边缘   │  │ · 质量   │          │
│  │ · 触发   │  │ · A/B    │  │ · 告警   │          │
│  └──────────┘  └──────────┘  └──────────┘          │
└─────────────────────────────────────────────────────┘
```

---

## 第二章：MLflow 核心组件

### 2.1 MLflow Tracking

MLflow Tracking 是实验跟踪的核心组件：

```python
import mlflow
import mlflow.sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score
from sklearn.model_selection import train_test_split
import pandas as pd

# 设置 MLflow 追踪服务器
mlflow.set_tracking_uri("http://localhost:5000")

# 创建或获取实验
mlflow.set_experiment("customer-churn-prediction")

# 开始运行
with mlflow.start_run(run_name="random-forest-v1") as run:
    # 加载数据
    df = pd.read_csv("data/customer_churn.csv")
    X = df.drop("churn", axis=1)
    y = df["churn"]
    
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    # 记录参数
    params = {
        "n_estimators": 100,
        "max_depth": 10,
        "min_samples_split": 5,
        "random_state": 42,
    }
    mlflow.log_params(params)
    
    # 训练模型
    model = RandomForestClassifier(**params)
    model.fit(X_train, y_train)
    
    # 预测和评估
    y_pred = model.predict(X_test)
    
    # 记录指标
    metrics = {
        "accuracy": accuracy_score(y_test, y_pred),
        "precision": precision_score(y_test, y_pred),
        "recall": recall_score(y_test, y_pred),
    }
    mlflow.log_metrics(metrics)
    
    # 记录模型
    mlflow.sklearn.log_model(
        model,
        "model",
        registered_model_name="churn-prediction",
        input_example=X_train.iloc[:5],
    )
    
    # 记录数据集信息
    mlflow.log_artifact("data/customer_churn.csv", "datasets")
    
    # 记录自定义指标图
    import matplotlib.pyplot as plt
    from sklearn.metrics import confusion_matrix, ConfusionMatrixDisplay
    
    cm = confusion_matrix(y_test, y_pred)
    disp = ConfusionMatrixDisplay(cm)
    disp.plot()
    plt.savefig("confusion_matrix.png")
    mlflow.log_artifact("confusion_matrix.png", "plots")
    
    print(f"Run ID: {run.info.run_id}")
    print(f"Accuracy: {metrics['accuracy']:.4f}")
```

### 2.2 MLflow Model Registry

Model Registry 提供模型版本管理和生命周期管理：

```python
import mlflow
from mlflow.tracking import MlflowClient

client = MlflowClient("http://localhost:5000")

# 注册模型
model_uri = f"runs:/{run_id}/model"
model_version = mlflow.register_model(model_uri, "churn-prediction")

# 添加描述
client.update_model_version(
    name="churn-prediction",
    version=model_version.version,
    description="Random Forest model for customer churn prediction. Accuracy: 92.3%"
)

# 添加标签
client.set_model_version_tag(
    name="churn-prediction",
    version=model_version.version,
    key="validation_status",
    value="passed"
)

# 阶段转换：None → Staging → Production → Archived
# 推进到 Staging
client.transition_model_version_stage(
    name="churn-prediction",
    version=model_version.version,
    stage="Staging"
)

# 验证后推进到 Production
client.transition_model_version_stage(
    name="churn-prediction",
    version=model_version.version,
    stage="Production"
)

# 获取生产版本
def get_production_model(model_name: str):
    """获取生产环境的模型"""
    versions = client.get_latest_versions(model_name, stages=["Production"])
    if not versions:
        raise ValueError(f"No production model found for {model_name}")
    
    model_version = versions[0]
    model = mlflow.pyfunc.load_model(
        f"models:/{model_name}/{model_version.version}"
    )
    return model, model_version.version

# 模型别名（MLflow 2.x+）
client.set_registered_model_alias(
    name="churn-prediction",
    alias="champion",
    version=model_version.version
)

# 通过别名加载模型
model = mlflow.pyfunc.load_model("models:/churn-prediction@champion")
```

### 2.3 MLflow Projects

MLflow Projects 定义可重复运行的机器学习项目：

```yaml
# MLproject
name: churn-prediction

python_env: python_env.yaml

entry_points:
  main:
    parameters:
      n_estimators: {type: int, default: 100}
      max_depth: {type: int, default: 10}
      data_path: {type: str, default: "data/customer_churn.csv"}
    command: >-
      python train.py 
      --n_estimators {n_estimators} 
      --max_depth {max_depth} 
      --data_path {data_path}
  
  evaluate:
    parameters:
      model_uri: {type: str}
      test_data: {type: str}
    command: >-
      python evaluate.py 
      --model-uri {model_uri} 
      --test-data {test_data}
  
  preprocess:
    parameters:
      raw_data: {type: str}
      output_path: {type: str}
    command: >-
      python preprocess.py 
      --raw-data {raw_data} 
      --output-path {output_path}
```

```python
# 使用 MLflow Projects 运行
import mlflow

# 本地运行
mlflow.run(".", "main", parameters={
    "n_estimators": 200,
    "max_depth": 15
})

# 远程运行（Git 仓库）
mlflow.run(
    "git://github.com/my-org/churn-model.git",
    "main",
    parameters={"n_estimators": 200}
)

# Docker 运行
mlflow.run(".", "main", docker_image="my-ml-image:latest")
```

### 2.4 MLflow Models

MLflow Models 提供标准化的模型打包格式：

```python
# 自定义模型签名
from mlflow.models import infer_signature, ModelSignature
from mlflow.types.schema import Schema, ColSpec

# 定义输入输出 Schema
input_schema = Schema([
    ColSpec("double", "tenure"),
    ColSpec("double", "monthly_charges"),
    ColSpec("double", "total_charges"),
    ColSpec("integer", "contract_type"),
    ColSpec("integer", "payment_method"),
])

output_schema = Schema([
    ColSpec("integer", "churn"),
])

signature = ModelSignature(inputs=input_schema, outputs=output_schema)

# 记录模型（带签名）
mlflow.sklearn.log_model(
    model,
    "model",
    signature=signature,
    input_example=X_train.iloc[:3],
    registered_model_name="churn-prediction",
)

# 使用 pyfunc 加载和预测
model = mlflow.pyfunc.load_model(f"runs:/{run_id}/model")
predictions = model.predict(X_test)
```

---

## 第三章：Kubeflow Pipelines

### 3.1 Kubeflow 架构

Kubeflow 是 Kubernetes 上的机器学习工具集：

```
┌─────────────────────────────────────────────────────┐
│                 Kubeflow Platform                     │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │   Pipelines  │  │   KFServing  │                 │
│  │   (工作流)   │  │   (模型服务) │                 │
│  └──────────────┘  └──────────────┘                 │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │   Katib      │  │   Notebooks  │                 │
│  │   (超参调优) │  │   (Jupyter)  │                 │
│  └──────────────┘  └──────────────┘                 │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │   KFServing  │  │   Training   │                 │
│  │   (推理服务) │  │   Operators  │                 │
│  └──────────────┘  └──────────────┘                 │
└─────────────────────────────────────────────────────┘
```

### 3.2 Kubeflow Pipeline 定义

使用 Python SDK 定义 ML 流水线：

```python
from kfp import dsl, compiler, Client
from kfp.dsl import component, pipeline, Input, Output, Dataset, Model, Metrics

# 定义组件
@component(
    base_image="python:3.11",
    packages_to_install=["pandas", "scikit-learn", "mlflow"],
)
def preprocess_data(
    raw_data: Input[Dataset],
    processed_data: Output[Dataset],
    test_size: float = 0.2,
):
    """预处理数据"""
    import pandas as pd
    from sklearn.model_selection import train_test_split
    
    df = pd.read_csv(raw_data.path)
    
    # 数据清洗
    df = df.dropna()
    df = pd.get_dummies(df, columns=["contract_type", "payment_method"])
    
    # 划分数据集
    train_df, test_df = train_test_split(df, test_size=test_size, random_state=42)
    
    train_df.to_csv(f"{processed_data.path}/train.csv", index=False)
    test_df.to_csv(f"{processed_data.path}/test.csv", index=False)

@component(
    base_image="python:3.11",
    packages_to_install=["pandas", "scikit-learn", "mlflow"],
)
def train_model(
    processed_data: Input[Dataset],
    model: Output[Model],
    metrics: Output[Metrics],
    n_estimators: int = 100,
    max_depth: int = 10,
):
    """训练模型"""
    import pandas as pd
    import mlflow
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import accuracy_score, precision_score, recall_score
    
    mlflow.set_tracking_uri("http://mlflow-service:5000")
    
    train_df = pd.read_csv(f"{processed_data.path}/train.csv")
    X_train = train_df.drop("churn", axis=1)
    y_train = train_df["churn"]
    
    with mlflow.start_run():
        params = {
            "n_estimators": n_estimators,
            "max_depth": max_depth,
        }
        mlflow.log_params(params)
        
        clf = RandomForestClassifier(**params)
        clf.fit(X_train, y_train)
        
        test_df = pd.read_csv(f"{processed_data.path}/test.csv")
        X_test = test_df.drop("churn", axis=1)
        y_test = test_df["churn"]
        
        y_pred = clf.predict(X_test)
        
        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred)
        rec = recall_score(y_test, y_pred)
        
        mlflow.log_metrics({
            "accuracy": acc,
            "precision": prec,
            "recall": rec,
        })
        
        mlflow.sklearn.log_model(clf, "model")
        
        # 保存模型
        import joblib
        joblib.dump(clf, model.path)
        
        # 记录指标
        metrics.log_metric("accuracy", acc)
        metrics.log_metric("precision", prec)
        metrics.log_metric("recall", rec)

@component(
    base_image="python:3.11",
    packages_to_install=["joblib", "scikit-learn"],
)
def validate_model(
    model: Input[Model],
    metrics: Input[Metrics],
    accuracy_threshold: float = 0.85,
) -> bool:
    """验证模型是否达标"""
    # 读取指标
    accuracy = metrics.metadata["accuracy"]
    
    if accuracy >= accuracy_threshold:
        print(f"Model passed validation: accuracy={accuracy:.4f}")
        return True
    else:
        print(f"Model failed validation: accuracy={accuracy:.4f} < {accuracy_threshold}")
        return False

@component(
    base_image="python:3.11",
    packages_to_install=["mlflow", "boto3"],
)
def register_model(
    model: Input[Model],
    model_name: str = "churn-prediction",
):
    """注册模型到 Model Registry"""
    import mlflow
    import joblib
    
    mlflow.set_tracking_uri("http://mlflow-service:5000")
    
    clf = joblib.load(model.path)
    
    with mlflow.start_run():
        mlflow.sklearn.log_model(
            clf,
            "model",
            registered_model_name=model_name,
        )

@component(
    base_image="python:3.11",
    packages_to_install=["kubernetes", "requests"],
)
def deploy_model(
    model_name: str = "churn-prediction",
    namespace: str = "kubeflow",
):
    """部署模型到 KFServing"""
    from kubernetes import client, config
    import yaml
    
    config.load_incluster_config()
    
    kfserving_yaml = {
        "apiVersion": "serving.kserve.io/v1beta1",
        "kind": "InferenceService",
        "metadata": {
            "name": "churn-prediction",
            "namespace": namespace,
        },
        "spec": {
            "predictor": {
                "model": {
                    "modelFormat": {"name": "sklearn"},
                    "storageUri": f"s3://models/{model_name}",
                }
            }
        }
    }
    
    api = client.CustomObjectsApi()
    api.create_namespaced_custom_object(
        group="serving.kserve.io",
        version="v1beta1",
        namespace=namespace,
        plural="inferenceservices",
        body=kfserving_yaml,
    )

# 定义流水线
@pipeline(
    name="churn-prediction-pipeline",
    description="End-to-end churn prediction pipeline",
)
def churn_pipeline(
    raw_data_path: str = "s3://data/customer_churn.csv",
    n_estimators: int = 100,
    max_depth: int = 10,
    accuracy_threshold: float = 0.85,
):
    # 1. 数据预处理
    preprocess = preprocess_data(
        raw_data=raw_data_path,
    )
    
    # 2. 训练模型
    train = train_model(
        processed_data=preprocess.outputs["processed_data"],
        n_estimators=n_estimators,
        max_depth=max_depth,
    )
    
    # 3. 验证模型
    validation = validate_model(
        model=train.outputs["model"],
        metrics=train.outputs["metrics"],
        accuracy_threshold=accuracy_threshold,
    )
    
    # 4. 条件注册和部署
    with dsl.Condition(validation.output == True):
        register = register_model(
            model=train.outputs["model"],
        )
        
        deploy = deploy_model(
            model_name="churn-prediction",
        )
        deploy.after(register)

# 编译和运行
if __name__ == "__main__":
    compiler.Compiler().compile(
        pipeline_func=churn_pipeline,
        package_path="churn_pipeline.yaml",
    )
    
    client = Client(host="http://kubeflow-service:8888")
    run = client.create_run_from_pipeline_package(
        "churn_pipeline.yaml",
        arguments={
            "n_estimators": 200,
            "max_depth": 15,
            "accuracy_threshold": 0.90,
        },
    )
```

### 3.3 超参数调优（Katib）

```python
from kubeflow.katib import KatibClient
from kubeflow.katib import V1beta1ExperimentSpec, V1beta1ObjectiveSpec
from kubeflow.katib import V1beta1AlgorithmSpec, V1beta1TrialTemplate

# 创建超参调优实验
def create_katib_experiment():
    experiment_spec = V1beta1ExperimentSpec(
        max_trial_count=20,
        parallel_trial_count=3,
        objective=V1beta1ObjectiveSpec(
            type="maximize",
            goal=0.95,
            objective_metric_name="accuracy",
        ),
        algorithm=V1beta1AlgorithmSpec(
            algorithm_name="bayesianoptimization",
        ),
        parameters=[
            {
                "name": "n_estimators",
                "parameter_type": "int",
                "feasible_space": {"min": "50", "max": "500"},
            },
            {
                "name": "max_depth",
                "parameter_type": "int",
                "feasible_space": {"min": "3", "max": "20"},
            },
            {
                "name": "learning_rate",
                "parameter_type": "double",
                "feasible_space": {"min": "0.001", "max": "0.3"},
            },
        ],
        trial_template=V1beta1TrialTemplate(
            primary_container_name="training-container",
            trial_parameters=[
                {
                    "name": "n_estimators",
                    "description": "Number of trees",
                    "reference": "n_estimators",
                },
                {
                    "name": "max_depth",
                    "description": "Max depth of trees",
                    "reference": "max_depth",
                },
            ],
            trial_spec={
                "apiVersion": "kubeflow.org/v1",
                "kind": "TFJob",
                "spec": {
                    "tfReplicaSpecs": {
                        "Worker": {
                            "replicas": 1,
                            "template": {
                                "spec": {
                                    "containers": [{
                                        "name": "training-container",
                                        "image": "my-training-image:latest",
                                        "command": ["python", "train.py"],
                                        "args": [
                                            "--n_estimators", "${trialParameters.n_estimators}",
                                            "--max_depth", "${trialParameters.max_depth}",
                                        ],
                                    }],
                                    "restartPolicy": "Never",
                                }
                            }
                        }
                    }
                }
            }
        )
    )
    
    return experiment_spec

# 提交实验
client = KatibClient()
client.create_experiment(
    create_katib_experiment(),
    namespace="kubeflow",
    name="churn-hpo",
)
```

---

## 第四章：模型部署

### 4.1 KFServing（KServe）部署

```yaml
# model-serving.yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: churn-prediction
  namespace: kubeflow
spec:
  predictor:
    model:
      modelFormat:
        name: sklearn
      storageUri: s3://models/churn-prediction
      resources:
        requests:
          cpu: "1"
          memory: "2Gi"
        limits:
          cpu: "2"
          memory: "4Gi"
  
  # 可选：Transformer（数据预处理）
  transformer:
    containers:
      - name: transformer
        image: my-transformer:latest
        resources:
          requests:
            cpu: "500m"
            memory: "1Gi"
  
  # 自动扩缩容
  autoscalerSpec:
    minReplicas: 1
    maxReplicas: 10
    metrics:
      - type: Pods
        pods:
          metric:
            name: inference_request_per_second
          target:
            type: AverageValue
            averageValue: "100"
```

### 4.2 A/B 测试部署

```yaml
# canary-deployment.yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: churn-prediction
  namespace: kubeflow
spec:
  # 金丝雀版本（10% 流量）
  predictor:
    canaryTrafficPercent: 10
    
    model:
      modelFormat:
        name: sklearn
      storageUri: s3://models/churn-prediction-v2
    
    # 主版本（90% 流量）
    model:
      modelFormat:
        name: sklearn
      storageUri: s3://models/churn-prediction-v1
```

### 4.3 多模型服务

```yaml
# multi-model-serving.yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: ml-models
  namespace: kubeflow
spec:
  predictor:
    model:
      modelFormat:
        name: sklearn
      storageUri: pvc://model-pvc/models
      # 多模型路由
      runtimeVersion: "1.0"
```

---

## 第五章：模型监控与漂移检测

### 5.1 数据漂移检测

```python
from alibi_detect.cd import TabularDrift
import numpy as np

class DataDriftDetector:
    def __init__(self, reference_data: np.ndarray, p_val: float = 0.05):
        self.reference_data = reference_data
        self.p_val = p_val
        self.cd = TabularDrift(reference_data, p_val=p_val)
    
    def detect_drift(self, new_data: np.ndarray) -> dict:
        """检测数据漂移"""
        preds = self.cd.predict(new_data)
        
        return {
            "is_drift": preds["data"]["is_drift"],
            "p_val": preds["data"]["p_val"].tolist(),
            "distance": preds["data"]["distance"].tolist(),
            "threshold": preds["data"]["threshold"],
        }

# 集成到监控系统
class ModelMonitor:
    def __init__(self, model_name: str, reference_data: np.ndarray):
        self.model_name = model_name
        self.drift_detector = DataDriftDetector(reference_data)
    
    def monitor_prediction(self, features: np.ndarray, prediction: any):
        """监控预测请求"""
        # 记录预测
        self.log_prediction(features, prediction)
        
        # 检测漂移
        drift_result = self.drift_detector.detect_drift(features.reshape(1, -1))
        
        if drift_result["is_drift"]:
            self.alert_drift(drift_result)
    
    def alert_drift(self, drift_result: dict):
        """发送漂移告警"""
        import requests
        
        requests.post("https://hooks.slack.com/xxx", json={
            "text": f"⚠️ Data drift detected for model {self.model_name}!",
            "attachments": [{
                "color": "danger",
                "fields": [
                    {"title": "P-value", "value": str(drift_result["p_val"]), "short": True},
                    {"title": "Threshold", "value": str(drift_result["threshold"]), "short": True},
                ]
            }]
        })
```

### 5.2 模型性能监控

```python
from prometheus_client import Counter, Histogram, Gauge, start_http_server
import time

class ModelMetrics:
    def __init__(self):
        self.prediction_count = Counter(
            'model_predictions_total',
            'Total predictions',
            ['model_name', 'version']
        )
        self.prediction_latency = Histogram(
            'model_prediction_latency_seconds',
            'Prediction latency',
            ['model_name', 'version']
        )
        self.model_accuracy = Gauge(
            'model_accuracy',
            'Model accuracy',
            ['model_name', 'version']
        )
        self.drift_score = Gauge(
            'model_drift_score',
            'Data drift score',
            ['model_name', 'version']
        )
    
    def record_prediction(self, model_name: str, version: str, latency: float):
        self.prediction_count.labels(model_name, version).inc()
        self.prediction_latency.labels(model_name, version).observe(latency)
    
    def update_accuracy(self, model_name: str, version: str, accuracy: float):
        self.model_accuracy.labels(model_name, version).set(accuracy)
    
    def update_drift(self, model_name: str, version: str, score: float):
        self.drift_score.labels(model_name, version).set(score)

# 启动 Prometheus 指标服务器
metrics = ModelMetrics()
start_http_server(8000)
```

### 5.3 Grafana Dashboard 配置

```json
{
  "dashboard": {
    "title": "ML Model Monitoring",
    "panels": [
      {
        "title": "Prediction Rate",
        "targets": [{
          "expr": "rate(model_predictions_total[5m])",
          "legendFormat": "{{model_name}} v{{version}}"
        }]
      },
      {
        "title": "Prediction Latency P99",
        "targets": [{
          "expr": "histogram_quantile(0.99, model_prediction_latency_seconds_bucket)",
          "legendFormat": "{{model_name}} v{{version}}"
        }]
      },
      {
        "title": "Model Accuracy",
        "targets": [{
          "expr": "model_accuracy",
          "legendFormat": "{{model_name}} v{{version}}"
        }]
      },
      {
        "title": "Data Drift Score",
        "targets": [{
          "expr": "model_drift_score",
          "legendFormat": "{{model_name}} v{{version}}"
        }]
      }
    ]
  }
}
```

---

## 第六章：CI/CD for ML

### 6.1 GitHub Actions ML Pipeline

```yaml
# .github/workflows/ml-pipeline.yml
name: ML Pipeline

on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'data/**'
  schedule:
    - cron: '0 2 * * 1'  # 每周一凌晨 2 点重新训练

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      
      - name: Install Dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest pytest-cov
      
      - name: Run Tests
        run: |
          pytest tests/ --cov=src/ --cov-report=xml
      
      - name: Upload Coverage
        uses: codecov/codecov-action@v4

  train:
    needs: test
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      
      - name: Install Dependencies
        run: pip install -r requirements.txt
      
      - name: Train Model
        env:
          MLFLOW_TRACKING_URI: ${{ secrets.MLFLOW_TRACKING_URI }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          python src/train.py \
            --data-path s3://data/latest \
            --output-path s3://models/churn-prediction
      
      - name: Evaluate Model
        run: |
          python src/evaluate.py \
            --model-uri runs:/latest/model \
            --test-data s3://data/test

  deploy:
    needs: train
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - name: Deploy to KFServing
        env:
          KUBECONFIG: ${{ secrets.KUBECONFIG }}
        run: |
          kubectl apply -f k8s/model-serving.yaml
```

### 6.2 模型测试

```python
# tests/test_model.py
import pytest
import mlflow
import pandas as pd
import numpy as np
from sklearn.metrics import accuracy_score

class TestModel:
    @pytest.fixture
    def model(self):
        return mlflow.pyfunc.load_model("models:/churn-prediction@champion")
    
    @pytest.fixture
    def test_data(self):
        return pd.read_csv("tests/fixtures/test_data.csv")
    
    def test_model_accuracy(self, model, test_data):
        """测试模型准确率"""
        X = test_data.drop("churn", axis=1)
        y = test_data["churn"]
        
        predictions = model.predict(X)
        accuracy = accuracy_score(y, predictions)
        
        assert accuracy >= 0.85, f"Model accuracy {accuracy} is below threshold 0.85"
    
    def test_model_predictions_shape(self, model, test_data):
        """测试预测输出形状"""
        X = test_data.drop("churn", axis=1)
        predictions = model.predict(X)
        
        assert len(predictions) == len(X)
        assert set(predictions).issubset({0, 1})
    
    def test_model_latency(self, model, test_data):
        """测试预测延迟"""
        import time
        
        X = test_data.drop("churn", axis=1).iloc[:100]
        
        start = time.time()
        model.predict(X)
        elapsed = time.time() - start
        
        assert elapsed < 1.0, f"Prediction latency {elapsed}s exceeds 1s"
    
    def test_model_handles_missing_values(self, model, test_data):
        """测试模型处理缺失值"""
        X = test_data.drop("churn", axis=1).copy()
        X.iloc[0, 0] = np.nan
        
        # 模型应该能处理缺失值或抛出明确错误
        try:
            predictions = model.predict(X)
            assert len(predictions) == len(X)
        except Exception as e:
            assert "missing" in str(e).lower() or "nan" in str(e).lower()
```

---

## 第七章：Laravel 集成

### 7.1 ML 推理 API

```php
// app/Services/MLPredictionService.php
class MLPredictionService
{
    private string $modelEndpoint;
    private HttpClient $http;
    
    public function __construct()
    {
        $this->modelEndpoint = config('ml.endpoint');
        $this->http = Http::timeout(5)->retry(3, 100);
    }
    
    public function predictChurn(array $customerData): array
    {
        $response = $this->http->post("{$this->modelEndpoint}/v2/models/churn-prediction/infer", [
            'inputs' => [
                [
                    'name'     => 'input-0',
                    'shape'    => [1, count($customerData)],
                    'datatype' => 'FP32',
                    'data'     => array_values($customerData),
                ]
            ]
        ]);
        
        if ($response->failed()) {
            throw new MLPredictionException('Model prediction failed: ' . $response->body());
        }
        
        $result = $response->json();
        
        return [
            'prediction'  => $result['outputs'][0]['data'][0],
            'probability' => $result['outputs'][0]['data'][1] ?? null,
            'model_version' => $response->header('x-model-version'),
        ];
    }
    
    public function batchPredict(array $customers): array
    {
        $inputs = [];
        foreach ($customers as $customer) {
            $inputs[] = array_values($customer);
        }
        
        $response = $this->http->post("{$this->modelEndpoint}/v2/models/churn-prediction/infer", [
            'inputs' => [
                [
                    'name'     => 'input-0',
                    'shape'    => [count($inputs), count($inputs[0])],
                    'datatype' => 'FP32',
                    'data'     => array_merge(...$inputs),
                ]
            ]
        ]);
        
        return $response->json()['outputs'][0]['data'];
    }
}
```

### 7.2 模型版本管理

```php
// app/Services/ModelVersionManager.php
class ModelVersionManager
{
    private MlflowClient $mlflow;
    
    public function getCurrentModel(string $modelName): array
    {
        $response = $this->mlflow->getLatestVersions($modelName, ['Production']);
        
        return [
            'version' => $response[0]['version'],
            'run_id'  => $response[0]['run_id'],
            'status'  => $response[0]['status'],
        ];
    }
    
    public function promoteModel(string $modelName, string $version, string $stage): void
    {
        $this->mlflow->transitionModelVersionStage($modelName, $version, $stage);
    }
    
    public function rollbackModel(string $modelName): void
    {
        $versions = $this->mlflow->getLatestVersions($modelName, ['Production', 'Archived']);
        
        // 找到上一个 Production 版本
        $previousVersion = collect($versions)
            ->where('current_stage', 'Archived')
            ->sortByDesc('version')
            ->first();
        
        if ($previousVersion) {
            // 将当前 Production 降级到 Archived
            $currentProduction = collect($versions)
                ->where('current_stage', 'Production')
                ->first();
            
            if ($currentProduction) {
                $this->promoteModel($modelName, $currentProduction['version'], 'Archived');
            }
            
            // 将之前的版本提升到 Production
            $this->promoteModel($modelName, $previousVersion['version'], 'Production');
        }
    }
}
```

### 7.3 特征存储集成

```php
// app/Services/FeatureStoreService.php
class FeatureStoreService
{
    private Redis $redis;
    private DB $db;
    
    public function getFeatures(string $customerId): array
    {
        $cacheKey = "features:{$customerId}";
        
        // 1. 检查 Redis 缓存
        if ($cached = $this->redis->get($cacheKey)) {
            return json_decode($cached, true);
        }
        
        // 2. 从特征存储获取
        $features = $this->fetchFromFeatureStore($customerId);
        
        // 3. 缓存 5 分钟
        $this->redis->setex($cacheKey, 300, json_encode($features));
        
        return $features;
    }
    
    private function fetchFromFeatureStore(string $customerId): array
    {
        // 从特征库获取实时特征
        $realtimeFeatures = $this->db->table('customer_features')
            ->where('customer_id', $customerId)
            ->latest('created_at')
            ->first();
        
        // 从历史数据获取聚合特征
        $historicalFeatures = $this->db->table('orders')
            ->selectRaw('
                COUNT(*) as total_orders,
                SUM(amount) as total_amount,
                AVG(amount) as avg_order_amount,
                MAX(created_at) as last_order_date
            ')
            ->where('customer_id', $customerId)
            ->first();
        
        return [
            'tenure'            => $realtimeFeatures->tenure ?? 0,
            'monthly_charges'   => $realtimeFeatures->monthly_charges ?? 0,
            'total_charges'     => $historicalFeatures->total_amount ?? 0,
            'contract_type'     => $realtimeFeatures->contract_type ?? 0,
            'payment_method'    => $realtimeFeatures->payment_method ?? 0,
            'total_orders'      => $historicalFeatures->total_orders ?? 0,
            'avg_order_amount'  => $historicalFeatures->avg_order_amount ?? 0,
            'days_since_last'   => $this->daysSince($historicalFeatures->last_order_date),
        ];
    }
}
```

---

## 第八章：生产环境最佳实践

### 8.1 模型验证清单

```python
# model_validation.py
class ModelValidationChecklist:
    def __init__(self, model, test_data):
        self.model = model
        self.test_data = test_data
        self.results = {}
    
    def run_all_checks(self) -> dict:
        """运行所有验证检查"""
        checks = [
            self.check_accuracy,
            self.check_latency,
            self.check_robustness,
            self.check_fairness,
            self.check_stability,
        ]
        
        for check in checks:
            name = check.__name__
            try:
                passed, details = check()
                self.results[name] = {"passed": passed, "details": details}
            except Exception as e:
                self.results[name] = {"passed": False, "details": str(e)}
        
        return self.results
    
    def check_accuracy(self) -> tuple:
        """检查模型准确率"""
        X, y = self.test_data
        predictions = self.model.predict(X)
        accuracy = accuracy_score(y, predictions)
        passed = accuracy >= 0.85
        return passed, {"accuracy": accuracy, "threshold": 0.85}
    
    def check_latency(self) -> tuple:
        """检查预测延迟"""
        import time
        X = self.test_data[0][:100]
        
        latencies = []
        for _ in range(10):
            start = time.time()
            self.model.predict(X)
            latencies.append(time.time() - start)
        
        p99_latency = np.percentile(latencies, 99)
        passed = p99_latency < 0.1  # 100ms
        return passed, {"p99_latency": p99_latency, "threshold": 0.1}
    
    def check_robustness(self) -> tuple:
        """检查模型鲁棒性"""
        X, y = self.test_data
        
        # 添加噪声
        noise = np.random.normal(0, 0.01, X.shape)
        X_noisy = X + noise
        
        predictions_original = self.model.predict(X)
        predictions_noisy = self.model.predict(X_noisy)
        
        stability = np.mean(predictions_original == predictions_noisy)
        passed = stability >= 0.95
        return passed, {"stability": stability, "threshold": 0.95}
    
    def check_fairness(self) -> tuple:
        """检查模型公平性"""
        # 检查不同群体的预测差异
        X, y = self.test_data
        
        # 假设第一个特征是敏感属性
        group_0 = X[X[:, 0] == 0]
        group_1 = X[X[:, 0] == 1]
        
        pred_0 = self.model.predict(group_0)
        pred_1 = self.model.predict(group_1)
        
        disparity = abs(np.mean(pred_0) - np.mean(pred_1))
        passed = disparity < 0.1
        return passed, {"disparity": disparity, "threshold": 0.1}
```

### 8.2 部署策略

```python
# 部署策略选择
DEPLOYMENT_STRATEGIES = {
    "shadow": {
        "description": "影子部署：新模型与旧模型同时运行，但只返回旧模型结果",
        "use_case": "验证新模型性能",
        "risk": "低",
    },
    "canary": {
        "description": "金丝雀部署：逐步增加新模型流量",
        "use_case": "生产环境验证",
        "risk": "中",
    },
    "blue_green": {
        "description": "蓝绿部署：一键切换新旧模型",
        "use_case": "快速回滚",
        "risk": "中",
    },
    "a_b_testing": {
        "description": "A/B 测试：基于用户分组的模型对比",
        "use_case": "业务指标优化",
        "risk": "低",
    },
}
```

---

## 第九章：总结

### 9.1 MLflow vs Kubeflow

| 特性 | MLflow | Kubeflow |
|------|--------|----------|
| 核心功能 | 实验跟踪、模型管理 | 端到端 ML 平台 |
| 部署复杂度 | 低（pip install） | 高（Kubernetes） |
| 适用规模 | 小到中型 | 大型企业 |
| 模型服务 | MLflow Models | KFServing |
| 流水线 | MLflow Projects | Kubeflow Pipelines |
| 超参调优 | 第三方集成 | 内置 Katib |
| 多框架支持 | ✅ | ✅ |
| 社区活跃度 | 高 | 高 |

### 9.2 选型建议

**选择 MLflow 当：**
- 团队较小（<20 人）
- 已有 Kubernetes 基础设施
- 主要需要实验跟踪和模型管理
- 快速上手

**选择 Kubeflow 当：**
- 需要端到端 ML 平台
- 大规模生产环境
- 需要复杂的流水线编排
- 有专门的 MLOps 团队

### 9.3 最佳实践总结

1. **实验跟踪**：记录所有实验参数、指标、产物
2. **模型注册**：使用 Model Registry 管理模型版本
3. **自动化测试**：模型准确率、延迟、鲁棒性测试
4. **渐进式部署**：使用金丝雀或 A/B 测试
5. **持续监控**：数据漂移、模型性能监控
6. **快速回滚**：保留旧版本，支持一键回滚

## 相关阅读

- [AI Agent 数据分析实战：自然语言转 SQL、图表生成、报告自动化](/AI-Agent-数据分析实战-自然语言转SQL-图表生成-报告自动化/)
- [Redis 8.0 新特性实战：向量搜索、JSON Path、性能改进与 AI 场景应用](/databases/2026-06-02-Redis-8.0-新特性实战-向量搜索-JSON-Path-性能改进与AI场景应用/)
- [金丝雀发布实战：渐进式流量放量](/07_CICD/Canary-Deployment-渐进式流量放量-Nginx-Envoy权重路由与Laravel版本共存/)

---

## 参考资料

1. [MLflow Documentation](https://mlflow.org/docs/latest/index.html)
2. [Kubeflow Documentation](https://www.kubeflow.org/docs/)
3. [Google MLOps Whitepaper](https://cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning)
4. [KServe Documentation](https://kserve.github.io/website/)
5. [Alibi Detect - Drift Detection](https://docs.seldon.io/projects/alibi-detect/en/latest/)
