const themeStorageKey = "theme";
const preferredExampleVoiceNames = ["Samantha", "Alex", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Daniel", "Karen", "Tessa", "Moira", "Rishi"];
const noveltyVoiceNames = ["Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Fred", "Good News", "Jester", "Junior", "Organ", "Ralph", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox"];

/* ---------------- Theme Controller (Aurora Theme Consistency) ---------------- */
function getSavedTheme() {
  return localStorage.getItem(themeStorageKey) || localStorage.getItem("aurora-theme") || localStorage.getItem("cv-theme") || "system";
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.setAttribute("data-theme", "dark");
  } else if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
  updateThemeToggleIcon(theme);
}

function updateThemeToggleIcon(theme) {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  btn.innerHTML = isDark
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  btn.title = `当前主题：${theme === "dark" ? "深色" : theme === "light" ? "浅色" : "跟随系统"}（点击切换）`;
}

function toggleTheme() {
  const current = getSavedTheme();
  let next = "dark";
  if (current === "system") {
    next = window.matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark";
  } else if (current === "dark") {
    next = "light";
  } else {
    next = "dark";
  }
  localStorage.setItem(themeStorageKey, next);
  localStorage.setItem("aurora-theme", next);
  localStorage.setItem("cv-theme", next);
  applyTheme(next);
}

function initTheme() {
  applyTheme(getSavedTheme());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getSavedTheme() === "system") {
      applyTheme("system");
    }
  });
}

// Apply theme immediately to prevent flashing
initTheme();

/* ---------------- Audio & Voice Controller (Local Studio HD MP3) ---------------- */
function markAudioPlaying(trigger) {
  document.querySelectorAll(".audio-button.playing").forEach((element) => element.classList.remove("playing"));
  document.querySelectorAll(".word-card.playing-card").forEach((element) => element.classList.remove("playing-card"));
  if (!trigger) return () => {};
  trigger.classList.add("playing");
  const card = trigger.closest(".word-card");
  if (card) card.classList.add("playing-card");
  return () => {
    trigger.classList.remove("playing");
    if (card) card.classList.remove("playing-card");
  };
}

let activeAudioElement = null;
let lastPlayTimestamp = 0;
let lastPlayTrigger = null;

function playAudioTrack(src, trigger, onComplete) {
  if (activeAudioElement) {
    activeAudioElement.pause();
    activeAudioElement = null;
  }

  const stopPlaying = markAudioPlaying(trigger);
  const audio = new Audio(src);
  activeAudioElement = audio;

  audio.onended = () => {
    stopPlaying();
    if (activeAudioElement === audio) {
      activeAudioElement = null;
    }
    if (onComplete) onComplete();
  };

  audio.onerror = (e) => {
    console.error(`Audio playback error for ${src}:`, e);
    stopPlaying();
    if (activeAudioElement === audio) {
      activeAudioElement = null;
    }
    if (onComplete) onComplete();
  };

  audio.play().catch((err) => {
    console.error(`Audio play caught error for ${src}:`, err);
    stopPlaying();
    if (activeAudioElement === audio) {
      activeAudioElement = null;
    }
    if (onComplete) onComplete();
  });
}

function playWordAudio(firstArg, secondArg) {
  const trigger = (firstArg instanceof HTMLElement) ? firstArg : secondArg;
  if (!trigger) return;
  stopContinuousPlayback();

  // Cancel any pending hover timers on click/touch
  if (hoverPlayTimer) {
    clearTimeout(hoverPlayTimer);
    hoverPlayTimer = null;
  }

  // Prevent duplicate double-tap / synthetic click events on mobile within 350ms
  const now = Date.now();
  if (lastPlayTrigger === trigger && now - lastPlayTimestamp < 350) {
    return;
  }
  lastPlayTimestamp = now;
  lastPlayTrigger = trigger;

  const wordSrc = trigger.dataset.audioSrc;
  const card = trigger.closest(".word-card");
  const exampleBtn = card ? card.querySelector(".example .audio-button") : null;
  const exampleSrc = exampleBtn ? exampleBtn.dataset.audioSrc : null;

  if (wordSrc) {
    playAudioTrack(wordSrc, trigger, () => {
      if (exampleSrc && exampleBtn) {
        setTimeout(() => {
          playAudioTrack(exampleSrc, exampleBtn);
        }, 350);
      }
    });
  }
}

function playExampleAudio(firstArg, secondArg) {
  const trigger = (firstArg instanceof HTMLElement) ? firstArg : secondArg;
  if (!trigger) return;
  stopContinuousPlayback();

  if (hoverPlayTimer) {
    clearTimeout(hoverPlayTimer);
    hoverPlayTimer = null;
  }

  const now = Date.now();
  if (lastPlayTrigger === trigger && now - lastPlayTimestamp < 350) {
    return;
  }
  lastPlayTimestamp = now;
  lastPlayTrigger = trigger;

  const exampleSrc = trigger.dataset.audioSrc;
  if (exampleSrc) {
    playAudioTrack(exampleSrc, trigger);
  }
}

/* ---------------- Hover-To-Play Controller ---------------- */
let hoverPlayTimer = null;
let currentHoverCard = null;

function isPointerHoverSupported() {
  return window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function initHoverPlay() {
  if (!isPointerHoverSupported()) return;

  document.querySelectorAll(".word-card").forEach((card) => {
    if (card._hasHoverBound) return;
    card._hasHoverBound = true;

    card.addEventListener("mouseenter", () => {
      if (!isPointerHoverSupported()) return;

      if (hoverPlayTimer) {
        clearTimeout(hoverPlayTimer);
        hoverPlayTimer = null;
      }

      if (currentHoverCard === card && card.classList.contains("playing-card")) {
        return;
      }

      hoverPlayTimer = setTimeout(() => {
        currentHoverCard = card;
        const wordBtn = card.querySelector(".pronunciation .audio-button");
        if (wordBtn) {
          playWordAudio(wordBtn);
        }
      }, 140);
    });

    card.addEventListener("mouseleave", () => {
      if (hoverPlayTimer) {
        clearTimeout(hoverPlayTimer);
        hoverPlayTimer = null;
      }
    });
  });
}

/* ---------------- Tabs Controller (Core vs Proper Nouns) ---------------- */
function switchVocabTab(btn) {
  if (!btn) return;
  const nav = btn.closest(".vocab-tabs-nav");
  if (!nav) return;
  stopContinuousPlayback();

  if (hoverPlayTimer) {
    clearTimeout(hoverPlayTimer);
    hoverPlayTimer = null;
  }
  if (activeAudioElement) {
    activeAudioElement.pause();
    activeAudioElement = null;
  }
  document.querySelectorAll(".audio-button.playing").forEach((el) => el.classList.remove("playing"));
  document.querySelectorAll(".word-card.playing-card").forEach((el) => el.classList.remove("playing-card"));

  nav.querySelectorAll(".vocab-tab-btn").forEach((b) => {
    b.classList.remove("active");
    b.setAttribute("aria-selected", "false");
  });
  btn.classList.add("active");
  btn.setAttribute("aria-selected", "true");

  const targetId = btn.dataset.tabTarget;
  document.querySelectorAll(".vocab-tab-panel").forEach((panel) => {
    if (panel.id === targetId) {
      panel.classList.add("active");
      panel.hidden = false;
    } else {
      panel.classList.remove("active");
      panel.hidden = true;
    }
  });

  initHoverPlay();
}

function initVocabTabs() {
  document.querySelectorAll(".vocab-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchVocabTab(btn));
  });
}

