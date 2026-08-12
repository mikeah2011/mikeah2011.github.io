/**
 * 简历站访问统计（客户端）
 *
 * ENDPOINT 为空时这个文件完全静默 —— 不发任何请求。目前已配置，正在上报。
 * 部署步骤见私有仓库 jobsearch/analytics/README.md。
 */
(function () {
  'use strict';

  // 已部署。想临时停止上报就把这里改回空字符串 —— 整个文件会完全静默。
  // Worker 源码与部署手册在私有仓库 jobsearch/analytics/。
  var ENDPOINT = 'https://cv-stats.mikeah2011.workers.dev/h';

  // 投递对象标记的参数名。带 ?to=acme 的链接进来，后续站内跳转都会带着它，
  // 所以「从首页点进简历、再下载 PDF」会记在同一个标记下。
  var TAG_PARAM = 'to';

  var params = new URLSearchParams(location.search);
  var tag = (params.get(TAG_PARAM) || '').slice(0, 60) || null;

  // 简历站的根路径。线上是 /cv/，但本地起 http server 时根目录就是 source/cv/，
  // 路径变成 /index.html。写死 '/cv/' 会让本地预览和线上行为不一致（本地全部
  // 跳过、什么都不生效），所以从当前页面推导 —— src/ 和 share/ 是已知的子目录。
  var BASE = (function () {
    var m = location.pathname.match(/^(.*?)(?:\/(?:src|share))?\/[^\/]*$/);
    return (m ? m[1] : '') + '/';
  })();

  // ---- 标记在站内跳转时的传递 ----
  // 刻意用 URL 传，不用 cookie / localStorage / sessionStorage：
  // 一是不碰客户端存储就不需要同意横幅，二是和已有的 ?lang= 处理方式一致。
  // 代价是链接会长一点，可接受。
  function propagateTag() {
    if (!tag) return;
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      // 下载链接不用带（带了也无害，但没意义）；外站链接绝不带 —— 那等于
      // 把投递对象标记泄漏给第三方。
      if (a.hasAttribute('download')) continue;
      var href = a.getAttribute('href');
      if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
      var url;
      try { url = new URL(href, location.href); } catch (e) { continue; }
      if (url.origin !== location.origin) continue;
      if (url.pathname.indexOf(BASE) !== 0) continue;
      if (url.searchParams.get(TAG_PARAM)) continue;
      url.searchParams.set(TAG_PARAM, tag);
      a.setAttribute('href', url.pathname + url.search + url.hash);
    }
  }

  // ---- 当前页面的身份 ----
  function detectPage() {
    var p = location.pathname;
    if (/\/share\//.test(p)) return 'share';
    if (/\/src\/view\.html$/.test(p)) return 'view';
    if (/\/resume\.html$/.test(p)) return 'resume';
    if (/\/deck\.html$/.test(p)) return 'deck';
    if (p === BASE || p === BASE + 'index.html') return 'index';
    return null;
  }

  function detectVariant() {
    var v = params.get('v') || '';
    return ['', 'backend', 'lead', 'ai'].indexOf(v) > -1 ? v : '';
  }

  // 语言取 <html lang> —— cv-ui.js 初始化时会写这个属性，所以它反映的是
  // 实际渲染出来的语言，比 ?lang= 参数可靠（后者可能缺省）。
  function detectLang() {
    var l = document.documentElement.getAttribute('lang');
    return ['zh-CN', 'zh-TW', 'en'].indexOf(l) > -1 ? l : null;
  }

  function send(event, detail) {
    if (!ENDPOINT) return;
    var payload = JSON.stringify({
      page: detectPage(),
      variant: detectVariant(),
      lang: detectLang(),
      tag: tag,
      event: event,
      detail: detail || null,
      // 只带 referrer 的来源域名，不带完整路径 —— 路径可能含对方内部系统的信息。
      referrer: (function () {
        if (!document.referrer) return null;
        try {
          var r = new URL(document.referrer);
          return r.origin === location.origin ? null : r.origin;
        } catch (e) { return null; }
      })()
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
