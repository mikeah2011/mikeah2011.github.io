---

title: OpenHuman 语音实战：STT 输入 + ElevenLabs TTS 输出 + 口型同步
keywords: [OpenHuman, STT, ElevenLabs TTS, 语音实战, 输入, 输出, 口型同步]
date: 2026-06-02 10:00:00
description: 本文系统拆解 OpenHuman 语音实战方案，覆盖 STT 输入、Whisper 与 Deepgram 对比、ElevenLabs TTS 输出、流式播放、口型同步、WebSocket 事件总线、打断控制、延迟优化与常见踩坑，附可运行代码、配置示例与架构建议，适合数字人、AI Agent、虚拟主播与语音助手项目落地参考。
tags:
- OpenHuman
- 语音识别
- TTS
- elevenlabs
- STT
- AI Agent
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---




在很多 AI Agent 项目里，“能听、能说、能对口型”已经不是锦上添花，而是决定交互自然度的核心能力。尤其是当 OpenHuman 这类偏实时、偏人格化、偏多模态的系统走向实际落地时，语音链路不再只是简单的“录音 -> 识别 -> 回复 -> 播放”，而是一个同时涉及延迟控制、流式协议、音频编码、角色语音风格、时间戳对齐、口型驱动、前后端并发调度的完整工程系统。

这篇文章不谈泛泛而谈的概念，而是围绕一个可以真正跑起来的 OpenHuman 语音链路来展开：**STT 输入 + ElevenLabs TTS 输出 + Lip Sync 口型同步**。目标是把“用户说话 -> Agent 理解 -> Agent 出声 -> 数字人张嘴”这条路径拆开讲透，并给出可以直接改造成项目骨架的代码与配置示例。

全文将重点覆盖以下内容：

1. OpenHuman 语音模块的整体架构与数据流。
2. STT 语音转文字的实现方式，重点对比 Whisper 与 Deepgram。
3. ElevenLabs TTS 的接入方式、流式输出与参数调优。
4. 口型同步的技术原理：从音频到 viseme / phoneme，再到前端 blendshape 或嘴型帧。
5. 一套完整的代码示例，包括后端服务、配置文件、前端播放器与 lip sync 调度器。
6. 实战中的踩坑记录与性能优化方法。

如果你正在做数字人、陪伴式 Agent、虚拟主播、语音助手或 AI NPC，这套方案基本就是可以直接落地的一条主干路径。

## 一、为什么 OpenHuman 的语音链路不是“接个 ASR 和 TTS”那么简单

OpenHuman 这类系统和普通语音助手最大的区别，在于它并不是单点功能，而是一个持续运行的角色化实体。它有状态、有记忆、有表情、有动作，甚至还可能有摄像头输入、屏幕共享、Live2D/3D 驱动、会话打断和多人房间场景。

因此语音模块至少要满足以下几个要求：

- **低延迟**：用户说完话后不能等两三秒才响应。
- **可中断**：用户插话时，Agent 必须能停掉当前播报。
- **可流式**：识别、LLM、TTS 最好都能边出边处理。
- **可对齐**：语音播放和嘴型动画必须在时间轴上统一。
- **可切换**：STT/TTS 供应商要支持替换，不应深耦合。
- **可观测**：要知道延迟到底卡在录音、上传、识别、推理还是播放。

这意味着语音系统的最佳设计不是把逻辑都写死在一个 `voice.py` 里，而是采用**分层、事件驱动、可替换 Provider 的架构**。

## 二、OpenHuman 语音模块总体架构

先给出一套推荐的模块划分：

```text
┌────────────────────────────────────────────────────────────┐
│                        OpenHuman App                       │
├────────────────────────────────────────────────────────────┤
│  Input Layer                                               │
│  ├─ Microphone Capture                                     │
│  ├─ VAD (Voice Activity Detection)                         │
│  └─ Audio Chunk Buffer                                     │
├────────────────────────────────────────────────────────────┤
│  STT Layer                                                 │
│  ├─ Whisper Provider                                       │
│  ├─ Deepgram Provider                                      │
│  └─ Transcript Normalizer                                  │
├────────────────────────────────────────────────────────────┤
│  Agent Core                                                │
│  ├─ Dialogue Manager                                       │
│  ├─ Memory / Persona                                       │
│  ├─ Tool Calling                                           │
│  └─ Response Streamer                                      │
├────────────────────────────────────────────────────────────┤
│  TTS Layer                                                 │
│  ├─ ElevenLabs Provider                                    │
│  ├─ Audio Segment Queue                                    │
│  └─ Playback Scheduler                                     │
├────────────────────────────────────────────────────────────┤
│  Lip Sync Layer                                            │
│  ├─ Audio Analyzer / Phoneme Extractor                     │
│  ├─ Viseme Timeline Generator                              │
│  └─ Avatar Renderer Adapter                                │
├────────────────────────────────────────────────────────────┤
│  Transport / Sync                                          │
│  ├─ WebSocket Event Bus                                    │
│  ├─ State Machine                                          │
│  └─ Interruption Controller                                │
└────────────────────────────────────────────────────────────┘
```

### 2.1 核心事件流

更关键的是事件流而不是目录结构。推荐使用统一事件协议，把每一步都显式化：

```json
{
  "event": "stt.partial",
  "session_id": "sess_01",
  "turn_id": "turn_18",
  "text": "你好，我想问一下",
  "is_final": false,
  "timestamp": 1717300000
}
```

类似事件通常包括：

- `audio.input.chunk`
- `vad.speech_start`
- `vad.speech_end`
- `stt.partial`
- `stt.final`
- `agent.response.delta`
- `agent.response.final`
- `tts.audio.chunk`
- `tts.audio.done`
- `lipsync.timeline.ready`
- `playback.started`
- `playback.stopped`
- `turn.interrupted`

### 2.2 推荐目录结构