/* ---------------- Custom Word Lookup ---------------- */
const primaryDictionaryApiBase = "https://freedictionaryapi.com/api/v1/entries/en/";
const fallbackDictionaryApiBase = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const wiktionaryApiBase = "https://en.wiktionary.org/w/api.php?action=query&generator=images&gimlimit=50&prop=imageinfo&iiprop=url&format=json&origin=*&titles=";
const translationApiBase = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t";
const fallbackTranslationApiBase = "https://api.mymemory.translated.net/get";
const customWordHistoryKey = "side-by-side-custom-word-history";
const customWordHistoryLimit = 20;
const translationHistoryKey = "english-translation-history";
const translationHistoryLimit = 10;
const partOfSpeechLabels = {
  noun: "名词",
  verb: "动词",
  adjective: "形容词",
  adverb: "副词",
  pronoun: "代词",
  preposition: "介词",
  conjunction: "连词",
  interjection: "感叹词"
};

async function fetchWithTimeout(url, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function translateChunk(text, sourceLanguage, targetLanguage) {
  if (!text) return "";
  try {
    const requestUrl = `${translationApiBase}&sl=${encodeURIComponent(sourceLanguage)}&tl=${encodeURIComponent(targetLanguage)}&q=${encodeURIComponent(text)}`;
    const response = await fetchWithTimeout(requestUrl, 8000);
    if (!response.ok) throw new Error(`Translation request failed with status ${response.status}`);
    const data = await response.json();
    const translation = Array.isArray(data?.[0])
      ? data[0].map((segment) => segment?.[0] || "").join("").trim()
      : "";
    if (translation) return translation;
  } catch (error) {
    console.warn("Primary translation request failed; trying fallback:", error);
  }

  const languagePair = `${sourceLanguage}|${targetLanguage}`;
  const fallbackUrl = `${fallbackTranslationApiBase}?langpair=${encodeURIComponent(languagePair)}&q=${encodeURIComponent(text)}`;
  const fallbackResponse = await fetchWithTimeout(fallbackUrl, 10000);
  if (!fallbackResponse.ok) {
    throw new Error(`Fallback translation request failed with status ${fallbackResponse.status}`);
  }
  const fallbackData = await fallbackResponse.json();
  return fallbackData?.responseData?.translatedText?.trim() || "";
}

function splitTranslationParagraph(paragraph, maxLength = 800) {
  const chunks = [];
  let remaining = paragraph;
  while (remaining.length > maxLength) {
    const candidate = remaining.slice(0, maxLength);
    const breakPoints = [".", "!", "?", "。", "！", "？", "；", ";", "，", ",", " "]
      .map((character) => candidate.lastIndexOf(character))
      .filter((index) => index >= Math.floor(maxLength * 0.6));
    const breakAt = breakPoints.length ? Math.max(...breakPoints) + 1 : maxLength;
    chunks.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining.trim()) chunks.push(remaining.trim());
  return chunks;
}

async function translateText(text, sourceLanguage, targetLanguage) {
  const paragraphs = text.split("\n");
  const translated = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      translated.push("");
      continue;
    }
    const chunks = splitTranslationParagraph(paragraph);
    const translatedChunks = [];
    for (const chunk of chunks) {
      translatedChunks.push(await translateChunk(chunk.trim(), sourceLanguage, targetLanguage));
    }
    translated.push(translatedChunks.join(" "));
  }
  return translated.join("\n");
}

function translateToChinese(text) {
  return translateText(text, "en", "zh-CN");
}

let activeSpeechUtterance = null;
let activeSpeechSession = null;
let speechWatchdogTimer = null;

function stopActiveSpeech() {
  if (!activeSpeechSession) return;
  const session = activeSpeechSession;
  activeSpeechSession = null;
  activeSpeechUtterance = null;
  if (speechWatchdogTimer) {
    clearTimeout(speechWatchdogTimer);
    speechWatchdogTimer = null;
  }
  window.speechSynthesis.cancel();
  session.stopPlaying();
  session.onFinish();
}

function speakText(text, language, trigger, options = {}) {
  const status = document.getElementById("custom-word-status") || document.getElementById("translation-status");
  if (!text || !("speechSynthesis" in window)) {
    if (status) {
      status.textContent = "当前浏览器不支持语音播放，请使用 Safari、Chrome 或 Edge。";
      status.classList.add("error");
    }
    return;
  }
  if (activeAudioElement) {
    activeAudioElement.pause();
    activeAudioElement = null;
  }
  if (speechWatchdogTimer) {
    clearTimeout(speechWatchdogTimer);
    speechWatchdogTimer = null;
  }
  stopActiveSpeech();
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) window.speechSynthesis.cancel();
  if (status) {
    status.textContent = "";
    status.classList.remove("error");
  }
  const stopPlaying = markAudioPlaying(trigger);
  const segments = Array.isArray(options.segments) && options.segments.length ? options.segments : [text];
  const session = {
    stopPlaying,
    onFinish: typeof options.onFinish === "function" ? options.onFinish : () => {}
  };
  activeSpeechSession = session;

  const finish = () => {
    if (activeSpeechSession !== session) return;
    if (speechWatchdogTimer) {
      clearTimeout(speechWatchdogTimer);
      speechWatchdogTimer = null;
    }
    stopPlaying();
    session.onFinish();
    activeSpeechSession = null;
    activeSpeechUtterance = null;
  };

  const play = (segmentIndex, isRetry = false) => {
    if (activeSpeechSession !== session) return;
    let hasStarted = false;
    const utterance = new SpeechSynthesisUtterance(segments[segmentIndex]);
    activeSpeechUtterance = utterance;
    utterance.lang = language;
    utterance.rate = 0.9;
    utterance.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    if (language.startsWith("en")) {
      utterance.voice = voices.find((voice) => preferredExampleVoiceNames.includes(voice.name))
        || voices.find((voice) => voice.lang.startsWith("en") && !noveltyVoiceNames.includes(voice.name))
        || null;
    } else {
      utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith("zh"))
        || null;
    }
    utterance.onstart = () => {
      if (activeSpeechSession !== session || activeSpeechUtterance !== utterance) return;
      hasStarted = true;
      if (speechWatchdogTimer) {
        clearTimeout(speechWatchdogTimer);
        speechWatchdogTimer = null;
      }
      if (typeof options.onSegmentStart === "function") {
        options.onSegmentStart(segmentIndex, segments.length);
      }
    };
    utterance.onend = () => {
      if (activeSpeechSession !== session || activeSpeechUtterance !== utterance) return;
      if (segmentIndex + 1 < segments.length) {
        play(segmentIndex + 1);
      } else {
        finish();
      }
    };
    utterance.onerror = (event) => {
      if (activeSpeechSession !== session || activeSpeechUtterance !== utterance) return;
      if (event.error !== "canceled" && event.error !== "interrupted") {
        console.error(`Speech synthesis failed for ${language}:`, event.error);
        if (status) {
          status.textContent = "当前浏览器无法播放这段语音，请检查系统媒体音量或更换浏览器。";
          status.classList.add("error");
        }
      }
      finish();
    };

    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);

    speechWatchdogTimer = setTimeout(() => {
      if (activeSpeechSession !== session || activeSpeechUtterance !== utterance || hasStarted || window.speechSynthesis.speaking) return;
      window.speechSynthesis.cancel();
      if (!isRetry) {
        play(segmentIndex, true);
      } else {
        finish();
        if (status) {
          status.textContent = "语音没有启动，请确认手机未处于静音模式后再试。";
          status.classList.add("error");
        }
      }
    }, 1500);
  };

  play(0);
}

