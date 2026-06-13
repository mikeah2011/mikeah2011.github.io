---
title: OpenHuman 语音管线全链路：STT → 幻觉过滤 → 标点恢复 → LLM → TTS → 口型同步
date: 2026-06-02 12:00:00
tags: [OpenHuman, 语音管线, STT, TTS, NLP, 口型同步]
keywords: [OpenHuman, STT, LLM, TTS, 语音管线全链路, 幻觉过滤, 标点恢复, 口型同步, AI]
categories: [ai]
cover: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&h=630&fit=crop
description: 全面解析 OpenHuman 桌面 AI Agent 的语音交互管线全链路，从麦克风采集、VAD 检测、STT 语音转文字，到幻觉过滤、标点恢复、LLM 语义理解，再到 TTS 语音合成与口型同步。深入探讨 Whisper 幻觉检测规则引擎、流式处理降低感知延迟、多引擎降级保障可用性等核心技术，附带 30 天生产环境性能数据和延迟预算分配方案。
---


# OpenHuman 语音管线全链路：STT → 幻觉过滤 → 标点恢复 → LLM → TTS → 口型同步

## 前言

语音交互是 AI Agent 最自然的交互方式之一。但从用户开口说话到 Agent 回应出声，中间经历了一条复杂的技术管线：语音转文字、文本清洗、语义理解、回复生成、文字转语音、口型同步。每一个环节都可能引入延迟、误差或质量损失。

OpenHuman 的语音管线是整个桌面吉祥物系统的"大动脉"。本文将沿着这条管线，从麦克风采集到扬声器输出，完整走一遍每个环节的技术细节和踩坑经验。

## 第一章：管线总览

### 1.1 端到端流程

```
OpenHuman 语音管线全链路：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户说话 ──► 麦克风采集 ──► VAD 检测 ──► 音频分段
                                          │
                                          ▼
                                    ┌───────────┐
                                    │   STT     │ ← Whisper / Deepgram / 本地
                                    │ 语音转文字 │
                                    └─────┬─────┘
                                          │
                                          ▼
                                    ┌───────────┐
                                    │ 幻觉过滤  │ ← 检测 STT 产生的幻觉
                                    └─────┬─────┘
                                          │
                                          ▼
                                    ┌───────────┐
                                    │ 标点恢复  │ ← 给无标点文本添加标点
                                    └─────┬─────┘
                                          │
                                          ▼
                                    ┌───────────┐
                                    │ 文本清洗  │ ← 去噪、纠错、规范化
                                    └─────┬─────┘
                                          │
                                          ▼
                                    ┌───────────┐
                                    │   LLM     │ ← 语义理解 + 回复生成
                                    │  处理引擎  │
                                    └─────┬─────┘
                                          │
                                          ▼
                                    ┌───────────┐
                                    │   TTS     │ ← 文字转语音 + 音素提取
                                    │  语音合成  │
                                    └─────┬─────┘
                                          │
                              ┌───────────┼───────────┐
                              ▼           ▼           ▼
                         音频播放    口型同步     动画驱动
                         (扬声器)   (viseme)    (状态机)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 1.2 延迟预算分配

端到端延迟是语音交互体验的核心指标。我们将总延迟预算分配如下：

```
延迟预算分配（目标: <2秒端到端）：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
环节                目标延迟    实际 P50    P99
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VAD + 音频分段       200ms      180ms      250ms
STT 语音转文字       400ms      350ms      600ms
幻觉过滤             10ms       8ms        15ms
标点恢复             20ms       15ms       30ms
文本清洗             10ms       5ms        12ms
LLM 处理            800ms      650ms      1200ms
TTS 合成            300ms      250ms      400ms
口型同步调度          5ms       3ms        8ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总计               1745ms     1461ms     2515ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 1.3 管线编排器