```text
openhuman/
├─ app.py
├─ config/
│  ├─ default.yaml
│  └─ production.yaml
├─ core/
│  ├─ events.py
│  ├─ bus.py
│  ├─ session.py
│  └─ metrics.py
├─ audio/
│  ├─ capture.py
│  ├─ vad.py
│  ├─ codecs.py
│  └─ buffer.py
├─ stt/
│  ├─ base.py
│  ├─ whisper_provider.py
│  ├─ deepgram_provider.py
│  └─ normalizer.py
├─ tts/
│  ├─ base.py
│  ├─ elevenlabs_provider.py
│  └─ scheduler.py
├─ lipsync/
│  ├─ base.py
│  ├─ rhubarb_adapter.py
│  ├─ viseme_mapper.py
│  └─ timeline.py
├─ transport/
│  ├─ ws_server.py
│  └─ schemas.py
└─ web/
   ├─ player.ts
   ├─ avatar.ts
   └─ lipsync.ts
```

这个结构看似“重”，但长期维护非常省心。尤其是在你未来想从 Whisper 切到 Deepgram，或者从 ElevenLabs 切到 Azure / Fish Audio 时，Provider 抽象会帮你省掉大量重构成本。

## 三、配置设计：不要把密钥和模型参数散落在代码里

实际项目里，语音链路最容易失控的就是配置。建议所有 Provider 的能力都走统一配置文件。

### 3.1 YAML 配置示例

```yaml
app:
  env: production
  log_level: info
  sample_rate: 16000
  channels: 1

transport:
  websocket:
    host: 0.0.0.0
    port: 8765
    ping_interval: 20

vad:
  enabled: true
  provider: silero
  speech_threshold: 0.45
  min_speech_ms: 250
  min_silence_ms: 500
  pre_roll_ms: 200
  max_segment_ms: 12000

stt:
  provider: deepgram
  language: zh
  interim_results: true
  endpointing_ms: 300
  whisper:
    model: large-v3
    device: cuda
    compute_type: float16
    beam_size: 3
    vad_filter: true
  deepgram:
    api_key: ${DEEPGRAM_API_KEY}
    model: nova-3
    punctuate: true
    smart_format: true
    diarize: false
    encoding: linear16
    sample_rate: 16000

tts:
  provider: elevenlabs
  output_format: mp3_44100_128
  chunk_schedule_ms: 120
  elevenlabs:
    api_key: ${ELEVENLABS_API_KEY}
    model_id: eleven_multilingual_v2
    voice_id: EXAVITQu4vr4xnSDxMaL
    stability: 0.35
    similarity_boost: 0.8
    style: 0.25
    use_speaker_boost: true

lipsync:
  provider: rhubarb
  frame_rate: 60
  lead_ms: 40
  tail_ms: 80
  smooth:
    enabled: true
    attack: 0.7
    release: 0.5
  viseme_map:
    A: aa
    B: ee
    C: ih
    D: oh
    E: ou
    F: fv
    G: l
    H: mbp
    X: rest

playback:
  allow_interrupt: true
  ducking: true
  buffer_ms: 180
  max_queue_segments: 12
```

### 3.2 Python 配置加载器

```python
# config_loader.py
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml

ENV_PATTERN = re.compile(r"\$\{([A-Z0-9_]+)\}")


def _expand_env(value: Any) -> Any:
    if isinstance(value, str):
        def repl(match: re.Match[str]) -> str:
            key = match.group(1)
            return os.environ.get(key, "")
        return ENV_PATTERN.sub(repl, value)
    if isinstance(value, dict):
        return {k: _expand_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand_env(v) for v in value]
    return value


def load_config(path: str | Path) -> dict[str, Any]:
    path = Path(path)
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return _expand_env(data)
```

这里有两个原则：

1. API Key 一律使用环境变量注入。
2. Provider 参数全部集中配置，运行时代码只读配置，不写死阈值。

## 四、STT 实战：Whisper 与 Deepgram 的实现思路

STT 的核心需求不是“能识别”，而是：

- 能否流式返回 partial transcript。
- 中英混说、口语停顿、语气词的处理如何。
- 中文标点与断句是否可靠。
- 网络延迟、吞吐成本、本地部署难度如何。
- 是否支持说话人分离、关键词、时间戳。

### 4.1 Whisper 的优点与局限

Whisper 非常适合作为本地可控方案：

- 隐私可控，不出本地。
- 模型一致性高，便于调试。
- 中文、英文、混合语种都有不错效果。
- 对音质稍差的输入也比较鲁棒。

局限也很明显：

- 真流式体验不如商用云服务顺滑。
- 大模型推理吃 GPU。
- 低端设备上延迟可能明显。
- 如果自己做 chunk 拼接和增量转写，工程复杂度不低。

### 4.2 Deepgram 的优点与局限

Deepgram 在实时 STT 场景非常强：

- WebSocket 实时识别成熟。
- partial / final transcript 机制清晰。
- endpointing 表现较好。
- 接入简单，适合线上服务。

但它同样有取舍：

- 依赖外部网络。
- 计费随调用量增长。
- 对中文某些场景仍需后处理。
- 合规要求高的项目需要额外评估。

### 4.3 STT 抽象接口设计

```python
# stt/base.py
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator, Optional


@dataclass
class STTResult:
    text: str
    is_final: bool
    confidence: float | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    raw: dict | None = None


class BaseSTTProvider(ABC):
    @abstractmethod
    async def connect(self) -> None:
        ...

    @abstractmethod
    async def send_audio(self, pcm: bytes) -> None:
        ...

    @abstractmethod
    async def receive(self) -> AsyncIterator[STTResult]:
        ...

    @abstractmethod
    async def close(self) -> None:
        ...
```

Provider 抽象的意义在于：上层会话逻辑只关心 `STTResult`，不关心底层是 HTTP、WebSocket 还是本地模型。

### 4.4 Deepgram WebSocket Provider 示例