function findDictionaryDefinition(entries) {
  const definitions = entries.flatMap((entry) =>
    (entry.meanings || []).flatMap((meaning) =>
      (meaning.definitions || []).map((definition) => ({
        ...definition,
        partOfSpeech: meaning.partOfSpeech
      }))
    )
  );
  return definitions.find((definition) => definition.example) || definitions[0] || null;
}

function flattenDictionarySenses(senses, definitions = []) {
  (senses || []).forEach((sense) => {
    if (sense.definition) {
      definitions.push({
        definition: sense.definition,
        example: sense.examples?.[0] || ""
      });
    }
    flattenDictionarySenses(sense.subsenses, definitions);
  });
  return definitions;
}

function normalizePrimaryDictionaryResponse(data) {
  return (data.entries || []).map((entry) => {
    const phonetic = (entry.pronunciations || []).find((item) => item.type === "ipa")?.text || "";
    return {
      word: data.word,
      phonetic,
      phonetics: phonetic ? [{ text: phonetic, audio: "" }] : [],
      meanings: [{
        partOfSpeech: entry.partOfSpeech,
        definitions: flattenDictionarySenses(entry.senses)
      }]
    };
  });
}

async function fetchDictionaryEntries(word) {
  let primaryStatus = "network error";
  try {
    const primaryResponse = await fetchWithTimeout(`${primaryDictionaryApiBase}${encodeURIComponent(word)}`, 8000);
    primaryStatus = primaryResponse.status;
    if (primaryResponse.ok) {
      return normalizePrimaryDictionaryResponse(await primaryResponse.json());
    }
  } catch (error) {
    console.warn("Primary dictionary request failed; trying fallback:", error);
  }

  const fallbackResponse = await fetchWithTimeout(`${fallbackDictionaryApiBase}${encodeURIComponent(word)}`);
  if (fallbackResponse.status === 404) throw new Error("WORD_NOT_FOUND");
  if (!fallbackResponse.ok) {
    throw new Error(`Dictionary requests failed with statuses ${primaryStatus} and ${fallbackResponse.status}`);
  }
  return fallbackResponse.json();
}

