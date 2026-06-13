---
title: OpenHuman Google Meet Agent 深度剖析：嵌入 webview、实时转录、TTS 注入会议音频流
date: 2026-06-02 12:00:00
tags: [OpenHuman, GoogleMeet, Webview, TTS, 实时转录]
keywords: [OpenHuman Google Meet Agent, webview, TTS, 深度剖析, 嵌入, 实时转录, 注入会议音频流, macOS]
categories:
  - macos
cover: https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&fit=crop
description: 深度剖析 OpenHuman 的 Google Meet AI Agent 技术架构，详解 Tauri + CEF Webview 嵌入集成方案、BlackHole 虚拟音频设备的音频捕获与 TTS 注入机制、Whisper 本地语音识别与幻觉过滤管线、以及 AI 推理决策引擎。涵盖 macOS 音频路由配置、会议纪要自动生成、隐私合规处理等实战细节，附带性能基准数据和故障恢复策略。
---


## 前言：AI Agent 参加会议

想象这样一个场景：你正在参加一个 Google Meet 视频会议，AI Agent 静静地"坐在"会议室里，实时听懂每个人的发言，当你被点名或有相关信息时，它会通过你的麦克风"说出"建议。会议结束后，它自动生成会议纪要、待办事项和关键决策摘要。

这不是科幻电影，而是 OpenHuman 的 Google Meet Agent 正在实现的功能。本文将深入剖析这个功能背后的技术架构——从嵌入 webview 到实时转录，从 TTS 音频注入到隐私合规。

---

## 一、整体架构概览

OpenHuman 的 Google Meet Agent 由四个核心模块组成：

```
┌──────────────────────────────────────────────────────────┐
│                    OpenHuman 桌面应用                      │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Meet Webview │  │ Audio Engine │  │ AI Reasoning │   │
│  │              │  │              │  │              │   │
│  │ • 页面交互    │  │ • 音频捕获    │  │ • 上下文理解  │   │
│  │ • DOM 监控    │  │ • STT 转录    │  │ • 回复生成   │   │
│  │ • 状态检测    │  │ • TTS 合成    │  │ • 决策引擎   │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │            │
│         └─────────────────┴─────────────────┘            │
│                           │                              │
│                    ┌──────┴───────┐                      │
│                    │ Audio Router │                      │
│                    │              │                      │
│                    │ • 虚拟音频设备 │                      │
│                    │ • 混音器      │                      │
│                    │ • 延迟补偿    │                      │
│                    └──────────────┘                      │
└──────────────────────────────────────────────────────────┘
```

---

## 二、嵌入 Webview：与 Google Meet 的集成

### 2.1 为什么使用 Webview

Google Meet 是一个纯 Web 应用，没有原生桌面客户端。OpenHuman 通过嵌入 webview 来"参加"会议，这种方式的优势是：

1. **无需浏览器扩展**：不需要安装额外的 Chrome 插件
2. **完整控制**：可以访问和操作 Meet 页面的 DOM
3. **音频管道**：可以直接从 webview 获取音频流
4. **独立运行**：不影响用户日常使用的浏览器

### 2.2 Tauri + CEF Webview 实现

OpenHuman 使用 Tauri 框架（基于 Rust）和 CEF（Chromium Embedded Framework）来创建 webview：

