# 馬成軍（Michael Ma）

**資深後端工程師 / 技術負責人 · 13 年研發經驗 · 高並發交易系統 · AI 工程化**

📧 mikeah2011@gmail.com ｜ 📱 +86 188-0196-3698 ｜ 📍 上海
🔗 GitHub: [github.com/mikeah2011](https://github.com/mikeah2011) ｜ 領英: [linkedin.com/in/michael-ma-923223116](https://www.linkedin.com/in/michael-ma-923223116/) ｜ 技術部落格: [mikeah2011.github.io](https://mikeah2011.github.io)

---

## 個人簡介

13 年後端研發經驗，專注**高並發電商交易系統**與**分散式架構**。正因為搶救過大規模線上故障、長期維護核心交易鏈路，更清楚不可靠的輸出流進生產會造成什麼後果——近一年將重心延伸至 **AI 工程化**，先建的是收斂層與控費機制，而不是又一個生成器。

**13 年** — 後端研發 · OTA / 電商 / MarTech  
**¥100 億** — Apple 中國經銷商平台上線 5 個月 GMV  
**25s → 2s** — 大型促銷故障搶救後關鍵 API p99  
**200%** — KKday 聯盟業務年增長  
**Review −50%** — Maestro 收斂 4 個 AI 審查機器人，300+ PR  
**20+ 人** — 自研 AI 平台跨 7 個團隊日常使用

- **AI 工程化**：自研多 AI 審查機器人收斂層（Maestro）與 AI 根因分析監控平台（VM Health Center），解決多來源 AI 輸出重複、不可靠、無法收斂的工程問題
- **交易系統縱深**：以首要貢獻者身分主導 KKday 聯盟行銷平台（業務年增長 200%），並負責 B2C 主幹線核心交易鏈路
- **穩定性與團隊**：主導大規模故障搶救（關鍵 API p99 25s+ → <2s，5xx 穩定 <0.01%）；現兼任售前 CVR 增轉專案組組長，帶領 6 人跨端小組

---

## AI 工程化實踐

- **Maestro**（TypeScript CLI）——**多 AI 審查機器人收斂層**：編排 CodeRabbit / Copilot / Codex / Gemini 4 個機器人，經問題分類 → 三層去重 → 自動修復 → 回覆並解決討論串 → 收斂監控與人工升級判斷，將發散的 AI 意見收斂成可執行的修改佇列；**已成為團隊日常流程**：10 人使用、累計走過 300+ 個 PR，Code Review 耗時**減半**、誤報率下降 70%
- **VM Health Center**（TypeScript / Node.js + Slack Bolt + Elasticsearch，從 0 到 1 獨立開發）——團隊作戰看板 + 服務健康監控：彙整 Jira / GitHub / Confluence 自動產生日報週報、訂購漏斗與後端服務健康告警、AI 初步根因分析；**跨 7 個團隊（Product / Web / App / QA / Order / B2C 等）20+ 人日常使用**，每日觸發告警，故障定位時間縮短 40%
- **Claude API 生產化落地**：8 語系 SEO slug 自動產生，已涵蓋近 3000 個商品頁、累計約 5 萬次呼叫，以 hash 變更偵測跳過未變更內容持續控費；Git 工作流 + AI 程式碼審查自動化，支援 CLI / Webhook / GitHub Actions 多形態部署
- **單一來源多產出內容流水線**（本履歷網站）：一份內容來源自動匯出三語 × 深淺色 × HTML / PDF / PPTX / Markdown 共 20+ 份產物；針對 Marp CLI 渲染不穩定（SVG 圖示隨機降級為字面文字）設計匯出後驗證與自動重試

---

## 核心技能

| 領域 | 技能 |
|------|------|
| AI 工程 | Claude API / Copilot SDK 應用開發、多 AI Agent 編排與收斂、AI 輔助研發流程建置 |
| 語言與框架 | PHP（精通，8 年+）、TypeScript / Node.js、Go、Python（可讀）；Laravel / Hyperf、Gin / go-zero、Vue |
| 資料與中介軟體 | MySQL、PostgreSQL、Redis、Elasticsearch、Google BigQuery、RabbitMQ、Kafka |
| 雲原生與維運 | Docker、Kubernetes、AWS Lambda / GCP Cloud Run、GitHub Actions、Prometheus / Grafana / Kibana |
| 架構與業務 | 微服務與 BFF 分層、RabbitMQ 事件驅動、Redis 熔斷器與雙層 Kill Switch、多級快取與 Cache Key 治理；聯盟分潤結算、訂單交易鏈路、動態定價 |

---

## 工作經歷

### KKday（酷遊天國際旅行社） — 資深後端工程師
**2022.11 – 至今 ｜ 上海**

全球領先的旅遊體驗預訂平台（涵蓋 50+ 國家/地區）。近四年歷任聯盟行銷平台負責人、B2C 主幹線核心後端，現兼任售前 CVR 增轉專案組組長。

**① 售前 CVR 增轉專案組 · 組長（2026 H2 – 至今）**
- 組建並帶領 **6 人跨端小組**（iOS / Android / Web / BE），以「CVR 1.2% → 1.8%（+50%）」為唯一北極星指標，直接向 PM 負責；建立站立會議、1on1、OKR 對齊機制，統籌售前鏈路（商品頁 → 購物車 → 訂購頁）全端體驗與效能優化

**② B2C 核心交易鏈路（2025.02 – 至今）**
- **USJ（大阪環球影城）訂單改期**：跨 B2C/Order/MKT/Member 四大服務改造，主筆 7 份 SA/SD；提出「權益繼承、條件重審」原則，將散亂的優惠券／點數重驗規則整理為可稽核決策表，四方一次對齊通過；重構金額試算器與訂單狀態機，確保公司 TOP 級票券供應商續約
- **大規模故障搶救（主要搶救窗口）**：定位微服務相依拖垮 PHP-FPM worker 池的根因，7 天內完成 P0+P1 強化（逾時優化、例外兜底、Redis 輕量熔斷器、雙層 Feature Flag / Kill Switch）——cart/validate API p99 由 25s+ 降至 <2s，根治 iOS 下單白屏，此後 5xx 錯誤率連續多週 <0.01%
- **票券／Tour 商品架構升級**：主導方案分組、組合商品、OpenDate 月曆下放等專案，獨立完成 SA/SD → Mock → API → 單元測試 → 文件全流程；建立「BFF 層版本相容 + App 漸進升級」標準解法，修復 15+ 跨端差異情境

**③ 聯盟行銷平台 · 平台負責人（2022.11 – 2025.03）**
- 以首要貢獻者身分主導 affiliate-service（占 56% 提交）與 affiliate-api 兩大核心服務，擔任 Code Owner 與 PR 把關；串接 Google Things To Do 官方通路及 ShopBack、亞洲萬里通、Naver Shopping 等 10+ 異業通路，推動聯盟業務年增長 200%
- 設計**分潤結算系統**：分潤規則引擎、月度結算與重跑能力、BigQuery 資料歸因；以 RabbitMQ 事件驅動打通訂單／商品資料流
- 效能與可觀測性：多級快取與統一 Cache Key 管理、慢查詢治理、聯盟訂單監控與 Slack 圖文日報，API 延遲降低 65%（120ms → 35ms）

---

### 徑碩科技（JINGdigital） — 資深後端工程師
**2021.03 – 2022.10 ｜ 上海**

B2B MarTech/SCRM 行銷自動化 SaaS 廠商。負責行銷自動化微服務矩陣的後端研發（Laravel/Yii2/YAF，10+ 服務）。

- 主責 **JS 埋點追蹤服務**（jstracking）：全通路行為蒐集與內容行銷歸因，行銷自動化核心資料來源
- 主力參與 **JINGsocial 主系統**前後端分離改造（v2）與舊架構維護（合計 300+ 次提交），並橫向涵蓋 EDM、簡訊閘道、問卷、名單開發、企業微信等 8+ 微服務的迭代與穩定性

---

### 商派雲起軟體（Shopex） — 技術專家 / Lead Developer
**2017.12 – 2021.03 ｜ 上海**

國內頭部電商 SaaS 服務商。主導 Apple 中國經銷商平台交付與高並發效能優化。

- 交付 **Apple 中國經銷商平台**（上線 5 個月 GMV 超 ¥100 億）：串接順豐、寶尊 OMS 等 15+ 支付／物流系統，OMS/WMS 操作自動化率 98%，服務 3500+ 零售門市、25 萬+ DAU
- 高效能優惠券系統獲公司**金番茄獎**；H5 介面吞吐量提升 17.5 倍（200 → 3500 TPS），壓測調校（NGINX 快取 + TSung）達 12K TPS
- 以 go-zero 建構簡訊閘道服務（日發送量 100 萬+）；資料匯出從 OOM 失敗優化至 1000 萬列 / 10 分鐘

---

### 遠豐科技集團 — 全端開發工程師
**2013.06 – 2017.12 ｜ 上海**

- 開發多商戶 SaaS 電商平台（支撐 1 萬+ 商家），支援 10 國語言（Google／有道翻譯 API 混合流程，翻譯成本降低 70%）
- 以網易雲信建構 IM 系統（日訊息量 200 萬+）；設計 Redis 快取層，資料庫負載降低 60%

---

## 開源與個人專案

- **SwaggerNotes**（PHP/Laravel 擴充套件，100% 獨立開發）：自動產生 Swagger 註解並輸出 OpenAPI 介面檔；已發布至 Packagist，累計下載 2.6k+
- **knuckleswtf/scribe**（2.3k ⭐ Laravel API 文件產生器）：2 個 PR 已合併進主線，列名於官方貢獻者
- **技術部落格**：1300+ 篇技術文章，涵蓋 PHP／架構／資料庫／AI 工程，至今仍在更新

---

## 榮譽獎項

KKday 年度優秀員工（2023、2024 連續兩屆）· Shopex 金番茄獎（2020）· 遠豐科技「技術之星」（2016、2018）
