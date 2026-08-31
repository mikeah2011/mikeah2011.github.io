/**
 * Privacy-friendly site analytics shared by the blog and standalone tools.
 * Payloads contain only allowlisted dimensions; user-entered content is never sent.
 */
(function (global) {
  'use strict';

  var ENDPOINT = global.SiteConfig && global.SiteConfig.statsEndpoint;
  var TAG_PARAM = 'to';
  var TAG_STORAGE_KEY = 'site_stats_recipient_tag';
  var lastPath = '';
  var depthSent = {};
  var tag = recipientTag();

  function classify(path) {
    if (path.indexOf('/english/translate/') === 0) return { app: 'english', page_type: 'translate' };
    if (path.indexOf('/english/words/') === 0) return { app: 'english', page_type: 'words' };
    if (/^\/english\/side-by-side-1\/lesson-\d+\//.test(path)) return { app: 'english', page_type: 'lesson' };
    if (path.indexOf('/english/side-by-side-1/') === 0) return { app: 'english', page_type: 'course' };
    if (path === '/') return { app: 'blog', page_type: 'home' };
    if (path.indexOf('/post/') === 0) return { app: 'blog', page_type: 'post' };
    if (path.indexOf('/archives') === 0) return { app: 'blog', page_type: 'archive' };
    if (path.indexOf('/categories') === 0) return { app: 'blog', page_type: 'category' };
    if (path.indexOf('/tags') === 0) return { app: 'blog', page_type: 'tag' };
    if (path.indexOf('/about') === 0) return { app: 'blog', page_type: 'about' };
    return { app: 'blog', page_type: 'other' };
  }

  function language() {
    var lang = document.documentElement.lang || '';
    if (/^zh-TW/i.test(lang)) return 'zh-TW';
    if (/^en/i.test(lang)) return 'en';
    return 'zh-CN';
  }

  function referrerOrigin() {
    if (!document.referrer) return 'direct';
    try {
      var url = new URL(document.referrer);
      return url.origin === location.origin
        ? 'internal:' + url.pathname
        : url.origin + url.pathname;
    } catch (error) {
      return 'direct';
    }
  }

  function sourceType(referrer) {
    if (referrer === 'direct') return 'direct';
    return referrer && referrer.indexOf('internal:') === 0 ? 'internal' : 'external';
  }

  function variant(dimensions) {
    var value = new URLSearchParams(location.search).get('v') || '';
    var allowed = {
      blog: ['aurora-2'],
      cv: ['backend', 'lead', 'ai'],
      english: ['side-by-side-1', 'words-v1', 'translate-v1']
    };
    if ((allowed[dimensions.app] || []).indexOf(value) !== -1) return value;
    if (dimensions.page_type === 'course' || dimensions.page_type === 'lesson') return 'side-by-side-1';
    if (dimensions.page_type === 'words') return 'words-v1';
    if (dimensions.page_type === 'translate') return 'translate-v1';
    return dimensions.app === 'blog' ? 'aurora-2' : null;
  }

  function recipientTag() {
    var fromUrl = null;
    try {
      fromUrl = new URLSearchParams(location.search).get(TAG_PARAM);
    } catch (error) {
      fromUrl = null;
    }
    var safeUrlTag = normalizeTag(fromUrl);
    if (safeUrlTag) {
      storeTag(safeUrlTag);
      return safeUrlTag;
    }
    if (fromUrl) {
      clearStoredTag();
      return null;
    }
    return storedTag();
  }

  function normalizeTag(value) {
    var safe = (value || '').slice(0, 60);
    return /^[A-Za-z0-9_-]{1,60}$/.test(safe) ? safe : null;
  }

  function storeTag(value) {
    try {
      global.sessionStorage.setItem(TAG_STORAGE_KEY, value);
    } catch (error) {}
  }

  function storedTag() {
    try {
      return normalizeTag(global.sessionStorage.getItem(TAG_STORAGE_KEY));
    } catch (error) {
      return null;
    }
  }

  function clearStoredTag() {
    try {
      global.sessionStorage.removeItem(TAG_STORAGE_KEY);
    } catch (error) {}
  }

  function relativeHref(url) {
    return url.pathname + url.search + url.hash;
  }

  function shouldPropagate(link, url) {
    var href = link.getAttribute('href') || '';
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return false;
    if (link.hasAttribute('download')) return false;
    if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return false;
    return true;
  }

  function addTagToLink(link) {
    if (!tag) return;
    try {
      var url = new URL(link.getAttribute('href'), location.href);
      if (!shouldPropagate(link, url)) return;
      if (url.searchParams.get(TAG_PARAM) === tag) return;
      url.searchParams.set(TAG_PARAM, tag);
      link.setAttribute('href', relativeHref(url));
    } catch (error) {}
  }

  function watchNewLinks() {
    if (!tag || !global.MutationObserver) return;
    var pending = false;
    var observer = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        propagateTag();
      }, 50);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function updateClickedInternalLink(event) {
    var link = event.target && event.target.closest && event.target.closest('a[href]');
    if (link) addTagToLink(link);
  }

  function refreshTagFromUrl() {
    var next = recipientTag();
    if (next !== tag) {
      tag = next;
      propagateTag();
    }
  }

  function propagateTag() {
    if (!tag) return;
    document.querySelectorAll('a[href]').forEach(function (link) {
      addTagToLink(link);
    });
  }

  function send(event, detail, options) {
    if (!ENDPOINT || location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
    var dimensions = classify(location.pathname);
    var sourceOverride = typeof options === 'string' ? options : null;
    var metrics = options && typeof options === 'object' ? options : {};
    var referrer = sourceOverride || referrerOrigin();
    var payload = JSON.stringify({
      app: dimensions.app,
      page_type: dimensions.page_type,
      path: location.pathname,
      variant: variant(dimensions),
      event: event,
      detail: detail || (event === 'view' ? sourceType(referrer) : null),
      lang: language(),
      tag: tag,
      referrer: referrer,
      input_kind: metrics.input_kind || null,
      input_length_bucket: metrics.input_length_bucket || null,
      input_script: metrics.input_script || null
    });
    var type = 'text/plain;charset=UTF-8';
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: type }))) return;
    } catch (error) {}
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        body: payload,
        keepalive: true,
        mode: 'cors',
        headers: { 'Content-Type': type }
      }).catch(function () {});
    } catch (error) {}
  }

  function trackView() {
    refreshTagFromUrl();
    var path = location.pathname;
    if (path === lastPath || path.indexOf('/cv/') === 0) return;
    var previousPath = lastPath;
    lastPath = path;
    depthSent = {};
    send('view', null, previousPath ? 'internal:' + previousPath : null);
  }

  function trackReadingDepth() {
    if (classify(location.pathname).page_type !== 'post') return;
    var max = document.documentElement.scrollHeight - global.innerHeight;
    if (max <= 0) return;
    var percent = Math.round((global.scrollY / max) * 100);
    [25, 50, 75, 100].forEach(function (mark) {
      if (percent >= mark && !depthSent[mark]) {
        depthSent[mark] = true;
        send('reading_depth', String(mark));
      }
    });
  }

  function trackExternalClicks() {
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest && event.target.closest('a[href]');
      if (!link) return;
      try {
        var url = new URL(link.href, location.href);
        if (/^https?:$/.test(url.protocol) && url.origin !== location.origin) {
          send('external_click', url.origin);
        }
      } catch (error) {}
    }, true);
  }

  function watchSpaNavigation() {
    ['pushState', 'replaceState'].forEach(function (method) {
      var original = history[method];
      if (!original) return;
      history[method] = function () {
        var result = original.apply(this, arguments);
        setTimeout(trackView, 0);
        return result;
      };
    });
    global.addEventListener('popstate', trackView);
    global.addEventListener('hashchange', trackView);
  }

  global.SiteStats = { track: send };

  function init() {
    propagateTag();
    document.addEventListener('click', updateClickedInternalLink, true);
    trackView();
    trackExternalClicks();
    watchSpaNavigation();
    watchNewLinks();
    global.addEventListener('scroll', trackReadingDepth, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
