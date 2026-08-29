const exampleVoiceStorageKey = "sideBySideExampleVoiceURI";
const exampleVoiceSelectionStorageKey = "sideBySideExampleVoiceSelected";
const preferredExampleVoiceNames = ["Samantha", "Alex", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Daniel", "Karen", "Tessa", "Moira", "Rishi"];
const noveltyVoiceNames = ["Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Fred", "Good News", "Jester", "Junior", "Organ", "Ralph", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox"];
let localPdfPreviewUrl;

function markAudioPlaying(trigger) {
  document.querySelectorAll(".playing").forEach((element) => element.classList.remove("playing"));
  if (!trigger) return () => {};
  trigger.classList.add("playing");
  return () => trigger.classList.remove("playing");
}

function playWordAudio(word, trigger) {
  window.speechSynthesis?.cancel();
  const audio = document.getElementById("voice-file");
  document.getElementById("audioSource").src = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
  audio.load();
  audio.play().catch((error) => console.error(`Unable to play audio for "${word}".`, error));
  const stopPlaying = markAudioPlaying(trigger);
  setTimeout(stopPlaying, 1000);
}

function getExampleVoices() {
  if (!window.speechSynthesis) return [];
  const voices = window.speechSynthesis.getVoices();
  const englishVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  const availableVoices = englishVoices.length > 0 ? englishVoices : voices;
  return [...availableVoices].sort((firstVoice, secondVoice) => {
    const firstPreferredIndex = preferredExampleVoiceNames.findIndex((name) => firstVoice.name.includes(name));
    const secondPreferredIndex = preferredExampleVoiceNames.findIndex((name) => secondVoice.name.includes(name));
    const firstNoveltyIndex = noveltyVoiceNames.findIndex((name) => firstVoice.name.includes(name));
    const secondNoveltyIndex = noveltyVoiceNames.findIndex((name) => secondVoice.name.includes(name));
    if (firstPreferredIndex !== -1 || secondPreferredIndex !== -1) {
      return (firstPreferredIndex === -1 ? Number.MAX_SAFE_INTEGER : firstPreferredIndex) - (secondPreferredIndex === -1 ? Number.MAX_SAFE_INTEGER : secondPreferredIndex);
    }
    if (firstNoveltyIndex !== -1 || secondNoveltyIndex !== -1) {
      return (firstNoveltyIndex === -1 ? -1 : 1) - (secondNoveltyIndex === -1 ? -1 : 1);
    }
    return firstVoice.name.localeCompare(secondVoice.name);
  });
}

function getSelectedExampleVoice() {
  const selectedVoiceURI = localStorage.getItem(exampleVoiceStorageKey);
  const hasUserSelectedVoice = localStorage.getItem(exampleVoiceSelectionStorageKey) === "true";
  const voices = getExampleVoices();
  const savedVoice = voices.find((voice) => voice.voiceURI === selectedVoiceURI);
  return (savedVoice && (hasUserSelectedVoice || !noveltyVoiceNames.some((name) => savedVoice.name.includes(name))) ? savedVoice : undefined)
    || voices.find((voice) => preferredExampleVoiceNames.some((name) => voice.name.includes(name)))
    || voices.find((voice) => voice.lang === "en-US" && !noveltyVoiceNames.some((name) => voice.name.includes(name)))
    || voices[0];
}

function populateExampleVoiceSelect() {
  const select = document.getElementById("example-voice-select");
  const status = document.getElementById("example-voice-status");
  if (!select) return;
  const voices = getExampleVoices();
  select.innerHTML = "";
  if (voices.length === 0) {
    select.disabled = true;
    const option = document.createElement("option");
    option.textContent = "使用浏览器默认声音";
    select.append(option);
    if (status) status.textContent = "当前浏览器暂未返回可选声音。";
    return;
  }
  const selectedVoiceURI = localStorage.getItem(exampleVoiceStorageKey);
  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    option.selected = voice.voiceURI === selectedVoiceURI;
    select.append(option);
  });
  if (!select.value && voices[0]) select.value = getSelectedExampleVoice().voiceURI;
  select.disabled = false;
  if (status) status.textContent = `${voices.length} 个可选英文声音。`;
}

function playExampleAudio(example, trigger) {
  const synth = window.speechSynthesis;
  if (!synth) {
    console.error("This browser does not support speech synthesis.");
    return;
  }
  document.getElementById("voice-file").pause();
  synth.cancel();
  const stopPlaying = markAudioPlaying(trigger);
  const selectedVoice = getSelectedExampleVoice();
  const utterance = new SpeechSynthesisUtterance(example);
  utterance.lang = selectedVoice?.lang || "en-US";
  utterance.rate = 0.9;
  utterance.voice = selectedVoice;
  utterance.onend = stopPlaying;
  utterance.onerror = (event) => {
    stopPlaying();
    console.error(`Unable to play example audio for "${example}".`, event);
  };
  synth.speak(utterance);
}

function showPdfPreview(pdfUrl, statusText) {
  const preview = document.getElementById("pdf-preview");
  const status = document.getElementById("pdf-preview-status");

  if (!preview) return;

  preview.src = pdfUrl;
  preview.hidden = false;

  if (status) status.textContent = statusText;
}

function loadLocalPdfPreview(input) {
  const file = input.files?.[0];

  if (!file) return;

  if (file.type !== "application/pdf") {
    const status = document.getElementById("pdf-preview-status");
    if (status) status.textContent = "请选择 PDF 文件。";
    input.value = "";
    return;
  }

  if (localPdfPreviewUrl) URL.revokeObjectURL(localPdfPreviewUrl);
  localPdfPreviewUrl = URL.createObjectURL(file);
  showPdfPreview(localPdfPreviewUrl, `正在预览本地文件：${file.name}。这个文件不会上传到网站。`);
}

function loadDefaultPdfPreview(trigger) {
  const sidebar = trigger.closest(".pdf-sidebar");
  const defaultPdf = sidebar?.dataset.defaultPdf;
  const status = document.getElementById("pdf-preview-status");

  if (!defaultPdf) {
    if (status) status.textContent = "还没有配置站点 PDF。";
    return;
  }

  showPdfPreview(defaultPdf, "正在加载站点 PDF。如果没有显示，请确认你有授权并已把 PDF 放到 assets/side-by-side-1-sb.pdf。");
}

document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("example-voice-select");
  if (!select || !window.speechSynthesis) return;
  populateExampleVoiceSelect();
  if (typeof window.speechSynthesis.addEventListener === "function") {
    window.speechSynthesis.addEventListener("voiceschanged", populateExampleVoiceSelect);
  } else {
    window.speechSynthesis.onvoiceschanged = populateExampleVoiceSelect;
  }
  select.addEventListener("change", () => {
    localStorage.setItem(exampleVoiceStorageKey, select.value);
    localStorage.setItem(exampleVoiceSelectionStorageKey, "true");
  });
});