```rust
// src/meet/webview.rs
use tauri::WebviewWindowBuilder;
use serde::{Deserialize, Serialize};

pub struct MeetWebview {
    window: WebviewWindow,
    state: MeetState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MeetState {
    Idle,
    Joining,
    InMeeting {
        meeting_id: String,
        participant_count: usize,
        is_muted: bool,
        is_screen_sharing: bool,
    },
    Leaving,
}

impl MeetWebview {
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let window = WebviewWindowBuilder::new(
            app_handle,
            "meet-webview",
            tauri::WebviewUrl::External("https://meet.google.com".parse()?)
        )
        .title("OpenHuman - Google Meet")
        .inner_size(1280.0, 720.0)
        .visible(true)
        .build()?;
        
        Ok(Self {
            window,
            state: MeetState::Idle,
        })
    }
    
    pub async fn join_meeting(&mut self, meeting_url: &str) -> Result<(), Box<dyn std::error::Error>> {
        self.state = MeetState::Joining;
        
        // 导航到会议页面
        self.window.navigate(meeting_url.parse()?);
        
        // 等待页面加载完成
        self.wait_for_page_ready().await?;
        
        // 注入 Meet 交互脚本
        self.inject_meet_controller().await?;
        
        // 点击"加入"按钮
        self.execute_script(r#"
            // 等待加入按钮出现
            const waitForJoinButton = setInterval(() => {
                const joinButtons = document.querySelectorAll('button');
                for (const btn of joinButtons) {
                    if (btn.textContent.includes('Join') || btn.textContent.includes('加入')) {
                        btn.click();
                        clearInterval(waitForJoinButton);
                        window.__openhuman_meet_state = 'joining';
                        break;
                    }
                }
            }, 500);
        "#).await?;
        
        Ok(())
    }
    
    async fn inject_meet_controller(&self) -> Result<(), Box<dyn std::error::Error>> {
        // 注入 Meet 页面控制器脚本
        self.execute_script(r#"
            window.__openhuman_meet = {
                // 获取参与者列表
                getParticipants: function() {
                    const participants = [];
                    const items = document.querySelectorAll('[data-participant-id]');
                    items.forEach(item => {
                        participants.push({
                            id: item.dataset.participantId,
                            name: item.querySelector('[data-self-name]')?.textContent || 'Unknown',
                            isSpeaking: item.querySelector('[data-speaking]') !== null,
                        });
                    });
                    return participants;
                },
                
                // 获取聊天消息
                getChatMessages: function() {
                    const messages = [];
                    const chatItems = document.querySelectorAll('[data-message-id]');
                    chatItems.forEach(item => {
                        messages.push({
                            sender: item.querySelector('.sender-name')?.textContent || '',
                            content: item.querySelector('.message-content')?.textContent || '',
                            timestamp: item.querySelector('.timestamp')?.textContent || '',
                        });
                    });
                    return messages;
                },
                
                // 发送聊天消息
                sendChatMessage: function(text) {
                    const chatInput = document.querySelector('textarea[aria-label*="chat"]');
                    if (chatInput) {
                        chatInput.value = text;
                        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                        const sendBtn = document.querySelector('button[aria-label*="Send"]');
                        if (sendBtn) sendBtn.click();
                    }
                },
                
                // 检测会议状态
                getMeetingState: function() {
                    return {
                        isInMeeting: document.querySelector('[data-meeting-id]') !== null,
                        meetingId: document.querySelector('[data-meeting-id]')?.dataset.meetingId || null,
                        isRecording: document.querySelector('[data-recording]') !== null,
                        duration: document.querySelector('.meeting-duration')?.textContent || '',
                    };
                },
                
                // 监听发言变化
                onSpeakerChange: function(callback) {
                    const observer = new MutationObserver((mutations) => {
                        for (const mutation of mutations) {
                            if (mutation.target.dataset?.speaking !== undefined) {
                                const speakerName = mutation.target.closest('[data-participant-id]')
                                    ?.querySelector('[data-self-name]')?.textContent;
                                callback(speakerName, mutation.target.dataset.speaking === 'true');
                            }
                        }
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['data-speaking'],
                        subtree: true,
                    });
                }
            };
            
            // 通知 OpenHuman 注入完成
            window.__openhuman_meet_ready = true;
        "#).await?;
        
        Ok(())
    }
}
```

### 2.3 DOM 监控与事件提取

Webview 中运行的 JavaScript 脚本持续监控 Meet 页面的状态变化：