```python
# stt/deepgram_provider.py
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

import websockets

from stt.base import BaseSTTProvider, STTResult


class DeepgramSTTProvider(BaseSTTProvider):
    def __init__(self, api_key: str, sample_rate: int = 16000, language: str = "zh"):
        self.api_key = api_key
        self.sample_rate = sample_rate
        self.language = language
        self.ws = None
        self._queue: asyncio.Queue[STTResult] = asyncio.Queue()
        self._reader_task: asyncio.Task | None = None

    async def connect(self) -> None:
        url = (
            "wss://api.deepgram.com/v1/listen"
            f"?encoding=linear16&sample_rate={self.sample_rate}"
            f"&language={self.language}&interim_results=true&punctuate=true"
        )
        self.ws = await websockets.connect(
            url,
            additional_headers={"Authorization": f"Token {self.api_key}"},
            ping_interval=20,
            ping_timeout=20,
            max_size=8 * 1024 * 1024,
        )
        self._reader_task = asyncio.create_task(self._reader_loop())

    async def _reader_loop(self) -> None:
        assert self.ws is not None
        async for message in self.ws:
            payload = json.loads(message)
            if payload.get("type") != "Results":
                continue

            channel = payload.get("channel", {})
            alternatives = channel.get("alternatives", [])
            if not alternatives:
                continue
            alt = alternatives[0]
            transcript = alt.get("transcript", "").strip()
            if not transcript:
                continue

            result = STTResult(
                text=transcript,
                is_final=payload.get("is_final", False),
                confidence=alt.get("confidence"),
                start_ms=int(alt.get("words", [{}])[0].get("start", 0) * 1000) if alt.get("words") else None,
                end_ms=int(alt.get("words", [{}])[-1].get("end", 0) * 1000) if alt.get("words") else None,
                raw=payload,
            )
            await self._queue.put(result)

    async def send_audio(self, pcm: bytes) -> None:
        assert self.ws is not None
        await self.ws.send(pcm)

    async def receive(self) -> AsyncIterator[STTResult]:
        while True:
            result = await self._queue.get()
            yield result

    async def close(self) -> None:
        if self.ws:
            await self.ws.close()
        if self._reader_task:
            self._reader_task.cancel()
```

### 4.5 Whisper 本地 Provider 示例

下面的实现更偏近实时：本地缓存 PCM，当 VAD 判断一段语音结束后，交给 faster-whisper 做一次转写。这不是真流式，但在桌面端、边缘端非常常见。

```python
# stt/whisper_provider.py
from __future__ import annotations

import asyncio
import io
import wave
from typing import AsyncIterator

from faster_whisper import WhisperModel

from stt.base import BaseSTTProvider, STTResult


class WhisperSTTProvider(BaseSTTProvider):
    def __init__(self, model_name: str = "large-v3", device: str = "cpu", compute_type: str = "int8"):
        self.model = WhisperModel(model_name, device=device, compute_type=compute_type)
        self._audio_buffer = bytearray()
        self._queue: asyncio.Queue[STTResult] = asyncio.Queue()

    async def connect(self) -> None:
        return None

    async def send_audio(self, pcm: bytes) -> None:
        self._audio_buffer.extend(pcm)

    async def transcribe_current_segment(self, sample_rate: int = 16000) -> None:
        wav_bytes = io.BytesIO()
        with wave.open(wav_bytes, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(bytes(self._audio_buffer))

        wav_bytes.seek(0)
        segments, info = self.model.transcribe(
            wav_bytes,
            language="zh",
            beam_size=3,
            vad_filter=True,
        )
        text = "".join(seg.text for seg in segments).strip()
        self._audio_buffer.clear()
        if text:
            await self._queue.put(STTResult(text=text, is_final=True, raw={"info": str(info)}))

    async def receive(self) -> AsyncIterator[STTResult]:
        while True:
            yield await self._queue.get()

    async def close(self) -> None:
        self._audio_buffer.clear()
```

### 4.6 VAD 驱动的分段逻辑

STT 做得再好，如果没有 VAD，你的系统会一直在录音、一直发包、一直误识别环境噪音。一个简单的 VAD 会话状态机如下：

```python
# audio/vad_session.py
from dataclasses import dataclass


@dataclass
class VADState:
    speaking: bool = False
    speech_ms: int = 0
    silence_ms: int = 0


class SegmentController:
    def __init__(self, min_speech_ms=250, min_silence_ms=500):
        self.state = VADState()
        self.min_speech_ms = min_speech_ms
        self.min_silence_ms = min_silence_ms

    def update(self, is_speech: bool, chunk_ms: int) -> str | None:
        if is_speech:
            self.state.speech_ms += chunk_ms
            self.state.silence_ms = 0
            if not self.state.speaking and self.state.speech_ms >= self.min_speech_ms:
                self.state.speaking = True
                return "speech_start"
            return None

        self.state.silence_ms += chunk_ms
        if self.state.speaking and self.state.silence_ms >= self.min_silence_ms:
            self.state = VADState()
            return "speech_end"
        return None
```

这里的关键点是：**STT 的最终提交时机，通常不是“收到音频就立刻转”，而是 VAD 决定当前语段已经结束**。这样可以极大降低碎片化识别结果。

### 4.7 Transcript Normalizer 必不可少

云 STT 和本地 STT 都常见以下问题：

- 标点断句不稳定。
- 中英文之间空格混乱。
- 数字、时间、金额格式不统一。
- filler words（嗯、啊、那个）太多。

一个简单的归一化器示例：

```python
# stt/normalizer.py
import re


def normalize_transcript(text: str) -> str:
    text = text.strip()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s*([，。！？；：,.!?;:])\s*", r"\1", text)
    text = re.sub(r"([\u4e00-\u9fff])\s+([\u4e00-\u9fff])", r"\1\2", text)
    text = text.replace("嗯嗯", "嗯")
    text = text.replace("啊啊", "啊")
    return text
```

不要小看这一步。用户对语音 Agent 的主观体验，很多时候并不是由识别模型本身决定的，而是由最后呈现给 LLM 的文本质量决定的。

## 五、ElevenLabs TTS 集成：从“能播”到“像人在说”

TTS 的难点也不仅仅是发出声音。对于 OpenHuman，通常要考虑：

- 角色声线是否稳定。
- 中文发音是否自然。
- 多语言混读时是否发音怪异。
- 是否支持流式输出。
- 是否能跟口型时间轴对齐。
- 是否能在句子还没生成完时提前开始播报。

