# 馬成軍（Michael Ma）

**資深後端工程師 · 13 年研發經驗 · 高並發交易系統 / AI 工程化**

📧 mikeah2011@gmail.com ｜ 📱 +86 188-0196-3698 ｜ 📍 上海
🔗 GitHub: [github.com/mikeah2011](https://github.com/mikeah2011) ｜ 技術部落格: [mikeah2011.github.io](https://mikeah2011.github.io)

---

## 個人簡介

13 年後端研發經驗，專注**高並發電商交易系統**與**分散式架構**，在 OTA（線上旅遊）、電商、MarTech 領域有完整的業務縱深：

- 現任 KKday（全球旅遊體驗平台）資深後端工程師，**售前 CVR 增轉專案組組長**，帶領 6 人跨端小組以轉換率提升 50%（1.2% → 1.8%）為北極星指標
- 以首要貢獻者身分主導 KKday 聯盟行銷平台（兩大核心儲存庫合計 3000+ 次提交），支撐 Google、Naver、ShopBack 等 10+ 全球通路
- 線上穩定性專家：主導大規模故障搶救，關鍵 API p99 從 25s+ 降至 2s 以內，5xx 錯誤率穩定低於 0.01%
- AI 工程化先行者：自研團隊健康監控平台（AI 根因分析）、多 AI 程式碼審查機器人編排工具，將 AI 深度落地至研發流程
- 連續兩屆 KKday 年度優秀員工（2023、2024）

---

## 核心技能

| 領域 | 技能 |
|------|------|
| 程式語言 | PHP（精通，8 年+）、TypeScript / Node.js、Go、Shell、Java（協作） |
| 框架 | Laravel / Hyperf / ThinkPHP / Yii2、Gin / go-zero、Vue / ElementUI |
| 資料與中介軟體 | MySQL、PostgreSQL、Redis、Elasticsearch、Google BigQuery、RabbitMQ、AWS SQS、Kafka |
| 雲原生與維運 | Docker、Kubernetes、AWS Lambda / GCP Cloud Run、Ansible、GitHub Actions、Prometheus / Grafana / Kibana |
| 架構能力 | 微服務、BFF、事件驅動、熔斷限流與高可用設計、API 設計與文件工程 |
| AI 工程 | Claude API / Copilot SDK 應用開發、AI Agent 工作流編排、AI 輔助研發流程建置 |
| 業務專長 | 聯盟行銷 / 分潤結算、訂單交易鏈路、動態定價、SCRM / 行銷自動化、SaaS 平台 |

---

## 工作經歷

### KKday（酷遊天國際旅行社） — 資深後端工程師
**2022.11 – 至今 ｜ 上海**

全球領先的旅遊體驗預訂平台（涵蓋 50+ 國家/地區）。歷任聯盟行銷平台負責人、B2C 主幹線核心後端，現兼任售前 CVR 增轉專案組組長。

**① 售前 CVR 增轉專案組 · 組長（2026 H2 – 至今）**
- 組建並帶領 **6 人跨端小組**（iOS/Android/Web/BE），以「CVR 1.2% → 1.8%（+50%）」為唯一北極星指標，直接向 PM 負責、承擔小組共責
- 建立站立會議、1on1、OKR 對齊等輕量協作機制，統籌售前鏈路（商品頁 → 購物車 → 訂購頁）全端體驗與效能優化

**② B2C 核心交易鏈路（2025.02 – 至今，b2c-api 783 次提交）**
- **USJ（大阪環球影城）訂單改期**：跨 B2C/Order/MKT/Member 四大服務改造，主筆 7 份 SA/SD；提出「權益繼承、條件重審」原則，將散亂的優惠券／點數重驗規則整理為可稽核決策表，四方一次對齊通過；重構金額試算器與訂單狀態機，確保公司 TOP 級票券供應商續約
- **GYG B2B 動態變價**：主筆 3 份 SA/SD，打通商品列表／SKU／購物車／訂單全鏈路動價；決策「新開獨立 API」取代改造 5 個舊呼叫點，並設計低版本 App 建議更新機制，避免錯誤價格外露
- **訂購頁改版**：旅客資訊擴充、排序、幽靈旅客機制及多規格×多旅客映射透傳，上線後 0 P0/P1 流出
- **大規模故障搶救（主要搶救窗口）**：定位微服務相依拖垮 PHP-FPM worker 池的根因，7 天內完成 P0+P1 強化——逾時優化、例外兜底、以 Redis 實作的輕量熔斷器、雙層 Feature Flag / Kill Switch；cart/validate API p99 由 25s+ 降至 <2s，根治 iOS 下單白屏，確保大型促銷平穩運行；此後 5xx 錯誤率連續多週 <0.01%
- **票券／Tour 商品架構升級**：主導方案分組、組合商品、OpenDate 月曆下放、商品頁特化等專案，獨立完成 SA/SD → Mock → API → 單元測試 → 文件全流程；建立「BFF 層版本相容 + App 漸進升級」標準解法，修復 15+ 跨端差異情境
- 端到端交付延伸：iOS Live Activity 出發日推播、行前關懷排程、會員快取治理、優惠券批次驗證（跨 5 個微服務）

**③ 聯盟行銷平台 · 平台負責人（2022.11 – 2025.03）**
- 以首要貢獻者身分主導 affiliate-service（2117/3747 次提交，占 56%）與 affiliate-api（1077 次提交）兩大核心服務，擔任 Code Owner 與 PR 把關，推動聯盟業務年增長 200%
- **Google 官方通路串接**：Things To Do 商品 Feeds 產生／壓縮／增量上傳、POI Ranking 擷取與排名、Google Transit 歐鐵點對點路線同步（驗簽、時區、黑名單治理）
- 串接 ShopBack、美安（Market America）、亞洲萬里通、Naver Shopping 等 10+ 異業聯盟通路，涵蓋回饋、哩程、比價多種合作模式
- 設計**分潤結算系統**：分潤規則引擎、月度結算與重跑能力、BigQuery 資料歸因；以 RabbitMQ 事件驅動打通訂單／商品資料流
- 效能與可觀測性：多級快取與統一 Cache Key 管理、慢查詢治理、聯盟訂單監控與 Slack 圖文日報，API 延遲降低 65%（120ms → 35ms）
- 主導 Affiliate → KKPartners 平台遷移技術方案，完成新舊系統平順轉換；為管理後台自研「資料庫型別 → CRUD 元件」自動對映引擎並維護公司級共用 SDK

**④ AI 工程化與內部平台（自主專案，2026）**
- **VM Health Center**（TypeScript/Node.js + Slack Bolt + Elasticsearch，79/86 次提交獨立開發）：團隊作戰看板 + 服務健康監控平台——自動彙整 Jira/GitHub/Confluence 產生團隊日報週報、訂購漏斗與後端服務健康告警、AI 初步根因分析
- **Maestro**（TypeScript CLI）：統一編排 CodeRabbit/Copilot/Codex/Gemini 等多個 AI PR 審查機器人的「收斂層」——問題分類、三層去重、自動修復、回覆與解決討論串、收斂監控與人工升級判斷
- 其他落地：Claude API 驅動的 8 語系 SEO slug 自動產生（hash 變更偵測控管費用）、Git 工作流 + AI 程式碼審查自動化系統（CLI/Webhook/GitHub Actions 多形態部署）

---

### 徑碩科技（JINGdigital） — 資深後端工程師
**2021.03 – 2022.10 ｜ 上海**

B2B MarTech/SCRM 行銷自動化 SaaS 廠商。負責行銷自動化微服務矩陣的後端研發（Laravel/Yii2/YAF，10+ 服務）。

- 主責 **JS 埋點追蹤服務**（jstracking）：全通路行為蒐集與內容行銷歸因，行銷自動化核心資料來源
- 主力參與 **JINGsocial 主系統**前後端分離改造（v2）與舊架構（YAF）維護，合計 300+ 次提交
- 橫向涵蓋 EDM 郵件行銷、簡訊閘道、問卷、名單開發、企業微信、資料遷移等 8+ 微服務的迭代與穩定性
- 參與 Ansible 維運基礎設施，具備從開發到部署的全鏈路能力

---

### 商派雲起軟體（Shopex） — 技術專家 / Lead Developer
**2017.12 – 2021.03 ｜ 上海**

- 交付 **Apple 中國經銷商平台**（上線 5 個月 GMV 超 ¥100 億）：串接順豐、寶尊 OMS 等 15+ 支付／物流系統，OMS/WMS 操作自動化率 98%，服務 3500+ 零售門市、25 萬+ DAU
- 高效能優惠券系統獲公司**金番茄獎**；H5 介面吞吐量提升 17.5 倍（200 → 3500 TPS），壓測調校（NGINX 快取 + TSung）達 12K TPS
- 以 go-zero 建構簡訊閘道服務，日發送量 100 萬+
- 資料匯出優化：從 OOM 失敗到 1000 萬列 / 10 分鐘

---

### 遠豐科技集團 — 全端開發工程師
**2013.06 – 2017.12 ｜ 上海**

- 開發多商戶 SaaS 電商平台（支撐 1 萬+ 商家），支援 10 國語言（Google／有道翻譯 API 混合流程，翻譯成本降低 70%）
- 以網易雲信建構 IM 系統，日訊息量 200 萬+
- 設計 Redis 快取層，資料庫負載降低 60%；兩次獲評公司「技術之星」（2016、2018）

---

## 開源與個人專案

- **SwaggerNotes**（PHP/Laravel 擴充套件，100% 獨立開發）：自動產生 Swagger 註解並輸出 OpenAPI 介面檔；已發布至 Packagist，累計下載 2.6k+
- **knuckleswtf/scribe**（2.3k ⭐ Laravel API 文件產生器）：2 個 PR 已合併進主線，列名於官方貢獻者
- **技術部落格**（Hexo）：1300+ 篇技術文章，涵蓋 PHP／架構／資料庫／AI 工程，至今仍在更新

---

## 榮譽獎項

- KKday 年度優秀員工（2023、2024，連續兩屆）
- Shopex 金番茄獎（2020）
- 遠豐科技「技術之星」（2016、2018）