function isUsefulLookupTranslation(source, translated) {
  const normalize = (value) => value.toLowerCase().replace(/[\s'’-]+/g, "");
  return Boolean(translated && normalize(source) !== normalize(translated));
}

function isLikelyProperName(value) {
  return /^[A-Z][a-z]+(?:[ '-][A-Z][a-z]+)*$/.test(value);
}

async function createDictionaryFallback(query, word, isChineseQuery) {
  const wordTranslation = isChineseQuery ? query : await translateToChinese(word);
  if (!isChineseQuery && !isUsefulLookupTranslation(word, wordTranslation)) {
    throw new Error("WORD_NOT_FOUND");
  }
  const looksLikeProperName = isLikelyProperName(query) || (isChineseQuery && isLikelyProperName(word));
  const type = looksLikeProperName ? "专有名词" : "词语";
  return {
    word,
    query,
    partOfSpeech: type,
    phonetic: "暂无音标",
    wordTranslation,
    definitionTranslation: `开放词典暂未收录这个${type}；上方为常见翻译。`,
    definition: `A ${looksLikeProperName ? "proper name" : "term"} not currently included in the open dictionary.`,
    example: "",
    translatedExample: "",
    audio: await fetchWiktionaryAudio(word),
    exampleAudio: "",
    queriedAt: Date.now()
  };
}

function getDictionaryAudio(entries) {
  const audio = entries
    .flatMap((entry) => entry.phonetics || [])
    .find((phonetic) => phonetic.audio)?.audio;
  if (!audio) return "";
  return audio.startsWith("//") ? `https:${audio}` : audio;
}

function getWikimediaMp3Url(originalUrl) {
  const url = new URL(originalUrl);
  const match = url.pathname.match(/^\/wikipedia\/commons\/(.+)\/([^/]+\.(?:ogg|wav))$/i);
  if (!match) return originalUrl;
  return `${url.origin}/wikipedia/commons/transcoded/${match[1]}/${match[2]}/${match[2]}.mp3`;
}

async function fetchWiktionaryAudio(word) {
  try {
    const response = await fetchWithTimeout(`${wiktionaryApiBase}${encodeURIComponent(word)}`, 8000);
    if (!response.ok) return "";
    const data = await response.json();
    const audioFiles = Object.values(data.query?.pages || {}).filter((page) =>
      /\.(?:ogg|wav|mp3)$/i.test(page.title || "") && page.imageinfo?.[0]?.url
    );
    const preferred = audioFiles.find((page) => /^File:En-us-/i.test(page.title))
      || audioFiles.find((page) => /^File:En-(?:uk|au|ca)-/i.test(page.title))
      || audioFiles.find((page) => /(?:eng|english)/i.test(page.title));
    return preferred ? getWikimediaMp3Url(preferred.imageinfo[0].url) : "";
  } catch (error) {
    console.warn("Wiktionary audio lookup failed:", error);
    return "";
  }
}

function setCustomWordLoading(isLoading) {
  const form = document.getElementById("custom-word-form");
  const input = document.getElementById("custom-word-input");
  const button = form?.querySelector("button");
  if (!input || !button) return;
  input.disabled = isLoading;
  button.disabled = isLoading;
  button.textContent = isLoading ? "查询中…" : "查询";
}

function renderCustomWordResult(entry) {
  const result = document.getElementById("custom-word-result");
  if (!result) return;

  document.getElementById("custom-word-name").textContent = entry.word;
  const copy = document.getElementById("custom-word-copy");
  copy.dataset.copyText = entry.word;
  copy.setAttribute("aria-label", `复制 ${entry.word}`);
  copy.title = `复制 ${entry.word}`;
  document.getElementById("custom-word-part").textContent =
    entry.partOfSpeech === "专有名称" ? "专有名词" : entry.partOfSpeech;
  document.getElementById("custom-word-phonetic").textContent = entry.phonetic;
  document.getElementById("custom-word-translation").textContent = entry.wordTranslation;
  document.getElementById("custom-word-meaning").textContent = entry.definitionTranslation;
  document.getElementById("custom-word-definition").textContent = entry.definition;
  document.getElementById("custom-word-example").textContent =
    entry.example || "开放词典暂未提供这个词的例句。";
  document.getElementById("custom-word-example-translation").textContent = entry.translatedExample;

  const wordAudio = document.getElementById("custom-word-audio");
  const exampleAudio = document.getElementById("custom-example-audio");
  const definition = document.getElementById("custom-word-definition");
  const meaning = document.getElementById("custom-word-meaning");
  const translationToggle = document.getElementById("custom-translation-toggle");
  const example = document.getElementById("custom-word-example");
  const translation = document.getElementById("custom-word-example-translation");
  wordAudio.dataset.audioSrc = entry.audio;
  wordAudio.dataset.speechText = entry.word;
  definition.hidden = false;
  meaning.hidden = true;
  exampleAudio.dataset.audioSrc = "";
  exampleAudio.dataset.speechText = entry.example;
  exampleAudio.dataset.speechLang = "en-US";
  exampleAudio.setAttribute("aria-label", "播放英文例句");
  exampleAudio.hidden = !entry.example;
  translationToggle.hidden = !entry.definitionTranslation && !entry.translatedExample;
  translationToggle.textContent = "译文";
  translationToggle.setAttribute("aria-label", "显示释义和例句译文");
  example.hidden = false;
  translation.hidden = true;
  result.hidden = false;
}

function getCustomWordHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(customWordHistoryKey) || "[]");
    return Array.isArray(history) ? history : [];
  } catch (error) {
    console.error("Unable to read custom word history:", error);
    return [];
  }
}

function saveCustomWordHistory(entry) {
  const history = getCustomWordHistory().filter((item) => item.word.toLowerCase() !== entry.word.toLowerCase());
  history.unshift(entry);
  localStorage.setItem(customWordHistoryKey, JSON.stringify(history.slice(0, customWordHistoryLimit)));
  renderCustomWordHistory();
}

function renderCustomWordHistory() {
  const list = document.getElementById("custom-word-history-list");
  const empty = document.getElementById("custom-word-history-empty");
  const clear = document.getElementById("custom-word-history-clear");
  if (!list || !empty || !clear) return;

  const history = getCustomWordHistory();
  list.replaceChildren();
  empty.hidden = history.length > 0;
  clear.hidden = history.length === 0;

  history.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "custom-word-history-item";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "custom-word-history-open";
    open.textContent = entry.query || entry.word;
    open.addEventListener("click", () => {
      if (!entry.wordTranslation || !entry.definitionTranslation) {
        document.getElementById("custom-word-input").value = entry.query || entry.word;
        lookupCustomWord(entry.query || entry.word);
        return;
      }
      renderCustomWordResult(entry);
      document.getElementById("custom-word-input").value = entry.query || entry.word;
      document.getElementById("custom-word-status").textContent = "";
      document.getElementById("custom-word-result").scrollIntoView({ behavior: "smooth", block: "center" });
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "custom-word-history-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `删除 ${entry.word} 的查询记录`);
    remove.addEventListener("click", () => {
      const nextHistory = getCustomWordHistory().filter((item) => item.word !== entry.word);
      localStorage.setItem(customWordHistoryKey, JSON.stringify(nextHistory));
      renderCustomWordHistory();
    });

    item.append(open, remove);
    list.append(item);
  });
}

async function lookupCustomWord(rawWord) {
  const query = rawWord.trim();
  const status = document.getElementById("custom-word-status");
  const result = document.getElementById("custom-word-result");
  if (!status || !result) return;

  const isChineseQuery = /[\u3400-\u9fff]/u.test(query);
  const isEnglishQuery = /^[a-z]+(?:[ '-][a-z]+)*$/i.test(query);
  if (!query || (!isChineseQuery && !isEnglishQuery)) {
    result.hidden = true;
    status.textContent = "请输入中文或英文单词、短语。";
    status.classList.add("error");
    return;
  }

  setCustomWordLoading(true);
  status.textContent = `正在查询 “${query}”…`;
  status.classList.remove("error");
  result.hidden = true;

  try {
    const translatedQuery = isChineseQuery ? await translateText(query, "zh-CN", "en") : query;
    const word = translatedQuery.trim().replace(/[.!?。！？]+$/u, "");
    if (!/^[a-z]+(?:[ '-][a-z]+)*$/i.test(word)) throw new Error("WORD_NOT_FOUND");
    if (isLikelyProperName(query) || (isChineseQuery && isLikelyProperName(word))) {
      const fallbackEntry = await createDictionaryFallback(query, word, isChineseQuery);
      renderCustomWordResult(fallbackEntry);
      saveCustomWordHistory(fallbackEntry);
      status.textContent = "";
      return;
    }
    let entries;
    try {
      entries = await fetchDictionaryEntries(word.toLowerCase());
    } catch (error) {
      if (error.message !== "WORD_NOT_FOUND") throw error;
      const fallbackEntry = await createDictionaryFallback(query, word, isChineseQuery);
      renderCustomWordResult(fallbackEntry);
      saveCustomWordHistory(fallbackEntry);
      status.textContent = "";
      return;
    }
    const definition = findDictionaryDefinition(entries);
    if (!definition) {
      const fallbackEntry = await createDictionaryFallback(query, word, isChineseQuery);
      renderCustomWordResult(fallbackEntry);
      saveCustomWordHistory(fallbackEntry);
      status.textContent = "";
      return;
    }

    const entry = entries[0];
    const phonetic = entry.phonetic
      || entries.flatMap((item) => item.phonetics || []).find((item) => item.text)?.text
      || "暂无音标";
    const example = definition.example || "";
    const translationsAndAudio = await Promise.allSettled([
      isChineseQuery ? Promise.resolve(query) : translateToChinese(entry.word || word),
      translateToChinese(definition.definition),
      example ? translateToChinese(example) : Promise.resolve(""),
      fetchWiktionaryAudio(entry.word || word)
    ]);
    const wordTranslation = translationsAndAudio[0].status === "fulfilled" && translationsAndAudio[0].value
      ? translationsAndAudio[0].value
      : "生词翻译暂时不可用";
    const definitionTranslation = translationsAndAudio[1].status === "fulfilled" && translationsAndAudio[1].value
      ? translationsAndAudio[1].value
      : "中文释义暂时不可用";
    const translatedExample = translationsAndAudio[2].status === "fulfilled" ? translationsAndAudio[2].value : "";
    const wiktionaryAudio = translationsAndAudio[3].status === "fulfilled" ? translationsAndAudio[3].value : "";

    const lookupEntry = {
      word: entry.word || word,
      query,
      partOfSpeech: partOfSpeechLabels[definition.partOfSpeech] || definition.partOfSpeech || "词条",
      phonetic,
      wordTranslation,
      definitionTranslation,
      definition: definition.definition,
      example,
      translatedExample,
      audio: getDictionaryAudio(entries) || wiktionaryAudio,
      exampleAudio: "",
      queriedAt: Date.now()
    };
    renderCustomWordResult(lookupEntry);
    saveCustomWordHistory(lookupEntry);
    status.textContent = "";
  } catch (error) {
    result.hidden = true;
    status.classList.add("error");
    if (error.message === "WORD_NOT_FOUND") {
      status.textContent = `没有查到 “${query}”，请尝试更具体的单词或短语。`;
    } else if (error.name === "AbortError") {
      status.textContent = "查询超时，请检查网络后重试。";
    } else {
      console.error("Custom word lookup failed:", error);
      status.textContent = "词典服务暂时不可用，请稍后重试。";
    }
  } finally {
    setCustomWordLoading(false);
  }
}

function initCustomWordLookup() {
  const form = document.getElementById("custom-word-form");
  const input = document.getElementById("custom-word-input");
  const wordAudio = document.getElementById("custom-word-audio");
  const wordCopy = document.getElementById("custom-word-copy");
  const exampleAudio = document.getElementById("custom-example-audio");
  const translationToggle = document.getElementById("custom-translation-toggle");
  const definition = document.getElementById("custom-word-definition");
  const meaning = document.getElementById("custom-word-meaning");
  const example = document.getElementById("custom-word-example");
  const translation = document.getElementById("custom-word-example-translation");
  const clearHistory = document.getElementById("custom-word-history-clear");
  if (!form || !input || !wordAudio || !wordCopy || !exampleAudio || !translationToggle || !definition || !meaning || !example || !translation || !clearHistory) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    lookupCustomWord(input.value);
  });
  wordAudio.addEventListener("click", () => {
    stopContinuousPlayback();
    const src = wordAudio.dataset.audioSrc;
    if (src) {
      playAudioTrack(src, wordAudio);
    } else {
      speakText(wordAudio.dataset.speechText, "en-US", wordAudio);
    }
  });
  wordCopy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(wordCopy.dataset.copyText);
      document.getElementById("custom-word-status").textContent = `${wordCopy.dataset.copyText} 已复制。`;
      document.getElementById("custom-word-status").classList.remove("error");
    } catch (error) {
      console.error("Unable to copy word:", error);
      document.getElementById("custom-word-status").textContent = "复制失败，请长按生词手动复制。";
      document.getElementById("custom-word-status").classList.add("error");
    }
  });
  exampleAudio.addEventListener("click", () => {
    stopContinuousPlayback();
    const src = exampleAudio.dataset.audioSrc;
    if (src) {
      playAudioTrack(src, exampleAudio);
    } else {
      speakText(exampleAudio.dataset.speechText, exampleAudio.dataset.speechLang, exampleAudio);
    }
  });
  translationToggle.addEventListener("click", () => {
    const showTranslation = meaning.hidden;
    const hasTranslatedExample = Boolean(translation.textContent);
    definition.hidden = showTranslation;
    meaning.hidden = !showTranslation;
    example.hidden = showTranslation && hasTranslatedExample;
    translation.hidden = !showTranslation || !hasTranslatedExample;
    translationToggle.textContent = showTranslation ? "原文" : "译文";
    translationToggle.setAttribute("aria-label", showTranslation ? "显示释义和例句原文" : "显示释义和例句译文");
    exampleAudio.dataset.speechText = showTranslation && hasTranslatedExample ? translation.textContent : example.textContent;
    exampleAudio.dataset.speechLang = showTranslation && hasTranslatedExample ? "zh-CN" : "en-US";
    exampleAudio.setAttribute("aria-label", showTranslation && hasTranslatedExample ? "播放中文译文" : "播放英文例句");
  });
  clearHistory.addEventListener("click", () => {
    localStorage.removeItem(customWordHistoryKey);
    renderCustomWordHistory();
  });
  renderCustomWordHistory();
}

/* ---------------- Chinese-English Translation ---------------- */
function getTranslationHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(translationHistoryKey) || "[]");
    return Array.isArray(history) ? history : [];
  } catch (error) {
    console.error("Unable to read translation history:", error);
    return [];
  }
}

