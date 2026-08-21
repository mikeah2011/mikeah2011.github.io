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
    'zh-CN': { lang: '语言切换', light: '浅色', system: '跟随系统', dark: '深色', themeHint: '主题：{mode}（点击切换）' },
    'zh-TW': { lang: '語言切換', light: '淺色', system: '跟隨系統', dark: '深色', themeHint: '主題：{mode}（點擊切換）' },
    'en':    { lang: 'Language', light: 'Light', system: 'System', dark: 'Dark', themeHint: 'Theme: {mode} (click to switch)' }
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

  function buildToolbar(mount) {
    var lang = LANGS.map(function (l) {
      return '<button type="button" data-cv-lang="' + l + '" aria-pressed="false">' + LANG_LABEL[l] + '</button>';
    }).join('');
    mount.innerHTML =
      '<button type="button" class="cv-theme-btn" data-cv-theme-btn></button>' +
      '<div class="cv-seg" data-cv-group="lang" role="group">' + lang + '</div>';
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
      applyFiles();
      if (typeof opts.onLang === 'function') opts.onLang(lang);
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
    return current;
  };

  global.CVUI = CVUI;
})(window);