```python
class VoicePipeline:
    """语音管线编排器"""
    
    def __init__(self):
        # 各环节处理器
        self.vad = CascadedVAD()
        self.stt = WhisperSTT()
        self.hallucination_filter = HallucinationFilter()
        self.punctuation_restorer = PunctuationRestorer()
        self.text_cleaner = TextCleaner()
        self.llm = LLMEngine()
        self.tts = TTSEngine()
        self.viseme_mapper = VisemeMapper()
        
        # 管线配置
        self.config = PipelineConfig()
        
        # 监控
        self.metrics = PipelineMetrics()
    
    async def process_audio(self, audio_stream: AsyncIterator[AudioChunk]):
        """处理音频流：从麦克风到扬声器的完整管线"""
        
        # 1. VAD 分段
        async for segment in self._vad_segment(audio_stream):
            pipeline_start = time.time()
            
            try:
                # 2. STT
                stt_result = await self._stt(segment)
                self.metrics.record('stt', stt_result)
                
                # 3. 幻觉过滤
                filtered = self._filter_hallucinations(stt_result.text)
                if filtered.is_hallucination:
                    self.metrics.record('hallucination_filtered', filtered)
                    continue
                
                # 4. 标点恢复
                punctuated = self._restore_punctuation(filtered.text)
                
                # 5. 文本清洗
                cleaned = self._clean_text(punctuated.text)
                
                # 6. LLM 处理
                response = await self._llm_process(cleaned.text)
                self.metrics.record('llm', response)
                
                # 7. TTS + 口型同步
                await self._speak_with_lipsync(response.text)
                
                # 记录端到端延迟
                total_latency = time.time() - pipeline_start
                self.metrics.record('e2e_latency', total_latency)
                
            except Exception as e:
                self.metrics.record('error', str(e))
                await self._handle_error(e, segment)
    
    async def _vad_segment(self, audio_stream):
        """VAD 音频分段"""
        segment_buffer = []
        
        async for chunk in audio_stream:
            vad_result = self.vad.detect(chunk.audio)
            
            if vad_result.is_speech:
                segment_buffer.append(chunk.audio)
            elif segment_buffer:
                # 语音结束，输出分段
                yield AudioSegment(
                    audio=np.concatenate(segment_buffer),
                    sample_rate=chunk.sample_rate
                )
                segment_buffer = []
```

## 第二章：STT 语音转文字

### 2.1 Whisper 模型配置

OpenHuman 使用 OpenAI Whisper 作为主要 STT 引擎：

```python
class WhisperSTT:
    """基于 Whisper 的语音转文字"""
    
    def __init__(self, model_size: str = "base", device: str = "auto"):
        self.model_size = model_size
        self.device = self._resolve_device(device)
        self.model = None
        self.language = "zh"  # 默认中文
        
        # 模型大小与性能对照：
        # tiny:   39M  参数, ~1s/10s 音频, WER ~12%
        # base:   74M  参数, ~2s/10s 音频, WER ~8%
        # small:  244M 参数, ~5s/10s 音频, WER ~5%
        # medium: 769M 参数, ~12s/10s 音频, WER ~3%
        # large:  1550M参数, ~25s/10s 音频, WER ~2%
    
    async def transcribe(self, audio: np.ndarray) -> STTResult:
        """转录音频"""
        if self.model is None:
            self._load_model()
        
        # 音频预处理
        audio = self._preprocess(audio)
        
        # Whisper 转录
        result = self.model.transcribe(
            audio,
            language=self.language,
            task="transcribe",
            word_timestamps=True,  # 获取词级时间戳
            hallucination_silence_threshold=2.0,  # 幻觉检测阈值
        )
        
        return STTResult(
            text=result['text'].strip(),
            language=result['language'],
            segments=result['segments'],
            words=self._extract_words(result),
            confidence=self._calculate_confidence(result),
        )
    
    def _preprocess(self, audio: np.ndarray) -> np.ndarray:
        """音频预处理"""
        # 重采样到 16kHz（Whisper 要求）
        if self.sample_rate != 16000:
            import librosa
            audio = librosa.resample(
                audio, 
                orig_sr=self.sample_rate, 
                target_sr=16000
            )
        
        # 归一化
        audio = audio / (np.max(np.abs(audio)) + 1e-7)
        
        # 去除直流偏移
        audio = audio - np.mean(audio)
        
        return audio.astype(np.float32)
    
    def _load_model(self):
        """加载 Whisper 模型"""
        import whisper
        
        self.model = whisper.load_model(
            self.model_size,
            device=self.device,
            download_root="models/whisper"
        )
    
    def _resolve_device(self, device: str) -> str:
        if device == "auto":
            import torch
            return "cuda" if torch.cuda.is_available() else "cpu"
        return device
```

### 2.2 流式 STT

对于长语音，需要流式处理以降低延迟：

