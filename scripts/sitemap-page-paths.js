'use strict';

const { text } = require('stream/consumers');

/*
 * 让 sitemap 只包含真正能打开的 URL。
 *
 * hexo-generator-sitemap 用的是 page.path，也就是源码里的相对路径；而
 * hexo-plugin-aurora 的 page generator 把自定义页一律发布到 /page/ 下：
 *
 *   site.pages.forEach(function (page) {
 *     if (page.type === 'about') pageData.push({ path: page.path, ... });
 *     else pageData.push({ path: `page/${page.path}`, ... });
 *   });
 *
 * 两边对不上，于是 sitemap 里写着 /link/、/message-board/，实际内容在
 * /page/link/、/page/message-board/，前者线上 404。source/ 下的静态资源
 * （manifest.json、css/、js/）同样被当成 page 收进了 sitemap，它们根本不是页面。
 *
 * 这里在 after_generate 阶段逐条核对：能直接命中路由的保留；命中不了但
 * page/<path> 能命中的，改写成后者；两者都命中不了、或者压根不是 HTML 的，
 * 剔除并告警。
 *
 * 顺带当安全网。之前 tag generator 的竞态（见 restore-hexo-generators.js）就是
 * 因为没人核对 sitemap 和产物，2537 个 URL 404 了很久都没被发现，而构建始终
 * 退出码 0。剔除时打日志，是为了让下一次同类问题当场可见，而不是被悄悄抹平。
 *
 * 优先级 20 —— 必须晚于 sitemap-cv.js（默认 10），否则它补进来的 /cv/ 条目
 * 还没写入就先被核对了。
 */

const PRIORITY = 20;

hexo.extend.filter.register(
  'after_generate',
  async function () {
    const base = this.config.url.replace(/\/+$/, '');
    const route = this.route;
    const log = this.log;

    // <loc> 里的 URL → 产物路由路径。与 Hexo 的 pretty_urls 约定一致：
    // 目录形式补 index.html，无扩展名的当目录处理。
    function toRoutePath(loc) {
      let p = loc.startsWith(base) ? loc.slice(base.length) : loc;
      try {
        p = decodeURIComponent(p);
      } catch (err) {
        // 编码坏掉的就按原样比对，交给后面的 exists 判定
      }
      p = p.replace(/^\/+/, '');
      if (p === '') return 'index.html';
      if (p.endsWith('/')) return `${p}index.html`;
      if (!/\.[a-z0-9]+$/i.test(p)) return `${p}/index.html`;
      return p;
    }

    async function fix(xmlPath) {
      if (!xmlPath) return;
      const stream = route.get(xmlPath);
      if (!stream) return;
      const xml = await text(stream);

      const dropped = [];
      const moved = [];

      const out = xml.replace(/[ \t]*<url>[\s\S]*?<\/url>\n?/g, (block) => {
        const m = block.match(/<loc>([^<]+)<\/loc>/);
        if (!m) return block;
        const loc = m[1];
        const routePath = toRoutePath(loc);

        // sitemap 只该收页面。非 HTML 的产物（manifest.json、css、js）剔除。
        if (!routePath.endsWith('.html')) {
          dropped.push(`${loc}（不是页面）`);
          return '';
        }
        if (route.get(routePath)) return block;

        const underPage = `page/${routePath}`;
        if (route.get(underPage)) {
          moved.push(loc);
          return block.replace(loc, `${base}/page${loc.slice(base.length)}`);
        }

        dropped.push(`${loc}（无对应产物）`);
        return '';
      });

      if (!moved.length && !dropped.length) return;

      route.set(xmlPath, out);

      if (moved.length) {
        log.info(`[sitemap] ${xmlPath}：${moved.length} 条自定义页 URL 改写到 /page/ 前缀`);
      }
      if (dropped.length) {
        log.warn(`[sitemap] ${xmlPath}：剔除 ${dropped.length} 条无效 URL`);
        for (const d of dropped) log.warn(`  - ${d}`);
      }
    }

    const sitemapCfg = this.config.sitemap || {};
    const sitemapPaths = Array.isArray(sitemapCfg.path) ? sitemapCfg.path : [sitemapCfg.path || 'sitemap.xml'];
    await fix(sitemapPaths.find((p) => p.endsWith('.xml')));

    await fix((this.config.baidusitemap || {}).path);
  },
  PRIORITY
);
