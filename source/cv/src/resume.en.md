# Michael Ma（马成军）

**Senior Backend Engineer · 13 Years of Experience · High-Concurrency Transaction Systems / AI Engineering**

📧 mikeah2011@gmail.com ｜ 📱 +86 188-0196-3698 ｜ 📍 Shanghai, China
🔗 GitHub: [github.com/mikeah2011](https://github.com/mikeah2011) ｜ Tech Blog: [mikeah2011.github.io](https://mikeah2011.github.io)

---

## Profile

13 years of backend engineering focused on **high-concurrency e-commerce transaction systems** and **distributed architecture**, with deep domain experience across OTA (online travel), e-commerce and MarTech:

- Senior Backend Engineer at KKday (global travel-experience platform) and **Lead of the Pre-Purchase Conversion Task Force**, driving a 6-person cross-platform team toward a north-star metric of +50% conversion (1.2% → 1.8%)
- Top contributor and owner of KKday's affiliate marketing platform (3,000+ commits across its two core repositories), powering 10+ global channels including Google, Naver and ShopBack
- Production reliability specialist: led incident response on a large-scale outage, cutting critical API p99 latency from 25s+ to under 2s and holding the 5xx error rate below 0.01%
- Early adopter of AI engineering: built an in-house team health-monitoring platform with AI root-cause analysis, and an orchestration layer that converges multiple AI code-review bots
- KKday Employee of the Year, two consecutive years (2023, 2024)

---

## Core Skills

| Domain | Skill |
|------|------|
| Languages | PHP (expert, 8+ yrs), TypeScript / Node.js, Go, Shell, Java (collaborative) |
| Frameworks | Laravel / Hyperf / ThinkPHP / Yii2, Gin / go-zero, Vue / ElementUI |
| Data & Messaging | MySQL, PostgreSQL, Redis, Elasticsearch, Google BigQuery, RabbitMQ, AWS SQS, Kafka |
| Cloud & DevOps | Docker, Kubernetes, AWS Lambda / GCP Cloud Run, Ansible, GitHub Actions, Prometheus / Grafana / Kibana |
| Architecture | Microservices, BFF, event-driven design, circuit breaking & rate limiting, API design and documentation engineering |
| AI Engineering | Claude API / Copilot SDK application development, AI agent workflow orchestration, AI-assisted engineering process design |
| Domain | Affiliate marketing & commission settlement, order transaction flows, dynamic pricing, SCRM / marketing automation, SaaS platforms |

---

## Experience

### KKday — Senior Backend Engineer
**2022.11 – Present ｜ Shanghai, China**

A leading global travel-experience booking platform operating in 50+ countries and regions. Progressed from affiliate platform owner to core backend engineer on the B2C mainline, now concurrently leading the Pre-Purchase Conversion Task Force.

**① Pre-Purchase Conversion Task Force · Lead (2026 H2 – Present)**
- Formed and lead a **6-person cross-platform team** (iOS/Android/Web/Backend) against a single north-star metric — conversion from 1.2% to 1.8% (+50%) — reporting directly to the PM and holding shared accountability for the group
- Established lightweight collaboration rituals (standups, 1-on-1s, OKR alignment) and coordinate end-to-end experience and performance work across the pre-purchase funnel: product page → cart → checkout

**② B2C Core Transaction Flow (2025.02 – Present, 783 commits to b2c-api)**
- **USJ (Universal Studios Japan) booking-date changes**: re-architected across four services (B2C/Order/MKT/Member) and authored 7 SA/SD documents. Introduced an "entitlements inherit, conditions re-evaluate" principle that turned scattered coupon and loyalty-point revalidation rules into an auditable decision table — approved by all four teams in a single review. Rebuilt the price calculator and order state machine, securing renewal with a top-tier ticketing supplier
- **GYG B2B dynamic pricing**: authored 3 SA/SD documents covering dynamic pricing across listings, SKU pages, cart and orders. Chose to introduce a dedicated API rather than retrofit five legacy call sites, and designed an app-upgrade prompt so older clients never surface stale prices
- **Checkout page rebuild**: expanded traveler fields, ordering, placeholder-traveler handling and many-to-many SKU-to-traveler mapping — shipped with zero P0/P1 escapes
- **Major outage response (incident lead)**: traced the root cause to a microservice dependency exhausting the PHP-FPM worker pool, then shipped P0+P1 hardening within 7 days — timeout tuning, exception fallbacks, a lightweight Redis-based circuit breaker and two-tier feature flag / kill switch. Cut cart/validate p99 from 25s+ to <2s, eliminated the iOS checkout white-screen, and kept a major campaign stable; 5xx has stayed below 0.01% for many weeks since
- **Ticketing / Tour product architecture**: led package grouping, bundled products, OpenDate calendar delegation and product-page specialization — owning the full cycle from SA/SD through mock, API, unit tests and documentation. Established a "BFF-layer version compatibility + progressive app rollout" playbook and resolved 15+ cross-platform inconsistencies
- End-to-end delivery beyond the core flow: iOS Live Activity departure-day notifications, pre-trip care scheduling, member cache governance and bulk coupon validation — spanning 5 microservices

**③ Affiliate Marketing Platform · Platform Owner (2022.11 – 2025.03)**
- Top contributor and owner of two core services — affiliate-service (2,117 of 3,747 commits, 56%) and affiliate-api (1,077 commits) — serving as Code Owner and PR gatekeeper while the affiliate business grew 200% year over year
- **Official Google channel integrations**: Things To Do product feed generation, compression and incremental upload; POI ranking collection; Google Transit point-to-point European rail sync (signature verification, time zones, blacklist governance)
- Integrated 10+ affiliate channels including ShopBack, Market America, Asia Miles and Naver Shopping — covering cashback, air-mile and price-comparison partnership models
- Designed the **commission settlement system**: rules engine, monthly settlement with re-run capability, BigQuery attribution, and a RabbitMQ event-driven pipeline connecting order and product data
- Performance and observability: multi-tier caching with unified cache-key management, slow-query remediation, affiliate order monitoring and daily Slack digests — reducing API latency 65% (120ms → 35ms)
- Led the technical plan for the Affiliate → KKPartners platform migration and delivered a seamless cutover; built a database-type-to-CRUD-component mapping engine for the admin console and maintained a company-wide shared SDK

**④ AI Engineering & Internal Platforms (self-initiated, 2026)**
- **VM Health Center** (TypeScript/Node.js + Slack Bolt + Elasticsearch, 79 of 86 commits, built solo): a team operations dashboard and service health monitor that aggregates Jira/GitHub/Confluence into daily and weekly reports, surfaces checkout-funnel and backend health alerts, and produces preliminary AI root-cause analysis
- **Maestro** (TypeScript CLI): a convergence layer orchestrating multiple AI PR-review bots (CodeRabbit, Copilot, Codex, Gemini) — issue classification, three-stage deduplication, auto-fix, thread replies and resolution, convergence monitoring and escalation to human review
- Additional work: Claude API–driven SEO slug generation across 8 locales with hash-based change detection for cost control; a Git workflow and AI code-review automation system deployable as CLI, webhook or GitHub Actions

---

### JINGdigital — Senior Backend Engineer
**2021.03 – 2022.10 ｜ Shanghai, China**

A B2B MarTech/SCRM marketing-automation SaaS vendor. Responsible for backend development across a marketing-automation microservice suite (Laravel/Yii2/YAF, 10+ services).

- Owned the **JavaScript event-tracking service** (jstracking): omnichannel behavioral collection and content-marketing attribution, the primary data source for marketing automation
- Core contributor to the **JINGsocial platform** — the frontend/backend decoupling rebuild (v2) and maintenance of the legacy YAF architecture, 300+ commits combined
- Delivered iteration and reliability work across 8+ microservices spanning email marketing, SMS gateway, surveys, lead generation, WeCom and data migration
- Contributed to Ansible-based infrastructure, covering the full path from development through deployment

---

### Shopex — Technical Expert / Lead Developer
**2017.12 – 2021.03 ｜ Shanghai, China**

- Delivered the **Apple China reseller platform** (surpassing ¥10B GMV within 5 months of launch): integrated 15+ payment and logistics systems including SF Express and Baozun OMS, reached 98% OMS/WMS automation, and served 3,500+ retail stores and 250K+ daily active users
- Received the company's **Golden Tomato Award** for a high-performance coupon system; raised H5 API throughput 17.5× (200 → 3,500 TPS) and reached 12K TPS under load testing (NGINX caching + TSung tuning)
- Built an SMS gateway service on go-zero handling 1M+ messages per day
- Optimized data export from OOM failures to 10M rows in 10 minutes

---

### Yuanfeng Technology Group — Full-Stack Engineer
**2013.06 – 2017.12 ｜ Shanghai, China**

- Built a multi-merchant SaaS e-commerce platform serving 10,000+ merchants with 10-language support, using a hybrid Google/Youdao translation pipeline that cut translation costs 70%
- Built an IM system on NetEase Cloud handling 2M+ messages per day
- Designed a Redis caching layer that reduced database load 60%; twice named company Technology Star (2016, 2018)

---

## Open Source & Personal Projects

- **SwaggerNotes** (PHP/Laravel package, built solo): generates Swagger annotations and OpenAPI specification files; published on Packagist with 2.6k+ downloads
- **knuckleswtf/scribe** (2.3k ⭐ Laravel API documentation generator): 2 pull requests merged upstream, listed among official contributors
- **Technical blog** (Hexo): 1,300+ articles covering PHP, architecture, databases and AI engineering — still actively updated

---

## Awards

- KKday Employee of the Year (2023, 2024 — two consecutive years)
- Shopex Golden Tomato Award (2020)
- Yuanfeng Technology Star (2016, 2018)
