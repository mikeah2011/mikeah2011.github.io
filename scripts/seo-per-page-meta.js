'use strict';

const { text } = require('stream/consumers');

/*
 * 给每个页面写入属于它自己的 <title> / description / canonical / og / twitter。
 *
 * Aurora 是 SPA，所有路由共用 layout/index.ejs 一个静态外壳，而那个外壳里的
 * meta 是写死的站点级默认值（见 postinstall-patch-aurora.js 的 Patch 8）。后果是
 * 全站 8000+ 个 HTML 只有两种 canonical、两种 og:title —— 1317 篇文章统统声明
 *
 *     <link rel="canonical" href="https://mikeah2011.github.io">
 *
 * canonical 的语义是「这个页面的权威地址是 X」。把 1317 篇文章的权威地址都指向
 * 首页，等于告诉搜索引擎它们全是首页的副本，正常结果是文章 URL 被合并掉、只留
 * 首页。tag / category 列表页同理。
 *
 * 外壳里还完全没有 <title> 标签 —— 标题是 Vue 挂载后在客户端设的。不执行 JS 的
 * 抓取器（社交平台的预览爬虫、部分搜索引擎的初次抓取）看到的是无标题页面。
 *
 * 为什么放在这里而不是去改主题模板：模板改动落在 node_modules 里，不进版本库、
 * 没法 review、也没人看得见。这个仓库刚因为一个藏在 node_modules 补丁里的 bug
 * 让全站文章白屏很久（见 Patch 10 的注释），所以逻辑一律留在仓库内。
 *
 * 时机：hexo-yam 的 HTML 压缩挂在 after_render:html，早于 after_generate，所以这里
 * 拿到的已经是压缩后的 HTML，替换按压缩形态匹配（属性之间没有多余空格）。
 */

const PRIORITY = 15;
const DESC_MAX = 155;

hexo.extend.filter.register(
  'after_generate',
  async function () {
    const hexo = this;
    const base = hexo.config.url.replace(/\/+$/, '');
    const siteTitle = hexo.config.title || '';
    const locals = hexo.locals.toObject();

    // ---- 工具 ----------------------------------------------------------

    // 页面的 path 与路由键的形态不一致（前者可能带前导斜杠、不带 index.html），
    // 统一成 hexo.route 用的键。
    function routeKey(p) {
      const s = String(p == null ? '' : p).replace(/^\/+/, '').replace(/\/+$/, '');
      if (s === '') return 'index.html';
      return s.endsWith('.html') ? s : `${s}/index.html`;
    }

    function absUrl(routePath) {
      const rel = routePath.replace(/index\.html$/, '');
      // 中文 tag / category 的路由键是未编码的，canonical 必须给编码后的形式
      return base + '/' + encodeURI(rel);
    }

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function toDesc(page) {
      const pick = [page.description, page.excerpt, (page.content || '').slice(0, 4000)];
      for (const raw of pick) {
        if (!raw) continue;
        const plain = String(raw)
          .replace(/<[^>]*>/g, ' ')
          .replace(/&[a-z]+;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (plain) {
          return plain.length > DESC_MAX ? plain.slice(0, DESC_MAX).trimEnd() + '…' : plain;
        }
      }
      return hexo.config.description || '';
    }

    // ---- 建立「路由键 → 该页的 meta」的映射 ------------------------------

    const meta = new Map();
    function add(pathish, entry) {
      const key = routeKey(pathish);
      if (!meta.has(key)) meta.set(key, entry);
    }

    for (const post of locals.posts.toArray()) {
      add(post.path, {
        title: post.title,
        desc: toDesc(post),
        type: 'article',
        image: post.cover || (Array.isArray(post.photos) && post.photos[0]) || null,
        published: post.date && post.date.toISOString ? post.date.toISOString() : null,
        modified: post.updated && post.updated.toISOString ? post.updated.toISOString() : null
      });
    }

    for (const tag of locals.tags.toArray()) {
      if (!tag.length) continue;
      add(tag.path, { title: `标签：${tag.name}`, desc: `${siteTitle} 中标记为「${tag.name}」的全部文章，共 ${tag.length} 篇。` });
    }

    for (const cat of locals.categories.toArray()) {
      if (!cat.length) continue;
      add(cat.path, { title: `分类：${cat.name}`, desc: `${siteTitle} 中「${cat.name}」分类下的全部文章，共 ${cat.length} 篇。` });
    }

    // 自定义页：Aurora 把 type 不是 about 的页面发布到 /page/ 下，两个键都登记，
    // 命中哪个算哪个（见 sitemap-page-paths.js 里的同一个成因）。
    for (const page of locals.pages.toArray()) {
      if (!page.title) continue;
      const entry = { title: page.title, desc: toDesc(page) };
      add(page.path, entry);
      add(`page/${String(page.path || '').replace(/^\/+/, '')}`, entry);
    }

    // ---- 改写 ----------------------------------------------------------

    // 每条 meta 都是「有就替换、没有就不动」，避免在 head 里造出重复标签。
    function replaceTag(html, pattern, replacement) {
      return pattern.test(html) ? html.replace(pattern, replacement) : html;
    }

    let touched = 0;
    let canonicalOnly = 0;

    for (const routePath of hexo.route.list()) {
      if (!routePath.endsWith('.html')) continue;

      const stream = hexo.route.get(routePath);
      if (!stream) continue;
      let html = await text(stream);
      if (!html.includes('<head>')) continue;

      const self = absUrl(routePath);
      const entry = meta.get(routePath);

      // canonical 与 og:url 一律指向自己 —— 这是所有页面都该做的
      html = replaceTag(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(self)}">`);
      html = replaceTag(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(self)}">`);

      if (entry) {
        const full = entry.title ? `${entry.title} | ${siteTitle}` : siteTitle;

        if (!/<title[ >]/.test(html)) {
          html = html.replace('<head>', `<head><title>${esc(full)}</title>`);
        }
        html = replaceTag(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(entry.desc)}">`);
        html = replaceTag(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(full)}">`);
        html = replaceTag(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(entry.desc)}">`);
        html = replaceTag(html, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(full)}">`);
        html = replaceTag(html, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(entry.desc)}">`);

        if (entry.type) {
          html = replaceTag(html, /<meta property="og:type" content="[^"]*">/, `<meta property="og:type" content="${esc(entry.type)}">`);
        }
        if (entry.image) {
          html = replaceTag(html, /<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(entry.image)}">`);
        }
        if (entry.published) {
          html = html.replace('</head>', `<meta property="article:published_time" content="${esc(entry.published)}">` +
            (entry.modified ? `<meta property="article:modified_time" content="${esc(entry.modified)}">` : '') + '</head>');
        }
        touched++;
      } else {
        // 分页页、聚合页入口等映射不到具体内容的路由，至少让 canonical 自指，
        // 而不是继续把权威地址交给首页。
        if (!/<title[ >]/.test(html)) {
          html = html.replace('<head>', `<head><title>${esc(siteTitle)}</title>`);
        }
        canonicalOnly++;
      }

      hexo.route.set(routePath, html);
    }

    hexo.log.info(`[seo] 写入独立 meta ${touched} 个页面，另有 ${canonicalOnly} 个仅修正 canonical`);
  },
  PRIORITY
);