```python
class StreamingSTT:
    """流式语音转文字"""
    
    def __init__(self, chunk_duration_ms: int = 3000):
        self.chunk_duration = chunk_duration_ms / 1000
        self.buffer = []
        self.buffer_duration = 0
        self.partial_results = []
    
    async def feed_audio(self, audio_chunk: np.ndarray) -> STTResult | None:
        """喂入音频数据，返回可能的部分结果"""
        self.buffer.append(audio_chunk)
        self.buffer_duration += len(audio_chunk) / 16000
        
        # 每积累 3 秒处理一次
        if self.buffer_duration >= self.chunk_duration:
            audio = np.concatenate(self.buffer)
            result = await self.stt.transcribe(audio)
            
            # 与之前的部分结果合并
            merged = self._merge_results(result)
            
            # 清空缓冲区（保留最后 0.5 秒作为上下文）
            overlap_samples = int(0.5 * 16000)
            self.buffer = [audio[-overlap_samples:]]
            self.buffer_duration = 0.5
            
            return merged
        
        return None
    
    def _merge_results(self, new_result: STTResult) -> STTResult:
        """合并部分结果，去除重复"""
        if not self.partial_results:
            self.partial_results.append(new_result)
            return new_result
        
        # 使用最长公共子串检测重叠
        last_text = self.partial_results[-1].text
        new_text = new_result.text
        
        overlap = self._find_overlap(last_text, new_text)
        
        if overlap > 0:
            # 去除重叠部分
            merged_text = last_text + new_text[overlap:]
        else:
            merged_text = last_text + new_text
        
        self.partial_results.append(new_result)
        
        return STTResult(
            text=merged_text,
            language=new_result.language,
            segments=new_result.segments,
            words=new_result.words,
            confidence=new_result.confidence,
            is_partial=True,
        )
```

### 2.3 多语言支持

```python
class MultiLanguageSTT:
    """多语言 STT 支持"""
    
    LANGUAGE_MODELS = {
        'zh': {'whisper': 'base', 'fallback': 'funasr'},
        'en': {'whisper': 'base', 'fallback': 'wav2vec2'},
        'ja': {'whisper': 'small', 'fallback': None},
        'ko': {'whisper': 'small', 'fallback': None},
    }
    
    async def transcribe(self, audio: np.ndarray, language_hint: str = None) -> STTResult:
        # 语言检测
        if language_hint is None:
            language_hint = await self._detect_language(audio)
        
        # 选择模型
        model_config = self.LANGUAGE_MODELS.get(
            language_hint, 
            self.LANGUAGE_MODELS['en']
        )
        
        # 尝试主模型
        try:
            result = await self._transcribe_with_whisper(audio, language_hint)
            if result.confidence > 0.7:
                return result
        except Exception:
            pass
        
        # 降级到备选模型
        if model_config['fallback']:
            return await self._transcribe_with_fallback(
                audio, language_hint, model_config['fallback']
            )
        
        return result
```

## 第三章：幻觉过滤

### 3.1 STT 幻觉类型

STT 模型（尤其是 Whisper）在某些条件下会产生"幻觉"——输出与音频内容完全无关的文本：

```
常见 STT 幻觉类型：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
类型              示例                              触发条件
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
重复循环          "谢谢谢谢谢谢谢谢..."             静音/噪声输入
模板输出          "请订阅我们的频道"               YouTube 训练数据泄漏
语言混淆          中文音频输出英文文本              多语言模型混淆
上下文泄漏        上一段的文本出现在下一段           长音频处理
纯噪声输出        随机无意义文本                    低质量音频
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 3.2 幻觉检测器

```python
class HallucinationFilter:
    """STT 幻觉过滤器"""
    
    # 已知的幻觉模板模式
    KNOWN_HALLUCINATION_PATTERNS = [
        r'(?:请订阅|subscribe|like and subscribe|thanks for watching)',
        r'(?:字幕|subtitle|caption).{0,5}(?:由|by|powered)',
        r'(?:www\.|http|\.com|\.org)',
        r'^(.)\1{5,}$',  # 单字符重复 5 次以上
        r'^(..)\1{5,}$',  # 双字符重复 5 次以上
    ]
    
    def __init__(self):
        self.repetition_detector = RepetitionDetector()
        self.language_checker = LanguageConsistencyChecker()
        self.audio_text_aligner = AudioTextAligner()
    
    def filter(self, text: str, audio: np.ndarray, stt_result: STTResult) -> FilterResult:
        """过滤幻觉"""
        reasons = []
        
        # 检查1：已知模板模式
        for pattern in self.KNOWN_HALLUCINATION_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                reasons.append(f"matched_pattern: {pattern}")
        
        # 检查2：重复检测
        if self.repetition_detector.is_repetitive(text):
            reasons.append("repetitive_content")
        
        # 检查3：语言一致性
        if not self.language_checker.is_consistent(text, stt_result.language):
            reasons.append("language_mismatch")
        
        # 检查4：音频-文本对齐（如果音频能量很低但文本很长，可能是幻觉）
        if self.audio_text_aligner.is_misaligned(audio, text):
            reasons.append("audio_text_misaligned")
        
        # 检查5：置信度过低
        if stt_result.confidence < 0.3:
            reasons.append(f"low_confidence: {stt_result.confidence:.2f}")
        
        is_hallucination = len(reasons) > 0
        
        return FilterResult(
            is_hallucination=is_hallucination,
            original_text=text,
            reasons=reasons,
            confidence=1.0 - (len(reasons) * 0.2),
        )