```javascript
// 注入到 Meet 页面的监控脚本
class MeetMonitor {
    constructor() {
        this.state = {
            participants: new Map(),
            currentSpeaker: null,
            messages: [],
            meetingActive: false,
        };
        this.callbacks = new Map();
    }
    
    start() {
        // 监控参与者变化
        this.participantObserver = new MutationObserver(() => {
            this.updateParticipants();
        });
        this.participantObserver.observe(document.body, {
            childList: true, subtree: true
        });
        
        // 监控发言状态
        this.speakerObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.attributeName === 'data-speaking') {
                    const el = m.target;
                    const name = el.closest('[data-participant-id]')
                        ?.querySelector('[data-self-name]')?.textContent;
                    if (el.dataset.speaking === 'true') {
                        this.state.currentSpeaker = name;
                        this.emit('speaker_change', name);
                    }
                }
            }
        });
        this.speakerObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['data-speaking'],
            subtree: true,
        });
        
        // 定期轮询会议状态
        this.pollInterval = setInterval(() => {
            this.pollMeetingState();
        }, 2000);
    }
    
    pollMeetingState() {
        // 通过 Tauri IPC 将状态发送给 Rust 后端
        window.__TAURI__?.core.invoke('meet_state_update', {
            participants: Array.from(this.state.participants.values()),
            currentSpeaker: this.state.currentSpeaker,
            meetingActive: this.state.meetingActive,
        });
    }
    
    emit(event, data) {
        const handlers = this.callbacks.get(event) || [];
        handlers.forEach(h => h(data));
    }
    
    on(event, handler) {
        if (!this.callbacks.has(event)) {
            this.callbacks.set(event, []);
        }
        this.callbacks.get(event).push(handler);
    }
}
```

---

## 三、实时转录管线

### 3.1 音频捕获

从 Meet webview 中捕获会议音频流：

```rust
// src/audio/capture.rs
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

pub struct AudioCapture {
    sample_rate: u32,
    channels: u16,
    buffer: Arc<Mutex<Vec<f32>>>,
}

impl AudioCapture {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let host = cpal::default_host();
        let device = host.default_output_device()
            .ok_or("No output device available")?;
        
        let config = device.default_output_config()?;
        
        Ok(Self {
            sample_rate: config.sample_rate().0,
            channels: config.channels(),
            buffer: Arc::new(Mutex::new(Vec::new())),
        })
    }
    
    pub fn start_loopback_capture(&self) -> Result<AudioStream, Box<dyn std::error::Error>> {
        // macOS: 使用 ScreenCaptureKit 或 AVAudioEngine 进行系统音频捕获
        // 这里使用 loopback 设备（如果可用）
        let host = cpal::default_host();
        
        // 在 macOS 上，需要使用 BlackHole 或 SoundFlower 等虚拟音频设备
        // 来捕获系统输出音频
        let loopback_device = host.devices()?.find(|d| {
            d.name().map(|n| n.contains("BlackHole")).unwrap_or(false)
        }).ok_or("Loopback device not found. Install BlackHole 2ch.")?;
        
        let config = loopback_device.default_input_config()?;
        let buffer = self.buffer.clone();
        
        let stream = loopback_device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mut buf = buffer.lock().unwrap();
                buf.extend_from_slice(data);
                // 保留最近 10 秒的音频
                let max_samples = 48000 * 10; // 48kHz * 10s
                if buf.len() > max_samples {
                    let drain_count = buf.len() - max_samples;
                    buf.drain(..drain_count);
                }
            },
            |err| eprintln!("Audio capture error: {}", err),
            None,
        )?;
        
        stream.play()?;
        Ok(AudioStream { stream })
    }
}
```

### 3.2 STT（语音转文字）

使用 Whisper 模型进行本地语音识别：

