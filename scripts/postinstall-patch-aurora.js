/**
 * Postinstall patch: fix hexo-plugin-aurora issues.
 * 1. Add 'Categories' to defaultPages (fixes /categories 404)
 * 2. Strip directory prefix from slug (fixes %2F encoding in URLs)
 * 3. Add Categories to theme JS menu (fixes missing nav item)
 * 4. Fix SiteGenerator early return (fixes build crash)
 */
const fs = require('fs');
const path = require('path');

// __dirname = scripts/, need project root = __dirname/..
const ROOT = path.resolve(__dirname, '..');

// Patch 1: Categories in defaultPages
const indexFile = path.join(ROOT, 'node_modules/hexo-plugin-aurora/lib/generators/index.js');
if (fs.existsSync(indexFile)) {
  let content = fs.readFileSync(indexFile, 'utf8');
  const needle = "const defaultPages = ['Tags', 'Archives', 'Links']";
  if (content.includes(needle)) {
    content = content.replace(needle, "const defaultPages = ['Tags', 'Archives', 'Links', 'Categories']");
    fs.writeFileSync(indexFile, content, 'utf8');
    console.log('Patched: added Categories to aurora-page defaultPages');
  } else {
    console.log('Skip Patch 1: already patched');
  }
}

// Patch 3: Add Categories to theme JS menu (fixes missing nav item)
const themeJsDir = path.join(ROOT, 'node_modules/hexo-theme-aurora/source/static/js');
console.log('Patch 3: checking', themeJsDir, 'exists:', fs.existsSync(themeJsDir));
if (fs.existsSync(themeJsDir)) {
  const jsFiles = fs.readdirSync(themeJsDir).filter(f => f.endsWith('.js'));
  console.log('Patch 3: found', jsFiles.length, 'JS files');
  for (const jsFile of jsFiles) {
    const jsPath = path.join(themeJsDir, jsFile);
    let content = fs.readFileSync(jsPath, 'utf8');
    const linkStr = 'Links:{name:"Links",path:"/links",i18n:{"zh-CN":"友情链接","zh-TW":"友情鏈接",en:"Friend Links"}}';
    const catStr = 'Categories:{name:"Categories",path:"/categories",i18n:{"zh-CN":"分类","zh-TW":"分類",en:"Categories"}}';
    if (content.includes(linkStr) && !content.includes(catStr)) {
      content = content.replace(linkStr, linkStr + ',' + catStr);
      fs.writeFileSync(jsPath, content, 'utf8');
      console.log(`Patched: added Categories menu to ${jsFile}`);
    } else if (content.includes(catStr)) {
      console.log(`Skip Patch 3 (${jsFile}): already patched`);
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

// Patch 2: Strip directory prefix from slug (fix %2F in URLs)
const mapperFile = path.join(ROOT, 'node_modules/hexo-plugin-aurora/lib/helpers/mapper.js');
if (fs.existsSync(mapperFile)) {
  let content = fs.readFileSync(mapperFile, 'utf8');

  if (content.includes('flatSlug')) {
    console.log('Skip Patch 2: already patched');
  } else {
    const slugRegex = /const pathSlug\s*=\s*\n\s*configs\.theme_config\.site\.pathSlug\s*!==\s*undefined\s*\n\s*\?\s*configs\.theme_config\.site\.pathSlug\s*===\s*'uid'\s*\n\s*\?\s*uid\s*\n\s*:\s*post\.slug\s*\n\s*:\s*post\.slug;/;
    const newCode = `  const rawSlug = post.slug || '';\n  const flatSlug = rawSlug.includes('/') ? rawSlug.split('/').pop() : rawSlug;\n  const pathSlug =\n    configs.theme_config.site.pathSlug !== undefined\n      ? configs.theme_config.site.pathSlug === 'uid'\n        ? uid\n        : flatSlug\n      : flatSlug;`;

    if (slugRegex.test(content)) {
      content = content.replace(slugRegex, newCode);
      fs.writeFileSync(mapperFile, content, 'utf8');
      console.log('Patched: stripped directory prefix from slug in mapper');
    } else {
      console.log('ERROR: Could not find pathSlug pattern in mapper.js');
    }
  }
}