function saveTranslationHistory(entry) {
  const history = getTranslationHistory().filter((item) =>
    item.sourceText !== entry.sourceText || item.sourceLanguage !== entry.sourceLanguage
  );
  history.unshift(entry);
  localStorage.setItem(translationHistoryKey, JSON.stringify(history.slice(0, translationHistoryLimit)));
  renderTranslationHistory();
}

function renderTranslationHistory() {
  const list = document.getElementById("translation-history-list");
  const empty = document.getElementById("translation-history-empty");
  const clear = document.getElementById("translation-history-clear");
  if (!list || !empty || !clear) return;
  const history = getTranslationHistory();
  list.replaceChildren();
  empty.hidden = history.length > 0;
  clear.hidden = history.length === 0;
  history.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "translation-history-item";
    button.innerHTML = `<strong>${entry.sourceLanguage === "zh-CN" ? "中 → 英" : "英 → 中"}</strong><span></span>`;
    button.querySelector("span").textContent = entry.sourceText.slice(0, 80);
    button.addEventListener("click", () => {
      stopActiveSpeech();
      setTranslationDirection(entry.sourceLanguage, entry.targetLanguage);
      document.getElementById("translation-source").value = entry.sourceText;
      document.getElementById("translation-result").value = entry.translatedText;
      updateTranslationCounts();
    });
    list.append(button);
  });
}

function setTranslationDirection(sourceLanguage, targetLanguage) {
  const form = document.getElementById("translation-form");
  if (!form) return;
  form.dataset.sourceLanguage = sourceLanguage;
  form.dataset.targetLanguage = targetLanguage;
  const sourceName = sourceLanguage === "zh-CN" ? "中文" : "English";
  const targetName = targetLanguage === "en" ? "English" : "中文";
  document.getElementById("translation-source-label").textContent = sourceName;
  document.getElementById("translation-target-label").textContent = targetName;
  document.getElementById("translation-toolbar-source").textContent = sourceLanguage === "zh-CN" ? "中文" : "English";
  document.getElementById("translation-toolbar-target").textContent = targetLanguage === "en" ? "English" : "中文";
  const source = document.getElementById("translation-source");
  const result = document.getElementById("translation-result");
  source.placeholder = sourceLanguage === "zh-CN"
    ? "输入要翻译的中文句子、段落或文章…"
    : "Enter an English sentence, paragraph, or article…";
  result.placeholder = targetLanguage === "en" ? "Translation will appear here" : "译文会显示在这里";
  setTranslationActionLabels("source", sourceName);
  setTranslationActionLabels("result", targetName);
}

function setTranslationActionLabels(panel, languageName) {
  const labels = {
    audio: languageName === "English" ? "Read English" : "朗读中文",
    copy: languageName === "English" ? "Copy English" : "复制中文",
    clear: languageName === "English" ? "Clear English" : "清空中文"
  };
  const controls = {
    audio: document.getElementById(`translation-${panel}-audio`),
    copy: document.getElementById(`translation-${panel}-copy`),
    clear: document.getElementById(`translation-${panel}-clear`)
  };
  Object.entries(controls).forEach(([action, control]) => {
    control.setAttribute("aria-label", labels[action]);
    control.title = labels[action];
  });
}