ElevenLabs 在拟人感和角色感上通常表现很好，尤其适合数字人、陪伴型角色与故事型交互。

### 5.1 TTS 抽象接口

```python
# tts/base.py
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator


@dataclass
class AudioChunk:
    chunk_id: str
    audio_bytes: bytes
    mime_type: str
    text: str | None = None
    is_final: bool = False


class BaseTTSProvider(ABC):
    @abstractmethod
    async def synthesize_stream(self, text: str) -> AsyncIterator[AudioChunk]:
        ...
```

### 5.2 ElevenLabs 流式 TTS 示例

```python
# tts/elevenlabs_provider.py
from __future__ import annotations

import uuid
from typing import AsyncIterator

import httpx

from tts.base import AudioChunk, BaseTTSProvider


class ElevenLabsTTSProvider(BaseTTSProvider):
    def __init__(
        self,
        api_key: str,
        voice_id: str,
        model_id: str = "eleven_multilingual_v2",
        output_format: str = "mp3_44100_128",
        stability: float = 0.35,
        similarity_boost: float = 0.8,
        style: float = 0.25,
        use_speaker_boost: bool = True,
    ):
        self.api_key = api_key
        self.voice_id = voice_id
        self.model_id = model_id
        self.output_format = output_format
        self.voice_settings = {
            "stability": stability,
            "similarity_boost": similarity_boost,
            "style": style,
            "use_speaker_boost": use_speaker_boost,
        }

    async def synthesize_stream(self, text: str) -> AsyncIterator[AudioChunk]:
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}/stream"
        payload = {
            "text": text,
            "model_id": self.model_id,
            "voice_settings": self.voice_settings,
        }
        headers = {
            "xi-api-key": self.api_key,
            "accept": "audio/mpeg",
            "content-type": "application/json",
        }
        params = {"output_format": self.output_format}

        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("POST", url, headers=headers, params=params, json=payload) as resp:
                resp.raise_for_status()
                chunk_index = 0
                async for data in resp.aiter_bytes():
                    if not data:
                        continue
                    chunk_index += 1
                    yield AudioChunk(
                        chunk_id=f"{uuid.uuid4().hex}_{chunk_index}",
                        audio_bytes=data,
                        mime_type="audio/mpeg",
                        text=text if chunk_index == 1 else None,
                        is_final=False,
                    )

        yield AudioChunk(
            chunk_id=f"{uuid.uuid4().hex}_final",
            audio_bytes=b"",
            mime_type="audio/mpeg",
            text=None,
            is_final=True,
        )
```

### 5.3 ElevenLabs 参数怎么调

最常见的几个参数影响如下：

- `stability`：越高越稳定，但情绪变化可能更少。
- `similarity_boost`：越高越贴近原始 voice profile。
- `style`：风格强度，过高时会显得“演得太用力”。
- `use_speaker_boost`：通常开启，但某些极端文本会让音色过于强调。

我在中文角色语音里的经验值通常是：

```yaml
elevenlabs:
  stability: 0.30 ~ 0.45
  similarity_boost: 0.75 ~ 0.90
  style: 0.15 ~ 0.35
```

如果你做的是陪伴型角色、偏自然聊天，不建议把 `style` 拉太高。太高会让每句话都像在配音，而不是像在交谈。

### 5.4 长文本切分策略

任何流式 TTS，真正想降低首包延迟，不能等 LLM 把整段话都生成完再送给 TTS。最佳做法通常是：

1. LLM 流式输出文本。
2. 句子级切分器检测出完整短句。
3. 每个短句立刻送入 TTS。
4. 音频按顺序排队播放。
5. 每个短句单独生成 lip sync timeline。

一个简单的句子切分器：

```python
# tts/text_segmenter.py
import re
from typing import Iterable


SENTENCE_END_RE = re.compile(r"([。！？!?；;\n])")


def split_sentences(stream_text: str) -> Iterable[str]:
    buf = ""
    for ch in stream_text:
        buf += ch
        if SENTENCE_END_RE.search(ch) and len(buf.strip()) >= 6:
            yield buf.strip()
            buf = ""
    if buf.strip():
        yield buf.strip()
```

这不是最复杂的切分器，但对中文播报已经足够实用。

## 六、口型同步原理：不是“音量大就张嘴”这么简单

很多项目初期会偷懒，直接用音量包络驱动嘴巴开合。这样做有一个好处：实现极快。但缺点也非常明显：

- 爆破音、唇音和元音没有区别。
- 嘴型变化单一，像机械开合。
- 音频停顿时闭嘴可以，但说话时嘴型不准。
- 角色一旦近景展示，违和感非常强。

更合理的方法是构建**音频 -> phoneme/viseme -> 时间轴 -> 渲染器**的链路。

### 6.1 Phoneme、Viseme、Blendshape 的关系

- **Phoneme（音素）**：语音学单位，例如 /a/、/m/、/f/。
- **Viseme（视位）**：视觉上的嘴型类别，多个音素可能映射到同一 viseme。
- **Blendshape**：3D 模型中的面部形变参数，如 `jawOpen`、`mouthFunnel`。

一个典型流程：

```text
TTS/Audio
  ↓
Forced Alignment / Audio Analyzer
  ↓
Phoneme Timeline
  ↓
Viseme Mapping
  ↓
Avatar-specific Animation Data
  ↓
Renderer Playback
```

### 6.2 常见口型同步方案对比

#### 方案 A：纯音量驱动

优点：实现快、依赖少。
缺点：嘴型不准，只能当最低成本 fallback。

#### 方案 B：Rhubarb Lip Sync

Rhubarb 可以根据音频推断嘴型时间轴，输出类似 `A/B/C/D/E/F/G/H/X` 的 mouth cue。

优点：

- 工具成熟。
- 输出结构简单。
- 非常适合 2D、Live2D、简单 3D 角色。

缺点：

- 精度有限。
- 对中文并不是语音学意义上的完美匹配。
- 通常需离线或准实时处理，不如音量驱动那样零成本。

#### 方案 C：Forced Alignment + 自定义 viseme map

