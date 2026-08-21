/*!
 * cv-ui — shared theme + language controller for the /cv/ pages.
 *
 * A page supplies its own dictionary and a mount point; this module renders the
 * toolbar, restores the visitor's saved choices, and keeps every /cv/ page in
 * sync through localStorage (same origin, so the choice follows them across
 * index / resume / deck).
 *
 * Usage:
 *   <div data-cv-toolbar></div>
 *   <script src="assets/cv-ui.js"></script>
 *   <script>CVUI.init(DICT, { files: FILES })</script>
 *
 * Dictionary shape: { 'zh-CN': {key: value}, 'zh-TW': {...}, 'en': {...} }
 * Markup hooks:
 *   data-i18n="key"       → textContent
 *   data-i18n-html="key"  → innerHTML (for strings carrying <strong>/<span>)
 *   data-i18n-attr="attr:key,attr:key"
 *
 * Setting a key to '' (or null) in one language HIDES that element for that
 * language — the résumé uses this to run a shorter English version off the
 * same markup, since English CV convention wants a tighter document than the
 * Chinese one. Omitting the key entirely is different: the element is left
 * untouched. Pages whose dictionaries have no empty values are unaffected.
 *
 * File-resource hooks (downloads that actually differ per language/theme,
 * not just a relabeled link to the same file):
 *   data-cv-file="key"         on the <a> — href swaps on language/theme change
 *   data-cv-file-desc          on a descendant — its text becomes the resource's desc
 * `options.files` shape: { key: { lang: {href, desc} | {dark: {href,desc}, light: {href,desc}} } }
 * A resource with dark/light sub-keys switches with the theme toggle (falling
 * back to the OS preference while the toggle is on "system"); a flat
 * {href, desc} resource is language-only.
 *
 * init() returns { lang, theme, setDict(nextDict) }. setDict swaps the whole
 * dictionary and re-renders at the current language — for pages that serve
 * several content variants off one set of markup.
 */