function updateTranslationCounts() {
  const source = document.getElementById("translation-source");
  const result = document.getElementById("translation-result");
  const sourceCount = document.getElementById("translation-character-count");
  const resultCount = document.getElementById("translation-result-character-count");
  if (source && sourceCount) sourceCount.textContent = `${source.value.length} / 5000`;
  if (result && resultCount) resultCount.textContent = `${result.value.length} / 5000`;
  updateTranslationAudioControls();
}

function getTranslationSpeechRanges(text) {
  const ranges = [];
  const sentencePattern = /[^.!?。！？；;\n]+[.!?。！？；;]?/g;
  for (const match of text.matchAll(sentencePattern)) {
    let start = match.index;
    const sentenceEnd = start + match[0].length;
    while (sentenceEnd - start > 180) {
      const candidate = text.slice(start, start + 180);
      const breakpoints = [...candidate.matchAll(/[,，、:\s]/g)].filter((item) => item.index >= 80);
      const end = breakpoints.length ? start + breakpoints.at(-1).index + 1 : start + 180;
      ranges.push({ start, end });
      start = end;
    }
    if (text.slice(start, sentenceEnd).trim()) ranges.push({ start, end: sentenceEnd });
  }
  if (!ranges.length && text.trim()) ranges.push({ start: 0, end: text.length });
  return ranges;
}

function resetTranslationSpeechState(panel) {
  const textarea = document.getElementById(`translation-${panel}`);
  const progress = document.getElementById(`translation-${panel}-progress`);
  if (!textarea || !progress) return;
  progress.hidden = true;
  progress.setAttribute("aria-valuenow", "0");
  progress.querySelector("span").style.width = "0";
  textarea.setSelectionRange(textarea.selectionEnd, textarea.selectionEnd);
}

function startTranslationSpeech(panel, language, trigger) {
  if (trigger.classList.contains("playing")) {
    stopActiveSpeech();
    return;
  }
  const textarea = document.getElementById(`translation-${panel}`);
  const progress = document.getElementById(`translation-${panel}-progress`);
  const text = textarea.value;
  const ranges = getTranslationSpeechRanges(text);
  if (!ranges.length) return;

  progress.hidden = false;

  speakText(text, language, trigger, {
    segments: ranges.map(({ start, end }) => text.slice(start, end).trim()),
    onSegmentStart: (index, total) => {
      const { start, end } = ranges[index];
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(start, end);
      const percentage = Math.round(((index + 1) / total) * 100);
      progress.setAttribute("aria-valuenow", String(percentage));
      progress.querySelector("span").style.width = `${percentage}%`;
    },
    onFinish: () => resetTranslationSpeechState(panel)
  });
}

function updateTranslationAudioControls() {
  const source = document.getElementById("translation-source");
  const result = document.getElementById("translation-result");
  const sourceAudio = document.getElementById("translation-source-audio");
  const resultAudio = document.getElementById("translation-result-audio");
  const sourceCopy = document.getElementById("translation-source-copy");
  const resultCopy = document.getElementById("translation-result-copy");
  if (!source || !result || !sourceAudio || !resultAudio || !sourceCopy || !resultCopy) return;
  sourceAudio.disabled = !source.value.trim();
  resultAudio.disabled = !result.value.trim();
  sourceCopy.disabled = !source.value.trim();
  resultCopy.disabled = !result.value.trim();
}

async function runTranslation() {
  const form = document.getElementById("translation-form");
  const source = document.getElementById("translation-source");
  const result = document.getElementById("translation-result");
  const status = document.getElementById("translation-status");
  const submit = form?.querySelector('button[type="submit"]');
  if (!form || !source || !result || !status || !submit) return;
  stopActiveSpeech();
  const sourceText = source.value.trim();
  if (!sourceText) {
    status.textContent = "请先输入需要翻译的内容。";
    status.classList.add("error");
    source.focus();
    return;
  }
  submit.disabled = true;
  submit.classList.add("loading");
  submit.setAttribute("aria-label", "翻译中");
  submit.title = "翻译中";
  status.textContent = "";
  status.classList.remove("error");
  try {
    const sourceLanguage = form.dataset.sourceLanguage;
    const targetLanguage = form.dataset.targetLanguage;
    const translatedText = await translateText(sourceText, sourceLanguage, targetLanguage);
    if (!translatedText) throw new Error("EMPTY_TRANSLATION");
    result.value = translatedText;
    updateTranslationCounts();
    saveTranslationHistory({ sourceText, translatedText, sourceLanguage, targetLanguage, translatedAt: Date.now() });
  } catch (error) {
    console.error("Translation failed:", error);
    status.textContent = error.name === "AbortError"
      ? "翻译超时，请缩短内容或检查网络后重试。"
      : "翻译服务暂时不可用，请稍后重试。";
    status.classList.add("error");
  } finally {
    submit.disabled = false;
    submit.classList.remove("loading");
    submit.setAttribute("aria-label", "开始翻译");
    submit.title = "开始翻译";
  }
}

function initTranslationTool() {
  const form = document.getElementById("translation-form");
  if (!form) return;
  const source = document.getElementById("translation-source");
  const result = document.getElementById("translation-result");
  const status = document.getElementById("translation-status");
  const sourceAudio = document.getElementById("translation-source-audio");
  const resultAudio = document.getElementById("translation-result-audio");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runTranslation();
  });
  source.addEventListener("input", () => {
    stopActiveSpeech();
    updateTranslationCounts();
  });
  source.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  document.getElementById("translation-swap").addEventListener("click", () => {
    stopActiveSpeech();
    const sourceLanguage = form.dataset.sourceLanguage;
    const targetLanguage = form.dataset.targetLanguage;
    const previousSource = source.value;
    if (result.value.trim()) {
      source.value = result.value;
      result.value = previousSource;
    }
    setTranslationDirection(targetLanguage, sourceLanguage);
    updateTranslationCounts();
  });
  sourceAudio.addEventListener("click", () => {
    const language = form.dataset.sourceLanguage === "en" ? "en-US" : "zh-CN";
    startTranslationSpeech("source", language, sourceAudio);
  });
  resultAudio.addEventListener("click", () => {
    const language = form.dataset.targetLanguage === "en" ? "en-US" : "zh-CN";
    startTranslationSpeech("result", language, resultAudio);
  });
  const copyPanelText = async (textarea, successMessage) => {
    if (!textarea.value) return;
    try {
      await navigator.clipboard.writeText(textarea.value);
      status.textContent = successMessage;
      status.classList.remove("error");
    } catch (error) {
      console.error("Unable to copy text:", error);
      status.textContent = "复制失败，请长按内容手动复制。";
      status.classList.add("error");
    }
  };
  document.getElementById("translation-source-copy").addEventListener("click", () => {
    copyPanelText(source, "原文已复制。");
  });
  document.getElementById("translation-result-copy").addEventListener("click", () => {
    copyPanelText(result, "译文已复制。");
  });
  document.getElementById("translation-source-clear").addEventListener("click", () => {
    stopActiveSpeech();
    source.value = "";
    status.textContent = "";
    status.classList.remove("error");
    updateTranslationCounts();
    source.focus();
  });
  document.getElementById("translation-result-clear").addEventListener("click", () => {
    stopActiveSpeech();
    result.value = "";
    status.textContent = "";
    status.classList.remove("error");
    updateTranslationCounts();
  });
  document.getElementById("translation-history-clear").addEventListener("click", () => {
    localStorage.removeItem(translationHistoryKey);
    renderTranslationHistory();
  });
  setTranslationDirection("zh-CN", "en");
  updateTranslationCounts();
  renderTranslationHistory();
}

