# LLM 推理基础设施

## 定义

LLM 推理基础设施是指支撑大语言模型高效运行的硬件、软件和优化技术栈，包括 GPU 选型、推理引擎、量化技术、批处理策略等。

## 核心原理

### vLLM 与 PagedAttention

vLLM 是高性能 LLM 推理引擎，核心创新是 PagedAttention：

**传统注意力的问题**：
- KV Cache 需要连续内存
- 不同请求的序列长度不同 → 内存碎片化
- 内存利用率低（预分配最大长度）

**PagedAttention 解决方案**：
- 将 KV Cache 分为固定大小的 Block
- 类似操作系统虚拟内存的分页机制
- 按需分配，动态回收
- 内存利用率提升 2-4 倍

```python
from vllm import LLM, SamplingParams

llm = LLM(
    model="meta-llama/Llama-3-70B-Instruct",
    tensor_parallel_size=4,      # 4 GPU 张量并行
    gpu_memory_utilization=0.9,  # GPU 内存利用率
    max_num_batched_tokens=8192  # 最大批处理 Token 数
)

sampling = SamplingParams(temperature=0.7, max_tokens=512)
outputs = llm.generate(["Hello, world!"], sampling)
```

### Continuous Batching（连续批处理）

传统批处理：等所有请求完成才处理下一批
连续批处理：请求完成立即释放，新请求立即加入

```
传统批处理：
[请求1 ████████][请求2 ████████████] → 等待最慢的
                 ↑ 空闲

连续批处理：
[请求1 ████████][请求3 ████]
[请求2 ████████████][请求4 ██]
                 ↑ 无空闲
```

### 模型量化

| 量化方法 | 精度 | 模型大小缩减 | 质量损失 |
|---------|------|------------|---------|
| FP16 | 16-bit | 2x | 无 |
| INT8 | 8-bit | 4x | 极小 |
| AWQ | 4-bit | 8x | 小 |
| GPTQ | 4-bit | 8x | 小 |
| GGUF (llama.cpp) | 2-8-bit | 2-16x | 可变 |

### 推理引擎对比

| 引擎 | 语言 | 特点 | 适用场景 |
|------|------|------|---------|
| vLLM | Python | PagedAttention、连续批处理 | 生产 API 服务 |
| TGI | Rust | HuggingFace 生态 | HuggingFace 模型 |
| llama.cpp | C++ | CPU 推理、GGUF 量化 | 边缘设备、开发测试 |
| Ollama | Go | 简单易用、模型管理 | 本地开发、原型 |
| TensorRT-LLM | C++ | NVIDIA 优化 | 极致性能 |

### GPU 选型指南

| GPU | 显存 | 适用模型 | 价格区间 |
|-----|------|---------|---------|
| RTX 4090 | 24GB | 7B-13B（FP16） | ~$1,600 |
| A100 40GB | 40GB | 30B（FP16）、70B（INT4） | ~$10,000 |
| A100 80GB | 80GB | 70B（FP16） | ~$15,000 |
| H100 80GB | 80GB | 70B（FP16）、更大模型（量化） | ~$30,000 |

## 实战案例

来自博客文章：
- [vLLM 高吞吐 LLM 推理](/2026/06/02/2026-06-02-vllm-high-throughput-llm-inference-pagedattention-gpu/) - PagedAttention 与 GPU 优化实战

## 相关概念

- [Agent 成本优化](Agent成本优化.md) - 本地推理降低成本
- [MLOps 模型生命周期](MLOps模型生命周期.md) - 模型部署与管理
- [Function Calling 与工具使用](Function-Calling与工具使用.md) - 推理引擎的工具调用支持

## 常见问题

### Q: 本地推理 vs 云端 API 怎么选？
- 云端 API：无需硬件、按量付费、最新模型
- 本地推理：数据隐私、无网络依赖、长期成本低
- 建议：开发测试用 Ollama，生产用 vLLM 或云端 API

### Q: 如何估算 GPU 需求？
经验公式：模型参数量 × 每参数字节数 ≈ 显存需求。7B 模型 FP16 需要 ~14GB，INT4 需要 ~3.5GB。
