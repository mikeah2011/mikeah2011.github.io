# Michael Ma（马成军）

**Senior Backend Engineer / Tech Lead · 13 Years of Experience · High-Concurrency Transaction Systems & AI Engineering**

mikeah2011@gmail.com ｜ +86 188-0196-3698 ｜ Shanghai, China (UTC+8)
GitHub: [github.com/mikeah2011](https://github.com/mikeah2011) ｜ LinkedIn: [linkedin.com/in/michael-ma-923223116](https://www.linkedin.com/in/michael-ma-923223116/) ｜ Tech Blog: [mikeah2011.github.io](https://mikeah2011.github.io)

---

## Profile

13 years of backend engineering on **high-concurrency transaction systems** and **distributed architecture**. Having run incident response on a major outage and maintained core transaction systems for years, I know what unreliable output costs in production — so extending into **AI engineering**, I built a convergence layer and cost controls first, not another generator.

**13 yrs** — Backend engineering · OTA / e-commerce / MarTech  
**¥10B+** — GMV within 5 months, Apple China reseller platform  
**25s → 2s** — Critical API p99 after major-outage response  
**200%** — YoY growth, KKday affiliate business  
**Review ~50%↓** — Maestro converging 4 AI review bots, 300+ PRs  
**20+** — Daily users of self-built AI platforms, 7 teams

- **AI engineering**: built a convergence layer for multiple AI review bots (Maestro) and an AI-assisted root-cause monitoring platform (VM Health Center), solving the practical problem of duplicated, unreliable, unconverged AI output
- **Transaction-systems depth**: top contributor and owner of KKday's affiliate marketing platform (200% YoY growth), and owner of the B2C core transaction flow
- **Stability & leadership**: led incident response on a large-scale outage (critical API p99 25s+ → <2s, 5xx held below 0.01%); currently also owner of the Pre-Purchase Conversion Task Force, coordinating a 6-person cross-platform team

---

## AI Engineering

- **Maestro** (TypeScript CLI) — a **convergence layer for AI review bots**: orchestrates 4 bots (CodeRabbit, Copilot, Codex, Gemini) through classification, three-stage deduplication, auto-fix, thread replies and resolution, convergence monitoring and escalation. **Now part of the team's daily workflow**: 10 engineers, 300+ PRs processed; per the team's own assessment, review time **cut roughly in half** and false positives down about 70%
- **VM Health Center** (TypeScript/Node.js + Slack Bolt + Elasticsearch, built solo from scratch) — a team dashboard and service health monitor: aggregates Jira/GitHub/Confluence into daily/weekly reports, surfaces checkout-funnel and backend health alerts, with preliminary AI root-cause analysis (rule-based log-keyword matching narrows down 1–2 suspicious traces, then an LLM helps pinpoint the underlying issue). **Used daily by 20+ people across 7 teams** (Product, Web, App, QA, Order, B2C), firing alerts every day and cutting incident triage time by 40%
- **Claude API in production**: SEO slug generation across 8 locales covering nearly 3,000 product pages and ~50k API calls, with hash-based change detection skipping unchanged content to hold cost down; a Git workflow and AI code-review automation system deployable as CLI, webhook or GitHub Actions

---

## Core Skills

| Domain | Skill |
|------|------|
| AI Engineering | Claude API / Copilot SDK application development, multi-agent orchestration and convergence, AI-assisted engineering process design |
| Languages & Frameworks | PHP (expert, 8+ yrs), TypeScript / Node.js, Go (basic), Python (reading proficiency); Laravel / Hyperf, Vue |
| Data & Messaging | MySQL, PostgreSQL, Redis, Elasticsearch, Google BigQuery, RabbitMQ, Kafka |
| Cloud & DevOps | Docker, Kubernetes, AWS Lambda / GCP Cloud Run, GitHub Actions, Prometheus / Grafana / Kibana |
| Architecture & Domain | Microservices and BFF layering, RabbitMQ event-driven pipelines, Redis circuit breakers with two-tier kill switches, multi-tier caching and cache-key governance; commission settlement, order transaction flows, dynamic pricing |

---

## Experience

### KKday — Senior Backend Engineer
**2022.11 – 2026.08 ｜ Shanghai, China (UTC+8)**

A leading global travel-experience platform operating in 50+ countries. Progressed from affiliate platform owner → B2C core backend → owner of the Pre-Purchase Conversion Task Force (currently ~80% of my time, with the remaining 20% wrapping up and handing off the B2C core flow).

**1) Pre-Purchase Conversion Task Force · Owner (2026 H2)**
- Formed and lead a **6-person cross-platform team** (iOS/Android/Web/Backend) against a single north-star metric — conversion 1.2% → 1.8% (+50%); established standups, 1-on-1s and OKR alignment across the pre-purchase funnel (product page → cart → checkout), and built a CVR health-monitoring dashboard so results are visible and verifiable