(function (global) {
  'use strict';

  var LANGS = ['zh-CN', 'zh-TW', 'en'];
  var LANG_KEY = 'cv-lang';
  var THEME_KEY = 'cv-theme';
  var LANG_LABEL = { 'zh-CN': '简', 'zh-TW': '繁', 'en': 'EN' };

  // Single button cycles through these in order; the icon shown is always
  // the CURRENTLY active mode, and a click advances to the next one.
  var THEME_ORDER = ['light', 'dark', 'system'];

  var UI_STRINGS = {
    'zh-CN': {
      lang: '语言切换', light: '浅色', system: '跟随系统', dark: '深色', themeHint: '主题：{mode}（点击切换）',
      share: '分享', home: '返回首页', shareTo: '分享给（可选）', shareToPh: '例如：HR-Lily', shareCopy: '复制链接', shareNative: '系统分享',
      shareClose: '取消', shareCopied: '链接已复制', shareFallback: '分享链接', shareHint: '输入投递对象，生成带 to 参数的分享链接。'
    },
    'zh-TW': {
      lang: '語言切換', light: '淺色', system: '跟隨系統', dark: '深色', themeHint: '主題：{mode}（點擊切換）',
      share: '分享', home: '返回首頁', shareTo: '分享給（可選）', shareToPh: '例如：HR-Lily', shareCopy: '複製連結', shareNative: '系統分享',
      shareClose: '取消', shareCopied: '連結已複製', shareFallback: '分享連結', shareHint: '輸入投遞對象，產生帶 to 參數的分享連結。'
    },
    'en': {
      lang: 'Language', light: 'Light', system: 'System', dark: 'Dark', themeHint: 'Theme: {mode} (click to switch)',
      share: 'Share', home: 'Home', shareTo: 'Share to (optional)', shareToPh: 'e.g. HR-Lily', shareCopy: 'Copy link', shareNative: 'System share',
      shareClose: 'Cancel', shareCopied: 'Link copied', shareFallback: 'Share link', shareHint: 'Add a recipient to generate a share link with the to parameter.'
    }
  };

  var ICONS = {
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/></svg>',
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 17v3.5"/></svg>',
    dark:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8z"/></svg>'
  };

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };

  function detectLang() {
    // An explicit ?lang= wins over everything: it's what makes a link
    // shareable in a specific language, and what lets the PDF export drive
    // the page deterministically instead of depending on the browser locale.
    // Deliberately NOT persisted — following someone's link shouldn't
    // overwrite the visitor's own saved choice.
    try {
      var forced = new URLSearchParams(location.search).get('lang');
      if (forced && LANGS.indexOf(forced) > -1) return forced;
    } catch (e) { /* no URLSearchParams — fall through to the usual order */ }
    var saved = store.get(LANG_KEY);
    if (saved && LANGS.indexOf(saved) > -1) return saved;
    var navs = global.navigator.languages || [global.navigator.language || 'zh-CN'];
    for (var i = 0; i < navs.length; i++) {
      var l = String(navs[i]).toLowerCase();
      // Traditional-script regions keep 繁體; every other zh variant gets 简体.
      if (l.indexOf('zh') === 0) return /hant|tw|hk|mo/.test(l) ? 'zh-TW' : 'zh-CN';
      if (l.indexOf('en') === 0) return 'en';
    }
    return 'zh-CN';
  }

  function isCvHomePage() {
    var p = String(global.location && global.location.pathname || '');
    return /\/cv\/$/.test(p) || /\/cv\/index\.html$/.test(p);
  }

  function cvHomeHref() {
    var p = String(global.location && global.location.pathname || '');
    return /\/cv\/src\//.test(p) ? '../index.html' : 'index.html';
  }

  function buildToolbar(mount) {
    var lang = LANGS.map(function (l) {
      return '<button type="button" data-cv-lang="' + l + '" aria-pressed="false">' + LANG_LABEL[l] + '</button>';
    }).join('');
    var share = '<button type="button" class="cv-icon-btn share-icon" data-cv-action="share" aria-label="Share" title="Share">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>' +
      '</button>';
    var home = isCvHomePage() ? '' :
      '<a class="cv-icon-btn cv-home-btn" data-cv-action="home" href="' + cvHomeHref() + '" aria-label="Home" title="Home">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 4.2 19 9.7V20a1 1 0 0 1-1 1h-4.6v-6h-2.8v6H6a1 1 0 0 1-1-1V9.7z"/></svg>' +
      '</a>';
    mount.innerHTML =
      '<div class="cv-seg" data-cv-group="lang" role="group">' + lang + '</div>' +
      '<button type="button" class="cv-theme-btn" data-cv-theme-btn></button>' +
      share + home;
    mount.classList.add('cv-toolbar');
  }

  function CVUI() {}

  function effectiveTheme(mode) {
    if (mode !== 'system') return mode;
    return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  CVUI.init = function (dict, options) {
    var opts = options || {};
    // Held in a variable rather than used directly so a page can swap the
    // whole dictionary later (see `setDict` on the returned controller) —
    // that's what lets the résumé switch between its targeted variants
    // without a reload, reusing the same markup and language state.
    var activeDict = dict;
    var root = document.documentElement;
    var mount = document.querySelector('[data-cv-toolbar]');
    if (mount) buildToolbar(mount);

    var langBtns = [].slice.call(document.querySelectorAll('[data-cv-lang]'));
    var themeBtn = document.querySelector('[data-cv-theme-btn]');
    var shareBtn = document.querySelector('[data-cv-action="share"]');
    var homeBtn = document.querySelector('[data-cv-action="home"]');
    var fileEls = [].slice.call(document.querySelectorAll('[data-cv-file]'));
    var current = { lang: detectLang(), theme: store.get(THEME_KEY) || 'system' };

    function applyFiles() {
      if (!opts.files || !fileEls.length) return;
      var theme = effectiveTheme(current.theme);
      fileEls.forEach(function (el) {
        var res = (opts.files[el.getAttribute('data-cv-file')] || {})[current.lang];
        if (!res) return;
        var entry = res.dark || res.light ? (res[theme] || res.dark || res.light) : res;
        if (entry.href) el.setAttribute('href', entry.href);
        if (entry.desc) {
          var desc = el.querySelector('[data-cv-file-desc]');
          if (desc) desc.textContent = entry.desc;
        }
      });
    }

    function applyLang(lang) {
      var d = activeDict[lang] || activeDict['zh-CN'] || {};
      var ui = UI_STRINGS[lang] || UI_STRINGS['zh-CN'];
      current.lang = lang;
      root.setAttribute('lang', lang);
      if (d['html.title']) document.title = d['html.title'];

      // Three cases, deliberately distinct:
      //   undefined ("key absent")  → leave the element alone (back-compat)
      //   '' or null ("key emptied") → this language drops the entry entirely
      //   a value                    → write it and make sure it's visible
      // The empty case is what lets one language carry fewer entries than
      // another without maintaining a second copy of the markup.
      function applyEntry(el, v, write) {
        if (v === '' || v === null) { el.hidden = true; return; }
        if (v === undefined) return;
        el.hidden = false;
        write(el, v);
      }
      document.querySelectorAll('[data-i18n]').forEach(function (el) {
        applyEntry(el, d[el.getAttribute('data-i18n')], function (e, v) { e.textContent = v; });
      });
      document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
        applyEntry(el, d[el.getAttribute('data-i18n-html')], function (e, v) { e.innerHTML = v; });
      });
      document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
        el.getAttribute('data-i18n-attr').split(',').forEach(function (pair) {
          var p = pair.split(':');
          var v = d[p[1] && p[1].trim()];
          if (v != null) el.setAttribute(p[0].trim(), v);
        });
      });

      var lg = document.querySelector('[data-cv-group="lang"]');
      if (lg) lg.setAttribute('aria-label', ui.lang);
      langBtns.forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-cv-lang') === lang));
      });
      renderThemeBtn(); // the hint text ("主题：浅色…") is language-specific
      if (shareBtn) {
        shareBtn.setAttribute('title', ui.share);
        shareBtn.setAttribute('aria-label', ui.share);
      }
      if (homeBtn) {
        homeBtn.setAttribute('title', ui.home);
        homeBtn.setAttribute('aria-label', ui.home);
      }
      applyFiles();
      if (typeof opts.onLang === 'function') opts.onLang(lang);
    }

    function copyToClipboard(text) {
      if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
        return global.navigator.clipboard.writeText(text);
      }
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      return Promise.resolve();
    }

    function flash(msg) {
      var n = document.createElement('div');
      n.textContent = msg;
      n.style.position = 'fixed';
      n.style.right = '20px';
      n.style.bottom = '90px';
      n.style.background = 'rgba(0,0,0,0.8)';
      n.style.color = '#fff';
      n.style.padding = '8px 12px';
      n.style.borderRadius = '8px';
      n.style.zIndex = 9999;
      document.body.appendChild(n);
      setTimeout(function () {
        n.style.transition = 'opacity .25s';
        n.style.opacity = '0';
        setTimeout(function () { n.remove(); }, 250);
      }, 1400);
    }

    function buildShareUrl(toValue) {
      var u = new URL(global.location.href);
      var to = (toValue || '').trim();
      u.searchParams.set('lang', current.lang);
      if (to) u.searchParams.set('to', to.slice(0, 60));
      else u.searchParams.delete('to');
      return u.toString();
    }

    function bindSharePrompt() {
      if (!shareBtn || isCvHomePage()) return;
      CVUI._shareManaged = true;
      shareBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var ui = UI_STRINGS[current.lang] || UI_STRINGS['en'];
        var old = document.getElementById('cvShareModal');
        if (old) old.remove();

        var modal = document.createElement('div');
        modal.id = 'cvShareModal';
        modal.className = 'cv-share-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML =
          '<div class="cv-share-panel">' +
          '  <h2 id="cvShareTitle">' + ui.share + '</h2>' +
          '  <p>' + ui.shareHint + '</p>' +
          '  <div class="cv-share-field">' +
          '    <label for="cvShareToInput">' + ui.shareTo + '</label>' +
          '    <input id="cvShareToInput" type="text" maxlength="60" placeholder="' + ui.shareToPh + '">' +
          '  </div>' +
          '  <div class="cv-share-preview mono" id="cvSharePreview"></div>' +
          '  <div class="cv-share-actions">' +
          '    <button type="button" id="cvShareCloseBtn">' + ui.shareClose + '</button>' +
          '    <button type="button" id="cvShareNativeBtn">' + ui.shareNative + '</button>' +
          '    <button type="button" class="primary" id="cvShareCopyBtn">' + ui.shareCopy + '</button>' +
          '  </div>' +
          '</div>';
        document.body.appendChild(modal);
        modal.classList.add('open');

        var toInput = modal.querySelector('#cvShareToInput');
        var preview = modal.querySelector('#cvSharePreview');
        var btnClose = modal.querySelector('#cvShareCloseBtn');
        var btnCopy = modal.querySelector('#cvShareCopyBtn');
        var btnNative = modal.querySelector('#cvShareNativeBtn');

        function currentUrl() {
          return buildShareUrl(toInput && toInput.value || '');
        }
        function renderPreview() {
          preview.textContent = currentUrl();
        }
        function close() {
          modal.remove();
          document.removeEventListener('keydown', onKeydown);
        }
        function onKeydown(ev) {
          if (ev.key === 'Escape') close();
        }

        renderPreview();
        if (toInput) {
          toInput.addEventListener('input', renderPreview);
          setTimeout(function () { toInput.focus(); }, 10);
        }
        modal.addEventListener('click', function (ev) {
          if (ev.target === modal) close();
        });
        document.addEventListener('keydown', onKeydown);
        btnClose.addEventListener('click', close);
        btnCopy.addEventListener('click', function () {
          copyToClipboard(currentUrl()).then(function () {
            flash(ui.shareCopied);
            close();
          });
        });
        btnNative.addEventListener('click', function () {
          var shareUrl = currentUrl();
          if (global.navigator.share) {
            global.navigator.share({
              title: document.title,
              text: document.querySelector('meta[name="description"]') && document.querySelector('meta[name="description"]').getAttribute('content') || '',
              url: shareUrl
            }).then(close).catch(function () {});
            return;
          }
          copyToClipboard(shareUrl).then(function () {
            flash(ui.shareCopied || ui.shareFallback);
            close();
          });
        });
      });
    }

    function renderThemeBtn() {
      if (!themeBtn) return;
      var ui = UI_STRINGS[current.lang] || UI_STRINGS['zh-CN'];
      var label = (ui.themeHint || '{mode}').replace('{mode}', ui[current.theme] || current.theme);
      themeBtn.innerHTML = ICONS[current.theme] || ICONS.system;
      themeBtn.setAttribute('title', label);
      themeBtn.setAttribute('aria-label', label);
    }

    function applyTheme(mode) {
      current.theme = mode;
      if (mode === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', mode);
      renderThemeBtn();
      applyFiles();
      if (typeof opts.onTheme === 'function') opts.onTheme(mode);
    }

    langBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        var l = b.getAttribute('data-cv-lang');
        applyLang(l); store.set(LANG_KEY, l);
      });
    });
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        var next = THEME_ORDER[(THEME_ORDER.indexOf(current.theme) + 1) % THEME_ORDER.length];
        applyTheme(next); store.set(THEME_KEY, next);
      });
    }

    // A choice made in another tab should land here too.
    global.addEventListener('storage', function (e) {
      if (e.key === LANG_KEY && e.newValue) applyLang(e.newValue);
      if (e.key === THEME_KEY && e.newValue) applyTheme(e.newValue);
    });

    // While the toggle is on "system", an OS-level light/dark switch should
    // still swap themed file links even though no explicit applyTheme() runs.
    if (global.matchMedia) {
      global.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        if (current.theme === 'system') applyFiles();
      });
    }

    // Swap the whole dictionary and re-render at the current language. The
    // caller owns building the replacement, so pages with several content
    // variants keep one pristine base and merge their own deltas over it.
    current.setDict = function (next) {
      activeDict = next;
      applyLang(current.lang);
    };

    applyLang(current.lang);
    applyTheme(current.theme);
    bindSharePrompt();
    return current;
  };

  global.CVUI = CVUI;
})(window);