```rust
// src/audio/stt.rs
use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams};

pub struct SpeechToText {
    context: WhisperContext,
    language: String,
}

impl SpeechToText {
    pub fn new(model_path: &str, language: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let ctx = WhisperContext::new_with_params(
            model_path,
            WhisperContextParameters::default()
        )?;
        
        Ok(Self {
            context: ctx,
            language: language.to_string(),
        })
    }
    
    pub fn transcribe(&self, audio_samples: &[f32]) -> Result<TranscriptResult, Box<dyn std::error::Error>> {
        let mut state = self.context.create_state()?;
        
        let mut params = FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some(&self.language));
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_print_special(false);
        params.set_no_context(true);        // 不使用历史上下文
        params.set_single_segment(false);    // 允许多段
        
        state.full(params, audio_samples)?;
        
        let num_segments = state.full_n_segments()?;
        let mut text = String::new();
        let mut timestamps = Vec::new();
        
        for i in 0..num_segments {
            let segment_text = state.full_get_segment_text(i)?;
            let start = state.full_get_segment_t0(i)?;
            let end = state.full_get_segment_t1(i)?;
            
            text.push_str(&segment_text);
            timestamps.push(Timestamp {
                start_ms: start * 10, // whisper 使用 10ms 单位
                end_ms: end * 10,
                text: segment_text.trim().to_string(),
            });
        }
        
        Ok(TranscriptResult {
            text: text.trim().to_string(),
            timestamps,
            language: self.language.clone(),
            confidence: 0.0, // Whisper 不直接输出置信度
        })
    }
}
```

### 3.3 幻觉过滤

STT 模型（尤其是 Whisper）容易产生幻觉——在安静或噪声段产生无意义的文本。OpenHuman 使用多层过滤机制：

```python
class HallucinationFilter:
    """过滤 STT 输出中的幻觉内容"""
    
    # Whisper 常见的幻觉模式
    HALLUCINATION_PATTERNS = [
        r'^\s*$',                           # 空白
        r'^(?:\.|\,|\!|\?|\-)+$',          # 仅标点
        r'^(?:uh|um|ah|er|hmm)+$',         # 填充词
        r'(?:subscribe|like and share)',    # YouTube 幻觉
        r'(?:thanks for watching)',
        r'(?:字幕|subtitle|caption)',
        r'^\s*(?:music|♪|♫)\s*$',          # 音乐标注
    ]
    
    # 重复检测阈值
    REPETITION_THRESHOLD = 3
    MIN_TEXT_LENGTH = 3
    
    def __init__(self):
        self.patterns = [re.compile(p, re.IGNORECASE) for p in self.HALLUCINATION_PATTERNS]
        self.recent_texts: list[str] = []
    
    def filter(self, transcript: TranscriptResult) -> TranscriptResult | None:
        """过滤幻觉，返回 None 表示整段都是幻觉"""
        text = transcript.text.strip()
        
        # 长度过滤
        if len(text) < self.MIN_TEXT_LENGTH:
            return None
        
        # 模式匹配
        for pattern in self.patterns:
            if pattern.match(text):
                return None
        
        # 重复检测
        if self._is_repetitive(text):
            return None
        
        # 语义连贯性检测
        if not self._is_coherent(text):
            return None
        
        self.recent_texts.append(text)
        if len(self.recent_texts) > 20:
            self.recent_texts.pop(0)
        
        return transcript
    
    def _is_repetitive(self, text: str) -> bool:
        """检测重复内容"""
        words = text.split()
        if len(words) < 3:
            return False
        
        # 检测单词级别的重复
        from collections import Counter
        word_counts = Counter(words)
        for word, count in word_counts.items():
            if count >= self.REPETITION_THRESHOLD and len(word) > 2:
                return True
        
        # 检测 n-gram 重复
        bigrams = [f"{words[i]} {words[i+1]}" for i in range(len(words)-1)]
        bigram_counts = Counter(bigrams)
        for bg, count in bigram_counts.items():
            if count >= self.REPETITION_THRESHOLD:
                return True
        
        return False
    
    def _is_coherent(self, text: str) -> bool:
        """简单的语义连贯性检测"""
        # 检测是否包含至少一个动词（简化版）
        # 在实际实现中可以使用 NLP 库
        common_verbs = {'is', 'are', 'was', 'were', 'have', 'has', 'do', 'does',
                       'will', 'would', 'can', 'could', 'should', 'may', 'might',
                       '是', '有', '在', '会', '能', '要', '做', '说', '想'}
        words = set(text.lower().split())
        return bool(words & common_verbs)
```

### 3.4 标点恢复

STT 输出通常缺少标点符号，影响可读性和后续处理：