例如使用 Montreal Forced Aligner、Gentle、aeneas 或自建 phoneme 模型，把文本和音频做强制对齐，获得更细粒度时间戳。

优点：

- 精度高。
- 更适合高保真数字人。
- 可以统一不同 TTS 供应商的渲染逻辑。

缺点：

- 工程复杂。
- 需要文本、词典、音素映射。
- 中文场景需要额外处理拼音、儿化音、多音字。

### 6.3 一个实用折中：TTS 音频 + Rhubarb + 前端平滑

在大多数 OpenHuman 项目里，我建议先上这条方案：

1. TTS 生成音频。
2. 服务端或工作线程调用 Rhubarb 分析音频。
3. 生成 mouth cue timeline。
4. 前端把 cue 映射到 Live2D 参数或 3D blendshape。
5. 使用 attack/release 做时间平滑。

这样成本和效果之间的平衡通常最好。

## 七、Lip Sync 实现示例：服务端生成时间轴

### 7.1 Rhubarb 输出格式示例

Rhubarb 常见 JSON 输出大致如下：

```json
{
  "metadata": {
    "duration": 2.84
  },
  "mouthCues": [
    {"start": 0.00, "end": 0.08, "value": "X"},
    {"start": 0.08, "end": 0.21, "value": "B"},
    {"start": 0.21, "end": 0.37, "value": "C"},
    {"start": 0.37, "end": 0.56, "value": "D"}
  ]
}
```

### 7.2 Python 适配器示例

```python
# lipsync/rhubarb_adapter.py
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


class RhubarbAdapter:
    def __init__(self, binary_path: str = "rhubarb"):
        self.binary_path = binary_path

    def analyze(self, audio_path: str) -> dict:
        cmd = [
            self.binary_path,
            "-f", "json",
            "--machineReadable",
            audio_path,
        ]
        completed = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return json.loads(completed.stdout)
```

### 7.3 Viseme 映射层

不同渲染器支持的嘴型参数各不相同。不要把 Rhubarb 的 `A/B/C...` 直接写进前端渲染逻辑，应该加一层映射。

```python
# lipsync/viseme_mapper.py
VISeme_TO_BLENDSHAPE = {
    "A": {"jawOpen": 0.75, "mouthOpen": 0.85},
    "B": {"mouthSmile": 0.15, "mouthOpen": 0.30},
    "C": {"mouthOpen": 0.45, "mouthFunnel": 0.10},
    "D": {"jawOpen": 0.55, "mouthPucker": 0.35},
    "E": {"jawOpen": 0.35, "mouthPucker": 0.60},
    "F": {"lowerLipClose": 0.70, "mouthOpen": 0.20},
    "G": {"tongueUp": 0.50, "jawOpen": 0.25},
    "H": {"lipsClosed": 1.00, "jawOpen": 0.05},
    "X": {"jawOpen": 0.0, "mouthOpen": 0.0},
}


def map_viseme_to_blendshape(viseme: str) -> dict[str, float]:
    return VISeme_TO_BLENDSHAPE.get(viseme, VISeme_TO_BLENDSHAPE["X"])
```

### 7.4 生成可播放时间轴

```python
# lipsync/timeline.py
from __future__ import annotations

from dataclasses import dataclass

from lipsync.viseme_mapper import map_viseme_to_blendshape


@dataclass
class VisemeFrame:
    start_ms: int
    end_ms: int
    viseme: str
    blendshape: dict[str, float]


def build_timeline(rhubarb_output: dict, lead_ms: int = 40, tail_ms: int = 80) -> list[VisemeFrame]:
    frames: list[VisemeFrame] = []
    for cue in rhubarb_output.get("mouthCues", []):
        start_ms = max(0, int(cue["start"] * 1000) - lead_ms)
        end_ms = int(cue["end"] * 1000) + tail_ms
        viseme = cue["value"]
        frames.append(
            VisemeFrame(
                start_ms=start_ms,
                end_ms=end_ms,
                viseme=viseme,
                blendshape=map_viseme_to_blendshape(viseme),
            )
        )
    return frames
```

这里的 `lead_ms` 和 `tail_ms` 很重要。原因是视觉上嘴型如果稍微提前一点点，观感往往比“严格同时”更自然；而结尾稍微拖尾也会减少“啪地闭嘴”的机械感。

## 八、完整后端串联：从音频输入到 TTS+Lip Sync 输出

下面给出一个简化但可落地的后端控制流。它不是生产级完整代码，但足以表达真实工程中的结构。

### 8.1 会话编排器

```python
# app.py
from __future__ import annotations

import asyncio
import base64
import tempfile
from pathlib import Path

from stt.deepgram_provider import DeepgramSTTProvider
from stt.normalizer import normalize_transcript
from tts.elevenlabs_provider import ElevenLabsTTSProvider
from lipsync.rhubarb_adapter import RhubarbAdapter
from lipsync.timeline import build_timeline


class EventBus:
    def __init__(self):
        self.clients = set()

    async def publish(self, event: dict):
        dead = []
        for ws in self.clients:
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.remove(ws)


async def fake_llm_reply(user_text: str) -> str:
    return f"我已经理解你的问题：{user_text}。下面我会用更结构化的方式为你解释。"


class OpenHumanVoiceSession:
    def __init__(self, bus: EventBus, deepgram_key: str, eleven_key: str):
        self.bus = bus
        self.stt = DeepgramSTTProvider(api_key=deepgram_key)
        self.tts = ElevenLabsTTSProvider(
            api_key=eleven_key,
            voice_id="EXAVITQu4vr4xnSDxMaL",
        )
        self.lipsync = RhubarbAdapter()

    async def start(self):
        await self.stt.connect()
        asyncio.create_task(self._consume_stt())

    async def ingest_audio(self, pcm: bytes):
        await self.stt.send_audio(pcm)

    async def _consume_stt(self):
        async for result in self.stt.receive():
            await self.bus.publish({
                "event": "stt.partial" if not result.is_final else "stt.final",
                "text": result.text,
                "is_final": result.is_final,
            })
            if result.is_final:
                normalized = normalize_transcript(result.text)
                reply = await fake_llm_reply(normalized)
                await self._speak(reply)

    async def _speak(self, text: str):
        audio_bytes = bytearray()
        async for chunk in self.tts.synthesize_stream(text):
            if chunk.audio_bytes:
                audio_bytes.extend(chunk.audio_bytes)
                await self.bus.publish({
                    "event": "tts.audio.chunk",
                    "chunk_id": chunk.chunk_id,
                    "mime_type": chunk.mime_type,
                    "audio_base64": base64.b64encode(chunk.audio_bytes).decode("utf-8"),
                })

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            f.write(audio_bytes)
            tmp_audio = f.name

        rhubarb_result = self.lipsync.analyze(tmp_audio)
        timeline = build_timeline(rhubarb_result)

        await self.bus.publish({
            "event": "lipsync.timeline.ready",
            "frames": [
                {
                    "start_ms": frame.start_ms,
                    "end_ms": frame.end_ms,
                    "viseme": frame.viseme,
                    "blendshape": frame.blendshape,
                }
                for frame in timeline
            ],
        })

        await self.bus.publish({"event": "tts.audio.done"})
```

