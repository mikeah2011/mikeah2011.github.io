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

// Patch 3: Add Categories to theme JS menu
const themeJsDir = path.join(ROOT, 'node_modules/hexo-theme-aurora/source/static/js');
if (fs.existsSync(themeJsDir)) {
  const jsFiles = fs.readdirSync(themeJsDir).filter(f => f.endsWith('.js'));
  for (const jsFile of jsFiles) {
    const jsPath = path.join(themeJsDir, jsFile);
    let content = fs.readFileSync(jsPath, 'utf8');
    const linkStr = 'Links:{name:"Links",path:"/links",i18n:{"zh-CN":"友情链接","zh-TW":"友情鏈接",en:"Friend Links"}}';
    const catStr = 'Categories:{name:"Categories",path:"/category",i18n:{"zh-CN":"分类","zh-TW":"分類",en:"Categories"}}';
    if (content.includes(linkStr) && !content.includes(catStr)) {
      // If already has Categories with /categories path, replace it
      const oldCatStr = 'Categories:{name:"Categories",path:"/categories",i18n:{"zh-CN":"分类","zh-TW":"分類",en:"Categories"}}';
      if (content.includes(oldCatStr)) {
        content = content.replace(oldCatStr, catStr);
      } else {
        content = content.replace(linkStr, linkStr + ',' + catStr);
      }
      fs.writeFileSync(jsPath, content, 'utf8');
      console.log('Patched: added/fixed Categories menu in ' + jsFile);
    } else if (content.includes(catStr)) {
      console.log('Skip Patch 3 (' + jsFile + '): already patched');
    }
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