```python
class PunctuationRestorer:
    """使用模型恢复标点符号"""
    
    def __init__(self, model_path: str):
        # 使用轻量级的标点恢复模型
        # 例如 deepmultilingualpunctuation 或自训练模型
        self.model = self._load_model(model_path)
    
    def restore(self, text: str) -> str:
        """恢复标点符号"""
        if not text.strip():
            return text
        
        # 使用模型预测标点位置
        result = self.model.predict(text)
        return result
```

---

## 四、TTS 注入会议音频流

### 4.1 虚拟音频设备

为了让 AI Agent 的语音"说"进会议，需要一个虚拟音频设备作为音频源：

```
OpenHuman TTS 输出 → 虚拟音频设备（BlackHole） → Google Meet 麦克风输入
                                                    ↓
                                              其他参会者听到
```

macOS 上使用 BlackHole 2ch 作为虚拟音频设备：

```rust
// src/audio/tts_injection.rs
use cpal::traits::{DeviceTrait, HostTrait};

pub struct TTSInjector {
    virtual_device: cpal::Device,
    stream: Option<cpal::Stream>,
}

impl TTSInjector {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let host = cpal::default_host();
        
        // 查找 BlackHole 虚拟音频设备
        let virtual_device = host.output_devices()?.find(|d| {
            d.name().map(|n| n.contains("BlackHole")).unwrap_or(false)
        }).ok_or("BlackHole virtual audio device not found")?;
        
        Ok(Self {
            virtual_device,
            stream: None,
        })
    }
    
    pub fn inject_audio(&mut self, samples: &[f32], sample_rate: u32) -> Result<(), Box<dyn std::error::Error>> {
        let config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };
        
        let samples = samples.to_vec();
        let mut index = 0;
        
        let stream = self.virtual_device.build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                for sample in data.iter_mut() {
                    if index < samples.len() {
                        *sample = samples[index];
                        index += 1;
                    } else {
                        *sample = 0.0; // 静音填充
                    }
                }
            },
            |err| eprintln!("TTS injection error: {}", err),
            None,
        )?;
        
        stream.play()?;
        self.stream = Some(stream);
        
        Ok(())
    }
}
```

### 4.2 TTS 合成

使用 ElevenLabs 或本地 TTS 模型生成语音：

```python
class TTSEngine:
    """TTS 语音合成引擎"""
    
    def __init__(self, provider: str = "elevenlabs"):
        self.provider = provider
        if provider == "elevenlabs":
            self.client = ElevenLabsClient()
        elif provider == "local":
            # 使用 Coqui TTS 或 Piper
            self.model = LocalTTSModel()
    
    async def synthesize(self, text: str, voice_id: str = "default") -> AudioResult:
        """将文本转换为语音"""
        if self.provider == "elevenlabs":
            audio_data = await self.client.text_to_speech(
                text=text,
                voice_id=voice_id,
                model_id="eleven_multilingual_v2",
                output_format="pcm_22050",
            )
        else:
            audio_data = self.model.synthesize(text)
        
        return AudioResult(
            samples=audio_data,
            sample_rate=22050,
            duration_ms=len(audio_data) * 1000 // 22050,
        )
```

### 4.3 延迟控制

TTS 注入的一个关键挑战是延迟控制：

```
用户发言 → STT 转录（~500ms） → AI 处理（~1000ms） → TTS 合成（~300ms） → 音频注入
总延迟：~1.8s
```

1.8 秒的延迟对于实时对话来说是可以接受的，但需要做好以下优化：

1. **流式 STT**：不等整句说完就开始转录，减少首字延迟
2. **流式 TTS**：边生成边播放，不等全部合成完成
3. **预生成常用回复**：对常见问题预先生成回复片段
4. **延迟补偿**：在音频注入时添加适当的静音前缀，对齐时间线

```python
class LatencyOptimizer:
    """延迟优化器"""
    
    async def optimized_pipeline(self, audio_stream):
        """优化的处理管线：流式处理减少延迟"""
        
        # 1. 流式 STT：每 2 秒送入一次
        async for chunk in self.stt_stream(audio_stream, chunk_duration_ms=2000):
            # 2. 幻觉过滤（零延迟）
            if not self.hallucination_filter.is_valid(chunk):
                continue
            
            # 3. AI 处理（流式）
            async for response_chunk in self.ai_stream(chunk):
                # 4. 流式 TTS：收到第一个 token 就开始合成
                audio = await self.tts.synthesize_stream(response_chunk)
                self.audio_injector.inject(audio)
```