注意这里有一个现实问题：如果 lip sync 必须等整段 TTS 音频出来后再分析，那嘴型时间轴会晚于首包音频。为了解决这个问题，生产实践里一般有三条路径：

1. **句子级切片**：每句单独 TTS、单独 lip sync，缩小等待时间。
2. **预生成模式**：先拿到完整 LLM 回复，再统一生成音频和口型，适合不那么强调首字延迟的场景。
3. **双通道模式**：先用音量包络做即时开口，再用更精细的 viseme 时间轴接管。

我自己最推荐的是“句子级切片 + 前几百毫秒音量兜底”的混合方案。

## 九、前端播放与嘴型渲染：时间轴必须以音频时钟为准

很多 lip sync 不准的问题，根本原因不是分析错了，而是前端播放和动画各自跑自己的时钟。

### 9.1 原则：音频时钟是唯一真相

无论你用的是 Web Audio API、HTMLAudioElement、Pixi、Three.js、Live2D 还是 Unity WebGL，**嘴型时间轴必须跟着实际音频播放进度走**，而不是跟着 `setTimeout` 走。

### 9.2 Web Audio 简化示例

```ts
// web/player.ts
export interface LipFrame {
  start_ms: number;
  end_ms: number;
  viseme: string;
  blendshape: Record<string, number>;
}

export class AudioTimelinePlayer {
  private audioContext = new AudioContext();
  private startAt = 0;
  private frames: LipFrame[] = [];
  private source: AudioBufferSourceNode | null = null;
  private onFrame: (frame: LipFrame | null) => void;

  constructor(onFrame: (frame: LipFrame | null) => void) {
    this.onFrame = onFrame;
  }

  async play(arrayBuffer: ArrayBuffer, frames: LipFrame[]) {
    this.frames = frames;
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
    this.source = this.audioContext.createBufferSource();
    this.source.buffer = audioBuffer;
    this.source.connect(this.audioContext.destination);
    this.startAt = this.audioContext.currentTime;
    this.source.start();
    this.tick();
  }

  private tick = () => {
    const elapsedMs = (this.audioContext.currentTime - this.startAt) * 1000;
    const active = this.frames.find(
      (f) => elapsedMs >= f.start_ms && elapsedMs < f.end_ms,
    ) || null;
    this.onFrame(active);

    if (this.source) {
      requestAnimationFrame(this.tick);
    }
  };

  stop() {
    if (this.source) {
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
    this.onFrame(null);
  }
}
```

### 9.3 Live2D / 3D Avatar 应用层

```ts
// web/avatar.ts
export class AvatarRenderer {
  applyBlendshape(weights: Record<string, number>) {
    // 这里替换成你的 Live2D 参数或 Three.js morphTargetInfluences 映射
    for (const [name, value] of Object.entries(weights)) {
      this.setParam(name, value);
    }
  }

  resetMouth() {
    this.applyBlendshape({ jawOpen: 0, mouthOpen: 0, mouthPucker: 0, lipsClosed: 0 });
  }

  private setParam(name: string, value: number) {
    console.log("set mouth param", name, value);
  }
}
```

### 9.4 平滑器：防止嘴型抖动

```ts
// web/lipsync.ts
export function smoothBlendshape(
  prev: Record<string, number>,
  next: Record<string, number>,
  attack = 0.7,
  release = 0.5,
): Record<string, number> {
  const result: Record<string, number> = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const p = prev[key] ?? 0;
    const n = next[key] ?? 0;
    const factor = n > p ? attack : release;
    result[key] = p + (n - p) * factor;
  }
  return result;
}
```

前端每一帧根据当前激活 viseme 计算目标嘴型，再经过平滑器推给模型，观感会比直接硬切好很多。

## 十、打断、抢话与状态机：真实语音 Agent 的关键工程问题

一个真正能用的 OpenHuman，不是“播得出来”就行，而是要支持中断。

典型场景：

- 用户说到一半停顿，Agent 不要抢答太快。
- Agent 正在讲话，用户突然插话，Agent 要立即停播。
- STT partial 已经出现，但 final 还没到，是否提前推理？
- TTS 已经生成到一半，但这轮对话被取消，是否清空队列？

建议使用显式状态机：

```text
IDLE
 └─(speech_start)→ LISTENING
LISTENING
 └─(speech_end + stt.final)→ THINKING
THINKING
 └─(first_tts_chunk)→ SPEAKING
SPEAKING
 └─(tts.done)→ IDLE
SPEAKING
 └─(user_interrupt)→ INTERRUPTING → LISTENING
```

对应的伪代码：

