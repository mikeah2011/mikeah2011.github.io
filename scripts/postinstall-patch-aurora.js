/**
 * Postinstall patch: fix hexo-plugin-aurora issues.
 * 1. Add 'Categories' to defaultPages (fixes /categories 404)
 * 2. Strip directory prefix from slug (fixes %2F encoding in URLs)
 * 3. Add Categories to theme JS menu (fixes missing nav item)
 * 4. Fix SiteGenerator early return (fixes build crash)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Patch 1: Categories in defaultPages + fix page path
const indexFile = path.join(ROOT, 'node_modules/hexo-plugin-aurora/lib/generators/index.js');
if (fs.existsSync(indexFile)) {
  let content = fs.readFileSync(indexFile, 'utf8');
  const needle = "const defaultPages = ['Tags', 'Archives', 'Links']";
  if (content.includes(needle)) {
    content = content.replace(needle, "const defaultPages = ['Tags', 'Archives', 'Links', 'Categories']");
    // Fix page path: use menu config path instead of hardcoded toLowerCase
    const pathNeedle = 'path: `${page.toLocaleLowerCase()}/index.html`,';
    const pathReplace = "path: `${(themeConfig.menu[page] && themeConfig.menu[page].path ? themeConfig.menu[page].path.replace(/^\\//, '') : page.toLocaleLowerCase())}/index.html`,";
    if (content.includes(pathNeedle)) {
      content = content.replace(pathNeedle, pathReplace);
    }
    fs.writeFileSync(indexFile, content, 'utf8');
    console.log('Patched: added Categories to aurora-page defaultPages + fixed path');
  } else {
    console.log('Skip Patch 1: already patched');
  }
}

// Patch 3: Reorder menu items + add all custom items as built-in
const themeJsDir = path.join(ROOT, 'node_modules/hexo-theme-aurora/source/static/js');
if (fs.existsSync(themeJsDir)) {
  const jsFiles = fs.readdirSync(themeJsDir).filter(f => f.endsWith('.js'));
  for (const jsFile of jsFiles) {
    const jsPath = path.join(themeJsDir, jsFile);
    let content = fs.readFileSync(jsPath, 'utf8');

    // Use regex to match the menu object regardless of minified variable names
    // The About item is always the anchor - it's the first key in the built-in menu
    const menuRegex = /const \w+=\{About:\{name:"About",path:"\/about",i18n:\{"zh-CN":"关于","zh-TW":"關於",en:"About"\}\},Archives:\{name:"Archives",path:"\/archives",i18n:\{"zh-CN":"归档","zh-TW":"歸檔",en:"Archives"\}\},Tags:\{name:"Tags",path:"\/tags",i18n:\{"zh-CN":"标签","zh-TW":"標簽",en:"Tags"\}\},Links:\{name:"Links",path:"\/links",i18n:\{"zh-CN":"友情链接","zh-TW":"友情鏈接",en:"Friend Links"\}\}\}/;

    const match = content.match(menuRegex);
    if (match) {
      const varName = match[0].match(/const (\w+)=/)[1];
      const newMenu = `const ${varName}={Categories:{name:"Categories",path:"/categories",i18n:{"zh-CN":"分类","zh-TW":"分類",en:"Categories"}},Tags:{name:"Tags",path:"/tags",i18n:{"zh-CN":"标签","zh-TW":"標簽",en:"Tags"}},Project:{name:"开源",path:null,i18n:{"zh-CN":"开源",en:"Projects"}},Archives:{name:"Archives",path:"/archives",i18n:{"zh-CN":"归档","zh-TW":"歸檔",en:"Archives"}},Contact:{name:"联系",path:"mailto:mikeah2011@gmail.com",i18n:{"zh-CN":"联系",en:"Contact"}},MessageBoard:{name:"留言板",path:"/page/message-board",i18n:{"cn":"留言板","zh-CN":"留言板",en:"Message Board"}},About:{name:"About",path:"/about",i18n:{"zh-CN":"关于","zh-TW":"關於",en:"About"}}}`;
      content = content.replace(menuRegex, newMenu);

      // Also patch Vue Router route: /category → /categories
      content = content.replace('name:"category",path:"/category"', 'name:"category",path:"/categories"');

      fs.writeFileSync(jsPath, content, 'utf8');
      console.log('Patched: reordered menu in ' + jsFile + ' (var=' + varName + ')');
    } else if (content.includes('Categories:{name:"Categories",path:"/categories"')) {
      // Already patched with /categories - but check if Vue Router also needs update
      if (content.includes('name:"category",path:"/category"')) {
        content = content.replace('name:"category",path:"/category"', 'name:"category",path:"/categories"');
        fs.writeFileSync(jsPath, content, 'utf8');
        console.log('Patched: Vue Router /category → /categories in ' + jsFile);
      } else {
        console.log('Skip Patch 3 (' + jsFile + '): already fully patched');
      }
    } else if (content.includes('Categories:{name:"Categories",path:"/category"')) {
      // Patched with old /category path - update path in both menu and router
      content = content.replace(/path:"\/category"/g, 'path:"/categories"');
      content = content.replace('name:"category",path:"/category"', 'name:"category",path:"/categories"');
      fs.writeFileSync(jsPath, content, 'utf8');
      console.log('Patched: updated /category → /categories in ' + jsFile);
    } else {
      console.log('Skip Patch 3 (' + jsFile + '): menu pattern not found');
    }
  }
}

// Patch 3b: Also patch the page generator to create /categories/index.html
// and add a redirect from /category to /categories
const generatorFile = path.join(ROOT, 'node_modules/hexo-plugin-aurora/lib/generators/index.js');
if (fs.existsSync(generatorFile)) {
  let genContent = fs.readFileSync(generatorFile, 'utf8');
  // The generator uses themeConfig.menu.Categories.path to create the page
  // We also need to create a redirect at the old /category path
  if (!genContent.includes('// PATCHED: redirect /category')) {
    const redirectCode = `
        // PATCHED: redirect /category → /categories
        pageData.push({
          path: 'category/index.html',
          data: {},
          layout: ['index']
        });
    `;
    // Insert after the defaultPages loop
    genContent = genContent.replace(
      "    site.pages.forEach(function (page) {",
      redirectCode + "\n    site.pages.forEach(function (page) {"
    );
    fs.writeFileSync(generatorFile, genContent, 'utf8');
    console.log('Patched: added /category redirect page in generator');
  } else {
    console.log('Skip Patch 3b: already patched');
  }
}

// Patch 4: Fix SiteGenerator early return in site.js
const siteFile = path.join(ROOT, 'node_modules/hexo-plugin-aurora/lib/generators/site.js');
if (fs.existsSync(siteFile)) {
  let content = fs.readFileSync(siteFile, 'utf8');
  // Remove `return;` after throwError so the class always exports
  content = content.replace(
    /throwError\(\s*\n?\s*'Aurora Plugin Error',\s*\n?\s*`[^`]+`\s*\n?\s*\);\s*\n?\s*return;/,
    "throwError(\n      'Aurora Plugin Error',\n      `Aurora Plugin fail to get current Aurora Theme version, please make sure you have the theme installed.`\n    );"
  );
  // Guard themePack.version access
  content = content.replace(
    'configs.theme_config.version = themePack.version;',
    'configs.theme_config.version = themePack ? themePack.version : "unknown";'
  );
  fs.writeFileSync(siteFile, content, 'utf8');
  console.log('Patched: fixed SiteGenerator in site.js');
}

// Patch 6: Fix baidusitemap double-slash issue (url + root + path = ///)
const baiduSitemapFile = path.join(ROOT, 'node_modules/hexo-generator-baidu-sitemap/baidusitemap.ejs');
if (fs.existsSync(baiduSitemapFile)) {
  const fixedEjs = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<%
  var baiduUrl = config.url
  if (config.baidusitemap.url) {
    baiduUrl = config.baidusitemap.url
  }
  var url = baiduUrl.replace(/\\/+$/, '') + '/';
  posts.forEach(function(post){
  if(post.categories){ -%>
  <url>
    <loc><%- encodeURI(url + post.path.replace(/^\\/+/, '')) %></loc>
    <lastmod><%= post.updated.toDate().toISOString().replace(/T.*$/i, "") || post.date.toDate().toISOString().replace(/T.*$/i, "") %></lastmod>
  </url>
<%}}) -%>
</urlset> -`;
  const current = fs.readFileSync(baiduSitemapFile, 'utf8');
  if (current.includes("replace(/\\\\/+$/,")) {
    console.log('Skip Patch 6: already patched');
  } else {
    fs.writeFileSync(baiduSitemapFile, fixedEjs, 'utf8');
    console.log('Patched: fixed baidusitemap double-slash');
  }
}

// Patch 5: Truncate search content to reduce search.json size (46MB → ~2MB)
const searchMapperFile = path.join(ROOT, 'node_modules/hexo-plugin-aurora/lib/helpers/mapper.js');
if (fs.existsSync(searchMapperFile)) {
  let content = fs.readFileSync(searchMapperFile, 'utf8');
  const searchNeedle = 'content: filterHTMLCharacters(post.content),';
  const searchReplace = 'content: filterHTMLCharacters(post.content).slice(0, 500),';
  if (content.includes(searchNeedle)) {
    content = content.replace(searchNeedle, searchReplace);
    fs.writeFileSync(searchMapperFile, content, 'utf8');
    console.log('Patched: truncated search content to 500 chars');
  } else if (content.includes(searchReplace)) {
    console.log('Skip Patch 5: already patched');
  }
}

// Patch 7: Fix html lang="en" → "zh-CN" in layout template
const layoutFile = path.join(ROOT, 'node_modules/hexo-theme-aurora/layout/index.ejs');
if (fs.existsSync(layoutFile)) {
  let content = fs.readFileSync(layoutFile, 'utf8');
  if (content.includes('lang="en"')) {
    content = content.replace('lang="en"', 'lang="zh-CN"');
    fs.writeFileSync(layoutFile, content, 'utf8');
    console.log('Patched: html lang="en" → "zh-CN"');
  } else {
    console.log('Skip Patch 7: already patched');
  }
}

// Patch 8: Add OG tags, canonical, and move google-site-verification to <head>
if (fs.existsSync(layoutFile)) {
  let content = fs.readFileSync(layoutFile, 'utf8');
  if (!content.includes('og:title')) {
    // Add OG tags + canonical right after <meta charset>
    const ogTags = '<meta property="og:type" content="website">' +
      '<meta property="og:site_name" content="Michael\'s Blog">' +
      '<meta property="og:title" content="Michael\'s Blog">' +
      '<meta property="og:description" content="Michael 的技术博客 — macOS 开发环境、PHP/Laravel 后端、Go/Rust 系统编程、AI Agent 工程化、K8s/DevOps 运维实践">' +
      '<meta property="og:url" content="https://mikeah2011.github.io">' +
      '<meta property="og:image" content="https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/blog_logo.jpeg">' +
      '<meta name="twitter:card" content="summary_large_image">' +
      '<meta name="twitter:title" content="Michael\'s Blog">' +
      '<meta name="twitter:description" content="Michael 的技术博客 — macOS 开发环境、PHP/Laravel 后端、Go/Rust 系统编程、AI Agent 工程化、K8s/DevOps 运维实践">' +
      '<link rel="canonical" href="https://mikeah2011.github.io">' +
      '<meta name="google-site-verification" content="xf2d-Tpmx9BSNsssXAIiFIuOhBsgj5xnTjvCIznHM-k">';
    content = content.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + ogTags);
    fs.writeFileSync(layoutFile, content, 'utf8');
    console.log('Patched: added OG tags, canonical, google-verification to <head>');
  } else {
    console.log('Skip Patch 8: already patched');
  }
}

// Patch 9: Cache-bust statistic.json to bypass CDN stale cache
if (fs.existsSync(themeJsDir)) {
  const jsFiles9 = fs.readdirSync(themeJsDir).filter(f => f.endsWith('.js'));
  for (const jsFile of jsFiles9) {
    const jsPath = path.join(themeJsDir, jsFile);
    let content = fs.readFileSync(jsPath, 'utf8');
    // Change: ft.get("/statistic.json") → ft.get("/statistic.json?v="+Date.now())
    if (content.includes('ft.get("/statistic.json")')) {
      content = content.replace(
        'ft.get("/statistic.json")',
        'ft.get("/statistic.json?v="+Date.now())'
      );
      fs.writeFileSync(jsPath, content, 'utf8');
      console.log('Patched: cache-bust statistic.json in ' + jsFile);
    } else if (content.includes('statistic.json?v=')) {
      console.log('Skip Patch 9 (' + jsFile + '): already patched');
    }
  }
}

// Patch 10: 撤销给主 bundle 加 ?v= 查询串的做法 —— 它会让整个 SPA 白屏。
//
// 原先这里往 layout 的入口 script 上加 ?v=Date.now() 来绕开 CDN 缓存。但主
// bundle 是 ES module，而另外 14 个 chunk 里都写着裸的相对导入：
//
//     from"./120aa8f8.js"
//
// ES module 以 URL 作为身份标识，带不带查询串算两个不同模块。于是浏览器会把
// 主 bundle 加载并执行两遍 —— 入口一份（带 ?v=），懒加载 chunk 再引一份（不带）。
// 两个 Vue/router 实例互相拆台，报 nextSibling / className 读到 null，#app 被
// 清空。首页不走懒加载 chunk 所以幸存，文章页必崩 —— 1317 篇全部打不开，而
// 构建和 HTTP 状态码全是正常的。
//
// 这个 cache-bust 本来就是多余的：120aa8f8.js 是 Vite 按内容哈希生成的文件名，
// 内容变了文件名就变，这本身就是 cache-busting。加查询串只会让每次构建的产物
// 都被当成新资源，反而彻底废掉浏览器缓存。
//
// 保留这段而不是直接删掉，是因为已经打过旧补丁的 node_modules 里 layout 仍带着
// ?v=，需要把它擦掉；全新 npm ci 的情况下这里是 no-op。
// 注意 Patch 9 的 statistic.json?v= 不受影响 —— 那是 fetch 一个 JSON，不是 ES
// module，不存在模块重复实例化的问题。
if (fs.existsSync(layoutFile)) {
  const content = fs.readFileSync(layoutFile, 'utf8');
  if (/120aa8f8\.js\?v=\d+/.test(content)) {
    fs.writeFileSync(layoutFile, content.replace(/(120aa8f8\.js)\?v=\d+/g, '$1'), 'utf8');
    console.log('Patched: removed JS bundle cache-bust query (双实例白屏的根因)');
  } else {
    console.log('Skip Patch 10: JS bundle cache-bust query not present');
  }
}

// Patch 2: Strip directory prefix from slug (fix %2F in URLs)
const mapperFile = path.join(ROOT, 'node_modules/hexo-plugin-aurora/lib/helpers/mapper.js');
if (fs.existsSync(mapperFile)) {
  let content = fs.readFileSync(mapperFile, 'utf8');
  if (content.includes('flatSlug')) {
    console.log('Skip Patch 2: already patched');
  } else {
    const slugRegex = /const pathSlug\s*=\s*\n\s*configs\.theme_config\.site\.pathSlug\s*!==\s*undefined\s*\n\s*\?\s*configs\.theme_config\.site\.pathSlug\s*===\s*'uid'\s*\n\s*\?\s*uid\s*\n\s*:\s*post\.slug\s*\n\s*:\s*post\.slug;/;
    const newCode = "  const rawSlug = post.slug || '';\n  const flatSlug = rawSlug.includes('/') ? rawSlug.split('/').pop() : rawSlug;\n  const pathSlug =\n    configs.theme_config.site.pathSlug !== undefined\n      ? configs.theme_config.site.pathSlug === 'uid'\n        ? uid\n        : flatSlug\n      : flatSlug;";
    if (slugRegex.test(content)) {
      content = content.replace(slugRegex, newCode);
      fs.writeFileSync(mapperFile, content, 'utf8');
      console.log('Patched: stripped directory prefix from slug in mapper');
    } else {
      console.log('ERROR: Could not find pathSlug pattern in mapper.js');
    }
  }
}