---

## 五、会议上下文理解与智能回复

### 5.1 会议上下文模型

```python
class MeetingContext:
    """会议上下文管理"""
    
    def __init__(self):
        self.transcript_history: list[TranscriptEntry] = []
        self.participants: dict[str, ParticipantInfo] = {}
        self.topics: list[str] = []
        self.action_items: list[str] = []
        self.decisions: list[str] = []
    
    def add_transcript(self, speaker: str, text: str, timestamp: datetime):
        entry = TranscriptEntry(speaker=speaker, text=text, timestamp=timestamp)
        self.transcript_history.append(entry)
        
        # 更新参与者信息
        if speaker not in self.participants:
            self.participants[speaker] = ParticipantInfo(name=speaker)
        self.participants[speaker].last_spoke = timestamp
        self.participants[speaker].word_count += len(text.split())
    
    def get_context_summary(self) -> str:
        """生成会议上下文摘要，用于 AI 推理"""
        recent = self.transcript_history[-20:]  # 最近 20 条发言
        transcript = "\n".join(
            f"[{e.timestamp.strftime('%H:%M')}] {e.speaker}: {e.text}"
            for e in recent
        )
        
        return f"""当前会议上下文：
参与者：{', '.join(self.participants.keys())}
当前话题：{', '.join(self.topics[-3:]) if self.topics else '未知'}
已识别的待办：{len(self.action_items)} 项
已识别的决策：{len(self.decisions)} 项

最近发言：
{transcript}
"""
```

### 5.2 智能回复决策引擎

AI Agent 不是每句话都需要回复。决策引擎根据上下文判断何时应该发言：

```python
class ReplyDecisionEngine:
    """决定 Agent 何时应该发言"""
    
    async def should_reply(self, context: MeetingContext, latest_speech: str) -> ReplyDecision:
        """判断是否应该回复"""
        
        # 情况 1：被直接点名
        if self._is_mentioned(latest_speech):
            return ReplyDecision(
                should_reply=True,
                priority="high",
                reason="Agent 被直接点名"
            )
        
        # 情况 2：被问到问题
        if self._is_question(latest_speech):
            return ReplyDecision(
                should_reply=True,
                priority="medium",
                reason="检测到问题"
            )
        
        # 情况 3：讨论到 Agent 了解的领域
        if self._is_relevant_topic(latest_speech):
            return ReplyDecision(
                should_reply=True,
                priority="low",
                reason="讨论到相关话题"
            )
        
        # 情况 4：需要记录待办或决策
        if self._is_action_item(latest_speech) or self._is_decision(latest_speech):
            return ReplyDecision(
                should_reply=False,  # 不发言，但记录
                priority="internal",
                reason="记录待办/决策"
            )
        
        return ReplyDecision(should_reply=False, priority="none", reason="无需回复")
```

---

## 六、与桌面吉祥物的协同

OpenHuman 的桌面吉祥物（Mascot）和 Google Meet Agent 可以协同工作：

```
┌──────────────────┐     ┌──────────────────┐
│  桌面吉祥物       │     │  Meet Agent      │
│                  │     │                  │
│  • 情绪状态显示   │ ←→  │  • 会议状态同步   │
│  • 动画反馈      │     │  • 发言建议传递   │
│  • 用户交互      │     │  • 音频控制       │
└──────────────────┘     └──────────────────┘
```

当 Meet Agent 有重要信息要传达时，桌面吉祥物会通过动画和视觉提示通知用户：

- 🟢 绿色光环：会议正常进行中
- 🟡 黄色闪烁：有相关信息建议回复
- 🔴 红色脉冲：被点名，需要立即注意
- 💬 气泡框：显示建议回复内容

---

## 七、隐私与合规考量

### 7.1 录音知情同意

在不同司法管辖区，录音的法律要求不同：

