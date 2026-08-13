# Michael Ma（马成军）

**Senior Backend Engineer · 13 Years of Experience · High-Concurrency Transaction Systems / Distributed Architecture**

mikeah2011@gmail.com ｜ +86 188-0196-3698 ｜ Shanghai, China (UTC+8)
GitHub: [github.com/mikeah2011](https://github.com/mikeah2011) ｜ LinkedIn: [linkedin.com/in/michael-ma-923223116](https://www.linkedin.com/in/michael-ma-923223116/) ｜ Tech Blog: [mikeah2011.github.io](https://mikeah2011.github.io)

---

## Profile

13 years of backend engineering focused on **high-concurrency e-commerce transaction systems** and **distributed architecture**, spanning OTA, e-commerce and MarTech. I'm at my best making architectural calls under real production pressure: I've led incident response on a large-scale outage, and independently delivered optimizations ranging from circuit-breaker design to a 17× throughput improvement.

**13 yrs** — Backend engineering · OTA / e-commerce / MarTech  
**¥10B+** — GMV in 5 months, Apple China reseller platform  
**17.5×** — H5 API throughput (200 → 3,500 TPS)  
**25s → 2s** — Critical API p99 after major-outage response  
**200%** — YoY growth, KKday affiliate business  
**65%↓** — Affiliate platform API latency (120ms → 35ms)

- **Transaction-systems depth**: top contributor and owner of KKday's affiliate marketing platform (200% YoY growth), and owner of the B2C core transaction flow spanning orders, payment callbacks and ticketing architecture
- **High concurrency & reliability**: led incident response on a large-scale outage (critical API p99 25s+ → <2s, 5xx held below 0.01%); raised H5 API throughput 17.5× on the Apple China reseller platform, reaching 12K TPS under load testing
- **Cross-team technical influence**: authored 7 SA/SD documents that aligned four service teams (B2C/Order/MKT/Member) in a single review; established a "BFF-layer version compatibility + progressive app rollout" playbook now used across the team; served as Code Owner and PR gatekeeper on the affiliate platform

---

## Core Skills

| Domain | Skill |
|------|------|
| Languages & Frameworks | PHP (expert, 8+ yrs), TypeScript / Node.js, Go, Python (reading proficiency); Laravel / Hyperf, Gin / go-zero, Vue |
| Data & Messaging | MySQL, PostgreSQL, Redis, Elasticsearch, Google BigQuery, RabbitMQ, Kafka |
| Cloud & DevOps | Docker, Kubernetes, AWS Lambda / GCP Cloud Run, GitHub Actions, Prometheus / Grafana / Kibana |
| Architecture & Domain | Microservices and BFF layering, RabbitMQ event-driven pipelines, Redis circuit breakers with two-tier kill switches, multi-tier caching and cache-key governance; commission settlement, order transaction flows, dynamic pricing |
| AI Engineering (adjacent) | Claude API in production, multi-agent orchestration and convergence |

---

## Experience

### KKday — Senior Backend Engineer
**2022.11 – 2026.08 ｜ Shanghai, China (UTC+8)**

A leading global travel-experience platform operating in 50+ countries. Over nearly four years: affiliate platform owner → B2C mainline core backend → currently focused on the technical implementation and monitoring dashboard for pre-purchase conversion (~80% of my time), while wrapping up and handing off the B2C core flow (~20%).

**1) Pre-Purchase Conversion Task Force (2026 H2)**
- Drive end-to-end performance optimization across the pre-purchase funnel (product page → cart → checkout) against a technical target of conversion 1.2% → 1.8% (+50%); built a CVR health-monitoring dashboard that quantifies the real impact of each optimization

