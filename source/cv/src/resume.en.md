# Michael Ma（马成军）

**Senior Backend Engineer / Tech Lead · High-Concurrency Transaction Systems & AI Engineering**

📧 mikeah2011@gmail.com ｜ 📱 +86 188-0196-3698 ｜ 📍 Shanghai, China (UTC+8)
🔗 GitHub: [github.com/mikeah2011](https://github.com/mikeah2011) ｜ LinkedIn: [linkedin.com/in/michael-ma-923223116](https://www.linkedin.com/in/michael-ma-923223116/) ｜ Tech Blog: [mikeah2011.github.io](https://mikeah2011.github.io)

---

## Profile

13 years of backend engineering on **high-concurrency transaction systems** and **distributed architecture**. Having run incident response on a major outage and maintained core transaction systems for years, I know what unreliable output costs in production — so extending into **AI engineering**, I built a convergence layer and cost controls first, not another generator.

**13 yrs** — Backend engineering · OTA / e-commerce / MarTech  
**¥10B+** — GMV within 5 months, Apple China reseller platform  
**25s → 2s** — Critical API p99 after major-outage response  
**200%** — YoY growth, KKday affiliate business  
**Review −50%** — Maestro converging 4 AI review bots, 300+ PRs  
**20+** — Daily users of self-built AI platforms, 7 teams

- **AI engineering**: built a convergence layer for multiple AI review bots (Maestro) and an AI-assisted root-cause monitoring platform (VM Health Center), solving the practical problem of duplicated, unreliable, unconverged AI output
- **Transaction-systems depth**: top contributor and owner of KKday's affiliate marketing platform (200% YoY growth), and owner of the B2C core transaction flow

---

## AI Engineering

- **Maestro** (TypeScript CLI) — a **convergence layer for AI review bots**: orchestrates 4 bots (CodeRabbit, Copilot, Codex, Gemini) through classification, three-stage deduplication, auto-fix, thread replies and resolution, convergence monitoring and escalation. **Now part of the team's daily workflow**: 10 engineers, 300+ PRs processed, review time **cut in half** and false positives down 70%
- **VM Health Center** (TypeScript/Node.js + Slack Bolt + Elasticsearch, built solo from scratch) — a team dashboard and service health monitor: aggregates Jira/GitHub/Confluence into daily/weekly reports, surfaces checkout-funnel and backend health alerts, with preliminary AI root-cause analysis. **Used daily by 20+ people across 7 teams** (Product, Web, App, QA, Order, B2C), firing alerts every day and cutting incident triage time by 40%
- **Claude API in production**: SEO slug generation across 8 locales covering nearly 3,000 product pages and ~50k API calls, with hash-based change detection skipping unchanged content to hold cost down; a Git workflow and AI code-review automation system deployable as CLI, webhook or GitHub Actions

---

## Core Skills

| Domain | Skill |
|------|------|
| AI Engineering | Claude API / Copilot SDK application development, multi-agent orchestration and convergence, AI-assisted engineering process design |
| Languages & Frameworks | PHP (expert, 8+ yrs), TypeScript / Node.js, Go, Python (reading proficiency); Laravel / Hyperf, Gin / go-zero, Vue |
| Data & Messaging | MySQL, PostgreSQL, Redis, Elasticsearch, Google BigQuery, RabbitMQ, Kafka |
| Cloud & DevOps | Docker, Kubernetes, AWS Lambda / GCP Cloud Run, GitHub Actions, Prometheus / Grafana / Kibana |
| Architecture & Domain | Microservices and BFF layering, RabbitMQ event-driven pipelines, Redis circuit breakers with two-tier kill switches, multi-tier caching and cache-key governance; commission settlement, order transaction flows, dynamic pricing |

---

## Experience

### KKday — Senior Backend Engineer
**2022.11 – Present ｜ Shanghai, China (UTC+8)**

A leading global travel-experience platform operating in 50+ countries. Progressed from affiliate platform owner → B2C core backend → lead of the Pre-Purchase Conversion Task Force.

**① Pre-Purchase Conversion Task Force · Lead (2026 H2 – Present)**
- Formed and lead a **6-person cross-platform team** (iOS/Android/Web/Backend) against a single north-star metric — conversion 1.2% → 1.8% (+50%); established standups, 1-on-1s and OKR alignment across the pre-purchase funnel (product page → cart → checkout)

**② B2C Core Transaction Flow (2025.02 – Present)**
- **USJ (Universal Studios Japan) booking-date changes**: re-architected across four services, authoring 7 SA/SD documents. Turned scattered coupon and loyalty-point revalidation rules into an auditable decision table — approved by all four teams in a single review, securing renewal with a top-tier ticketing supplier
- **Major outage response (incident lead)**: traced the root cause to a microservice dependency exhausting the PHP-FPM worker pool and shipped P0+P1 hardening in 7 days (timeouts, fallbacks, a Redis circuit breaker, two-tier kill switch) — cart/validate p99 25s+ → <2s, iOS checkout white-screen eliminated, 5xx held below 0.01% since

**③ Affiliate Marketing Platform · Platform Owner (2022.11 – 2025.03)**
- Top contributor and owner of two core services — affiliate-service (56% of all commits) and affiliate-api — as Code Owner and PR gatekeeper; integrated Google's Things To Do channel and 10+ partner channels including ShopBack, Asia Miles and Naver Shopping, growing the affiliate business 200% YoY
- Designed the **commission settlement system**: rules engine, monthly settlement with re-run capability, BigQuery attribution, and a RabbitMQ event-driven pipeline connecting order and product data

---

### JINGdigital — Senior Backend Engineer
**2021.03 – 2022.10 ｜ Shanghai, China (UTC+8)**

A B2B MarTech/SCRM marketing-automation SaaS vendor. Responsible for backend development across a marketing-automation microservice suite (Laravel/Yii2/YAF, 10+ services).

- Owned the **JavaScript event-tracking service** (jstracking): omnichannel behavioral collection and content-marketing attribution, the primary data source for marketing automation

---

### Shopex — Technical Expert / Lead Developer
**2017.12 – 2021.03 ｜ Shanghai, China (UTC+8)**

A leading domestic e-commerce SaaS provider. Technical Expert / Lead Developer, also driving high-concurrency performance work.

- **Apple China reseller platform** (surpassing ¥10B GMV within 5 months of launch): owned the core flow — pre-order, checkout, payment callbacks, fulfilment and shipping — leading a 6–7 person cross-functional team (backend / frontend / UI); integrated 15+ payment and logistics systems including SF Express and Baozun OMS, reached 98% OMS/WMS automation, serving 3,500+ retail stores and 250K+ DAU
- Received the company's **Golden Tomato Award** for a high-performance coupon system; raised H5 API throughput 17.5× (200 → 3,500 TPS) and reached 12K TPS under load testing (NGINX caching + TSung tuning)
- Built an SMS gateway on go-zero handling 1M+ messages/day; optimized data export from OOM failures to 10M rows in 10 minutes

---

### Yuanfeng Technology Group — Full-Stack Engineer
**2013.06 – 2017.12 ｜ Shanghai, China (UTC+8)**

- Built a multi-merchant SaaS e-commerce platform serving 10,000+ merchants with 10-language support, using a hybrid Google/Youdao translation pipeline that cut translation costs 70%

---

## Open Source & Personal Projects

- **SwaggerNotes** (PHP/Laravel package, built solo): generates Swagger annotations and OpenAPI specification files; published on Packagist with 2.6k+ downloads
- **knuckleswtf/scribe** (2.3k ⭐ Laravel API documentation generator): 2 pull requests merged upstream, listed among official contributors