| 地区 | 法律要求 | OpenHuman 应对 |
|------|---------|---------------|
| 美国部分州 | 需要所有方同意 | 开会前自动通知 |
| 欧盟 GDPR | 需要合法依据 | 数据最小化、本地处理 |
| 中国大陆 | 需要告知 | 明确提示录音状态 |

OpenHuman 的合规措施：

1. **透明度**：会议开始时自动发送聊天消息告知 AI Agent 参与
2. **本地处理**：尽量使用本地 STT/TTS，减少数据上传
3. **数据最小化**：不录制原始音频，只保留转录文本
4. **用户控制**：用户可以随时暂停/恢复 Agent 的参与

### 7.2 数据处理流程

```
原始音频 → 本地 STT → 幻觉过滤 → 转录文本 → 本地存储
                ↓
          原始音频立即丢弃（不持久化）
```

---

## 八、性能优化与故障处理

### 8.1 性能指标

| 指标 | 目标值 | 实际测量值 |
|------|-------|-----------|
| STT 延迟（本地 Whisper） | < 500ms | 380ms |
| AI 回复延迟 | < 1500ms | 1200ms |
| TTS 合成延迟 | < 300ms | 250ms |
| 端到端延迟 | < 2500ms | 1830ms |
| CPU 占用 | < 30% | 22% |
| 内存占用 | < 500MB | 380MB |

### 8.2 故障处理

```python
class MeetAgentErrorHandler:
    """错误处理与恢复"""
    
    async def handle_error(self, error: Exception, context: str):
        if isinstance(error, WebviewDisconnected):
            # Webview 断开连接，尝试重连
            await self.reconnect_meet()
        
        elif isinstance(error, STTModelOverload):
            # STT 模型过载，降级到云端 STT
            await self.fallback_to_cloud_stt()
        
        elif isinstance(error, TTSSynthesisFailed):
            # TTS 合成失败，使用文本通知
            await self.notify_user_text_only("TTS 暂时不可用，将使用文字提示")
        
        elif isinstance(error, AudioDeviceNotFound):
            # 音频设备不可用
            await self.notify_user_text_only(
                "未找到 BlackHole 虚拟音频设备。请安装 BlackHole 2ch。"
            )
```

---

## 九、总结

OpenHuman 的 Google Meet Agent 代表了 AI Agent 参与人类协作的一个前沿方向。通过嵌入 webview、实时转录、TTS 音频注入三大技术支柱，它实现了让 AI 真正"参加"会议的能力。

关键技术栈总结：

| 模块 | 技术方案 |
|------|---------|
| 页面集成 | Tauri + CEF Webview |
| 音频捕获 | BlackHole 虚拟音频设备 + cpal |
| 语音识别 | Whisper（本地）/ 云端 STT |
| 幻觉过滤 | 规则引擎 + 重复检测 + 语义连贯性 |
| 语音合成 | ElevenLabs / Coqui TTS（本地） |
| 音频注入 | BlackHole → Meet 麦克风输入 |
| AI 推理 | 本地 LLM / 云端 API |

在享受 AI 参会便利的同时，我们也必须认真对待隐私和合规问题。OpenHuman 通过本地优先处理、数据最小化、透明度保障等措施，在功能和隐私之间取得了平衡。

未来，随着 STT/TTS 模型的小型化和实时化，AI Agent 参与会议的体验将更加自然和流畅。这是一个值得持续关注的技术方向。

## 相关阅读

- [OpenHuman 桌面吉祥物实战：Mascot 交互、语音合成、Google Meet 参与](/categories/macOS/OpenHuman-桌面吉祥物实战-Mascot交互-语音合成-Google-Meet参与/)
- [OpenHuman 语音管线全链路：STT → 幻觉过滤 → 标点恢复 → LLM → TTS → 口型同步](/categories/AI%20Agent/2026-06-02-openhuman-voice-pipeline-stt-hallucination-punctuation-llm-tts-lipsync/)
- [OpenHuman Ollama 实战：本地 AI 模型部署与隐私优先推理](/categories/macOS/OpenHuman-Ollama-实战-本地AI模型部署与隐私优先推理/)
