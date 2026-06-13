
title: AI Agent + uni-app 实战：移动端 AI 助手集成与离线推理
keywords: [AI, Agent]
date: 2026-06-02 02:31:05
tags:
- AI
- uni-app
- 移动端
- 离线推理
categories:
  - ai
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
description: 本文系统梳理 AI Agent 在 uni-app 移动端落地的完整工程实践，涵盖云端大模型接入、WebSocket 流式对话、上下文管理、多端适配与性能优化，并重点介绍离线推理在弱网和隐私场景下的应用策略。通过真实代码结构、架构拆解与上线清单，帮助开发者快速构建稳定可用的移动端智能助手。
---


# AI Agent + uni-app 实战：移动端 AI 助手集成与离线推理

过去两年，AI Agent 从“能聊天”快速走向“能执行任务”。而移动端，则是 AI Agent 真正走向高频场景的关键入口。相比桌面端，手机天然具备摄像头、麦克风、定位、通知、通讯录、相册、蓝牙、传感器等能力，用户又几乎全天在线，因此“AI 助手”一旦落到移动端，就不再只是一个问答窗口，而是能够连接真实生活流程的任务操作系统。

对前端和全栈开发者来说，**uni-app + 云端大模型 + 本地轻量推理**，是目前相对务实的一条落地路线：

- 用 **uni-app** 获得多端统一开发能力；
- 用 **云端 LLM API** 解决复杂推理、知识问答、工具调用；
- 用 **WebSocket 流式输出** 提升交互速度和“正在思考”的感知；
- 用 **本地 ONNX / TFLite / Core ML** 承担离线分类、关键词检测、轻量意图识别、缓存补全等任务；
- 用 **上下文窗口管理** 与 **对话 UI 设计** 保证体验可控、成本可控、性能可控。

这篇文章不是概念综述，而是一篇偏“实战工程化”的技术博客。我们会围绕一个典型项目：**基于 uni-app 构建一个移动端 AI 助手**，覆盖从云端接入、流式对话、离线推理到多端适配、性能优化、踩坑复盘的完整过程。文中代码会尽量贴近实际项目结构，便于直接迁移。

---

## 一、移动端 AI 助手的场景与价值

很多团队在做 AI 产品时，第一反应是“先接一个聊天框”。但移动端 AI 助手真正有价值的，不是聊天本身，而是**把聊天作为任务入口**。换句话说，用户不是为了和模型聊天而聊天，而是为了更快完成某个动作。

### 1.1 典型场景拆解

移动端 AI 助手常见落地场景大致有下面几类：

1. **内容助手**：写文案、润色标题、生成摘要、翻译、改写；
2. **生活助手**：行程规划、饮食建议、运动打卡、记账分析；
3. **工作助手**：会议总结、日报周报生成、表单填写辅助、CRM 跟进建议；
4. **业务助手**：客服问答、商品推荐、售后分流、订单解释；
5. **设备助手**：智能家居控制、车机场景、穿戴设备语音指令；
6. **离线智能助手**：弱网环境下做图像识别、OCR 前处理、意图识别、语音唤醒等。

如果从工程实现角度看，这些场景往往由三层能力组合而成：

- **感知层**：文本、图片、语音、位置、设备状态；
- **推理层**：云端 LLM、本地模型、规则引擎；
- **执行层**：页面跳转、调用接口、系统通知、业务动作。

### 1.2 为什么是 uni-app

在企业项目里，很多 AI 助手并不是只跑在 App 上，而是常常要求：

- H5 能打开；
- 微信小程序能跑；
- App 端体验要更完整；
- 某些业务还要覆盖企业微信、支付宝小程序等。

这时候 uni-app 的价值就体现出来了。它的优势不是“性能绝对最好”，而是：

- **多端复用高**，适合快速验证 AI 产品形态；
- **网络、存储、路由、媒体能力 API 相对统一**；
- **前端团队改造成本低**；
- **和现有业务页面整合快**。

当然，AI 场景对交互实时性、滚动体验、输入状态、长文本渲染、连接稳定性要求更高，所以 uni-app 不是无脑可用，而是需要配合一套专门的工程设计。

### 1.3 一个可落地的移动 AI 助手架构

下面是一个典型架构：

```ts
// 架构示意：前端职责划分
export interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  createdAt: number
  status?: 'pending' | 'streaming' | 'done' | 'error'
  tokens?: number
}

export interface AssistantRuntimeConfig {
  apiBaseUrl: string
  wsUrl: string
  model: string
  offlineModeEnabled: boolean
  maxContextTokens: number
  streamEnabled: boolean
}

export interface OfflineTask {
  taskType: 'intent' | 'keyword' | 'ocr-postprocess' | 'embedding-cache'
  input: string
  priority: 'low' | 'normal' | 'high'
}
```

在这个架构里：

- **前端页面层**：负责消息展示、输入、滚动、流式渲染；
- **会话管理层**：负责上下文裁剪、历史缓存、状态恢复；
- **AI 服务层**：负责调用 REST / WebSocket、异常重试、鉴权；
- **离线推理层**：负责轻量模型加载、设备兼容、降级策略；
- **平台适配层**：处理 H5 / 小程序 / App 差异。

### 1.4 价值不只在“更智能”，也在“更省步骤”

一个好的移动端 AI 助手，评价标准通常不是 BLEU、ROUGE 或某个学术指标，而是：

- 用户是不是更快完成任务；
- 输入成本有没有降低；
- 页面跳转次数有没有减少；
- 客服、运营、销售的人工耗时有没有下降；
- 弱网和无网场景是否仍有最低可用能力。

例如一个电商导购助手，如果只是能回答“这件衣服适合春天穿吗”，价值其实很有限；但如果它能：

1. 识别用户意图；
2. 联动商品详情；
3. 根据库存和尺码推荐；
4. 自动生成购买建议；
5. 支持弱网下继续做本地推荐兜底；

那就从“聊天机器人”变成了“交易转化工具”。

### 1.5 场景设计中的代码落点

开发时建议先把“场景”和“任务”结构化，否则很容易把 AI 助手做成一个无法维护的大杂烩。

```ts
// /common/assistant/scenes.ts
export const assistantScenes = {
  customerService: {
    code: 'customer_service',
    title: '客服助手',
    systemPrompt: '你是电商客服助手，需要优先解决售前售后咨询。',
    tools: ['queryOrder', 'queryRefundPolicy', 'searchProduct']
  },
  workReport: {
    code: 'work_report',
    title: '日报助手',
    systemPrompt: '你是工作汇报助手，擅长整理结构化日报、周报。',
    tools: ['readCalendar', 'readTodoList']
  },
  healthCoach: {
    code: 'health_coach',
    title: '健康助手',
    systemPrompt: '你是健康建议助手，只能给出一般性建议，不能替代医生诊断。',
    tools: ['readStepData', 'readSleepData']
  }
}
```

这个配置化做法有两个好处：

- 可以针对不同业务场景配置不同的 system prompt；
- 后续接入工具调用时，能做最小权限隔离。

**结论很简单：移动端 AI 助手不是“把 Web 聊天页搬到手机上”，而是“让 AI 与设备能力、业务流程、离线能力结合”**。只有这样，uni-app 的多端价值才真正能发挥出来。

---