**2) B2C Core Transaction Flow (2025.02 – 2026.08)**
- **USJ (Universal Studios Japan) booking-date changes**: re-architected across four services (B2C/Order/MKT/Member), authoring 7 SA/SD documents. Introduced an "entitlements inherit, conditions re-evaluate" principle that turned scattered coupon and loyalty-point revalidation rules into an auditable decision table; rebuilt the price calculator and order state machine, securing renewal with a top-tier ticketing supplier
- **Major outage response**: traced the root cause to a microservice dependency exhausting the PHP-FPM worker pool and shipped P0+P1 hardening in 7 days (timeout tuning, exception fallbacks, a lightweight Redis circuit breaker, two-tier feature flag / kill switch) — cart/validate API p99 from 25s+ to <2s, iOS checkout white-screen eliminated, 5xx held below 0.01% for many weeks since
- **Ticketing/tour product architecture**: led package grouping, bundled products and OpenDate calendar delegation — owning the full cycle from SA/SD through mock, API, unit tests and documentation. Established a "BFF-layer version compatibility + progressive app rollout" playbook and resolved 15+ cross-platform inconsistencies

**3) Affiliate Marketing Platform (2022.11 – 2025.03)**
- Top contributor and owner of two core services — affiliate-service (majority of all commits) and affiliate-api — as Code Owner and PR gatekeeper; integrated Google's Things To Do channel and 10+ partner channels including ShopBack, Asia Miles and Naver Shopping, growing the affiliate business 200% YoY
- Designed the **commission settlement system**: rules engine, monthly settlement with re-run capability, BigQuery attribution, and a RabbitMQ event-driven pipeline connecting order and product data
- Performance and observability: multi-tier caching with unified cache-key management, slow-query remediation, affiliate order monitoring and daily Slack digests — reducing API latency 65% (120ms → 35ms)

---

### Shopex — Technical Expert
**2017.12 – 2022.10 ｜ Shanghai, China (UTC+8)**

A leading domestic e-commerce and B2B MarTech/SCRM marketing-automation SaaS provider. Responsible for backend development across a marketing-automation microservice suite (Laravel/Yii2/YAF, 10+ services), and drove high-concurrency performance and stability work.

- **Apple China reseller platform** (the platform surpassed ¥10B GMV within 5 months of launch): personally owned the architecture and implementation of the core flow — pre-order, checkout, payment callbacks, fulfilment and shipping — plus release management and server operations; integrated 15+ payment and logistics systems including SF Express and Baozun OMS, serving 3,500+ retail stores and 250K+ DAU
- Received the company's **Golden Tomato Award** for a high-performance coupon system; raised H5 API throughput 17.5× (200 → 3,500 TPS) and reached 12K TPS under load testing (NGINX caching + TSung tuning)
- Owned the **marketing event-tracking service**: omnichannel behavioral collection and content-marketing attribution, the primary data source for marketing automation
- Contributed to a front-/back-end separation rewrite (v2) and legacy-system maintenance (300+ commits combined), while covering iteration and stability across 8+ microservices including EDM, an SMS gateway (built on go-zero, handling 1M+ messages/day), surveys, lead generation and WeCom integration

---

### Yuanfeng Technology Group — Full-Stack Engineer
**2013.06 – 2017.12 ｜ Shanghai, China (UTC+8)**

An e-commerce SaaS provider. Full-stack ownership of a multi-merchant commerce platform, IM system and caching layer.

- Built a multi-merchant SaaS e-commerce platform serving 10,000+ merchants with 10-language support, using a hybrid Google/Youdao translation pipeline that cut translation costs 70%
- Built an SMS gateway handling 1M+ messages/day; optimized data export from OOM failures to 10M rows in 10 minutes
- Built an IM system on NetEase Cloud handling 2M+ messages/day; designed a Redis caching layer that reduced database load 60%

---

## Open Source & Personal Projects

- **SwaggerNotes** (PHP/Laravel package, built solo): generates Swagger annotations and OpenAPI specification files; published on Packagist with 2.6k+ downloads
- **knuckleswtf/scribe** (2.3k ⭐ Laravel API documentation generator): 2 pull requests merged upstream, listed among official contributors
- **Technical blog**: 1,300+ articles covering PHP, architecture, databases and AI engineering — still actively updated

---

## Honors

KKday Employee of the Year (2023, 2024 — two consecutive years) · Shopex Golden Tomato Award (2020) · Yuanfeng Technology Star (2016, 2018)
