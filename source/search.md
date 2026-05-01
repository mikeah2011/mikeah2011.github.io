---
title: Search
date: 2026-05-01 00:00:00
layout: page
---

<link href="/pagefind/pagefind-ui.css" rel="stylesheet">
<script src="/pagefind/pagefind-ui.js"></script>

<div id="search"></div>

<script>
  window.addEventListener('DOMContentLoaded', () => {
    new PagefindUI({
      element: '#search',
      showSubResults: true,
      showImages: false,
      autofocus: true,
      resetStyles: false,
      translations: {
        placeholder: '搜索文章...',
        clear_search: '清除',
        load_more: '加载更多结果',
        search_label: '搜索本站',
        filters_label: '过滤',
        zero_results: '没有找到 [SEARCH_TERM] 的结果',
        many_results: '找到 [COUNT] 条 [SEARCH_TERM] 的结果',
        one_result: '找到 [COUNT] 条 [SEARCH_TERM] 的结果',
        alt_search: '没有找到 [SEARCH_TERM] 的结果，显示 [DIFFERENT_TERM] 的结果',
        search_suggestion: '没有找到 [SEARCH_TERM] 的结果，建议搜索：',
        searching: '正在搜索 [SEARCH_TERM]...'
      }
    });
  });
</script>

<style>
  /* Pagefind UI 适配 butterfly 暗色主题 */
  #search { margin-top: 1rem; }
  .pagefind-ui {
    --pagefind-ui-primary: #0070f3;
    --pagefind-ui-text: var(--font-color);
    --pagefind-ui-background: var(--card-bg);
    --pagefind-ui-border: var(--scrollbar-color);
    --pagefind-ui-tag: var(--btn-bg);
    --pagefind-ui-border-width: 1px;
    --pagefind-ui-border-radius: 8px;
    --pagefind-ui-image-border-radius: 6px;
    --pagefind-ui-image-box-ratio: 3 / 2;
    --pagefind-ui-font: 'Inter', -apple-system, sans-serif;
  }
  .pagefind-ui__form { font-size: 1rem; }
  .pagefind-ui__result { padding: 1rem 0; }
  .pagefind-ui__result-title a { color: var(--theme-color); }
</style>
