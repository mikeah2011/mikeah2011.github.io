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

/* ---------------- Touch Swipe Navigation ---------------- */
const swipeMinDistance = 72;
const swipeDirectionRatio = 1.25;
const swipeMaxDuration = 1200;

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

  if (deltaX > 0) {
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
      time: Date.now()
    };
  }, { passive: true });

  main.addEventListener("touchend", (event) => {
    if (!swipeStart || event.changedTouches.length !== 1) {
      swipeStart = null;
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - swipeStart.x;
    const deltaY = touch.clientY - swipeStart.y;
    const duration = Date.now() - swipeStart.time;
    swipeStart = null;

    if (
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

  header.innerHTML = `
    <div class="site-header-left">
      <a href="/" title="返回 Michael's Blog">
        <img class="site-avatar" src="https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/blog_logo.jpeg" alt="Michael's Blog">
      </a>
      <div class="site-brand-text">
        <a href="/" class="site-brand-title">Michael's Blog</a>
        <span class="site-brand-sub">英语学习 · Side by Side 1</span>
      </div>
    </div>
    <nav class="site-header-nav">
      <a href="/" class="site-nav-link">博客首页</a>
      <a href="/english/side-by-side-1/" class="site-nav-link ${isDirectoryPage ? "active" : ""}">课程目录</a>
      <a href="/cv/" class="site-nav-link">简历</a>
      <a href="/categories" class="site-nav-link">分类</a>
      <a href="https://github.com/mikeah2011" target="_blank" rel="noopener noreferrer" class="site-nav-link">GitHub</a>
      <button id="theme-toggle" class="theme-toggle-btn" type="button" aria-label="切换主题" onclick="toggleTheme()"></button>
    </nav>
  `;

  updateThemeToggleIcon(getSavedTheme());
}

function enhanceFooter() {
  const footer = document.querySelector("footer");
  if (!footer) return;

  footer.innerHTML = `
    <div style="margin-bottom: 0.5rem; font-weight: 600; color: var(--text-title);">
      知我所能者，尽善尽美；知我所不能者，虚怀若谷。
    </div>
    <div>
      © ${new Date().getFullYear()} <a href="/">Michael's Blog</a> · 英语学习 · Side by Side 1
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  enhanceHeader();
  enhanceFooter();
  initVocabTabs();
  initHoverPlay();
  initSwipeNavigation();
});