```python
class TurnState:
    IDLE = "idle"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    INTERRUPTING = "interrupting"


class ConversationStateMachine:
    def __init__(self):
        self.state = TurnState.IDLE

    def on_event(self, event: str):
        if self.state == TurnState.IDLE and event == "speech_start":
            self.state = TurnState.LISTENING
        elif self.state == TurnState.LISTENING and event == "stt_final":
            self.state = TurnState.THINKING
        elif self.state == TurnState.THINKING and event == "tts_start":
            self.state = TurnState.SPEAKING
        elif self.state == TurnState.SPEAKING and event == "interrupt":
            self.state = TurnState.INTERRUPTING
        elif self.state == TurnState.INTERRUPTING and event == "playback_stopped":
            self.state = TurnState.LISTENING
        elif event == "turn_done":
            self.state = TurnState.IDLE
```

关键不是状态机写得多复杂，而是**所有模块都必须服从同一状态机**。比如一旦触发 `interrupt`：

- 播放器立刻停。
- TTS 队列清空。
- 当前 lip sync timeline 作废。
- 前端嘴型恢复闭合。
- STT 重新进入监听状态。

## 十一、完整 WebSocket 协议示例

为了让前后端可独立开发，建议把协议固定下来。下面是一组实际可用的消息格式。

### 11.1 前端上传音频 chunk

```json
{
  "event": "audio.input.chunk",
  "session_id": "sess_01",
  "format": "pcm_s16le",
  "sample_rate": 16000,
  "chunk_ms": 40,
  "audio_base64": "..."
}
```

### 11.2 STT partial / final

```json
{
  "event": "stt.partial",
  "session_id": "sess_01",
  "text": "你好，我想问一下",
  "is_final": false
}
```

```json
{
  "event": "stt.final",
  "session_id": "sess_01",
  "text": "你好，我想问一下 OpenHuman 的语音链路怎么接。",
  "is_final": true
}
```

### 11.3 TTS 音频片段

```json
{
  "event": "tts.audio.chunk",
  "segment_id": "seg_01",
  "mime_type": "audio/mpeg",
  "audio_base64": "..."
}
```

### 11.4 Lip sync 时间轴

```json
{
  "event": "lipsync.timeline.ready",
  "segment_id": "seg_01",
  "frames": [
    {
      "start_ms": 0,
      "end_ms": 80,
      "viseme": "X",
      "blendshape": {"jawOpen": 0.0, "mouthOpen": 0.0}
    },
    {
      "start_ms": 81,
      "end_ms": 160,
      "viseme": "B",
      "blendshape": {"jawOpen": 0.3, "mouthOpen": 0.2}
    }
  ]
}
```

有了这层协议，前端团队和后端团队可以完全并行开发。

## 十二、部署层面的建议：本地、边缘、云端如何分工

实际部署时，语音链路最好不要“一股脑都放浏览器”或者“一股脑都放后端”。推荐的分工通常是：

### 12.1 浏览器端负责

- 麦克风采集
- 降噪/回声消除（如果使用浏览器内建能力）
- PCM chunk 上传
- 音频播放
- 口型渲染
- 中断控制 UI

### 12.2 服务端负责

- STT Provider 连接
- 会话管理
- LLM 推理
- TTS Provider 调用
- Lip sync timeline 生成
- 指标采集与日志

### 12.3 边缘节点可选承担

- 本地 Whisper 推理
- 本地 VAD
- 音频重采样
- 缓存热 voice profile

如果你是做桌面端应用，也可以把 VAD 和 Whisper 都前置到本地，减少上行带宽与隐私风险；而 ElevenLabs TTS 保持云端调用。这个组合在很多场景里很实用。

## 十三、踩坑记录：这些问题几乎每个项目都会遇到

### 13.1 MP3 解码延迟导致嘴型慢半拍

如果 ElevenLabs 返回 MP3，而前端 decode 音频需要额外时间，常常会出现“嘴型开始时机不准”。

解决思路：

- 尽量统一成 WAV/PCM 再播放。
- 或者在前端只有完成 decode 后才启动音频与时间轴。
- 若必须流式 MP3，嘴型不要按收到 chunk 时间计算，而要按**实际播放时刻**计算。

### 13.2 STT final 太慢，用户感觉系统发呆

很多人默认等 `final transcript` 再触发推理，这会让停顿很明显。

优化方式：

- partial transcript 稳定到一定阈值时预取 LLM。
- endpointing 阈值根据场景调小，如 300ms～500ms。
- 对短问句允许“弱 final”提前启动回复。

### 13.3 中文标点断句差，TTS 读得像机关枪

解决方式：

- 在 transcript normalizer 阶段补标点。
- LLM 输出时要求短句化。
- 进入 TTS 前做 sentence segmentation。
- 适当插入逗号、顿号或换行，帮助呼吸节奏。

### 13.4 口型过于夸张

原因通常不是 lip sync 算法太“聪明”，而是嘴型映射权重设置过高。

优化建议：

- 统一对 `jawOpen` 做上限裁剪，例如不超过 0.6。
- 对爆破音 / 唇音的嘴闭合做短时增强，但别持续过长。
- 前端加入 attack/release 平滑。

### 13.5 中断后残留嘴型不归零

这个问题非常常见。用户打断后音频停了，但模型嘴还张着。

解决方式：

- `interrupt` 事件必须显式触发 `avatar.resetMouth()`。
- 清除所有尚未消费的 lip sync frame。
- 停止 `requestAnimationFrame` 或渲染循环中的当前播放引用。

### 13.6 多语混读时发音异常

解决方式：

- 英文缩写、产品名、URL 在送 TTS 前做 pronunciation replacement。
- 中文句子里夹英文时，尽量不要一次塞太长。
- ElevenLabs voice profile 需要用对应语言风格更稳定的 voice。

## 十四、性能优化：把延迟拆成每一段来打

语音链路优化最忌讳“总感觉慢”。要做的不是拍脑袋，而是给每一段打点。

### 14.1 建议采集的关键指标

```text
mic_capture_ms
vad_trigger_ms
stt_first_partial_ms
stt_final_ms
llm_first_token_ms
llm_final_ms
tts_first_byte_ms
tts_audio_complete_ms
lipsync_ready_ms
playback_start_ms
turn_end_ms
```

### 14.2 Python 打点示例