**2) B2C Core Transaction Flow (2025.02 – 2026.08)**
- **USJ (Universal Studios Japan) booking-date changes**: re-architected across four services, authoring 7 SA/SD documents. Turned scattered coupon and loyalty-point revalidation rules into an auditable decision table — approved by all four teams in a single review, securing renewal with a top-tier ticketing supplier
- **Major outage response (as primary responder)**: traced the root cause to a microservice dependency exhausting the PHP-FPM worker pool and shipped P0+P1 hardening in 7 days (timeouts, fallbacks, a Redis circuit breaker, two-tier kill switch) — cart/validate p99 25s+ → <2s, iOS checkout white-screen eliminated, 5xx held below 0.01% since
- **Ticketing/tour product architecture**: led package grouping, bundled products, and OpenDate calendar delegation — owning the full cycle from SA/SD through mock, API, unit tests and documentation. Established a "BFF-layer version compatibility + progressive app rollout" playbook, resolving 15+ cross-platform inconsistencies

**3) Affiliate Marketing Platform · Platform Owner (2022.11 – 2025.03)**
- Top contributor and owner of two core services — affiliate-service (majority of all commits) and affiliate-api — as Code Owner and PR gatekeeper; integrated Google's Things To Do channel and 10+ partner channels including ShopBack, Asia Miles and Naver Shopping, growing the affiliate business 200% YoY
- Designed the **commission settlement system**: rules engine, monthly settlement with re-run capability, BigQuery attribution, and a RabbitMQ event-driven pipeline connecting order and product data
- Performance and observability: multi-tier caching with unified cache-key management, slow-query remediation, affiliate order monitoring and daily Slack digests — reducing API latency 65% (120ms → 35ms)

---

### Shopex — Technical Expert / Lead Developer
**2017.12 – 2022.10 ｜ Shanghai, China (UTC+8)**

A leading domestic e-commerce and B2B MarTech/SCRM marketing-automation SaaS provider. Responsible for backend development across a marketing-automation microservice suite (Laravel/Yii2/YAF, 10+ services), and drove high-concurrency performance and stability work.

- **Apple China reseller platform** (the platform surpassed ¥10B GMV within 5 months of launch): personally owned the core flow — pre-order, checkout, payment callbacks, fulfilment and shipping — leading a 6–7 person cross-functional team; integrated 15+ payment and logistics systems including SF Express and Baozun OMS, serving 3,500+ retail stores and 250K+ DAU
- Received the company's **Golden Tomato Award** for a high-performance coupon system; raised H5 API throughput 17.5× (200 → 3,500 TPS) and reached 12K TPS under load testing (NGINX caching + TSung tuning)
- Owned the **marketing event-tracking service**: omnichannel behavioral collection and content-marketing attribution, the primary data source for marketing automation
- Contributed to a front-/back-end separation rewrite (v2) and legacy-system maintenance (300+ commits combined), while covering iteration and stability across 8+ microservices including EDM, an SMS gateway (built on go-zero, handling 1M+ messages/day), surveys, lead generation and WeCom integration

---

### Yuanfeng Technology Group — Full-Stack Engineer
**2013.06 – 2017.12 ｜ Shanghai, China (UTC+8)**

- Built a multi-merchant SaaS e-commerce platform serving 10,000+ merchants with 10-language support, using a hybrid Google/Youdao translation pipeline that cut translation costs 70%
- Built an SMS gateway handling 1M+ messages/day; optimized data export from OOM failures to 10M rows in 10 minutes
- Built an IM system on NetEase Cloud handling 2M+ messages/day; designed a Redis caching layer that reduced database load by 60%

---

## Open Source & Personal Projects

- **SwaggerNotes** (PHP/Laravel package, built solo): generates Swagger annotations and OpenAPI specification files; published on Packagist with 2.6k+ downloads
- **knuckleswtf/scribe** (2.3k ⭐ Laravel API documentation generator): 2 pull requests merged upstream, listed among official contributors
- **Technical blog**: 1,300+ articles covering PHP, architecture, databases and AI engineering — still actively updated

---

## Honors

KKday Employee of the Year (2023, 2024 — two consecutive years) · Shopex Golden Tomato Award (2020) · Yuanfeng Technology Star (2016, 2018)