/* ---------------- Mobile Continuous Playback ---------------- */
let continuousPlaybackActive = false;
let continuousPlaybackPaused = false;
let continuousPlaybackIndex = 0;
let continuousPlaybackCards = [];

function getContinuousPlaybackCards() {
  const activePanel = document.querySelector(".vocab-tab-panel.active");
  const container = activePanel || document.querySelector("main");
  return container ? Array.from(container.querySelectorAll(".word-card")) : [];
}

function updateContinuousPlayer() {
  const toggle = document.querySelector('[data-player-action="toggle"]');
  const progress = document.getElementById("continuous-player-progress");
  if (!toggle || !progress) return;

  if (!continuousPlaybackActive) {
    toggle.textContent = "▶ 连续播放";
    toggle.setAttribute("aria-label", "开始连续播放");
    progress.textContent = "从当前分类的第一个词开始";
    return;
  }

  toggle.textContent = continuousPlaybackPaused ? "▶ 继续" : "⏸ 暂停";
  toggle.setAttribute("aria-label", continuousPlaybackPaused ? "继续连续播放" : "暂停连续播放");

  const card = continuousPlaybackCards[continuousPlaybackIndex];
  const number = card ? card.querySelector(".word-num")?.textContent.trim() : "";
  const word = card ? card.querySelector(".word span")?.textContent.trim() : "";
  progress.textContent = `${number} ${word} · ${continuousPlaybackIndex + 1}/${continuousPlaybackCards.length}`;
}

function clearContinuousPlaybackHighlight() {
  document.querySelectorAll(".word-card.continuous-current").forEach((card) => {
    card.classList.remove("continuous-current");
  });
}

function stopContinuousPlayback() {
  if (!continuousPlaybackActive && !continuousPlaybackPaused) return;

  continuousPlaybackActive = false;
  continuousPlaybackPaused = false;
  if (activeAudioElement) {
    activeAudioElement.pause();
    activeAudioElement = null;
  }
  document.querySelectorAll(".audio-button.playing").forEach((element) => element.classList.remove("playing"));
  document.querySelectorAll(".word-card.playing-card").forEach((card) => card.classList.remove("playing-card"));
  clearContinuousPlaybackHighlight();
  updateContinuousPlayer();
}

function finishContinuousPlayback() {
  continuousPlaybackActive = false;
  continuousPlaybackPaused = false;
  clearContinuousPlaybackHighlight();
  updateContinuousPlayer();
  const progress = document.getElementById("continuous-player-progress");
  if (progress) progress.textContent = "本分类已播放完毕";
}

function playContinuousCard(index) {
  if (!continuousPlaybackActive || continuousPlaybackPaused) return;

  const loopEnabled = document.getElementById("continuous-player-loop")?.checked;
  if (index >= continuousPlaybackCards.length) {
    if (loopEnabled) {
      index = 0;
    } else {
      finishContinuousPlayback();
      return;
    }
  }
  if (index < 0) index = 0;

  continuousPlaybackIndex = index;
  const card = continuousPlaybackCards[index];
  const wordButton = card.querySelector(".pronunciation .audio-button");
  const exampleButton = card.querySelector(".example .audio-button");
  if (!wordButton || !exampleButton) {
    console.error("Continuous playback controls are missing for a vocabulary card.");
    finishContinuousPlayback();
    return;
  }

  clearContinuousPlaybackHighlight();
  card.classList.add("continuous-current");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  updateContinuousPlayer();

  playAudioTrack(wordButton.dataset.audioSrc, wordButton, () => {
    if (!continuousPlaybackActive || continuousPlaybackPaused) return;
    playAudioTrack(exampleButton.dataset.audioSrc, exampleButton, () => {
      if (!continuousPlaybackActive || continuousPlaybackPaused) return;
      playContinuousCard(continuousPlaybackIndex + 1);
    });
  });
}

function startContinuousPlayback(index) {
  const highlightedCard = document.querySelector(".word-card.playing-card, .word-card.continuous-current");
  continuousPlaybackCards = getContinuousPlaybackCards();
  if (!continuousPlaybackCards.length) return;

  if (activeAudioElement) {
    activeAudioElement.pause();
    activeAudioElement = null;
  }
  document.querySelectorAll(".audio-button.playing").forEach((element) => element.classList.remove("playing"));
  document.querySelectorAll(".word-card.playing-card").forEach((card) => card.classList.remove("playing-card"));

  continuousPlaybackActive = true;
  continuousPlaybackPaused = false;
  const highlightedIndex = continuousPlaybackCards.indexOf(highlightedCard);
  playContinuousCard(Number.isInteger(index) ? index : Math.max(highlightedIndex, 0));
}

function toggleContinuousPlayback() {
  if (!continuousPlaybackActive) {
    startContinuousPlayback();
    return;
  }

  if (continuousPlaybackPaused) {
    continuousPlaybackPaused = false;
    updateContinuousPlayer();
    if (activeAudioElement) {
      activeAudioElement.play().catch((error) => {
        console.error("Unable to resume continuous playback:", error);
        stopContinuousPlayback();
      });
    } else {
      playContinuousCard(continuousPlaybackIndex);
    }
    return;
  }

  continuousPlaybackPaused = true;
  if (activeAudioElement) activeAudioElement.pause();
  updateContinuousPlayer();
}

function skipContinuousPlayback(offset) {
  if (!continuousPlaybackActive) {
    startContinuousPlayback(offset > 0 ? 1 : 0);
    return;
  }

  if (activeAudioElement) {
    activeAudioElement.pause();
    activeAudioElement = null;
  }
  continuousPlaybackPaused = false;
  playContinuousCard(continuousPlaybackIndex + offset);
}

function initContinuousPlayback() {
  const player = document.querySelector(".continuous-player");
  if (!player) return;

  player.addEventListener("click", (event) => {
    const button = event.target.closest("[data-player-action]");
    if (!button) return;

    const action = button.dataset.playerAction;
    if (action === "toggle") toggleContinuousPlayback();
    if (action === "previous") skipContinuousPlayback(-1);
    if (action === "next") skipContinuousPlayback(1);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && continuousPlaybackActive && !continuousPlaybackPaused) {
      toggleContinuousPlayback();
    }
  });
}

