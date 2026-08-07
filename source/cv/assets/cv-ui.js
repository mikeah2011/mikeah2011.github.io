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
 *   <script>CVUI.init(DICT)</script>
 *
 * Dictionary shape: { 'zh-CN': {key: value}, 'zh-TW': {...}, 'en': {...} }
 * Markup hooks:
 *   data-i18n="key"       → textContent
 *   data-i18n-html="key"  → innerHTML (for strings carrying <strong>/<span>)
 *   data-i18n-attr="attr:key,attr:key"
 */
(function (global) {
  'use strict';

  var LANGS = ['zh-CN', 'zh-TW', 'en'];
  var LANG_KEY = 'cv-lang';
  var THEME_KEY = 'cv-theme';
  var LANG_LABEL = { 'zh-CN': '简', 'zh-TW': '繁', 'en': 'EN' };

  var UI_STRINGS = {
    'zh-CN': { lang: '语言切换', theme: '主题切换', light: '浅色', system: '跟随系统', dark: '深色' },
    'zh-TW': { lang: '語言切換', theme: '主題切換', light: '淺色', system: '跟隨系統', dark: '深色' },
    'en':    { lang: 'Language', theme: 'Theme', light: 'Light', system: 'System', dark: 'Dark' }
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
    var theme = ['light', 'system', 'dark'].map(function (t) {
      return '<button type="button" data-cv-theme="' + t + '" aria-pressed="false">' + ICONS[t] + '</button>';
    }).join('');
    mount.innerHTML =
      '<div class="cv-seg" data-cv-group="lang" role="group">' + lang + '</div>' +
      '<div class="cv-seg cv-icons" data-cv-group="theme" role="group">' + theme + '</div>';
    mount.classList.add('cv-toolbar');
  }

  function CVUI() {}

  CVUI.init = function (dict, options) {
    var opts = options || {};
    var root = document.documentElement;
    var mount = document.querySelector('[data-cv-toolbar]');
    if (mount) buildToolbar(mount);

    var langBtns = [].slice.call(document.querySelectorAll('[data-cv-lang]'));
    var themeBtns = [].slice.call(document.querySelectorAll('[data-cv-theme]'));
    var current = { lang: detectLang(), theme: store.get(THEME_KEY) || 'system' };

    function applyLang(lang) {
      var d = dict[lang] || dict['zh-CN'] || {};
      var ui = UI_STRINGS[lang] || UI_STRINGS['zh-CN'];
      current.lang = lang;
      root.setAttribute('lang', lang);
      if (d['html.title']) document.title = d['html.title'];

      document.querySelectorAll('[data-i18n]').forEach(function (el) {
        var v = d[el.getAttribute('data-i18n')];
        if (v != null) el.textContent = v;
      });
      document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
        var v = d[el.getAttribute('data-i18n-html')];
        if (v != null) el.innerHTML = v;
      });
      document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
        el.getAttribute('data-i18n-attr').split(',').forEach(function (pair) {
          var p = pair.split(':');
          var v = d[p[1] && p[1].trim()];
          if (v != null) el.setAttribute(p[0].trim(), v);
        });
      });

      var lg = document.querySelector('[data-cv-group="lang"]');
      var tg = document.querySelector('[data-cv-group="theme"]');
      if (lg) lg.setAttribute('aria-label', ui.lang);
      if (tg) tg.setAttribute('aria-label', ui.theme);
      themeBtns.forEach(function (b) {
        var t = ui[b.getAttribute('data-cv-theme')];
        if (t) { b.setAttribute('title', t); b.setAttribute('aria-label', t); }
      });
      langBtns.forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-cv-lang') === lang));
      });
      if (typeof opts.onLang === 'function') opts.onLang(lang);
    }

    function applyTheme(mode) {
      current.theme = mode;
      if (mode === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', mode);
      themeBtns.forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-cv-theme') === mode));
      });
      if (typeof opts.onTheme === 'function') opts.onTheme(mode);
    }

    langBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        var l = b.getAttribute('data-cv-lang');
        applyLang(l); store.set(LANG_KEY, l);
      });
    });
    themeBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        var t = b.getAttribute('data-cv-theme');
        applyTheme(t); store.set(THEME_KEY, t);
      });
    });

    // A choice made in another tab should land here too.
    global.addEventListener('storage', function (e) {
      if (e.key === LANG_KEY && e.newValue) applyLang(e.newValue);
      if (e.key === THEME_KEY && e.newValue) applyTheme(e.newValue);
    });

    applyLang(current.lang);
    applyTheme(current.theme);
    return current;
  };

  global.CVUI = CVUI;
})(window);
