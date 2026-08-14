# 馬成軍（Michael Ma）

**AI 工程師 / 資深後端工程師 · Claude API 與 Agent 編排 · 13 年工程經驗**

mikeah2011@gmail.com ｜ +86 188-0196-3698 ｜ 上海
GitHub: [github.com/mikeah2011](https://github.com/mikeah2011) ｜ 領英: [linkedin.com/in/michael-ma-923223116](https://www.linkedin.com/in/michael-ma-923223116/) ｜ 技術部落格: [mikeah2011.github.io](https://mikeah2011.github.io)

---

## 個人簡介

13 年高並發後端工程背景，近一年將重心延伸至 **AI 工程化**：先建的是收斂層與控費機制，而不是又一個生成器。正因為長期維護核心交易鏈路、搶救過大規模線上故障，更清楚不可靠的輸出流進生產會造成什麼後果——這也是我做 AI 工程時的第一原則。

**Review ~50%↓** — Maestro 收斂 4 個 AI 審查機器人，300+ PR  
**20+ 人** — 自研 AI 平台跨 7 個團隊日常使用  
**40%↓** — VM Health Center 故障定位時間縮短  
**13 年** — 後端工程經驗 · 高並發系統背景  
**¥100 億** — Apple 平台 5 個月 GMV（工程背景佐證）  
**25s → 2s** — 大型促銷故障搶救後關鍵 API p99

- **AI 工程化**：自研多 AI 審查機器人收斂層（Maestro）與 AI 輔助根因分析監控平台（VM Health Center），解決多來源 AI 輸出重複、不可靠、無法收斂的工程問題；Claude API 生產化落地涵蓋近 3000 個商品頁
- **工程基本功**：13 年高並發後端經驗（PHP / Go / Node.js），長期維護核心交易鏈路、主導大規模故障搶救，這讓我在把 AI 輸出送上生產前，比多數人更清楚「不可靠」的代價
- **交易系統縱深**：以首要貢獻者身分主導 KKday 聯盟行銷平台（業務年增長 200%），並負責 B2C 核心交易鏈路

---

## AI 工程化實踐

- **Maestro**（TypeScript CLI）——**多 AI 審查機器人收斂層**：編排 CodeRabbit / Copilot / Codex / Gemini 4 個機器人，經問題分類 → 三層去重 → 自動修復 → 回覆並解決討論串 → 收斂監控與人工升級判斷，將發散的 AI 意見收斂成可執行的修改佇列；**已成為團隊日常流程**：10 人使用、累計走過 300+ 個 PR；據團隊自評，Code Review 耗時明顯縮短、誤報率下降約 70%
- **VM Health Center**（TypeScript / Node.js + Slack Bolt + Elasticsearch，從 0 到 1 獨立開發）——團隊作戰看板 + 服務健康監控：彙整 Jira / GitHub / Confluence 自動產生日報週報、訂購漏斗與後端服務健康告警、AI 初步根因分析——規則比對日誌關鍵字篩出 1-2 條可疑鏈路，交由 LLM 輔助分析癥結；**跨 7 個團隊（Product / Web / App / QA / Order / B2C 等）20+ 人日常使用**，每日觸發告警，故障定位時間縮短 40%
- **Claude API 生產化落地**：8 語系 SEO slug 自動產生，已涵蓋近 3000 個商品頁、累計約 5 萬次呼叫，以 hash 變更偵測跳過未變更內容持續控費；Git 工作流 + AI 程式碼審查自動化，支援 CLI / Webhook / GitHub Actions 多形態部署
- **單一來源多產出內容流水線**（本履歷網站）：一份內容來源自動匯出三語 × 深淺色 × HTML / PDF / PPTX / Markdown 共 20+ 份產物；四個投遞版本以差異覆蓋疊加在同一份基底上，任何事實修正只改一處即可同步全部產物，避免多版本內容漂移

---

## 核心技能

| 領域 | 技能 |
|------|------|
| AI 工程 | Claude API / Copilot SDK 應用開發、多 AI Agent 編排與收斂、Prompt 設計與成本控制、AI 輔助研發流程建置 |
| 語言與框架 | TypeScript / Node.js、PHP（精通，8 年+）、Go（基礎）、Python（可讀）；Laravel / Hyperf、Vue |
| 資料與中介軟體 | Elasticsearch、Google BigQuery、MySQL、PostgreSQL、Redis、RabbitMQ、Kafka |
| 雲原生與維運 | Docker、Kubernetes、AWS Lambda / GCP Cloud Run、GitHub Actions、Prometheus / Grafana / Kibana |
| 架構與業務 | 微服務與 BFF 分層、事件驅動架構、Redis 熔斷器；聯盟分潤結算、訂單交易鏈路、動態定價 |

---

## 工作經歷

### KKday（酷遊天國際旅行社） — 資深後端工程師
**2022.11 – 2026.08 ｜ 上海**

全球領先的旅遊體驗預訂平台（涵蓋 50+ 國家/地區）。近四年歷任聯盟行銷平台負責人、B2C 主幹線核心後端，現兼任售前 CVR 增轉專案組負責人；Maestro、VM Health Center 等 AI 工程化專案均為自驅發起。

**1) 售前 CVR 增轉專案組 · 負責人（2026 H2）**
- 組建並帶領 6 人跨端小組，以「CVR 1.2% → 1.8%（+50%）」為唯一北極星指標，建置 CVR 健康監控看板，使優化成果可視化、可驗證

