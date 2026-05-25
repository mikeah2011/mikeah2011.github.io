/**
 * Postinstall patch: fix hexo-plugin-aurora issues.
 * 1. Add 'Categories' to defaultPages (fixes /categories 404)
 * 2. Change featureCapacity from 3 to 5 (more featured posts)
 * 3. Strip directory prefix from slug (fixes %2F encoding in URLs)
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

// Patch 2: featureCapacity 3 → 5
const postFile = path.join(ROOT, 'node_modules/hexo-plugin-aurora/lib/generators/post.js');
if (fs.existsSync(postFile)) {
  let content = fs.readFileSync(postFile, 'utf8');
  if (content.includes('featureCapacity = 3;')) {
    content = content.replace('featureCapacity = 3;', 'featureCapacity = 5;');
    fs.writeFileSync(postFile, content, 'utf8');
    console.log('Patched: featureCapacity 3 → 5');
  } else {
    console.log('Skip Patch 2: already patched');
  }
}

// Patch 3: Strip directory prefix from slug (fix %2F in URLs)
const mapperFile = path.join(ROOT, 'node_modules/hexo-plugin-aurora/lib/helpers/mapper.js');
if (fs.existsSync(mapperFile)) {
  let content = fs.readFileSync(mapperFile, 'utf8');

  if (content.includes('flatSlug')) {
    console.log('Skip Patch 3: already patched');
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