function initLessonUtilityRail() {
  const progress = document.querySelector(".lesson-scroll-progress");
  const backToTop = document.querySelector(".lesson-back-to-top");
  if (!progress || !backToTop) return;

  const updateProgress = () => {
    const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
    const percentage = scrollableHeight > 0
      ? Math.min(100, Math.max(0, Math.round((window.scrollY / scrollableHeight) * 100)))
      : 100;
    progress.style.setProperty("--scroll-progress", `${percentage * 3.6}deg`);
    progress.setAttribute("aria-valuenow", String(percentage));
    progress.querySelector("span").textContent = `${percentage}%`;
    const isVisible = window.scrollY > 320;
    progress.classList.toggle("show", isVisible);
    backToTop.classList.toggle("show", isVisible);
  };
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);
  backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  updateProgress();
}

/* ---------------- Touch Swipe Navigation ---------------- */
const swipeMinDistance = 72;
const swipeDirectionRatio = 1.25;
const swipeMaxDuration = 1200;
const swipeEdgeProtection = 32;

function isSwipeControl(element) {
  return element instanceof Element && Boolean(element.closest("a, button, input, select, textarea"));
}

function navigateToLesson(url) {
  if (url) {
    window.location.assign(url);
  }
}

function handleHorizontalSwipe(deltaX) {
  const coreTab = document.querySelector('[data-tab-target="tab-core"]');
  const properTab = document.querySelector('[data-tab-target="tab-proper"]');
  const activeTab = document.querySelector(".vocab-tab-btn.active");
  const prevLessonUrl = document.body.dataset.prevLessonUrl;
  const nextLessonUrl = document.body.dataset.nextLessonUrl;

  if (deltaX < 0) {
    if (activeTab === coreTab && properTab) {
      switchVocabTab(properTab);
    } else {
      navigateToLesson(nextLessonUrl);
    }
  } else if (activeTab === properTab && coreTab) {
    switchVocabTab(coreTab);
  } else {
    navigateToLesson(prevLessonUrl);
  }
}

function initSwipeNavigation() {
  const main = document.querySelector("main");
  if (!main || !document.body.matches("[data-prev-lesson-url], [data-next-lesson-url]")) return;

  let swipeStart = null;

  main.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || isSwipeControl(event.target)) {
      swipeStart = null;
      return;
    }

    const touch = event.touches[0];
    swipeStart = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
      startedAtLeftEdge: touch.clientX <= swipeEdgeProtection
    };
  }, { passive: true });

  main.addEventListener("touchmove", (event) => {
    if (!swipeStart || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - swipeStart.x;
    const deltaY = touch.clientY - swipeStart.y;
    if (
      Math.abs(deltaX) >= 12 &&
      Math.abs(deltaX) > Math.abs(deltaY) * swipeDirectionRatio
    ) {
      event.preventDefault();
    }
  }, { passive: false });

  main.addEventListener("touchend", (event) => {
    if (!swipeStart || event.changedTouches.length !== 1) {
      swipeStart = null;
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - swipeStart.x;
    const deltaY = touch.clientY - swipeStart.y;
    const duration = Date.now() - swipeStart.time;
    const startedAtLeftEdge = swipeStart.startedAtLeftEdge;
    swipeStart = null;

    if (
      !startedAtLeftEdge &&
      duration <= swipeMaxDuration &&
      Math.abs(deltaX) >= swipeMinDistance &&
      Math.abs(deltaX) > Math.abs(deltaY) * swipeDirectionRatio
    ) {
      event.preventDefault();
      handleHorizontalSwipe(deltaX);
    }
  }, { passive: false });

  main.addEventListener("touchcancel", () => {
    swipeStart = null;
  }, { passive: true });
}

// Expose functions globally for inline onclick handlers
window.switchVocabTab = switchVocabTab;
window.playWordAudio = playWordAudio;
window.playExampleAudio = playExampleAudio;
window.toggleTheme = toggleTheme;

/* ---------------- Render Aurora Navigation Header & Footer ---------------- */
function enhanceHeader() {
  const header = document.querySelector(".site-header");
  if (!header) return;

  const isDirectoryPage = window.location.pathname.endsWith("/side-by-side-1/") || window.location.pathname.endsWith("/side-by-side-1/index.html");
  const isWordsPage = window.location.pathname.startsWith("/english/words");
  const isTranslationPage = window.location.pathname.startsWith("/english/translate");

  header.innerHTML = `
    <div class="site-header-left">
      <a href="/" title="返回 Michael's Blog">
        <img class="site-avatar" src="https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/blog_logo.jpeg" alt="Michael's Blog">
      </a>
      <div class="site-brand-text">
        <a href="/" class="site-brand-title">Michael's Blog</a>
        <span class="site-brand-sub">${isWordsPage ? "英语学习 · 查询生词" : isTranslationPage ? "英语学习 · 中英翻译" : "英语学习 · Side by Side 1"}</span>
      </div>
    </div>
    <div class="site-header-controls">
      <nav id="site-header-nav" class="site-header-nav" aria-label="主导航">
        <a href="/" class="site-nav-link">博客首页</a>
        <a href="/english/side-by-side-1/" class="site-nav-link ${isDirectoryPage ? "active" : ""}">课程目录</a>
        <a href="/english/words/" class="site-nav-link ${isWordsPage ? "active" : ""}">查询生词</a>
        <a href="/english/translate/" class="site-nav-link ${isTranslationPage ? "active" : ""}">中英翻译</a>
        <a href="/cv/?to=michael's-blog" class="site-nav-link">简历</a>
        <a href="/categories" class="site-nav-link">分类</a>
        <a href="https://github.com/mikeah2011" target="_blank" rel="noopener noreferrer" class="site-nav-link">GitHub</a>
      </nav>
      <button id="theme-toggle" class="theme-toggle-btn" type="button" aria-label="切换主题" onclick="toggleTheme()"></button>
      <button id="mobile-menu-toggle" class="mobile-menu-btn" type="button" aria-label="打开导航菜单" aria-expanded="false" aria-controls="site-header-nav">
        <span></span><span></span><span></span>
      </button>
    </div>
  `;

  updateThemeToggleIcon(getSavedTheme());
}

function initMobileHeaderMenu() {
  const header = document.querySelector(".site-header");
  const toggle = document.getElementById("mobile-menu-toggle");
  if (!header || !toggle) return;

  const closeMenu = () => {
    header.classList.remove("menu-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "打开导航菜单");
  };

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = header.classList.toggle("menu-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.setAttribute("aria-label", isOpen ? "关闭导航菜单" : "打开导航菜单");
  });

  header.querySelectorAll(".site-nav-link").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("click", (event) => {
    if (!header.contains(event.target)) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

function enhanceFooter() {
  const footer = document.querySelector("footer");
  if (!footer) return;

  footer.innerHTML = `
    <div style="margin-bottom: 0.5rem; font-weight: 600; color: var(--text-title);">
      知我所能者，尽善尽美；知我所不能者，虚怀若谷。
    </div>
    <div>
      © ${new Date().getFullYear()} <a href="/">Michael's Blog</a> · 英语学习
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  enhanceHeader();
  initMobileHeaderMenu();
  enhanceFooter();
  initVocabTabs();
  initHoverPlay();
  initCustomWordLookup();
  initTranslationTool();
  initContinuousPlayback();
  initLessonUtilityRail();
  initSwipeNavigation();
});
