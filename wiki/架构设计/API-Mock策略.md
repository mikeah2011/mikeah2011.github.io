# API Mock 策略

## 定义

API Mock 是在开发和测试阶段用虚拟接口替代真实服务的技术，使前后端能够并行开发，同时在集成测试中模拟各种边界条件和故障场景。三层 Mock 体系按环境分层：MSW（浏览器/Node.js 拦截）、Mockoon（团队级 Mock 服务）、WireMock（集成测试与契约验证）。

## 核心原理

### 三层架构

| 层级 | 工具 | 运行环境 | 适用场景 |
|------|------|----------|----------|
| L1 浏览器层 | **MSW** (Mock Service Worker) | 浏览器 / Node.js | 前端本地开发、组件测试 |
| L2 服务层 | **Mockoon** | 本地 / CI / Docker | 快速 Mock 服务、团队协作 |
| L3 集成层 | **WireMock** | Standalone JVM | 集成测试、契约验证、故障注入 |

### MSW — 浏览器请求拦截

基于 Service Worker API 拦截浏览器发出的 HTTP 请求，无需修改业务代码。支持 Vue/TypeScript 集成，通过环境变量 `VITE_MOCK` 控制开关。Node.js 模式用于 Vitest/Jest 单元测试。

**核心原理**：Service Worker 拦截 fetch → 返回预定义 handler → 业务代码无感知。

### Mockoon — GUI/CLI Mock 服务

Electron 架构的桌面应用，支持 GUI 编辑路由规则和 JSON 配置导入导出。CLI 版本支持 Docker 部署，可集成到 CI 流水线。

**核心原理**：独立 HTTP 服务器 → 路由匹配 → 返回预定义响应 → 团队共享配置文件。

### WireMock — 精确匹配与状态机

Java 实现的 Mock 服务器，支持 Scenario 状态机模拟工作流（如订单状态流转）。内置录制/回放功能、精确匹配规则和故障注入能力。

**核心原理**：状态机驱动 → 场景转换 → 模拟真实业务流程 → 支持超时/断连等异常模拟。

### 环境分层策略

```
开发环境 → MSW（浏览器拦截，零依赖）
    ↓
联调环境 → Mockoon（独立服务，团队共享）
    ↓
测试环境 → WireMock（集成验证，故障注入）
    ↓
预发环境 → 真实服务（端到端验证）
```

### 契约测试防漂移

Mock 数据可能与真实 API 不一致（Mock 漂移）。Pact 契约测试通过消费者驱动契约（Consumer-Driven Contract）确保 Mock 与真实 API 保持一致：
1. 消费者定义期望数据格式 → 生成 Pact 文件
2. 提供者验证是否满足所有消费者契约
3. CI 中自动运行 `can-i-deploy` 门禁检查

## 实战案例

来自博客文章：[API Mock 策略实战：WireMock/Mockoon/MSW 三层 Mock 体系——从开发到测试到生产的接口隔离](/2026/06/06/2026-06-06-API-Mock-策略实战-WireMock-Mockoon-MSW-三层Mock体系/)

**关键技术点**：
- MSW 2.x Service Worker 拦截 + 环境变量门控
- Mockoon CLI 7.x Docker 部署 + JSON 配置版本管理
- WireMock 3.5 Scenario 状态机 + 录制回放
- 5 大踩坑：MSW 缓存残留、WireMock JSON 数字精度、Mock 数据维护、多人一致性、Mock 泄漏到生产

## 相关概念

- [API 生命周期管理](API生命周期管理.md) - Mock 是 API 设计阶段的重要实践
- [API 治理进阶](API治理进阶.md) - AsyncAPI Mock Server 生成
- [数据契约与契约测试](数据契约与契约测试.md) - Pact 消费者驱动契约
- [BFF 模式](BFF模式.md) - BFF 层 Mock 与前端并行开发

## 常见问题

**Q: MSW 缓存导致 Mock 行为残留？**
A: Service Worker 有独立缓存生命周期。每次切换 Mock/真实模式后，需在 DevTools → Application → Storage 中清除站点数据，或使用 `worker.stop()` 强制注销。

**Q: WireMock JSON 中 Long 类型精度丢失？**
A: Java JSON 库默认将大数字解析为 Double。在 WireMock stub 中使用字符串包裹 Long 值，或配置 `Jackson ObjectMapper` 使用 `DeserializationFeature.USE_LONG_FOR_INTS`。

**Q: Mock 数据与真实 API 不一致怎么办？**
A: 引入 Pact 契约测试。消费者编写测试定义期望 → 生成 Pact 文件 → 提供者 CI 中验证。配合 `can-i-deploy` 确保不会在契约不兼容时部署。

**Q: 如何防止 Mock 泄漏到生产环境？**
A: CI 流水线中添加守卫步骤——扫描代码中 `VITE_MOCK=true`、Mockoon 启动脚本、WireMock 配置文件等。使用 GitHub Actions `paths-filter` 确保 Mock 配置不进入生产构建。
