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
  /* Pagefind UI sits inside landscape's article column — give it room */
  #search { margin-top: 1rem; }
  .pagefind-ui__form { font-size: 1rem; }
</style>
