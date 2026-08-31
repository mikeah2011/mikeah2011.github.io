/**
 * 网站访问统计的简历模块（客户端）
 *
 * ENDPOINT 为空时这个文件完全静默 —— 不发任何请求。目前已配置，正在上报。
 * 部署步骤见私有仓库 jobsearch/analytics/README.md。
 */
(function () {
  'use strict';

  // 已部署。想临时停止上报就把这里改回空字符串 —— 整个文件会完全静默。
  // Worker 源码与部署手册在私有仓库 jobsearch/analytics/。
  var ENDPOINT = window.SiteConfig && window.SiteConfig.statsEndpoint;

  // 投递对象标记的参数名。带 ?to=acme 的链接进来，后续站内跳转都会带着它，
  // 所以「从首页点进简历、再下载 PDF」会记在同一个标记下。
  var TAG_PARAM = 'to';
  var TAG_STORAGE_KEY = 'site_stats_recipient_tag';

  var tag = recipientTag();

  // 简历站的根路径。线上是 /cv/，但本地起 http server 时根目录就是 source/cv/，
  // 路径变成 /index.html。写死 '/cv/' 会让本地预览和线上行为不一致（本地全部
  // 跳过、什么都不生效），所以从当前页面推导 —— src/ 和 share/ 是已知的子目录。
  var BASE = (function () {
    var m = location.pathname.match(/^(.*?)(?:\/(?:src|share))?\/[^\/]*$/);
    return (m ? m[1] : '') + '/';
  })();

  // ---- 标记在站内跳转时的传递 ----
  // 用 sessionStorage 兜底，URL 续传做显式链路；不写 cookie，也不把标记带到外站。
  function normalizeTag(value) {
    var safe = (value || '').slice(0, 60);
    return /^[A-Za-z0-9_-]{1,60}$/.test(safe) ? safe : null;
  }

  function storeTag(value) {
    try {
      window.sessionStorage.setItem(TAG_STORAGE_KEY, value);
    } catch (e) { }
  }

  function storedTag() {
    try {
      return normalizeTag(window.sessionStorage.getItem(TAG_STORAGE_KEY));
    } catch (e) {
      return null;
    }
  }

  function clearStoredTag() {
    try {
      window.sessionStorage.removeItem(TAG_STORAGE_KEY);
    } catch (e) { }
  }

  function recipientTag() {
    var fromUrl = null;
    try {
      fromUrl = new URLSearchParams(location.search).get(TAG_PARAM);
    } catch (e) {
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

  function relativeHref(url) {
    return url.pathname + url.search + url.hash;
  }

  function shouldPropagate(a, url) {
    var href = a.getAttribute('href') || '';
    if (a.hasAttribute('download')) return false;
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) return false;
    return url.origin === location.origin && /^https?:$/.test(url.protocol);
  }

  function addTagToLink(a) {
    if (!tag) return;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
    if (!shouldPropagate(a, url)) return;
    if (url.searchParams.get(TAG_PARAM) === tag) return;
    url.searchParams.set(TAG_PARAM, tag);
    a.setAttribute('href', relativeHref(url));
  }

  function propagateTag() {
    if (!tag) return;
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      addTagToLink(links[i]);
    }
  }

  function updateClickedInternalLink(e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (a) addTagToLink(a);
  }

  // ---- 当前页面的身份 ----
  // share/ 下那三个中转页刻意不在这里，也不该加进来：它们存在的意义是给不跑 JS
  // 的社交平台爬虫读 og 标签，不是给人停留的页面，算一次浏览会让「浏览次数」
  // 虚高一倍。它们本来也不加载这个脚本。服务端白名单同样不含 share，两边一致。
  function detectPage() {
    var p = location.pathname;
    if (/\/src\/view\.html$/.test(p)) return 'view';
    if (/\/resume\.html$/.test(p)) return 'resume';
    if (/\/deck\.html$/.test(p)) return 'deck';
    if (p === BASE || p === BASE + 'index.html') return 'index';
    return null;
  }

  // 版本必须在 send 时现读，不能用加载时捕获的 params —— resume.html 的版本
  // 切换走 history.replaceState 就地改 URL、不刷新页面，那份快照会过期。
  // 症状是矛盾的一行：切到 lead 再点下载，detail 记着 .lead.pdf，variant 却
  // 还是切换前的值。lang 没有这个问题（detectLang 读的是实时的 <html lang>）。
  function detectVariant() {
    var v = new URLSearchParams(location.search).get('v') || '';
    return ['backend', 'lead', 'ai'].indexOf(v) !== -1 ? v : null;
  }

  // 语言取 <html lang> —— cv-ui.js 初始化时会写这个属性，所以它反映的是
  // 实际渲染出来的语言，比 ?lang= 参数可靠（后者可能缺省）。
  function detectLang() {
    var l = document.documentElement.getAttribute('lang');
    return ['zh-CN', 'zh-TW', 'en'].indexOf(l) > -1 ? l : null;
  }

  function send(event, detail) {
    if (!ENDPOINT) return;
    var referrer = (function () {
      if (!document.referrer) return 'direct';
      try {
        var r = new URL(document.referrer);
        return r.origin === location.origin ? 'internal:' + r.pathname : r.origin + r.pathname;
      } catch (e) { return 'direct'; }
    })();
    var sourceType = referrer === 'direct'
      ? 'direct'
      : referrer.indexOf('internal:') === 0 ? 'internal' : 'external';
    var payload = JSON.stringify({
      app: 'cv',
      page_type: detectPage(),
      path: location.pathname,
      page: detectPage(),
      variant: detectVariant(),
      lang: detectLang(),
      tag: tag,
      event: event,
      detail: detail || (event === 'view' ? sourceType : null),
      // query/hash 会在客户端省略，Worker 入库前也会再次校验。
      referrer: referrer
    });

    // Content-Type 必须是 text/plain，不能是 application/json。
    //
    // application/json 不在 CORS 安全名单里，跨源请求会先发 OPTIONS 预检 ——
    // 而 sendBeacon 是发即忘的，处理预检很不可靠：实测即使 Worker 正确回应了
    // 预检（204 + 完整 CORS 头），beacon 照样丢包，什么都不记录，且没有任何
    // 报错。text/plain 在安全名单内，不触发预检，直接送达。
    //
    // 服务端用 request.json() 解析，不看 Content-Type，所以照样能读。
    var BODY_TYPE = 'text/plain;charset=UTF-8';

    // sendBeacon 页面跳转也能送达 —— 下载点击后马上离开页面的场景就靠它。
    try {
      if (navigator.sendBeacon &&
          navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: BODY_TYPE }))) {
        return;
      }
    } catch (e) { /* 落到下面 */ }
    try {
      fetch(ENDPOINT, {
        method: 'POST', body: payload, keepalive: true, mode: 'cors',
        headers: { 'Content-Type': BODY_TYPE }
      }).catch(function () { });
    } catch (e) { /* 统计失败绝不影响页面 */ }
  }

  function trackDownloads() {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a[download], a[href$=".pdf"], a[href$=".pptx"]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      send('download', href.split('/').pop());
    }, true);
  }

  function init() {
    propagateTag();
    document.addEventListener('click', updateClickedInternalLink, true);
    trackDownloads();
    // cv-ui.js 是同步初始化并写好 <html lang> 的，所以这里读到的语言已经是最终值。
    send('view');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
