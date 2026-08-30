/**
 * Privacy-friendly site analytics shared by the blog and standalone tools.
 * Payloads contain only allowlisted dimensions; user-entered content is never sent.
 */
(function (global) {
  'use strict';

  var ENDPOINT = global.SiteConfig && global.SiteConfig.statsEndpoint;
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
    if (!document.referrer) return null;
    try {
      var url = new URL(document.referrer);
      return url.origin === location.origin ? null : url.origin;
    } catch (error) {
      return null;
    }
  }

  function recipientTag() {
    try {
      return (new URLSearchParams(location.search).get('to') || '').slice(0, 60) || null;
    } catch (error) {
      return null;
    }
  }

  function propagateTag() {
    if (!tag) return;
    document.querySelectorAll('a[href]').forEach(function (link) {
      try {
        var url = new URL(link.href, location.href);
        if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return;
        url.searchParams.set('to', tag);
        link.href = url.href;
      } catch (error) {}
    });
  }

  function send(event, detail) {
    if (!ENDPOINT || location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
    var dimensions = classify(location.pathname);
    var payload = JSON.stringify({
      app: dimensions.app,
      page_type: dimensions.page_type,
      path: location.pathname,
      event: event,
      detail: detail || null,
      lang: language(),
      tag: tag,
      referrer: referrerOrigin()
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
    var path = location.pathname;
    if (path === lastPath || path.indexOf('/cv/') === 0) return;
    lastPath = path;
    depthSent = {};
    send('view');
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
    trackView();
    trackExternalClicks();
    watchSpaNavigation();
    global.addEventListener('scroll', trackReadingDepth, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
