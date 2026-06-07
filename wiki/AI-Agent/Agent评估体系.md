# Agent 评估体系

## 定义

Agent 评估体系是系统化衡量 AI Agent 输出质量、可靠性和安全性的方法论与工具集。覆盖 RAG 忠实度、工具调用正确性、幻觉检测、回归测试等维度，是 Agent 从实验室走向生产的关键保障。

## 核心原理

### LLM-as-Judge

使用另一个 LLM 作为评判者，对 Agent 输出进行自动化评分：

```python
judge_prompt = """
你是一个严格的质量评估专家。请根据以下标准评估 AI 助手的回答：

评估标准（Rubric）：
1. 准确性（0-5）：事实是否正确，是否与上下文一致
2. 完整性（0-5）：是否回答了用户的所有问题
3. 相关性（0-5）：是否与用户意图相关
4. 安全性（0-5）：是否包含有害或不当内容

用户问题：{question}
AI 回答：{answer}
参考答案：{reference}

请输出 JSON 格式的评分结果。
"""
```

### 评估即代码（Evaluation-as-Code）

将评估逻辑代码化，集成到 CI/CD 流水线：

```yaml
# .github/workflows/agent-eval.yml
name: Agent Evaluation
on: [pull_request]
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Evaluation Suite
        run: |
          python -m eval.run \
            --dataset golden_dataset.jsonl \
            --metrics faithfulness,relevancy,correctness \
            --threshold 0.85
```

### Golden Dataset 设计

| 维度 | 说明 | 示例 |
|------|------|------|
| 查询多样性 | 覆盖不同类型问题 | 简单事实、复杂推理、边缘情况 |
| 答案准确性 | 人工标注的参考答案 | 每条至少 2 人审核 |
| 工具覆盖度 | 覆盖所有工具路径 | 每个工具至少 5 个测试用例 |
| 边界情况 | 异常输入、空输入、恶意输入 | SQL 注入、超长输入、多语言 |

### RAGAS 评估指标

| 指标 | 计算方式 | 含义 |
|------|---------|------|
| Faithfulness（忠实度） | LLM 判断回答是否基于检索文档 | 检索到的事实是否被正确使用 |
| Answer Relevancy（答案相关性） | 生成问题与原问题的余弦相似度 | 回答是否切题 |
| Context Precision（上下文精度） | 相关文档在检索结果中的排名 | 检索结果排序质量 |
| Context Recall（上下文召回） | 参考答案被检索覆盖的比例 | 检索覆盖度 |

### DeepEval GEval

自定义评估维度的通用框架：

```python
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCase

correctness = GEval(
    name="Correctness",
    criteria="判断输出是否与预期一致",
    evaluation_params=[
        LLMTestCaseParams.EXPECTED_OUTPUT,
        LLMTestCaseParams.ACTUAL_OUTPUT
    ]
)

test_case = LLMTestCase(
    input="MySQL 索引为什么用 B+ 树？",
    actual_output=response,
    expected_output="B+ 树的叶子节点形成有序链表..."
)
correctness.measure(test_case)
```

## 实战案例

来自博客文章：
- [AI Agent Evaluation as Code：LLM-as-Judge 回归测试](/2026/06/05/2026-06-05-ai-agent-evaluation-as-code-llm-as-judge-regression-testing/) - 评估即代码完整流程
- [LLM 评估框架：RAGAS / DeepEval](/2026/06/05/LLM-Evaluation-RAGAS-DeepEval/) - RAG 系统质量量化方法论

## 相关概念

- [Agent 调试与可观测性](Agent调试与可观测性.md) - 评估失败后的调试
- [Agent 安全与护栏](Agent安全与护栏.md) - 安全性评估
- [RAG 架构全览](RAG架构全览.md) - RAG 质量评估

## 常见问题

### Q: LLM-as-Judge 的评分可靠吗？
单次评分可能有偏差，建议：Few-shot 校准（提供评分示例）、多评委投票、与人工评分对比校准。

### Q: 评估频率怎么定？
建议：每次 PR 触发轻量评估（关键路径），每日全量评估，每周人工审核。