## 二、uni-app 中调用云端 LLM API

云端 LLM 是移动 AI 助手的“主脑”。复杂推理、知识问答、长文本总结、多轮对话、工具调用，大多数情况下仍然要依赖云端模型。uni-app 中最直接的接入方式是通过 `uni.request` 调用后端代理接口，而不是在前端直接暴露模型 API Key。

### 2.1 为什么必须走服务端代理

不要在前端直接这样干：

```ts
// 错误示例：不要把大模型 API Key 写在前端
uni.request({
  url: 'https://api.xxx-llm.com/v1/chat/completions',
  method: 'POST',
  header: {
    Authorization: 'Bearer sk-xxxxx'
  }
})
```

原因很现实：

- 小程序/H5 代码都可能被反编译或抓包；
- API Key 一旦泄露，计费风险极高；
- 无法做用户级限流、审计、内容过滤；
- 很难统一切换模型供应商。

正确方式是：

```text
uni-app 前端 -> 自有业务后端 -> LLM 服务商 API
```

服务端代理可以承担：

- 用户鉴权；
- Prompt 注入；
- 黑白名单过滤；
- 敏感词审核；
- 模型路由；
- token 计费统计；
- 失败重试与熔断。

### 2.2 uni.request 的封装方式

先做一个统一请求层：

