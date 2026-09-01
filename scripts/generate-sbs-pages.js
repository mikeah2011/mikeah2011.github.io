const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const yamlPath = "/Users/michael/GitHub/most-frequent-technology-english-words/_data/side_by_side_1.yml";
const lessons = fs.existsSync(yamlPath)
  ? yaml.load(fs.readFileSync(yamlPath, "utf8"))
  : [];
if (lessons.length === 0) {
  console.warn(`Skip Side by Side page generation: vocabulary source not found at ${yamlPath}`);
}
const properNounRegex = /(人名|地名|国家名|城市名|街道名|省份名|建筑名|洲名|专有名词|称呼|酒店名)/;

function renderAudioSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" class="audio-icon" aria-hidden="true">
  <path d="M44.2 21.8a12 12 0 0 1 0 20.5" class="ani-path"></path>
  <path d="M50 16a20 20 0 0 1 0 32" class="ani-path-2"></path>
  <path d="M38 6L20 24H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12l18 18z" class="ani-path-3"></path>
</svg>`;
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderTable(words, lessonNumPad, startNum = 1) {
  if (!words || words.length === 0) return "";

  let html = `  <div class="word-table">
    <div class="table-header">
      <div class="word-num">#</div>
      <div class="word">单词</div>
      <div class="meaning">释义</div>
      <div class="pronunciation">发音</div>
      <div class="example">例句</div>
    </div>
`;

  words.forEach((item, index) => {
    const num = String(startNum + index).padStart(2, "0");
    const audioIdx = String(item.originalIndex + 1).padStart(3, "0");
    const wordEsc = escapeHtml(item.word);
    const ipaEsc = escapeHtml(item.ipa);
    const meaningEsc = escapeHtml(item.meaning);
    const exampleEsc = escapeHtml(item.example);
    const wordAudioPath = `../audio/lesson-${lessonNumPad}/w-${audioIdx}.mp3`;
    const exampleAudioPath = `../audio/lesson-${lessonNumPad}/e-${audioIdx}.mp3`;

    html += `    <article class="word-card">
      <div class="word-num">${num}</div>
      <div class="word"><span>${wordEsc}</span></div>
      <div class="meaning">${meaningEsc}</div>
      <div class="pronunciation">${ipaEsc}
        <button type="button" class="audio-button" data-audio-src="${wordAudioPath}" data-audio-text="${wordEsc}" onclick="playWordAudio(this)" aria-label="播放 ${wordEsc} 的发音">${renderAudioSvg()}</button>
      </div>
      <div class="example">
        <span>${exampleEsc}</span>
        <button type="button" class="audio-button" data-audio-src="${exampleAudioPath}" data-audio-text="${exampleEsc}" onclick="playExampleAudio(this)" aria-label="播放例句发音">${renderAudioSvg()}</button>
      </div>
    </article>
`;
  });

  html += `  </div>\n`;
  return html;
}

lessons.forEach((item, idx) => {
  const lessonNum = item.lesson;
  const lessonNumPad = String(lessonNum).padStart(2, "0");
  const lessonDir = path.join("source/english/side-by-side-1", `lesson-${lessonNumPad}`);
  if (!fs.existsSync(lessonDir)) {
    fs.mkdirSync(lessonDir, { recursive: true });
  }

  const prevLesson = idx > 0 ? lessons[idx - 1] : null;
  const nextLesson = idx < lessons.length - 1 ? lessons[idx + 1] : null;
  const prevLessonUrl = prevLesson ? `../lesson-${String(prevLesson.lesson).padStart(2, "0")}/` : "";
  const nextLessonUrl = nextLesson ? `../lesson-${String(nextLesson.lesson).padStart(2, "0")}/` : "";

  // Add originalIndex to each item to map to generated mp3 files
  const vocabWithIndex = item.vocabulary.map((v, i) => ({ ...v, originalIndex: i }));

  const coreWords = vocabWithIndex.filter(v => !properNounRegex.test(v.meaning));
  const properWords = vocabWithIndex.filter(v => properNounRegex.test(v.meaning));

  let prevLink = prevLesson ? `<a href="${prevLessonUrl}">← 上一课</a>` : "";
  let nextLink = nextLesson ? `<a href="${nextLessonUrl}">下一课 →</a>` : "";
  const lessonNavLinks = [
    prevLesson ? `<a href="${prevLessonUrl}" aria-label="上一课" title="上一课">←</a>` : "",
    '<a href="../" aria-label="课程目录" title="课程目录">目</a>',
    nextLesson ? `<a href="${nextLessonUrl}" aria-label="下一课" title="下一课">→</a>` : ""
  ].filter(Boolean).map(link => `      ${link}`).join("\n");

  let tabsHtml = "";
  if (properWords.length > 0) {
    tabsHtml = `
