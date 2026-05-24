/**
 * Postinstall patch: fix hexo-plugin-aurora issues.
 * 1. Add 'Categories' to defaultPages (fixes /categories 404)
 * 2. Change featureCapacity from 3 to 5 (more featured posts)
 */
const fs = require('fs');
const path = require('path');

// Patch 1: Categories in defaultPages
const indexFile = path.join(__dirname, 'node_modules/hexo-plugin-aurora/lib/generators/index.js');
if (fs.existsSync(indexFile)) {
  let content = fs.readFileSync(indexFile, 'utf8');
  const needle = "const defaultPages = ['Tags', 'Archives', 'Links']";
  if (content.includes(needle)) {
    content = content.replace(needle, "const defaultPages = ['Tags', 'Archives', 'Links', 'Categories']");
    fs.writeFileSync(indexFile, content, 'utf8');
    console.log('Patched: added Categories to aurora-page defaultPages');
  }
}

// Patch 2: featureCapacity 3 → 5
const postFile = path.join(__dirname, 'node_modules/hexo-plugin-aurora/lib/generators/post.js');
if (fs.existsSync(postFile)) {
  let content = fs.readFileSync(postFile, 'utf8');
  if (content.includes('featureCapacity = 3;')) {
    content = content.replace('featureCapacity = 3;', 'featureCapacity = 5;');
    fs.writeFileSync(postFile, content, 'utf8');
    console.log('Patched: featureCapacity 3 → 5');
  }
}