```ts
// /services/http.ts
const BASE_URL = 'https://api.example.com'

interface RequestOptions<T = any> {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: T
  header?: Record<string, string>
  timeout?: number
}

export function request<T = any>(options: RequestOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = uni.getStorageSync('token') || ''

    uni.request({
      url: `${BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      timeout: options.timeout || 30000,
      header: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
        ...options.header
      },
      success: (res: any) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T)
        } else {
          reject({
            code: res.statusCode,
            message: res.data?.message || '请求失败',
            raw: res.data
          })
        }
      },
      fail: (err) => reject(err)
    })
  })
}
```

然后再封装 AI 接口：

```ts
// /services/llm.ts
import { request } from './http'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatPayload {
  sessionId: string
  scene: string
  messages: LLMMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface ChatResponse {
  reply: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  requestId: string
}

export function createChatCompletion(data: ChatPayload) {
  return request<ChatResponse>({
    url: '/ai/chat',
    method: 'POST',
    data
  })
}
```

### 2.3 页面中接入对话逻辑

在 uni-app 页面里，通常会把消息状态和发送逻辑拆开：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { createChatCompletion } from '@/services/llm'

const inputValue = ref('')
const sessionId = ref(`s_${Date.now()}`)
const messages = ref<any[]>([])
const loading = ref(false)

async function sendMessage() {
  const content = inputValue.value.trim()
  if (!content || loading.value) return

  messages.value.push({
    id: `u_${Date.now()}`,
    role: 'user',
    content
  })

  inputValue.value = ''
  loading.value = true

  try {
    const payload = {
      sessionId: sessionId.value,
      scene: 'customer_service',
      messages: messages.value.map(item => ({
        role: item.role,
        content: item.content
      })),
      model: 'gpt-4.1-mini',
      temperature: 0.7,
      maxTokens: 800
    }

    const res = await createChatCompletion(payload)

    messages.value.push({
      id: `a_${Date.now()}`,
      role: 'assistant',
      content: res.reply,
      usage: res.usage
    })
  } catch (error: any) {
    messages.value.push({
      id: `e_${Date.now()}`,
      role: 'assistant',
      content: `抱歉，当前请求失败：${error?.message || '未知错误'}`,
      error: true
    })
  } finally {
    loading.value = false
  }
}
</script>
```

### 2.4 云端调用的关键工程问题

真正上线时，调用云端 LLM 远不只是“发个 POST 请求”这么简单。最常见的问题包括：

#### 问题一：超时

移动端网络环境很差，4G、Wi-Fi、地铁、电梯切换频繁，大模型接口又常常需要数秒甚至十几秒。建议：

- 前端请求超时设为 20~30 秒；
- 服务端与模型供应商之间单独做更长超时；
- 前端必须有“正在思考”“重新生成”“取消”机制；
- 超时不要直接丢上下文，要支持继续追问。

#### 问题二：幂等性

用户连续点击发送按钮，或弱网重试，很容易发出重复请求。建议引入 `clientMessageId`：

```ts
export interface ChatPayload {
  sessionId: string
  clientMessageId: string
  scene: string
  messages: LLMMessage[]
}
```

服务端收到相同 `clientMessageId` 时，只返回第一次处理结果，避免重复扣费。

#### 问题三：安全合规

如果你的业务有客服、医疗、金融、教育等属性，服务端最好做以下控制：

- 敏感问题转人工；
- 特定场景强制加免责声明；
- 用户输入脱敏存储；
- 模型输出审查；
- 审计日志与 requestId 关联。

### 2.5 建议的服务端返回结构

推荐服务端返回更多元数据，前端后续做统计、重试、埋点会更方便：

```json
{
  "requestId": "req_202606020001",
  "sessionId": "s_1748800000",
  "reply": "可以的，我来帮你分析这次订单问题。",
  "usage": {
    "promptTokens": 1250,
    "completionTokens": 230,
    "totalTokens": 1480
  },
  "model": "gpt-4.1-mini",
  "safety": {
    "blocked": false,
    "riskTags": []
  }
}
```

### 2.6 深度分析：为什么移动端要“服务端主导”

桌面 Web 项目里，很多人习惯把业务逻辑尽可能前置到前端。但 AI 项目恰好相反：**能力越强、成本越高、风险越大，越应该往后端集中**。移动端前端主要负责三件事：

1. 高质量采集用户输入；
2. 高质量反馈模型输出；
3. 管理会话态与交互体验。

而 Prompt 编排、工具调用、模型路由、风控与监控，应尽量收拢到服务端。这样前端才能在 uni-app 的多端环境里保持统一。

---

## 三、WebSocket 流式对话实现

AI 助手如果等模型完整回答后一次性展示，用户会觉得“卡”“假”“像在等接口”。而流式输出最大的意义，不只是更快，而是**让用户感知系统在持续工作**。在移动端，这种感知尤其重要，因为用户随时可能切走页面。

### 3.1 为什么流式输出优先选 WebSocket

技术上，流式输出有几种方式：

- HTTP Chunked / SSE；
- WebSocket；
- 长轮询。

在 uni-app 多端场景下，SSE 的兼容性和封装体验不如 WebSocket 稳定，尤其是小程序端与 App 端的差异会更多。所以实践里更建议：

- **普通问答**：可先用 `uni.request`；
- **流式问答**：优先统一到 WebSocket；
- **工具调用过程、多事件回传**：也适合 WebSocket。

### 3.2 WebSocket 连接管理器

先封装一个连接管理类，而不是在页面里直接写回调地狱。

```ts
// /services/chat-socket.ts
interface StreamChunk {
  type: 'start' | 'delta' | 'end' | 'error' | 'usage'
  sessionId: string
  messageId: string
  delta?: string
  fullText?: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  error?: string
}

class ChatSocket {
  private socketTask: UniApp.SocketTask | null = null
  private connected = false
  private messageHandlers: Array<(data: StreamChunk) => void> = []
  private closeHandlers: Array<() => void> = []

  connect(url: string, token: string) {
    return new Promise<void>((resolve, reject) => {
      if (this.socketTask && this.connected) {
        resolve()
        return
      }

      this.socketTask = uni.connectSocket({
        url: `${url}?token=${encodeURIComponent(token)}`,
        complete: () => {}
      })

      this.socketTask.onOpen(() => {
        this.connected = true
        resolve()
      })

      this.socketTask.onMessage((res) => {
        try {
          const data: StreamChunk = JSON.parse(res.data as string)
          this.messageHandlers.forEach(fn => fn(data))
        } catch (e) {
          console.error('ws parse error', e)
        }
      })

      this.socketTask.onClose(() => {
        this.connected = false
        this.closeHandlers.forEach(fn => fn())
      })

      this.socketTask.onError((err) => {
        this.connected = false
        reject(err)
      })
    })
  }

  send(payload: Record<string, any>) {
    if (!this.socketTask || !this.connected) {
      throw new Error('WebSocket 未连接')
    }

    this.socketTask.send({
      data: JSON.stringify(payload)
    })
  }

  onMessage(handler: (data: StreamChunk) => void) {
    this.messageHandlers.push(handler)
  }

  onClose(handler: () => void) {
    this.closeHandlers.push(handler)
  }

  close() {
    this.socketTask?.close({ code: 1000, reason: 'manual close' })
    this.socketTask = null
    this.connected = false
  }
}

export const chatSocket = new ChatSocket()
```

### 3.3 页面中处理增量渲染

流式消息的关键，不是“收到一段文本就 append”，而是要正确维护消息状态，避免滚动抖动和重复渲染。

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { chatSocket } from '@/services/chat-socket'

const messages = ref<any[]>([])
const streamingMessageId = ref('')
const wsConnected = ref(false)

function upsertAssistantStreamingMessage(messageId: string, delta: string) {
  const target = messages.value.find(item => item.id === messageId)
  if (target) {
    target.content += delta
    target.status = 'streaming'
  } else {
    messages.value.push({
      id: messageId,
      role: 'assistant',
      content: delta,
      status: 'streaming'
    })
  }
}

async function initSocket() {
  const token = uni.getStorageSync('token')
  await chatSocket.connect('wss://api.example.com/ai/chat-stream', token)
  wsConnected.value = true

  chatSocket.onMessage((packet) => {
    if (packet.type === 'start') {
      streamingMessageId.value = packet.messageId
      upsertAssistantStreamingMessage(packet.messageId, '')
    }

    if (packet.type === 'delta') {
      upsertAssistantStreamingMessage(packet.messageId, packet.delta || '')
      scrollToBottomDebounced()
    }

    if (packet.type === 'end') {
      const target = messages.value.find(item => item.id === packet.messageId)
      if (target) {
        target.status = 'done'
        target.fullText = packet.fullText || target.content
      }
    }

    if (packet.type === 'usage') {
      const target = messages.value.find(item => item.id === packet.messageId)
      if (target) {
        target.usage = packet.usage
      }
    }

    if (packet.type === 'error') {
      const target = messages.value.find(item => item.id === packet.messageId)
      if (target) {
        target.status = 'error'
        target.error = packet.error
      }
    }
  })
}

function sendStreamMessage(content: string) {
  const clientMessageId = `msg_${Date.now()}`

  messages.value.push({
    id: clientMessageId,
    role: 'user',
    content
  })

  chatSocket.send({
    action: 'chat',
    sessionId: 's_demo_001',
    clientMessageId,
    scene: 'customer_service',
    stream: true,
    messages: messages.value.map(item => ({
      role: item.role,
      content: item.content
    }))
  })
}

function scrollToBottomDebounced() {
  clearTimeout((scrollToBottomDebounced as any).timer)
  ;(scrollToBottomDebounced as any).timer = setTimeout(() => {
    uni.pageScrollTo({
      scrollTop: 999999,
      duration: 80
    })
  }, 50)
}

onMounted(initSocket)
onUnmounted(() => chatSocket.close())
</script>
```

### 3.4 数据协议设计建议

很多项目 WebSocket 不稳定，本质问题不是协议本身，而是协议设计太随意。建议至少定义这些事件：

```json
{ "type": "start", "messageId": "a_001", "sessionId": "s_001" }
{ "type": "delta", "messageId": "a_001", "delta": "你好，" }
{ "type": "delta", "messageId": "a_001", "delta": "我来帮你分析。" }
{ "type": "usage", "messageId": "a_001", "usage": { "totalTokens": 500 } }
{ "type": "end", "messageId": "a_001", "fullText": "你好，我来帮你分析。" }
```

核心原则：

- `start` 表示前端可以创建占位消息；
- `delta` 只追加增量；
- `end` 兜底给完整文本，便于前端校验；
- `usage` 独立上报，避免和内容耦合；
- `error` 能定位到具体 messageId。

### 3.5 心跳、重连与页面生命周期

移动端 WebSocket 最大的问题不是“连不上”，而是：

- 切后台后被系统挂起；
- 网络切换后连接失效；
- 小程序端页面切换导致 socket 被清理；
- 心跳频率太高造成额外耗电。

可以这样设计：

```ts
// /services/socket-heartbeat.ts
export function startHeartbeat(socket: { send: (payload: any) => void }) {
  const timer = setInterval(() => {
    socket.send({ action: 'ping', ts: Date.now() })
  }, 25000)

  return () => clearInterval(timer)
}
```

建议：

- 心跳间隔控制在 20~30 秒；
- 页面进入前台时检查连接状态，不在后台持续高频保活；
- 断线重连使用指数退避：1s、2s、4s、8s，最多 5 次；
- 重连后仅恢复“当前活跃会话”，不要一次拉起所有历史连接。

### 3.6 深度分析：流式输出真正难的是 UI 协调

很多人以为 WebSocket 的难点是网络协议，其实在移动端，真正难的是：

- 增量文本导致布局不断变化；
- markdown 渲染频繁重排；
- 输入法弹起时滚动区域变化；
- 自动滚动与用户手动上滑冲突；
- 长文本流式更新引发卡顿。

所以工程上一定要牢记：**流式输出问题，七成是 UI 状态管理问题，三成才是连接问题。** 后面讲 UI 组件设计时会继续展开。

---

## 四、本地离线推理方案：ONNX / TFLite / Core ML

所有 AI 能力都走云端，体验会很好理解，但成本、时延、弱网可用性和隐私都会出问题。移动端真正成熟的做法，通常是：**云端大模型负责复杂认知，本地轻量模型负责快速判断和离线兜底。**

### 4.1 离线推理适合做什么，不适合做什么

先给结论：目前在 uni-app 项目里，本地离线推理更适合这些任务：

- 文本意图分类；
- 关键词提取；
- 文本安全初筛；
- 小型 embedding 检索缓存；
- OCR 后处理纠错；
- 轻量图像分类；
- 语音唤醒/命令词识别；
- 个性化排序特征预处理。

不太适合直接在大多数移动设备上做的任务：

- 7B/14B 级通用大语言模型长文本生成；
- 长时间连续高负载生成；
- 超大上下文复杂推理；
- 多模态大模型完整推理流水线。

换句话说，本地模型应该是“助手的前哨站”和“故障兜底器”，而不是在多数业务里完全替代云端主模型。

### 4.2 三类主流方案对比

#### 方案一：ONNX Runtime Mobile

优点：

- 跨平台性强；
- 模型生态广；
- 适合已有 PyTorch/ONNX 导出链路；
- 安卓/iOS 都有较成熟支持。

缺点：

- 集成复杂度相对较高；
- 在 uni-app 中通常需要原生插件桥接；
- 不同算子支持情况要提前验证。

#### 方案二：TensorFlow Lite

优点：

- Android 生态成熟；
- 对轻量分类、CV 任务支持好；
- 量化工具相对完善。

缺点：

- iOS 与跨端统一体验不如 ONNX + Core ML 组合直接；
- 文本生成类场景工程化接入复杂。

#### 方案三：Core ML

优点：

- iOS 端原生体验最佳；
- 可利用 Apple 芯片上的硬件加速；
- 对功耗和调度相对更友好。

缺点：

- 强平台绑定；
- Android 端仍需另一套方案；
- 模型转换和调试门槛较高。

### 4.3 在 uni-app 里的现实接入方式

uni-app 自身不直接承担复杂本地推理能力，通常有三条路径：

1. **原生插件**：Android 插件接入 ONNX/TFLite，iOS 插件接入 Core ML/ONNX；
2. **UTS + 原生扩展**：用 UTS 封装平台能力，对前端暴露统一接口；
3. **Hybrid 方案**：核心推理在原生层，uni-app 只负责参数传递和结果展示。

推荐抽象出统一的离线推理接口：

```ts
// /services/offline-ai.ts
export interface OfflineInferOptions {
  task: 'intent' | 'keyword' | 'image_classify'
  input: string
  extra?: Record<string, any>
}

export interface OfflineInferResult {
  success: boolean
  label?: string
  score?: number
  tokens?: string[]
  error?: string
  latencyMs?: number
  provider?: 'onnx' | 'tflite' | 'coreml'
}

export async function runOfflineInference(
  options: OfflineInferOptions
): Promise<OfflineInferResult> {
  // #ifdef APP-PLUS
  return new Promise((resolve) => {
    const plugin = uni.requireNativePlugin('AI-Infer-Plugin')
    plugin.run(options, (result: OfflineInferResult) => {
      resolve(result)
    })
  })
  // #endif

  // #ifndef APP-PLUS
  return {
    success: false,
    error: '当前平台不支持本地推理',
    provider: undefined
  }
  // #endif
}
```

### 4.4 一个典型离线意图识别流程

比如在客服场景，用户输入“我要退货但是包装拆了还能退吗”，我们不一定要立刻把整句发到云端。可以先做本地意图分类：

- 是否为退款/退货意图；
- 是否为物流意图；
- 是否为人工转接意图；
- 是否包含风险关键词。

代码可以这样组织：

```ts
// /services/assistant-router.ts
import { runOfflineInference } from './offline-ai'
import { createChatCompletion } from './llm'

export async function routeUserQuery(content: string, messages: any[]) {
  const offlineResult = await runOfflineInference({
    task: 'intent',
    input: content
  })

  if (offlineResult.success && offlineResult.label === 'refund_policy' && offlineResult.score! > 0.9) {
    return {
      source: 'local-rule',
      reply: '你当前咨询的是退货规则问题，我可以先告诉你：若商品未明显影响二次销售，通常可以申请退货，具体以平台规则为准。是否需要我继续帮你查询完整规则？'
    }
  }

  return createChatCompletion({
    sessionId: `s_${Date.now()}`,
    scene: 'customer_service',
    messages
  })
}
```

这种方式的价值在于：

- 高频简单问题可以本地快速命中；
- 降低云端 token 消耗；
- 弱网时还能给出最低可用反馈；
- 某些安全场景可以先做本地预筛查。

### 4.5 模型体积与分发策略

离线推理最大的工程约束，不是“能不能跑”，而是：

- 包体大小；
- 首次下载成本；
- 内存占用；
- 启动加载时间；
- 发热与耗电。

实践建议：

1. **模型尽量量化**：INT8 / FP16 优先；
2. **按任务拆模型**：不要把所有能力打成一个大模型；
3. **动态下载**：首次安装不内置全部模型，按场景下载；
4. **版本化缓存**：模型文件命名带 hash/version；
5. **后台预热**：只在充电/Wi-Fi/空闲时做模型预加载。

例如：

```ts
// /services/model-manager.ts
export interface LocalModelMeta {
  name: string
  version: string
  sizeMB: number
  localPath?: string
  downloaded: boolean
  hash: string
}

export async function ensureModelReady(model: LocalModelMeta) {
  if (model.downloaded && model.localPath) return model.localPath

  const networkType = await getNetworkType()
  if (networkType !== 'wifi' && model.sizeMB > 20) {
    throw new Error('当前非 Wi-Fi，暂不下载大体积模型')
  }

  // 真实项目中这里调用下载 API
  return `/models/${model.name}_${model.version}.bin`
}

function getNetworkType(): Promise<string> {
  return new Promise((resolve) => {
    uni.getNetworkType({
      success(res) {
        resolve(res.networkType)
      },
      fail() {
        resolve('unknown')
      }
    })
  })
}
```

### 4.6 深度分析：离线推理的正确定位

很多团队一听“端侧 AI”就非常兴奋，试图把一切都搬到本地。但经验上看，**本地模型不是替代云端，而是优化云端**。它最适合做三件事：

- **前置判断**：先判断用户意图、风险等级、是否需要联网；
- **中间增强**：对 OCR、ASR、搜索结果做本地修正；
- **失败兜底**：网络断开时给出基础可用答案或操作建议。

在 uni-app 的技术栈里，这种“端云协同”的收益远高于“强行全端侧生成”。

---

## 五、AI 对话 UI 组件设计

如果说模型质量决定了上限，那么 UI 组件设计决定了用户能不能长期用。移动端 AI 对话比普通 IM 更复杂，因为它同时具备：

- 长文本展示；
- 流式增量更新；
- markdown / 代码块渲染；
- 输入法遮挡；
- 快捷提问；
- 多状态反馈；
- 错误重试与继续生成。

所以，建议从一开始就把聊天页做成**组件化、状态驱动**的结构，而不是一个大页面里混杂所有逻辑。

### 5.1 推荐组件划分

一个典型的聊天页，可以拆成下面几个组件：

- `ChatMessageList`：消息列表；
- `ChatMessageItem`：单条消息；
- `ChatInputBar`：输入栏；
- `ThinkingIndicator`：思考中动画；
- `SuggestionChips`：快捷问题建议；
- `MarkdownRenderer`：Markdown/代码块渲染；
- `ChatToolbar`：重试、复制、重新生成、停止生成按钮。

消息数据结构建议一开始就设计完整：

```ts
// /types/chat.ts
export interface ChatMessageItem {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  status: 'pending' | 'streaming' | 'done' | 'error'
  createdAt: number
  errorMessage?: string
  usage?: {
    totalTokens: number
  }
  actions?: Array<'copy' | 'retry' | 'regenerate'>
  extra?: {
    markdown?: boolean
    thinking?: boolean
    sourceDocs?: string[]
  }
}
```

### 5.2 消息项组件示例

```vue
<!-- /components/chat/ChatMessageItem.vue -->
<template>
  <view class="message-item" :class="[`role-${message.role}`]">
    <view class="avatar">
      <text>{{ message.role === 'user' ? '我' : 'AI' }}</text>
    </view>
    <view class="bubble">
      <view v-if="message.extra?.thinking && message.status === 'streaming'" class="thinking">
        正在思考...
      </view>

      <view v-if="message.extra?.markdown" class="markdown-body">
        <rich-text :nodes="renderedNodes"></rich-text>
      </view>
      <text v-else selectable class="plain-text">{{ message.content }}</text>

      <view v-if="message.status === 'error'" class="error-box">
        {{ message.errorMessage || '生成失败，请稍后重试' }}
      </view>

      <view class="actions" v-if="message.role === 'assistant' && message.status !== 'pending'">
        <text @click="$emit('copy', message)">复制</text>
        <text @click="$emit('regenerate', message)">重试</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ message: any }>()