<div class="vocab-tabs-nav" role="tablist" aria-label="词汇分类切换">
  <button type="button" class="vocab-tab-btn active" role="tab" aria-selected="true" data-tab-target="tab-core" onclick="switchVocabTab(this)">
    核心词汇
    <span class="tab-badge">${coreWords.length}</span>
  </button>
  <button type="button" class="vocab-tab-btn" role="tab" aria-selected="false" data-tab-target="tab-proper" onclick="switchVocabTab(this)">
    专有名词
    <span class="tab-badge">${properWords.length}</span>
  </button>
</div>

<div id="tab-core" class="vocab-tab-panel active" role="tabpanel">
${renderTable(coreWords, lessonNumPad, 1)}
</div>

<div id="tab-proper" class="vocab-tab-panel" role="tabpanel" hidden>
${renderTable(properWords, lessonNumPad, 1)}
</div>
`;
  } else {
    tabsHtml = `
<div class="section-title-wrap">
  <h3 class="section-title">核心词汇</h3>
  <span class="section-count">${coreWords.length} 个生词</span>
</div>
${renderTable(coreWords, lessonNumPad, 1)}
`;
  }

  const properSummary = properWords.length > 0 ? `（核心词汇 ${coreWords.length} · 专有名词 ${properWords.length}）` : `（核心词汇 ${coreWords.length}）`;

  const pageHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(item.title)} - Michael's Blog</title>
  <meta name="description" content="Side by Side 1 英语生词、音标、例句和发音练习。">
  <link rel="stylesheet" href="../assets/styles.css?v=4.1">
  <script src="/assets/site-config.js"></script>
  <script src="../assets/site-stats.js" defer></script>
  <script src="../assets/script.js?v=4.2" defer></script>
</head>
<body data-prev-lesson-url="${prevLessonUrl}" data-next-lesson-url="${nextLessonUrl}">
  <header class="site-header"></header>
  <main>
    <aside class="lesson-utility-rail" aria-label="课程阅读工具">
      <div class="lesson-scroll-progress" role="progressbar" aria-label="阅读进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <span>0%</span>
      </div>
      <button type="button" class="lesson-back-to-top" aria-label="回到顶部" title="回到顶部">↑</button>
      <nav class="lesson-nav-menu" aria-label="课程导航">
${lessonNavLinks}
      </nav>
    </aside>
    <section class="hero">
      <p>Lesson ${lessonNum}</p>
      <h2>${escapeHtml(item.title)}</h2>
      <div>共 ${item.vocabulary.length} 个词汇${properSummary}。</div>
    </section>
    <section class="continuous-player" aria-label="连续播放控制">
      <div class="continuous-player-status">
        <strong id="continuous-player-title">连续播放</strong>
        <span id="continuous-player-progress" aria-live="polite">从当前分类的第一个词开始</span>
      </div>
      <div class="continuous-player-controls">
        <button type="button" data-player-action="previous" aria-label="上一个词">⏮</button>
        <button type="button" class="continuous-player-toggle" data-player-action="toggle" aria-label="开始连续播放">▶ 连续播放</button>
        <button type="button" data-player-action="next" aria-label="下一个词">⏭</button>
        <label class="continuous-player-loop">
          <input type="checkbox" id="continuous-player-loop">
          循环
        </label>
      </div>
    </section>
${tabsHtml}
    <audio id="voice-file" preload="none"><source id="audioSource" src=""></audio>
  </main>
  <footer></footer>
</body>
</html>
`;

  fs.writeFileSync(path.join(lessonDir, "index.html"), pageHtml, "utf8");
  console.log(`Generated ${lessonDir}/index.html (${coreWords.length} core, ${properWords.length} proper)`);
});