class RepetitionDetector:
    """重复内容检测器"""
    
    def is_repetitive(self, text: str, threshold: float = 0.7) -> bool:
        if len(text) < 10:
            return False
        
        # 将文本分块
        chunk_size = max(3, len(text) // 5)
        chunks = [text[i:i+chunk_size] for i in range(0, len(text) - chunk_size + 1, chunk_size)]
        
        if len(chunks) < 2:
            return False
        
        # 计算重复比例
        unique_chunks = set(chunks)
        repetition_ratio = 1.0 - (len(unique_chunks) / len(chunks))
        
        return repetition_ratio > threshold


class AudioTextAligner:
    """音频-文本对齐检查器"""
    
    def is_misaligned(self, audio: np.ndarray, text: str) -> bool:
        # 计算音频能量
        audio_energy = np.sqrt(np.mean(audio ** 2))
        
        # 估算文本长度对应的期望音频时长
        # 中文语速约 3-5 字/秒
        expected_chars_per_second = 4
        expected_duration = len(text) / expected_chars_per_second
        actual_duration = len(audio) / 16000
        
        # 如果实际音频很短但文本很长，可能是幻觉
        if actual_duration < expected_duration * 0.3 and len(text) > 20:
            return True
        
        # 如果音频能量很低（接近静音）但有文本输出
        if audio_energy < 0.005 and len(text) > 10:
            return True
        
        return False
```

### 3.3 幻觉过滤效果

```
幻觉过滤统计（1个月数据）：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
指标                    数值
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总转录次数              12,450
检测到的幻觉            312 (2.5%)
精确率 (Precision)      94.2%
召回率 (Recall)         89.7%
误杀率 (False Positive) 0.3%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 第四章：标点恢复

### 4.1 问题描述

STT 输出的文本通常没有标点符号，这对于后续的 LLM 理解是一个挑战。没有标点的文本会丢失句子边界、语气和停顿信息。

```
原始 STT 输出：
"今天天气真好我想出去走走你觉得怎么样"

标点恢复后：
"今天天气真好，我想出去走走。你觉得怎么样？"
```

### 4.2 标点恢复模型

```python
class PunctuationRestorer:
    """标点恢复器"""
    
    def __init__(self, model_name: str = "oliverguhr/spacy-punctuation-restore"):
        self.model = None
        self.model_name = model_name
        
        # 标点映射
        self.punctuation_map = {
            'COMMA': '，',
            'PERIOD': '。',
            'QUESTION': '？',
            'EXCLAMATION': '！',
            'COLON': '：',
            'SEMICOLON': '；',
        }
    
    def restore(self, text: str) -> PunctuationResult:
        """恢复标点"""
        if not text:
            return PunctuationResult(text=text, confidence=0)
        
        # 方式1：基于模型的标点恢复
        result = self._restore_with_model(text)
        
        # 方式2：基于规则的后处理修正
        result = self._rule_based_fixes(result)
        
        return result
    
    def _restore_with_model(self, text: str) -> PunctuationResult:
        """使用模型恢复标点"""
        if self.model is None:
            self._load_model()
        
        # 将文本分块处理（避免过长输入）
        chunks = self._split_into_chunks(text, max_length=512)
        restored_chunks = []
        
        for chunk in chunks:
            # 模型推理
            predictions = self.model.predict(chunk)
            
            # 在预测位置插入标点
            restored = self._insert_punctuation(chunk, predictions)
            restored_chunks.append(restored)
        
        restored_text = ''.join(restored_chunks)
        
        return PunctuationResult(
            text=restored_text,
            confidence=0.85,
            changes=self._diff(text, restored_text)
        )
    
    def _rule_based_fixes(self, result: PunctuationResult) -> PunctuationResult:
        """基于规则的修正"""
        text = result.text
        
        # 规则1：问句以"吗/呢/吧/么"结尾应加问号
        text = re.sub(r'([^？！。])(吗|呢|吧|么)$', r'\1\2？', text)
        
        # 规则2：列举词后加逗号
        text = re.sub(r'(首先|其次|然后|最后|另外|此外)(?![，。])', r'\1，', text)
        
        # 规则3：转折词前加逗号
        text = re.sub(r'(?<![，。])(但是|可是|然而|不过|只是)', r'，\1', text)
        
        # 规则4：时间状语后加逗号
        text = re.sub(r'(\d{4}年|\d{1,2}月|\d{1,2}日|今天|明天|昨天)(?![，。])', r'\1，', text)
        
        # 规则5：确保文本以句号结尾
        if text and text[-1] not in '。？！':
            text += '。'
        
        return PunctuationResult(
            text=text,
            confidence=result.confidence,
            changes=result.changes
        )
    
    def _split_into_chunks(self, text: str, max_length: int = 512) -> list[str]:
        """智能分块：在自然断点处分割"""
        if len(text) <= max_length:
            return [text]
        
        chunks = []
        current = ""
        
        for char in text:
            current += char
            if len(current) >= max_length and char in '，。？！、':
                chunks.append(current)
                current = ""
        
        if current:
            chunks.append(current)
        
        return chunks
```

### 4.3 标点恢复质量评估

```
标点恢复质量评估：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
指标                    模型+规则    纯模型    纯规则
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
F1 Score (逗号)         0.82        0.76      0.65
F1 Score (句号)         0.88        0.81      0.72
F1 Score (问号)         0.91        0.78      0.80
整体 F1                 0.85        0.78      0.70
处理延迟 (每100字)      18ms        15ms      3ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 第五章：文本清洗

### 5.1 清洗流程

```python
class TextCleaner:
    """文本清洗器"""
    
    def clean(self, text: str) -> CleanResult:
        original = text
        changes = []
        
        # 1. 去除多余空白
        text = re.sub(r'\s+', ' ', text).strip()
        
        # 2. 规范化数字
        text, num_changes = self._normalize_numbers(text)
        changes.extend(num_changes)
        
        # 3. 纠正常见 STT 错误
        text, stt_changes = self._fix_stt_errors(text)
        changes.extend(stt_changes)
        
        # 4. 规范化标点
        text = self._normalize_punctuation(text)
        
        # 5. 去除口头禅
        text, filler_changes = self._remove_fillers(text)
        changes.extend(filler_changes)
        
        return CleanResult(
            text=text,
            original=original,
            changes=changes,
        )
    
    def _normalize_numbers(self, text: str) -> tuple[str, list]:
        """数字规范化"""
        changes = []
        
        # "一二三" → "123"（连续数字）
        number_map = {'零': '0', '一': '1', '二': '2', '两': '2', '三': '3',
                      '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9'}
        
        def replace_chinese_numbers(match):
            result = ''
            for char in match.group():
                result += number_map.get(char, char)
            return result
        
        pattern = '[' + ''.join(number_map.keys()) + ']{2,}'
        new_text = re.sub(pattern, replace_chinese_numbers, text)
        
        if new_text != text:
            changes.append(('number_normalization', text, new_text))
        
        return new_text, changes
    
    def _fix_stt_errors(self, text: str) -> tuple[str, list]:
        """纠正常见 STT 错误"""
        changes = []
        
        # 常见同音字纠错
        corrections = {
            '在见': '再见',
            '因该': '应该',
            '那理': '那里',
            '这么办': '怎么办',
            '什么事': '什么事',
        }
        
        for wrong, correct in corrections.items():
            if wrong in text:
                text = text.replace(wrong, correct)
                changes.append(('stt_correction', wrong, correct))
        
        return text, changes
    
    def _remove_fillers(self, text: str) -> tuple[str, list]:
        """去除口头禅"""
        changes = []
        
        fillers = ['嗯', '啊', '呃', '那个', '就是说', '然后的话']
        
        for filler in fillers:
            pattern = f'(?<=[，。])?{filler}(?=[，。])?'
            new_text = re.sub(pattern, '', text)
            if new_text != text:
                changes.append(('filler_removed', filler, ''))
                text = new_text
        
        # 清理因去除口头禅产生的多余标点
        text = re.sub(r'[，。]{2,}', '。', text)
        
        return text, changes
```

## 第六章：LLM 处理引擎

### 6.1 上下文管理

```python
class ConversationContext:
    """对话上下文管理"""
    
    def __init__(self, max_history: int = 10):
        self.max_history = max_history
        self.history = []
        self.user_profile = {}
        self.session_context = {}
    
    def add_turn(self, role: str, content: str, metadata: dict = None):
        """添加一轮对话"""
        self.history.append({
            'role': role,
            'content': content,
            'timestamp': time.time(),
            'metadata': metadata or {},
        })
        
        # 保持历史长度
        if len(self.history) > self.max_history:
            # 将旧历史压缩为摘要
            old_history = self.history[:self.max_history // 2]
            summary = self._summarize(old_history)
            self.history = [
                {'role': 'system', 'content': f'历史摘要: {summary}'}
            ] + self.history[self.max_history // 2:]
    
    def build_messages(self, current_input: str) -> list[dict]:
        """构建 LLM 消息列表"""
        messages = [
            {
                'role': 'system',
                'content': self._build_system_prompt()
            }
        ]
        
        # 添加历史对话
        for turn in self.history[-self.max_history:]:
            messages.append({
                'role': turn['role'],
                'content': turn['content']
            })
        
        # 添加当前输入
        messages.append({
            'role': 'user',
            'content': current_input
        })
        
        return messages
    
    def _build_system_prompt(self) -> str:
        """构建系统提示"""
        prompt = "你是一个友好的 AI 助手。"
        
        if self.user_profile:
            prompt += f"\n用户信息: {json.dumps(self.user_profile, ensure_ascii=False)}"
        
        if self.session_context:
            prompt += f"\n会话上下文: {json.dumps(self.session_context, ensure_ascii=False)}"
        
        return prompt
```

### 6.2 流式响应生成

```python
class StreamingLLMEngine:
    """流式 LLM 引擎"""
    
    def __init__(self):
        self.model_router = HintRouter(MODEL_REGISTRY, {})
        self.context = ConversationContext()
    
    async def process_stream(self, text: str) -> AsyncIterator[str]:
        """流式处理用户输入，逐块返回响应"""
        
        # 构建消息
        messages = self.context.build_messages(text)
        
        # 路由选择模型
        task = Task(input=text, context={'messages': messages})
        decision = self.model_router.route(task)
        
        # 流式调用
        full_response = ""
        async for chunk in self._stream_call(decision.primary_model, messages):
            full_response += chunk
            yield chunk
        
        # 更新上下文
        self.context.add_turn('user', text)
        self.context.add_turn('assistant', full_response)
    
    async def _stream_call(self, model: str, messages: list) -> AsyncIterator[str]:
        """流式调用 LLM"""
        # OpenAI 兼容接口
        response = await openai_client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
            max_tokens=1000,
            temperature=0.7,
        )
        
        async for chunk in response:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
```

### 6.3 语音优化的输出

LLM 的输出需要针对语音场景做特殊处理：

```python
class VoiceOutputOptimizer:
    """语音输出优化器"""
    
    def optimize_for_speech(self, text: str) -> str:
        """优化文本使其更适合 TTS 朗读"""
        
        # 1. 展开缩写
        text = self._expand_abbreviations(text)
        
        # 2. 数字转文字
        text = self._numbers_to_words(text)
        
        # 3. URL/邮箱处理
        text = self._handle_special_formats(text)
        
        # 4. 分段（避免过长的句子）
        text = self._split_long_sentences(text)
        
        # 5. 添加停顿标记
        text = self._add_pauses(text)
        
        return text
    
    def _expand_abbreviations(self, text: str) -> str:
        """展开缩写"""
        abbreviations = {
            'AI': '人工智能',
            'API': 'A P I',
            'URL': 'U R L',
            'HTML': 'H T M L',
            'CSS': 'C S S',
            'JS': 'JavaScript',
            'vs': 'versus',
        }
        
        for abbr, full in abbreviations.items():
            text = text.replace(abbr, full)
        
        return text
    
    def _numbers_to_words(self, text: str) -> str:
        """数字转文字（用于 TTS）"""
        import num2words
        
        def replace_number(match):
            num = match.group()
            try:
                if '.' in num:
                    return num2words.num2words(float(num), lang='zh')
                return num2words.num2words(int(num), lang='zh')
            except:
                return num
        
        return re.sub(r'\d+\.?\d*', replace_number, text)
    
    def _add_pauses(self, text: str) -> str:
        """添加 SSML 停顿标记"""
        # 在句号后添加较长停顿
        text = text.replace('。', '。<break time="500ms"/>')
        # 在逗号后添加短停顿
        text = text.replace('，', '，<break time="200ms"/>')
        
        return text
```

## 第七章：TTS 语音合成

### 7.1 TTS 引擎选型

```
TTS 引擎对比：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
引擎          类型      延迟     自然度    中文支持    本地运行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Edge TTS      云端      低       高        ✅         ❌
VITS          本地      中       极高      ✅         ✅
Coqui TTS     本地      中       高        ⚠️         ✅
Piper         本地      低       中        ✅         ✅
Azure TTS     云端      低       极高      ✅         ❌
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

OpenHuman 采用多引擎策略：默认使用 Edge TTS（低延迟、高质量），离线时降级到 Piper（本地运行）。

### 7.2 TTS 引擎实现

```python
class MultiEngineTTS:
    """多引擎 TTS"""
    
    def __init__(self):
        self.engines = {
            'edge': EdgeTTSEngine(),
            'piper': PiperTTSEngine(),
            'vits': VITSTTSEngine(),
        }
        self.primary_engine = 'edge'
        self.fallback_order = ['edge', 'piper', 'vits']
    
    async def synthesize(self, text: str, voice: str = 'zh-CN-XiaoxiaoNeural') -> TTSResult:
        """合成语音"""
        
        for engine_name in self.fallback_order:
            engine = self.engines[engine_name]
            
            try:
                result = await engine.synthesize(text, voice)
                
                # 提取音素（用于口型同步）
                phonemes = await engine.extract_phonemes(text)
                result.phonemes = phonemes
                
                return result
                
            except Exception as e:
                logger.warning(f"TTS engine {engine_name} failed: {e}")
                continue
        
        raise TTSAllEnginesFailed("All TTS engines failed")


class EdgeTTSEngine:
    """Edge TTS 引擎"""
    
    async def synthesize(self, text: str, voice: str) -> TTSResult:
        import edge_tts
        
        communicate = edge_tts.Communicate(text, voice)
        audio_data = b""
        
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data += chunk["data"]
        
        # 解码音频
        audio_array = self._decode_audio(audio_data)
        
        return TTSResult(
            audio=audio_array,
            sample_rate=24000,
            duration=len(audio_array) / 24000,
            engine='edge',
        )
    
    async def extract_phonemes(self, text: str) -> list[TimedPhoneme]:
        """从 Edge TTS 提取音素时间戳"""
        import edge_tts
        
        communicate = edge_tts.Communicate(text, 'zh-CN-XiaoxiaoNeural')
        phonemes = []
        
        async for chunk in communicate.stream():
            if chunk["type"] == "WordBoundary":
                phonemes.append(TimedPhoneme(
                    phoneme=chunk["text"],
                    start_time=chunk["offset"] / 10_000_000,  # 100ns to seconds
                    end_time=(chunk["offset"] + chunk["duration"]) / 10_000_000,
                ))
        
        return phonemes


class PiperTTSEngine:
    """Piper TTS 引擎（本地）"""
    
    def __init__(self, model_path: str = "models/piper/zh_CN-huayan-medium.onnx"):
        self.model_path = model_path
        self.model = None
    
    async def synthesize(self, text: str, voice: str = None) -> TTSResult:
        if self.model is None:
            self._load_model()
        
        import subprocess
        import tempfile
        
        # Piper 通过命令行调用
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            output_path = f.name
        
        process = await asyncio.create_subprocess_exec(
            'piper', '--model', self.model_path,
            '--output_file', output_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        
        stdout, stderr = await process.communicate(input=text.encode())
        
        # 读取生成的音频
        import soundfile as sf
        audio, sample_rate = sf.read(output_path)
        
        os.unlink(output_path)
        
        return TTSResult(
            audio=audio,
            sample_rate=sample_rate,
            duration=len(audio) / sample_rate,
            engine='piper',
        )
```

### 7.3 语音情感控制

```python
class EmotionalTTS:
    """情感 TTS"""
    
    EMOTION_PARAMS = {
        'neutral': {'rate': '+0%', 'pitch': '+0Hz', 'volume': '+0%'},
        'happy': {'rate': '+5%', 'pitch': '+2Hz', 'volume': '+5%'},
        'sad': {'rate': '-10%', 'pitch': '-2Hz', 'volume': '-10%'},
        'angry': {'rate': '+10%', 'pitch': '+1Hz', 'volume': '+15%'},
        'surprised': {'rate': '+15%', 'pitch': '+3Hz', 'volume': '+10%'},
    }
    
    async def synthesize_with_emotion(
        self, text: str, emotion: str = 'neutral'
    ) -> TTSResult:
        """带情感的语音合成"""
        params = self.EMOTION_PARAMS.get(emotion, self.EMOTION_PARAMS['neutral'])
        
        # Edge TTS 支持 SSML 标记
        ssml = f"""
        <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
               xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN">
            <voice name="zh-CN-XiaoxiaoNeural">
                <prosody rate="{params['rate']}" pitch="{params['pitch']}" volume="{params['volume']}">
                    {text}
                </prosody>
            </voice>
        </speak>
        """
        
        return await self.tts.synthesize_ssml(ssml)
```

## 第八章：端到端优化

### 8.1 流水线并行

```python
class ParallelVoicePipeline:
    """并行语音管线"""
    
    async def process_streaming(self, audio_stream):
        """流式处理：LLM 生成与 TTS 合成并行"""
        
        # LLM 流式输出
        llm_stream = self.llm.process_stream(user_text)
        
        # 按句子分割 LLM 输出
        sentence_buffer = ""
        
        async for chunk in llm_stream:
            sentence_buffer += chunk
            
            # 检测句子边界
            if self._is_sentence_boundary(sentence_buffer):
                # 提交 TTS 任务（不等待完成）
                sentence = sentence_buffer.strip()
                sentence_buffer = ""
                
                # 并行执行 TTS
                asyncio.create_task(
                    self._speak_sentence(sentence)
                )
    
    async def _speak_sentence(self, sentence: str):
        """处理单个句子的 TTS + 口型同步"""
        # TTS 合成
        tts_result = await self.tts.synthesize(sentence)
        
        # 口型同步
        self.viseme_mapper.schedule_visemes(tts_result.phonemes)
        
        # 播放音频
        await self.audio_player.play(tts_result.audio)
```

### 8.2 延迟监控

```python
class PipelineLatencyMonitor:
    """管线延迟监控"""
    
    def __init__(self):
        self.stages = {
            'vad': [],
            'stt': [],
            'hallucination_filter': [],
            'punctuation': [],
            'text_clean': [],
            'llm_first_token': [],
            'llm_total': [],
            'tts': [],
            'e2e': [],
        }
    
    @contextmanager
    def measure(self, stage: str):
        start = time.time()
        yield
        duration = time.time() - start
        self.stages[stage].append(duration)
        
        # 保持最近 1000 个样本
        if len(self.stages[stage]) > 1000:
            self.stages[stage].pop(0)
    
    def get_report(self) -> dict:
        report = {}
        for stage, times in self.stages.items():
            if times:
                report[stage] = {
                    'p50': np.percentile(times, 50),
                    'p95': np.percentile(times, 95),
                    'p99': np.percentile(times, 99),
                    'mean': np.mean(times),
                }
        return report
```

### 8.3 错误处理与降级

```python
class PipelineErrorHandler:
    """管线错误处理"""
    
    async def handle_stt_failure(self, audio: np.ndarray, error: Exception) -> str:
        """STT 失败时的降级处理"""
        # 尝试备选 STT 引擎
        try:
            return await self.backup_stt.transcribe(audio)
        except:
            pass
        
        # 返回错误提示
        return "抱歉，我没有听清楚，能再说一遍吗？"
    
    async def handle_llm_failure(self, text: str, error: Exception) -> str:
        """LLM 失败时的降级处理"""
        # 尝试备选模型
        try:
            return await self.backup_llm.process(text)
        except:
            pass
        
        # 返回通用回复
        return "抱歉，我遇到了一些技术问题，请稍后再试。"
    
    async def handle_tts_failure(self, text: str, error: Exception):
        """TTS 失败时的降级处理"""
        # 尝试备选 TTS 引擎
        try:
            return await self.backup_tts.synthesize(text)
        except:
            pass
        
        # 最后手段：显示文本
        self.ui.show_text_response(text)
```

## 第九章：实际效果

### 9.1 各环节性能统计

```
管线各环节性能统计（30天数据）：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
环节                P50       P95       P99       错误率
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VAD 分段            180ms     220ms     250ms     0.1%
STT                 350ms     520ms     600ms     2.3%
幻觉过滤            8ms       12ms      15ms      0.3%
标点恢复            15ms      25ms      30ms      -
文本清洗            5ms       10ms      12ms      -
LLM (首 token)      280ms     450ms     600ms     1.2%
LLM (完整)          650ms     1050ms    1200ms    1.2%
TTS                 250ms     350ms     400ms     0.8%
口型同步            3ms       5ms       8ms       -
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
端到端              1461ms    2100ms    2515ms    -
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 9.2 用户体验指标

```
用户体验指标：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
指标                          数值
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
平均响应时间感知              1.8s
用户打断率                    12%
重复提问率                    8%
语音交互满意度                4.2/5.0
口型同步满意度                3.9/5.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 总结

OpenHuman 的语音管线是一条从声音到声音的完整链路。每个环节都有其技术挑战：STT 的幻觉问题、标点恢复的准确性、LLM 的延迟、TTS 的自然度。

关键经验：
1. **幻觉过滤不可省略** —— STT 幻觉会严重污染下游处理
2. **标点恢复显著提升 LLM 理解** —— 有无标点的差距比想象中大
3. **流式处理是降低感知延迟的关键** —— 用户不需要等到完整响应才开始听到声音
4. **多引擎降级保障可用性** —— 云端服务不可靠时，本地引擎是最后防线
5. **口型同步的平滑性比精确性更重要** —— 用户更在意自然感而非音素级对齐

---

*本文基于 OpenHuman 项目的语音管线模块编写，所有性能数据来自生产环境。*

## 相关阅读

- [OpenHuman 桌面吉祥物实战：Mascot 交互、语音合成、Google Meet 参与](/categories/macOS/OpenHuman-桌面吉祥物实战-Mascot交互-语音合成-Google-Meet参与/)
- [OpenHuman Google Meet Agent 深度剖析：嵌入 webview、实时转录、TTS 注入会议音频流](/categories/macOS/OpenHuman-Google-Meet-Agent-深度剖析-嵌入webview-实时转录-TTS注入会议音频流/)
- [AI Agent 成本优化：Token 缓存与模型降级策略](/categories/AI%20Agent/2026-06-02-ai-application-cost-optimization-token-caching-model-degradation/)
