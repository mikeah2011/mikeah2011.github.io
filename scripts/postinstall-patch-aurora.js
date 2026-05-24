/**
 * Postinstall patch: fix hexo-plugin-aurora missing Categories in defaultPages.
 * The aurora-page generator only generates Tags/Archives/Links at the root,
 * but not Categories — causing /categories to return 404.
 * This script adds 'Categories' to the defaultPages array.
 */
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'node_modules/hexo-plugin-aurora/lib/generators/index.js');

if (!fs.existsSync(target)) return;

let content = fs.readFileSync(target, 'utf8');
const needle = "const defaultPages = ['Tags', 'Archives', 'Links']";

if (content.includes(needle)) {
  content = content.replace(needle, "const defaultPages = ['Tags', 'Archives', 'Links', 'Categories']");
  fs.writeFileSync(target, content, 'utf8');
  console.log('Patched: added Categories to aurora-page defaultPages');
} else if (content.includes("'Categories'")) {
  // already patched
} else {
  console.warn('Warning: Could not find defaultPages pattern in aurora generators, patch skipped');
}