const renderedNodes = computed(() => {
  // 真实项目可接 markdown 解析器，这里示意
  return [{ name: 'div', children: [{ type: 'text', text: props.message.content }] }]
})
</script>

<style scoped>
.message-item { display: flex; margin-bottom: 24rpx; }
.role-user { flex-direction: row-reverse; }
.avatar { width: 64rpx; height: 64rpx; border-radius: 50%; background: #ddd; display:flex; align-items:center; justify-content:center; }
.bubble { max-width: 72%; padding: 20rpx; border-radius: 20rpx; background: #f4f6f8; }
.role-user .bubble { background: #d7f4df; }
.thinking { font-size: 24rpx; color: #999; margin-bottom: 8rpx; }
.actions { display:flex; gap: 16rpx; margin-top: 12rpx; color:#4a67ff; font-size: 24rpx; }
.error-box { color:#d93025; margin-top: 8rpx; }
</style>
```

### 5.3 输入栏设计要点

AI 聊天输入栏不是普通表单，它至少要支持：

- 多行输入自动增高；
- 发送中禁用重复点击；
- 支持快捷模板；
- 支持语音/图片入口；
- 支持“停止生成”；
- 键盘弹起时不遮挡最近消息。

```vue
<!-- /components/chat/ChatInputBar.vue -->
<template>
  <view class="input-bar">
    <textarea
      v-model="innerValue"
      class="textarea"
      :maxlength="5000"
      :auto-height="true"
      placeholder="输入你的问题，或让 AI 帮你完成任务"
      @confirm="handleSend"
    />
    <button class="send-btn" :disabled="disabled || !innerValue.trim()" @click="handleSend">
      {{ streaming ? '发送中' : '发送' }}
    </button>
    <button v-if="streaming" class="stop-btn" @click="$emit('stop')">停止</button>
  </view>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ value: string; disabled?: boolean; streaming?: boolean }>()
const emit = defineEmits(['update:value', 'send', 'stop'])
const innerValue = ref(props.value || '')

watch(() => props.value, (val) => {
  innerValue.value = val || ''
})

function handleSend() {
  const text = innerValue.value.trim()
  if (!text) return
  emit('send', text)
  emit('update:value', '')
  innerValue.value = ''
}
</script>
```

### 5.4 滚动区域的正确处理

聊天页最容易出问题的是滚动。很多团队一上来就全量 `scrollTop = 999999`，结果导致：

- 用户正在往上看历史消息时被强制拉到底部；
- 流式输出时持续抖动；
- 键盘弹起时位置错乱；
- H5 和小程序行为不一致。

正确思路是：

1. 维护一个 `isNearBottom` 状态；
2. 只有用户本来就在底部附近时，流式消息才自动跟随；
3. 用户上滑查看历史后，不再强制拉到底；
4. 出现新消息提示“点击回到底部”。

```ts
const isNearBottom = ref(true)

function onScroll(e: any) {
  const { scrollHeight, scrollTop, clientHeight } = e.detail
  isNearBottom.value = scrollHeight - scrollTop - clientHeight < 120
}

function tryAutoScrollToBottom() {
  if (!isNearBottom.value) return
  uni.pageScrollTo({
    scrollTop: 999999,
    duration: 100
  })
}
```

### 5.5 Markdown 与代码块渲染策略

AI 输出经常带：

- 标题；
- 列表；
- 表格；
- 引用；
- 代码块。

但在移动端，完全实时地对每个 delta 重新跑 markdown 解析，很容易卡。实际建议是：

- **流式过程中先按纯文本渲染**；
- **收到 end 事件后，再做一次完整 markdown 解析**；
- **代码块单独高亮，不要对整段富文本反复重排**。

```ts
function finalizeStreamingMessage(message: any) {
  message.status = 'done'
  message.extra = {
    ...message.extra,
    markdown: true
  }
}
```

### 5.6 深度分析：AI 对话 UI 是“异步状态界面”

传统页面多是“点击 -> 请求 -> 返回 -> 渲染”，状态链路比较短。而 AI 对话页更像一个异步事件总线：

- 用户输入；
- 本地校验；
- 离线模型判断；
- 云端请求；
- 流式增量；
- 工具调用；
- 最终落盘；
- 失败重试。

因此如果组件边界不清晰，后续加语音、图片、多模态、引用卡片时会很痛苦。建议从一开始就把**消息状态、输入状态、网络状态、滚动状态**分离建模。

---

## 六、上下文窗口管理

大模型不是“记忆无限”的。移动端 AI 助手如果不做上下文管理，很快会遇到四个问题：

- token 成本飙升；
- 响应越来越慢；
- 旧上下文污染当前问题；
- 前端历史消息越来越长，性能变差。

因此，上下文窗口管理不是优化项，而是必做项。

### 6.1 上下文管理的三个层级

一个完整会话，建议拆成三层：

1. **显示层消息**：给用户看的完整聊天记录；
2. **模型层上下文**：真正发给 LLM 的裁剪后消息；
3. **记忆层摘要**：对历史轮次做压缩记忆。

也就是说，前端可以显示 100 条消息，但发给模型的也许只有最近 12 条 + 一段摘要。

### 6.2 估算 token 的前端策略

前端通常很难精确计算 token，但可以先做近似估算，避免每次把全部消息都带上。

```ts
// /utils/token-estimator.ts
export function estimateTokens(text: string) {
  if (!text) return 0
  // 粗略估算：中文约 1 字 ~ 1-2 token，英文按单词和符号折中
  return Math.ceil(text.length * 1.2)
}

export function estimateMessageTokens(messages: Array<{ content: string; role: string }>) {
  return messages.reduce((sum, item) => {
    return sum + estimateTokens(item.content) + 8
  }, 0)
}
```

这不是精确计费，但足够做前端预裁剪。

### 6.3 滑动窗口裁剪实现

最简单可落地的方法就是滑动窗口：保留 system prompt + 最近 N 条消息，直到达到 token 预算。

```ts
// /services/context-manager.ts
import { estimateTokens } from '@/utils/token-estimator'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function buildModelContext(
  messages: Message[],
  maxTokens = 6000,
  reserveTokens = 1200
) {
  const systemMessages = messages.filter(m => m.role === 'system')
  const chatMessages = messages.filter(m => m.role !== 'system')

  const result: Message[] = [...systemMessages]
  let used = systemMessages.reduce((sum, item) => sum + estimateTokens(item.content), 0)

  for (let i = chatMessages.length - 1; i >= 0; i--) {
    const current = chatMessages[i]
    const cost = estimateTokens(current.content) + 10

    if (used + cost > maxTokens - reserveTokens) {
      break
    }

    result.splice(systemMessages.length, 0, current)
    used += cost
  }

  return result
}
```

这里的 `reserveTokens` 是给模型回复预留空间，避免 prompt 吃满上下文后没有输出预算。

### 6.4 历史摘要策略

只保留最近几轮并不够，因为用户可能在第 20 轮引用第 2 轮的信息。解决方法是**摘要记忆**：把旧消息压缩成一段“会话摘要”。

```ts
export interface ConversationMemory {
  sessionId: string
  summary: string
  updatedAt: number
}

export function injectSummaryMemory(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  memory?: ConversationMemory
) {
  if (!memory?.summary) return messages

  return [
    {
      role: 'system' as const,
      content: `以下是此前对话摘要，请在后续回复中参考，但若与用户最新明确表达冲突，以最新表达为准：${memory.summary}`
    },
    ...messages
  ]
}
```

摘要可以在服务端生成，也可以在满足某个轮次数后异步生成，例如：

- 每 10 轮对话生成一次摘要；
- 历史 token 超过阈值时触发摘要；
- 会话切后台时异步总结最近主题。

### 6.5 检索增强与上下文分层

如果你的 AI 助手还要接业务知识库，那就不能只靠“聊天历史”，还要把上下文分成：

- 会话历史；
- 用户画像；
- 业务知识检索结果；
- 当前页面状态；
- 工具返回结果。

前端可组织为结构化 payload：

```ts
export interface ChatRequestPayload {
  sessionId: string
  scene: string
  messages: Array<{ role: string; content: string }>
  memorySummary?: string
  pageContext?: {
    route: string
    productId?: string
    orderId?: string
  }
  retrievalContext?: Array<{
    title: string
    content: string
    score: number
  }>
}
```

这样做的好处是：服务端能够区分“聊天历史”和“外部知识”，避免所有东西都拼成一个大 prompt。

### 6.6 深度分析：上下文管理的核心是“控制信息熵”

很多 AI 助手回复质量下降，不是模型不够强，而是上下文太脏。移动端场景尤其如此，因为用户输入通常更碎片化、更口语化、更容易跳话题。

所以一个高质量上下文管理器，目标不是“尽可能保留更多历史”，而是：

- 保留当前任务最相关的信息；
- 删除无关噪声；
- 压缩旧信息；
- 给模型清晰边界。

你可以把它理解为：**上下文窗口管理，本质上是在做对话态的信息架构。**

---

## 七、多端适配：小程序 / H5 / App 差异处理

uni-app 的核心优势是多端，但 AI 场景会把多端差异放大。因为 AI 页不是普通表单页，它需要长连接、滚动、高频渲染、键盘处理、媒体输入、本地存储、原生推理能力，而这些点恰好最容易出现平台差异。

### 7.1 网络能力差异

#### H5

- 受浏览器 CORS、SSE/WebSocket 策略影响；
- 页面切后台时可能被浏览器限频；
- 本地文件访问和模型缓存能力弱。

#### 小程序

- 请求域名、WebSocket 域名需要平台白名单；
- 某些 header 受限制；
- 页面与组件生命周期和 Web 不同；
- 长连接在切后台时更容易被系统回收。

#### App

- 网络自由度更高；
- 原生插件能力更强；
- 更适合接本地推理和多媒体能力；
- 但也要关注系统权限、发热、后台策略。

### 7.2 条件编译是第一道防线

uni-app 最实用的方式仍然是条件编译：

```ts
export function getPlatformCapabilities() {
  return {
    websocket: true,
    offlineInference:
      // #ifdef APP-PLUS
      true
      // #endif
      // #ifndef APP-PLUS
      false
      // #endif
  }
}
```

更实际一点，可以直接对不同端返回不同实现：

```ts
export async function selectStreamTransport() {
  // #ifdef H5
  return 'websocket'
  // #endif

  // #ifdef MP-WEIXIN
  return 'websocket'
  // #endif

  // #ifdef APP-PLUS
  return 'websocket'
  // #endif
}
```

虽然看起来三端都是 websocket，但后续你可以在各端走不同重连策略、埋点或鉴权逻辑。

### 7.3 键盘与安全区适配

聊天页在不同平台最容易“炸”的地方之一，就是输入框与键盘。

常见问题：

- iOS 安全区导致输入栏被 Home Indicator 挡住；
- 安卓部分机型键盘顶起布局异常；
- 小程序里 textarea 高度变化滞后；
- H5 浏览器地址栏收缩导致视口高度变化。

建议抽一个底部安全区计算：

```ts
// /utils/layout.ts
export function getSafeAreaBottom() {
  const info = uni.getSystemInfoSync()
  const safeAreaInsetsBottom = (info as any).safeAreaInsets?.bottom || 0
  return safeAreaInsetsBottom
}
```

然后在输入栏上应用：

```vue
<template>
  <view class="chat-footer" :style="{ paddingBottom: `${safeBottom}px` }">
    <ChatInputBar />
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getSafeAreaBottom } from '@/utils/layout'

const safeBottom = ref(0)
onMounted(() => {
  safeBottom.value = getSafeAreaBottom()
})
</script>
```

### 7.4 本地能力的端差异封装

离线推理、语音识别、图片压缩等功能，不要在业务页面写 `#ifdef`。应该收敛到适配层：

```ts
// /platform/ai-capability.ts
export async function canUseOfflineAI() {
  // #ifdef APP-PLUS
  return true
  // #endif
  // #ifndef APP-PLUS
  return false
  // #endif
}

export async function callOfflineIntentModel(text: string) {
  // #ifdef APP-PLUS
  const plugin = uni.requireNativePlugin('AI-Infer-Plugin')
  return new Promise((resolve) => {
    plugin.intent({ text }, (res: any) => resolve(res))
  })
  // #endif

  // #ifndef APP-PLUS
  return { success: false, error: 'unsupported platform' }
  // #endif
}
```

### 7.5 存储策略差异

聊天历史通常需要本地缓存，但不同平台存储上限与序列化性能不同。建议：

- 最近消息列表只缓存必要字段；
- 长内容按会话分片存储；
- 避免每次 delta 都写入本地；
- 流式完成后再落盘；
- 图片/附件不要直接塞 `storageSync`。

```ts
export function persistSessionMessages(sessionId: string, messages: any[]) {
  const simplified = messages.map(item => ({
    id: item.id,
    role: item.role,
    content: item.content,
    createdAt: item.createdAt,
    status: item.status
  }))

  uni.setStorage({
    key: `chat_session_${sessionId}`,
    data: simplified
  })
}
```

### 7.6 深度分析：多端不是“一套代码跑 everywhere”

很多人对 uni-app 的期待是“一次开发，处处一致”。但 AI 场景里更实际的目标应该是：

- **核心业务逻辑一致**；
- **能力边界清晰**；
- **按平台做体验降级**。

例如：

- H5：优先云端对话，弱化离线推理；
- 小程序：优先轻量聊天与工具卡片；
- App：完整 AI 助手 + 本地模型 + 音视频能力。

真正成熟的多端工程，不是让每个平台都完全一样，而是让每个平台都“在自己的边界内表现最好”。

---

## 八、性能优化与电量控制

移动端 AI 助手是一个很容易“做出来，但跑不久”的东西。表面上它只是聊天页，实际上却非常消耗资源：

- 长文本渲染；
- 高频 setState；
- WebSocket 长连接；
- markdown 解析；
- 图片/语音附件处理；
- 端侧模型推理；
- 输入法与滚动联动。

如果不做优化，很快就会出现卡顿、发热、耗电、闪退。

### 8.1 流式渲染的节流

最常见问题是：服务端每 20ms 推一个 delta，前端每来一次都更新视图，导致渲染风暴。正确方法是把增量先缓冲，再按帧或按时间片合并更新。

```ts
// /services/stream-buffer.ts
export class StreamBuffer {
  private bufferMap = new Map<string, string>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private onFlush: (messageId: string, chunk: string) => void) {}

  push(messageId: string, delta: string) {
    const prev = this.bufferMap.get(messageId) || ''
    this.bufferMap.set(messageId, prev + delta)
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.bufferMap.forEach((chunk, messageId) => {
        if (!chunk) return
        this.onFlush(messageId, chunk)
        this.bufferMap.set(messageId, '')
      })
    }, 80)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
```

这样即使后端推送很频繁，前端也只在 80ms 左右更新一次，体验上更稳定。

### 8.2 长列表渲染优化

聊天记录一长，就容易出现滚动卡顿。建议：

- 消息列表做分段渲染；
- 超长历史分页加载；
- 旧消息懒渲染或折叠；
- 代码块按需展开；
- 引用来源默认折叠。

```ts
const visibleMessages = computed(() => {
  const total = messages.value.length
  if (total <= 80) return messages.value
  return messages.value.slice(total - 80)
})
```

当然，这种直接裁切只适合“最近消息视图”。如果要支持查看全历史，就要结合“加载更多历史”按钮或虚拟列表方案。

### 8.3 本地模型推理的功耗控制

离线模型最容易被忽视的是电量。尤其在 App 端，如果用户持续对话、持续调用本地分类器或 embedding 模型，很容易：

- CPU 持续高占用；
- 机身发热；
- 电池快速下降；
- 系统降频导致更卡。

因此建议：

1. 只有在必要时调用本地模型；
2. 同一输入不重复推理，做结果缓存；
3. 低电量模式下降级关闭部分离线能力；
4. 仅在充电/Wi-Fi/前台时做模型预热与下载；
5. 避免连续高频推理。

```ts
// /services/power-guard.ts
export interface PowerPolicy {
  allowOfflineInference: boolean
  allowModelPreload: boolean
  allowAggressiveStreaming: boolean
}

export function resolvePowerPolicy(options: {
  batteryLevel: number
  lowPowerMode: boolean
}) : PowerPolicy {
  const { batteryLevel, lowPowerMode } = options

  if (lowPowerMode || batteryLevel < 0.2) {
    return {
      allowOfflineInference: false,
      allowModelPreload: false,
      allowAggressiveStreaming: false
    }
  }

  return {
    allowOfflineInference: true,
    allowModelPreload: batteryLevel > 0.5,
    allowAggressiveStreaming: true
  }
}
```

### 8.4 图片与语音输入的资源控制

如果你的 AI 助手支持拍照问答、截图提问、语音转文本，那么还要注意：

- 图片上传前先压缩；
- 语音文件控制时长；
- 不要在主线程做大文件 base64 转换；
- 失败时释放临时文件。

```ts
export function chooseCompressedImage(): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      success(res) {
        resolve(res.tempFilePaths[0])
      },
      fail(err) {
        reject(err)
      }
    })
  })
}
```

### 8.5 埋点与性能观测

没有观测，就谈不上优化。至少建议记录：

- 首字返回时间（TTFT）；
- 完整响应时间；
- WebSocket 重连次数；
- 页面卡顿次数；
- 模型下载时长；
- 本地推理耗时；
- 平均 token 消耗；
- 用户中断生成比例。

```ts
export function reportAIChatMetric(data: {
  sessionId: string
  ttftMs?: number
  totalLatencyMs?: number
  tokens?: number
  transport: 'http' | 'websocket'
  platform: string
}) {
  uni.reportAnalytics?.('ai_chat_metric', data)
}
```

### 8.6 深度分析：性能优化的目标不是“更快”，而是“稳定”

移动端 AI 场景里，用户其实能接受 2~5 秒的完整回答时间，但很难接受：

- 首字迟迟不出；
- 文字一卡一卡跳；
- 输入框乱抖；
- 页面明显发热；
- 生成过程中突然断开。

所以性能优化最重要的目标不是 benchmark 上快 10%，而是：

- 首字稳定；
- 交互稳定；
- 电量可控；
- 长时间使用不崩。

这也是为什么“节流渲染、控制功耗、减少无效推理”在 AI 助手中比单纯压榨 FPS 更重要。

---

## 九、真实踩坑记录

最后这一节，我不写“最佳实践”，只写项目里最常见、最真实的坑。很多问题你不踩一遍，很难真的意识到它们会影响上线质量。

### 坑一：把 API Key 放前端测试，结果忘记删

这是最经典、也最危险的坑。开发联调时图方便，直接把模型 API Key 塞进前端 header，觉得“上线前再改”。结果测试包流出去后，Key 被抓包拿走，直接产生异常费用。

**解决方式**：

- 前端永远不直连模型供应商；
- 联调环境也必须走代理；
- 用环境变量 + 服务端中转；
- 对请求做用户级鉴权与速率限制。

### 坑二：流式输出每个 delta 都重新解析 Markdown

刚开始做流式聊天时，我们为了“所见即所得”，每收到一个 delta 就重新跑 markdown-it + code highlight。结果中高端机还能忍，低端安卓直接掉帧，长回答时滚动几乎不可用。

问题代码类似这样：

```ts
function onDelta(messageId: string, delta: string) {
  const msg = messages.value.find(m => m.id === messageId)
  msg.content += delta
  msg.renderedHtml = markdown.render(msg.content)
}
```

这段逻辑的问题在于：

- 每次增量都要重算整个文本；
- 富文本节点树反复重建；
- 代码块高亮尤其重。

**修正方案**：

- streaming 中只渲染纯文本；
- 结束后再一次性 markdown parse；
- 对超长代码块做折叠展开。

### 坑三：自动滚动和用户手动上滑互相打架

早期版本只要有新消息就强制滚到底部，结果用户想回看上文时，页面被不断拉回底部，体验极差。

错误逻辑：

```ts
watch(messages, () => {
  uni.pageScrollTo({ scrollTop: 999999, duration: 0 })
}, { deep: true })
```

**正确做法**：

- 判断用户是否接近底部；
- 只有在接近底部时才自动跟随；
- 否则显示“有新消息，点击跳转到底部”。

### 坑四：小程序 WebSocket 域名没配全

在 H5 和 App 上都正常，到了微信小程序死活连不上，最后发现不是代码问题，而是后台只配置了 request 合法域名，忘了配 `socket` 合法域名。

**教训**：

- 小程序发布前必须逐项核对域名白名单；
- 开发、测试、生产环境要分别检查；
- `wss://` 与 `https://` 要分别配置。

### 坑五：会话历史无限增长，导致请求越来越慢

最初为了“保留上下文”，每轮对话都把全部历史带给后端。前几轮没问题，到了几十轮以后：

- token 成本暴涨；
- 模型响应变慢；
- 旧话题干扰当前问题；
- 前端本地缓存也越来越重。

后面做了三件事才稳住：

1. 滑动窗口保留最近消息；
2. 老消息自动摘要；
3. 业务知识和聊天历史分开传。

### 坑六：离线模型下载过大，首装转化率直接掉

我们曾经为了“开箱即用”，在 App 包里内置了多个本地模型，结果包体明显变大，下载转化率下降，低存储用户安装失败率也变高。

**修复方式**：

- 首包只保留必要资源；
- 模型按场景动态下载；
- 大模型仅在 Wi-Fi + 空闲状态预取；
- 下载失败允许纯云端运行。

### 坑七：本地推理太积极，省了云端 token 却烧了电

有一版我们几乎对每次输入都先跑本地意图分类、关键词提取和安全筛查，理论上很“智能”。结果用户连续使用 10 分钟后，机身发热明显，尤其安卓中端机更严重。

后来才意识到：

- 本地推理不是免费；
- 高频调用的功耗真实存在；
- 某些低价值判断完全没必要每次都做。

最终优化策略：

- 对短输入/低风险输入走轻规则，不跑模型；
- 相同输入命中缓存；
- 低电量关闭部分离线能力；
- 批量处理可延后到空闲时。

### 坑八：错误态设计不完整，用户以为 AI 在装死

最初只在控制台打印错误，没有清晰地展示：

- 网络错误；
- 超时；
- 风控拦截；
- 服务繁忙；
- 连接断开。

从用户角度看，就是“发出去没反应”。

后来我们补了统一错误映射：

```ts
export function mapAIError(err: any) {
  const code = err?.code || err?.statusCode

  if (code === 401) return '登录状态失效，请重新登录后再试'
  if (code === 429) return '当前请求较多，请稍后重试'
  if (code === 408) return '请求超时，请检查网络后重试'
  if (code >= 500) return '服务暂时繁忙，请稍后再试'

  return '当前网络不稳定，请稍后重试'
}
```

然后在消息气泡里明确展示错误，并提供“重试”“重新生成”按钮，用户感知会好很多。

### 坑九：把所有平台都追求一致，最后每个平台都不够好

一开始我们执着于 H5、小程序、App 三端 UI 和能力完全一致，结果：

- H5 想做离线推理很别扭；
- 小程序想做复杂富文本和长连接细节很多限制；
- App 的原生优势反而没发挥出来。

后来调整思路：

- H5 做轻量试用与分享入口；
- 小程序做高频业务助手；
- App 做完整 AI 助手能力中心。

这个转变之后，工程复杂度和用户体验都提升了。

### 一个更完整的错误恢复示例

```ts
async function safeSendMessage(content: string) {
  try {
    await sendStreamMessage(content)
  } catch (err: any) {
    messages.value.push({
      id: `err_${Date.now()}`,
      role: 'assistant',
      content: mapAIError(err),
      status: 'error',
      createdAt: Date.now(),
      actions: ['retry']
    })
  }
}
```

### 这一节最重要的结论

工程里真正难的，往往不是“接通模型”，而是把下面这些细节做稳：

- 网络异常时不崩；
- 流式时不卡；
- 上下文不失控；
- 多端不互相拖累；
- 弱网和低电量时能优雅降级。

AI 助手项目到了中后期，拼的已经不是“能不能接一个模型”，而是**能不能把复杂的不确定性，收束成一个稳定、可维护、可扩展的移动端产品**。

---

## 十、总结：一套可落地的移动端 AI 助手方法论

把全文收束一下，如果你要基于 uni-app 做一个真正可上线的移动端 AI 助手，我建议按下面的方法推进：

### 10.1 先做“端云协同”，不要先做“纯端侧幻想”

当前阶段，移动端最现实的形态仍然是：

- 云端 LLM 负责复杂生成、总结、工具调度；
- 本地模型负责意图识别、轻量分类、弱网兜底；
- uni-app 负责多端承载与统一交互。

这条路线成本、性能和落地速度之间相对平衡。

### 10.2 从一开始就做工程抽象

不要把 AI 逻辑散落在页面里。至少抽出：

- `services/llm.ts`：云端模型请求；
- `services/chat-socket.ts`：流式连接管理；
- `services/context-manager.ts`：上下文裁剪；
- `services/offline-ai.ts`：本地推理封装；
- `platform/*`：端差异适配；
- `components/chat/*`：对话 UI 组件。

这样后续接入多模型、多场景、多模态时不会失控。

### 10.3 把体验问题当成核心问题，而不是收尾问题

AI 项目里，用户真正记住的是：

- 回答是不是快；
- 页面是不是顺；
- 网络差时是不是还能用；
- 失败时是不是告诉我怎么继续；
- 长时间使用会不会烫、会不会卡。

所以流式渲染、滚动策略、错误态、功耗控制，优先级并不比模型效果低。

### 10.4 上线前检查清单

最后给一个非常实用的上线检查清单：

```ts
export const aiAssistantLaunchChecklist = [
  '前端未暴露任何模型 API Key',
  '服务端已做鉴权、限流、日志追踪',
  'WebSocket 已支持断线重连与心跳',
  '流式消息已做节流更新',
  '聊天历史已做裁剪与摘要',
  '消息列表支持错误重试',
  'H5/小程序/App 差异已测试',
  '小程序合法域名已配置完整',
  '本地模型按需下载与版本校验已完成',
  '低电量/弱网降级策略已验证',
  '关键指标埋点已接入（TTFT/时延/token/错误率）'
]
```

如果这些项大多已经做了，那么你的 uni-app AI 助手，基本就不是“一个能演示的 Demo”，而是“一个有机会稳定服务真实用户的产品”。

---

## 结语

AI Agent 的未来不只在浏览器标签页里，更在手机这个高频、真实、持续在线的场景里。而 uni-app 这样的多端框架，让我们能更快把 AI 能力和业务场景结合起来；云端 LLM 让助手具备通用智能；本地 ONNX / TFLite / Core ML 则让它在弱网、低时延、隐私敏感场景里更可靠。

真正的挑战，从来不是“接一个模型”这么简单，而是如何在多端、弱网、长文本、流式、高频交互、有限电量这些现实约束下，把 AI 助手做成一个稳定系统。

如果用一句话总结本文：**移动端 AI 助手的工程关键，不是单点技术最强，而是端、云、交互、性能、功耗与场景之间的平衡。**

当你掌握了这套平衡方法，uni-app 就不仅仅是一个跨端框架，而会成为你构建 AI Agent 产品的高效率底座。

## 相关阅读

- [AI Agent + 数据库实战：Text-to-SQL、智能查询、数据治理](/categories/AI%20Agent/AI-Agent-Database-Text-to-SQL/)
- [AI Agent 数据分析实战：自然语言转 SQL、图表生成、报告自动化](/categories/AI%20Agent/AI-Agent-数据分析实战-自然语言转SQL-图表生成-报告自动化/)