```python
# core/metrics.py
import time
from contextlib import contextmanager


class Metrics:
    def __init__(self):
        self.data = {}

    def mark(self, key: str):
        self.data[key] = time.perf_counter()

    def delta_ms(self, start: str, end: str) -> float:
        return (self.data[end] - self.data[start]) * 1000


@contextmanager
def measure(metrics: Metrics, start_key: str, end_key: str):
    metrics.mark(start_key)
    try:
        yield
    finally:
        metrics.mark(end_key)
```

### 14.3 真实最有效的优化点

从经验来看，最有效的优化通常是下面几条：

1. **VAD + endpointing 调优**：减少“等用户说完”的滞后。
2. **LLM 文本分段送 TTS**：不要等完整回复。
3. **句子级 lip sync**：避免整段音频分析阻塞。
4. **缓存 voice config**：减少每次 TTS 请求重复初始化成本。
5. **统一采样率**：减少不必要的转码与重采样。
6. **减少前端解码开销**：如果条件允许，用更直接的播放格式。

### 14.4 一个简单的并发调度器思路

```python
# tts/scheduler.py
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator


class TTSQueueScheduler:
    def __init__(self, max_queue_segments: int = 8):
        self.queue = asyncio.Queue(maxsize=max_queue_segments)
        self.cancelled = False

    async def enqueue_text(self, text: str):
        if self.cancelled:
            return
        await self.queue.put(text)

    async def cancel(self):
        self.cancelled = True
        while not self.queue.empty():
            self.queue.get_nowait()

    async def consume(self, synthesize_fn):
        while not self.cancelled:
            text = await self.queue.get()
            async for chunk in synthesize_fn(text):
                yield chunk
```

这类调度器虽然简单，但可以很好地承接“LLM 不断吐句子，TTS 按序合成与播放”的模式。

## 十五、一个更接近生产的组合建议

如果你现在要为 OpenHuman 选择一套**先能上线、后能持续优化**的方案，我会建议下面这个组合：

### 方案一：线上优先

- VAD：Silero / WebRTC VAD
- STT：Deepgram 实时 WebSocket
- LLM：流式输出
- TTS：ElevenLabs 流式
- Lip Sync：句子级 Rhubarb + 前端平滑

优点：

- 上线快
- 实时体验好
- 声音表现力强
- 架构扩展性高

### 方案二：隐私优先

- VAD：本地
- STT：Whisper / faster-whisper 本地
- LLM：本地或私有云
- TTS：可先保留 ElevenLabs，后续再替换本地 TTS
- Lip Sync：本地分析或弱化为音量驱动

优点：

- 数据可控
- 成本可控
- 适合桌面端与企业内网

### 方案三：低延迟极致优化

- STT partial 到达即做意图预测
- LLM 先生成短回复骨架
- TTS 按子句切片
- 口型前 200ms 采用音量驱动，后续切换精细 viseme

优点：

- 体感非常灵敏
- 更像真实对话

缺点：

- 逻辑复杂
- 需要处理回滚与中断一致性

## 十六、安全、成本与可维护性补充

语音系统上线后，除了效果，还要考虑三个常被忽视的问题。

### 16.1 安全

- 不要把 ElevenLabs / Deepgram Key 暴露到前端。
- 所有 Provider 调用走后端代理。
- 对上传音频大小、时长、格式做限制。
- 对 WebSocket 会话做 session 认证与速率限制。

### 16.2 成本

- TTS 比你想象中更容易成为大头，尤其在长对话、多人并发时。
- 可以对“思考型长回复”做文本摘要后再播报。
- 对重复固定短句做音频缓存，比如欢迎词、系统提示词。

### 16.3 可维护性

- Provider 抽象一定要早做。
- 事件协议一旦稳定，后续迭代成本会低很多。
- 把日志打全：session_id、turn_id、segment_id 缺一不可。

## 十七、结语：把语音链路做成系统，而不是拼 API

OpenHuman 的语音能力，表面上看是 STT、LLM、TTS、Lip Sync 四段链路，实际上真正决定用户体验的是它们之间的**时序、缓冲、切分、对齐、打断与回退**。

如果你只是在 Demo 阶段，最容易做出来的是：

- 点一下录音
- 识别一整段文本
- LLM 输出一大段
- TTS 一次性播完
- 嘴巴跟着音量乱动

但如果你想做的是一个真正像“在场人物”的 OpenHuman，那么必须把语音系统当成一个独立子系统来设计：

- STT 不只是识别率问题，而是 endpointing 与 partial 策略问题。
- TTS 不只是音色问题，而是切句、流式和角色稳定性问题。
- Lip Sync 不只是动画问题，而是音频时钟与时间轴一致性问题。
- 中断不只是 stop 按钮，而是跨模块状态一致性问题。

本文给出的实现路径，本质上是一个兼顾工程复杂度与体验上限的折中方案：**用 Deepgram / Whisper 解决输入，用 ElevenLabs 提升输出质感，用 Rhubarb 或 viseme 时间轴解决嘴型同步，再通过统一事件总线把整个链路串起来。**

等你把这条链路真正搭起来以后，你会发现 OpenHuman 的“人格感”会有质的提升。因为用户不再觉得自己在调用一个接口，而是在和一个能听、能说、能看起来像在说话的实体交流。

如果你接下来还要继续往前走，我建议优先做三件事：

1. 给每段链路打点，找出真正的延迟瓶颈。
2. 把 TTS 改造成句子级流式调度。
3. 把 lip sync 从音量驱动升级到 viseme 时间轴。

做到这一步，你的 OpenHuman 就已经不只是“支持语音”，而是开始具备一个现代数字人系统应有的语音交互骨架了。

## 相关阅读

- [OpenHuman 实战：开源 AI 超级智能框架入门与 macOS 安装](/2026/06/02/OpenHuman-实战-开源AI超级智能框架入门与macOS安装/)
- [OpenHuman 模型路由实战：智能选择推理/快速/视觉模型的策略](/2026/06/02/OpenHuman-模型路由实战-智能选择推理-快速-视觉模型的策略/)
- [OpenHuman 消息通道实战：多平台消息收发与工作流触发](/2026/06/02/OpenHuman-消息通道实战-多平台消息收发与工作流触发/)
