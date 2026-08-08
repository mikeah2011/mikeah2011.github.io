---
marp: true
html: true
title: "馬成軍 · 求職簡報"
size: 16:9
paginate: true
theme: default
class: invert
style: |
  section {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif;
    padding: 60px 72px;
  }
  :root {
    --bg: #0e171b; --surface: #16232a; --ink: #e6eef0;
    --muted: #8aa0a8; --accent: #46bfc9; --accent-dim: #46bfc933; --hairline: #24343b;
  }
  section { background: #0e171b; color: #e6eef0; }
  .eyebrow { font-weight: 700; letter-spacing: 0.26em; color: var(--accent); font-size: 0.45em; margin-bottom: 14px; }
  h1 { font-size: 1.7em; }
  h1 small { font-size: 0.5em; color: var(--muted); font-weight: 400; margin-left: 0.3em; }
  h2 { color: var(--accent); }
  strong { color: var(--accent); }
  a { color: var(--accent); }
  .role { margin-top: 0.3em; font-size: 0.6em; font-weight: 600; color: var(--accent); }
  .sub { font-size: 0.45em; color: var(--muted); margin-top: 0.3em; }
  .contact { margin-top: 0.55em; font-size: 0.4em; color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px 22px; list-style: none; padding: 0; }
  .contact span, .contact a { display: inline-flex; align-items: center; gap: 6px; }
  .contact a { color: inherit; text-decoration: none; }
  .contact svg { width: 15px; height: 15px; flex: none; }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 14px; list-style: none; padding: 0; }
  .tile { background: var(--surface); border: 1px solid var(--hairline); border-radius: 10px; padding: 18px 16px; }
  .tile .v { font-size: 1.5em; font-weight: 700; color: var(--accent); }
  .tile .k { margin-top: 6px; font-size: 0.5em; color: var(--muted); }
  .timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; font-size: 0.85em; }
  .timeline li { display: grid; grid-template-columns: 150px 1fr; gap: 16px; align-items: baseline; padding-left: 16px; border-left: 2px solid var(--hairline); position: relative; }
  .timeline li::before { content: ""; position: absolute; left: -6px; top: 0.5em; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
  .timeline .t { color: var(--muted); font-size: 0.75em; }
  .timeline .co { font-weight: 700; font-size: 0.85em; color: var(--ink); }
  .timeline .what { color: var(--muted); font-size: 0.75em; display: block; margin-top: 2px; }
  .timeline li.now { border-left-color: var(--accent); }
  .timeline li.now .co { color: var(--accent); }
  ul.points { margin: 0; padding-left: 1.1em; display: grid; gap: 12px; font-size: 0.85em; }
  ul.points strong { color: var(--accent); font-weight: 700; }
  .callout { margin-top: 18px; padding: 14px 20px; background: var(--accent-dim); border-left: 3px solid var(--accent); border-radius: 6px; font-size: 0.85em; }
  .ba { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 20px; list-style: none; padding: 0; }
  .ba .cell { background: var(--surface); border: 1px solid var(--hairline); border-radius: 10px; padding: 16px; }
  .ba .m { font-size: 0.5em; color: var(--muted); }
  .ba .val { margin-top: 6px; font-size: 0.85em; font-weight: 700; color: var(--ink); }
  .ba .val .from { color: var(--muted); font-weight: 400; text-decoration: line-through; margin-right: 8px; font-size: 0.75em; }
  .ba .val .to { color: var(--accent); }
  .skills { display: grid; grid-template-columns: 150px 1fr; gap: 10px 18px; font-size: 0.6em; margin: 0; }
  .skills dt { color: var(--accent); font-weight: 700; margin: 0; }
  .skills dd { margin: 0; color: var(--ink); }
  .links { display: grid; gap: 12px; margin-top: 14px; font-size: 0.6em; list-style: none; padding: 0; }
  .links a { color: var(--ink); text-decoration: none; background: var(--surface); border: 1px solid var(--hairline); border-radius: 10px; padding: 14px 18px; display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
  .links .lk { display: inline-flex; align-items: center; gap: 9px; color: var(--accent); font-weight: 700; }
  .links .lk svg { width: 19px; height: 19px; flex: none; }
  .links .lv { color: var(--muted); font-size: 0.85em; }
  table { font-size: 0.72em; }
  section::after { color: var(--muted); }
---

<!-- _paginate: false -->

<div class="eyebrow">求職簡報 · 2026</div>

# 馬成軍 <small>Michael Ma</small>

<div class="role">資深後端工程師</div>
<p class="sub">13 年研發經驗 · 高並發交易系統 · AI 工程化</p>

<div class="contact">
      <a href="mailto:mikeah2011@gmail.com" style="--brand:#EA4335"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>mikeah2011@gmail.com</a>
      <a href="tel:+8618801963698"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.2"/><path d="M10.5 18.5h3"/></svg>+86 188-0196-3698</a>
      <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21.5s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10.5" r="2.6"/></svg><span>上海</span></span>
      <a href="https://github.com/mikeah2011" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>github.com/mikeah2011</a>
    </div>

---

<div class="eyebrow">一頁看懂</div>

# 關鍵數字

<ul class="tiles">
      <li class="tile"><div class="v">13 年</div><div class="k">後端研發經驗（OTA / 電商 / MarTech）</div></li>
      <li class="tile"><div class="v">3000+</div><div class="k">KKday 核心儲存庫提交（兩庫首要貢獻者）</div></li>
      <li class="tile"><div class="v">10+</div><div class="k">全球聯盟通路串接（Google / Naver…）</div></li>
      <li class="tile"><div class="v">25s → 2s</div><div class="k">故障搶救後關鍵 API p99</div></li>
      <li class="tile"><div class="v">+50%</div><div class="k">CVR 提升目標（專案組組長）</div></li>
      <li class="tile"><div class="v">2 屆</div><div class="k">KKday 年度優秀員工（2023、2024）</div></li>
    </ul>

---

<div class="eyebrow">職涯軌跡</div>

# 13 年，四段進階

<ul class="timeline">
      <li><span class="t">2013 – 2017</span><span><span class="co">遠豐科技集團 · 全端開發</span><span class="what">多商戶 SaaS 電商（1 萬+ 商家）· IM 系統（日訊息 200 萬+）</span></span></li>
      <li><span class="t">2017 – 2022</span><span><span class="co">商派雲起 Shopex · Lead Developer</span><span class="what">Apple 中國經銷商平台（5 個月 GMV ¥100 億）· 金番茄獎</span></span></li>
      <li><span class="t">2022</span><span><span class="co">徑碩科技 JINGdigital · 資深後端</span><span class="what">MarTech/SCRM 微服務矩陣（10+ 服務）· 埋點追蹤主責</span></span></li>
      <li class="now"><span class="t">2022 – 至今</span><span><span class="co">KKday · 資深後端工程師</span><span class="what">聯盟行銷平台負責人 → B2C 交易鏈路 → CVR 專案組組長</span></span></li>
    </ul>

---

<div class="eyebrow">KKday · 2022.11 – 2025.03</div>

# 聯盟行銷平台負責人

<ul class="points">
      <li>兩大核心服務<strong>首要貢獻者</strong>：affiliate-service <span>2117</span> 次提交（占 <span>56%</span>）+ affiliate-api <span>1077</span> 次，擔任 Code Owner</li>
      <li><strong>Google 官方通路</strong>：Things To Do 商品 Feeds、POI Ranking、Transit 歐鐵路線同步</li>
      <li>串接 ShopBack、美安、亞洲萬里通、Naver Shopping 等 <span>10+</span> 異業通路</li>
      <li>自研<strong>分潤結算系統</strong>：規則引擎 + 月度結算重跑 + BigQuery 歸因</li>
    </ul>

<div class="callout">聯盟業務年增長 <strong>200%</strong>，API 延遲降低 <strong>65%</strong>（120ms → 35ms）</div>

---

<div class="eyebrow">KKday · 2025.02 – 至今</div>

# B2C 核心交易鏈路

<ul class="points">
      <li><strong>USJ 訂單改期</strong>：跨 4 服務改造、主筆 <span>7</span> 份 SA/SD，「權益繼承、條件重審」決策表四方一次對齊，確保 TOP 供應商續約</li>
      <li><strong>GYG B2B 動態變價</strong>：商品列表 → 訂單全鏈路動價，低版本 App 保護機制</li>
      <li><strong>訂購頁改版</strong>：多規格×多旅客映射透傳，上線 <span>0</span> P0/P1 流出</li>
      <li><strong>商品架構升級</strong>：方案分組、組合商品、月曆下放，治理 <span>15+</span> 跨端差異情境</li>
    </ul>

---

<div class="eyebrow">穩定性案例</div>

# 大規模故障搶救 · 主要搶救窗口

<ul class="points">
      <li><strong>根因定位</strong>：微服務相依拖垮 PHP-FPM worker 池，App 當機 15 分鐘</li>
      <li><strong>7 天完成 P0+P1 強化</strong>：逾時優化 · 例外兜底 · Redis 輕量熔斷器 · 雙層 Kill Switch</li>
    </ul>

<ul class="ba">
      <li class="cell"><div class="m">cart/validate p99</div><div class="val"><span class="from">25s+</span><span class="to">&lt; 2s</span></div></li>
      <li class="cell"><div class="m">5xx 錯誤率</div><div class="val"><span class="from">0.05%</span><span class="to">&lt; 0.01%</span></div></li>
      <li class="cell"><div class="m">iOS 下單白屏</div><div class="val"><span class="from">高頻</span><span class="to">根治</span></div></li>
    </ul>

---

<div class="eyebrow">管理與領導力</div>

# 售前 CVR 增轉專案組 · 組長

<ul class="points">
      <li>帶領 <strong>6 人跨端小組</strong>（iOS / Android / Web / BE），直接向 PM 負責、承擔小組共責</li>
      <li>北極星指標：<strong>CVR 1.2% → 1.8%（+50%）</strong>，等同營收結構性增長</li>
      <li>機制建設：站立會議 · 1on1 · OKR 對齊 · 團隊章程</li>
      <li>統籌售前鏈路：商品頁 → 購物車 → 訂購頁 全端體驗與效能優化</li>
    </ul>

---

<div class="eyebrow">AI 工程化 · 自主專案</div>

# 把 AI 落進研發流程

<ul class="points">
      <li><strong>VM Health Center</strong>（TypeScript + Slack Bolt + Elasticsearch，獨立開發）：團隊作戰看板 + 服務健康告警 + <strong>AI 根因分析</strong>，自動彙整 Jira / GitHub / Confluence 日報週報</li>
      <li><strong>Maestro</strong>（TypeScript CLI）：編排 CodeRabbit / Copilot / Codex / Gemini 等<strong>多 AI 審查機器人的收斂層</strong>——分類 · 三層去重 · 自動修復 · 收斂監控</li>
      <li><strong>Claude API 應用</strong>：8 語系 SEO slug 自動產生（hash 變更偵測控管費用）、Git 工作流 AI 審查自動化</li>
    </ul>

---

<div class="eyebrow">技能矩陣</div>

# 核心技能

<dl class="skills">
      <dt>語言</dt><dd>PHP（精通，8 年+）、TypeScript / Node.js、Go、Shell</dd>
      <dt>框架</dt><dd>Laravel / Hyperf / ThinkPHP、Gin / go-zero、Vue</dd>
      <dt>資料 & 中介軟體</dt><dd>MySQL、PostgreSQL、Redis、Elasticsearch、BigQuery、RabbitMQ、Kafka</dd>
      <dt>雲原生</dt><dd>Docker、Kubernetes、AWS / GCP Serverless、GitHub Actions、Grafana</dd>
      <dt>架構</dt><dd>微服務、BFF、事件驅動、熔斷限流與高可用設計</dd>
      <dt>AI & 工程</dt><dd>Claude API / Copilot SDK、AI Agent 工作流編排、AI 輔助研發流程</dd>
    </dl>

---

<!-- _paginate: false -->

<div class="eyebrow">謝謝</div>

# 期待與你聊聊

<div class="links">
      <a href="https://mikeah2011.github.io/cv/" target="_blank" rel="noopener">
        <span class="lk"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h4.5"/></svg>完整履歷 · 線上閱讀與下載</span>
        <span class="lv">mikeah2011.github.io/cv — HTML / PDF / PPTX / Markdown</span></a>
      <a href="https://github.com/mikeah2011" target="_blank" rel="noopener">
        <span class="lk"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>GitHub</span>
        <span class="lv">github.com/mikeah2011</span></a>
      <a href="https://mikeah2011.github.io" target="_blank" rel="noopener" style="--brand:#e08a2e">
        <span class="lk"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.5 3.5A1.5 1.5 0 0 0 3 5v14a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 19V5a1.5 1.5 0 0 0-1.5-1.5h-15zM7 7.5h10v2H7v-2zm0 4h10v2H7v-2zm0 4h6.5v2H7v-2z"/></svg>技術部落格</span>
        <span class="lv">mikeah2011.github.io</span></a>
      <a href="mailto:mikeah2011@gmail.com" style="--brand:#EA4335">
        <span class="lk"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>郵箱</span>
        <span class="lv">mikeah2011@gmail.com · +86 188-0196-3698</span></a>
    </div>