**2) B2C 核心交易鏈路（2025.02 – 2026.08）**
- **USJ（大阪環球影城）訂單改期**：跨 B2C / Order / MKT / Member 四大服務改造，主筆 7 份 SA/SD；提出「權益繼承、條件重審」原則，將散亂的優惠券／點數重驗規則整理為可稽核決策表
- **大規模故障搶救（主要搶救窗口）**：定位微服務相依拖垮 PHP-FPM worker 池的根因，7 天內完成 P0+P1 強化——cart/validate API p99 由 25s+ 降至 <2s，此後 5xx 錯誤率連續多週 <0.01%
- **票券／Tour 商品架構升級**：建立「BFF 層版本相容 + App 漸進升級」標準解法，修復 15+ 跨端差異情境

**3) 聯盟行銷平台 · 平台負責人（2022.11 – 2025.03）**
- 以首要貢獻者身分主導 affiliate-service（提交占比過半）與 affiliate-api 兩大核心服務；串接 Google Things To Do 等 10+ 異業通路，推動聯盟業務年增長 200%
- 設計**分潤結算系統**：分潤規則引擎、月度結算與重跑能力、BigQuery 資料歸因

---

### 商派雲起軟體（Shopex） — 技術專家 / Lead Developer
**2017.12 – 2022.10 ｜ 上海**

- **Apple 中國經銷商平台**（該平台上線 5 個月 GMV 超 ¥100 億）：本人主責預售、交易、支付回調、配送出貨核心鏈路；串接順豐、寶尊 OMS 等 15+ 支付／物流系統，服務 3500+ 零售門市、25 萬+ DAU
- 高效能優惠券系統獲公司**金番茄獎**；H5 介面吞吐量提升 17.5 倍（200 → 3500 TPS）
- 主力參與前後端分離改造（v2），並橫向涵蓋 EDM、簡訊閘道（以 go-zero 建構）等 8+ 微服務的迭代與穩定性

---

### 遠豐科技集團 — 全端開發工程師
**2013.06 – 2017.12 ｜ 上海**

- 開發多商戶 SaaS 電商平台，支援 10 國語言（Google／有道翻譯 API 混合流程，翻譯成本降低 70%）
- 以網易雲信建構 IM 系統；設計 Redis 快取層，資料庫負載降低 60%

---

## 開源與個人專案

- **SwaggerNotes**（PHP/Laravel 擴充套件，100% 獨立開發）：已發布至 Packagist，累計下載 2.6k+
- **knuckleswtf/scribe**（2.3k ⭐ Laravel API 文件產生器）：2 個 PR 已合併進主線，列名於官方貢獻者
- **技術部落格**：1300+ 篇技術文章，涵蓋 PHP／架構／資料庫／AI 工程，至今仍在更新

---

## 榮譽獎項

KKday 年度優秀員工（2023、2024 連續兩屆）· Shopex 金番茄獎（2020）· 遠豐科技「技術之星」（2016、2018）
