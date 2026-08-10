'use strict';

const { text } = require('stream/consumers');
const fs = require('fs');
const path = require('path');

// hexo-generator-sitemap and hexo-generator-baidu-sitemap both explicitly drop
// any page whose source matches skip_render (see the former's lib/generator.js)
// — so the /cv/ résumé pages, which are skip_render'd to bypass Hexo's
// templating entirely, never make it into either sitemap. Patching the
// already-written routes after the fact is simpler and less fragile than
// duplicating those generators' own template logic.
hexo.extend.filter.register('after_generate', async function () {
  const base = hexo.config.url.replace(/\/+$/, '');
  const cvPages = ['', 'resume.html', 'deck.html'];

  function cvUrlEntries(withChangefreq) {
    return cvPages
      .map((file) => {
        const srcFile = path.join(hexo.source_dir, 'cv', file || 'index.html');
        const lastmod = fs.statSync(srcFile).mtime.toISOString().slice(0, 10);
        const extra = withChangefreq ? '\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>' : '';
        return `  <url>\n    <loc>${base}/cv/${file}</loc>\n    <lastmod>${lastmod}</lastmod>${extra}\n  </url>`;
      })
      .join('\n');
  }

  async function patch(xmlPath, withChangefreq) {
    if (!xmlPath) return;
    const stream = hexo.route.get(xmlPath);
    if (!stream) return;
    const xml = await text(stream);
    if (xml.includes('/cv/')) return; // already patched
    const entries = cvUrlEntries(withChangefreq);
    hexo.route.set(xmlPath, xml.replace('</urlset>', `${entries}\n</urlset>`));
  }

  const sitemapCfg = hexo.config.sitemap || {};
  const sitemapPaths = Array.isArray(sitemapCfg.path) ? sitemapCfg.path : [sitemapCfg.path || 'sitemap.xml'];
  await patch(sitemapPaths.find((p) => p.endsWith('.xml')), true);

  const baiduCfg = hexo.config.baidusitemap || {};
  await patch(baiduCfg.path, false);
});
