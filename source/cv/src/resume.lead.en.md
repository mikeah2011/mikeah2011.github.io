# Michael Ma（马成军）

**Tech Lead / Senior Backend Engineer · 13 Years of Experience · Team Delivery / Cross-Team Alignment / Business Growth**

mikeah2011@gmail.com ｜ +86 188-0196-3698 ｜ Shanghai, China (UTC+8)
GitHub: [github.com/mikeah2011](https://github.com/mikeah2011) ｜ LinkedIn: [linkedin.com/in/michael-ma-923223116](https://www.linkedin.com/in/michael-ma-923223116/) ｜ Tech Blog: [mikeah2011.github.io](https://mikeah2011.github.io)

---

## Profile

13 years of backend engineering, grown consistently along a "Tech Lead who can carry the technical depth" path: at KKday I went from affiliate-platform Code Owner to B2C core backend, and since 2026 H2 have led a 6-person cross-platform team against a CVR north-star metric; earlier at Shopex I led a 6–7 person team delivering the Apple platform's mini-program and worked across OTA / e-commerce / MarTech scenarios. I'm used to trading off business goals, engineering constraints and team dynamics — and I believe a good technical decision has to be explainable and verifiable, not just "because I think so."

**+50%** — CVR improvement (1.2% → 1.8%), 6-person cross-platform team  
**200%** — YoY growth, KKday affiliate business  
**¥10B+** — Apple platform GMV in 5 months, delivered with a 6–7 person team  
**20+** — Daily users of self-built AI platforms across 7 teams  
**25s → 2s** — Critical API p99 after leading incident response  
**13 yrs** — Backend engineering · technical depth paired with team delivery

- **Team delivery**: formed and lead a 6-person cross-platform team (iOS / Android / Web / Backend), driving pre-purchase CVR up 50% against a single north-star metric; established standups, 1-on-1s and OKR alignment, and built a dashboard so the team's output is verifiable — while staying hands-on with code and architectural decisions
- **Cross-team technical decisions**: led the USJ re-architecture across four services (B2C/Order/MKT/Member), authoring 7 SA/SD documents and introducing an "entitlements inherit, conditions re-evaluate" principle that aligned all four teams in a single review; top contributor and owner of KKday's affiliate marketing platform (200% YoY growth) as Code Owner and PR gatekeeper; earlier at Shopex, owned the MarTech/SCRM marketing-automation microservice suite and its high-concurrency/stability work
- **Reliability & engineering culture**: led incident response on a large-scale outage (critical API p99 25s+ → <2s, 5xx held below 0.01%); self-initiated AI collaboration platforms (Maestro, VM Health Center) that turned AI tooling into everyday team productivity

---

## Team Effectiveness & AI Engineering

- **Maestro** (convergence layer for AI review bots): after the team adopted multiple AI code-review tools, their output diverged and was hard to reconcile — I designed a unified convergence flow (classification → three-stage deduplication → auto-fix → thread replies and resolution → escalation to human review) and drove its adoption into the team's daily workflow; 10 engineers, 300+ PRs processed, with review time noticeably reduced per the team's own assessment
- **VM Health Center** (team dashboard + service health monitor): built from scratch to solve cross-team information gaps and slow incident response; now a daily tool for 20+ people across 7 teams (Product / Web / App / QA / Order / B2C), cutting incident triage time by 40%, with preliminary AI root-cause analysis (rule-based log-keyword matching narrows down suspicious traces, then an LLM helps pinpoint the issue)
- **AI in production**: drove the introduction of Claude API into daily engineering workflows (SEO slug generation across 8 locales, AI code-review automation), establishing cost controls such as hash-based change detection — validating the path from "experiment" to "something the team depends on daily"

---

## Core Skills

| Domain | Skill |
|------|------|
| Architecture & Domain | Microservices and BFF layering, RabbitMQ event-driven pipelines, Redis circuit breakers with two-tier kill switches, multi-tier caching and cache-key governance; commission settlement, order transaction flows, dynamic pricing |
| Team Practices | Cross-functional alignment (multi-team / multi-service), OKRs with standups and 1-on-1s, decision documentation (SA/SD), outcome dashboards |
| AI Engineering | Claude API / Copilot SDK application development, multi-agent orchestration and convergence, AI-assisted engineering process design |
| Languages & Frameworks | PHP (8+ yrs), TypeScript / Node.js, Go (basic), Python (reading proficiency); Laravel / Hyperf, Vue |
| Data & Cloud | MySQL, PostgreSQL, Redis, Elasticsearch, BigQuery, RabbitMQ, Kafka; Docker, Kubernetes, GitHub Actions |

---

## Experience

### KKday — Senior Backend Engineer
**2022.11 – 2026.08 ｜ Shanghai, China (UTC+8)**

A leading global travel-experience platform operating in 50+ countries. Over nearly four years: affiliate platform owner → B2C mainline core backend → in H2 2026 also owner of the Pre-Purchase Conversion Task Force (~80% of my time, with the remaining 20% wrapping up and handing off the B2C core flow while mentoring the team taking it over).

**1) Pre-Purchase Conversion Task Force · Owner (2026 H2)**
- Formed and led a **6-person cross-platform team** (iOS / Android / Web / Backend) against a single north-star metric — conversion 1.2% → 1.8% (+50%) — reporting directly to the PM; established standups, 1-on-1s and OKR alignment, coordinating end-to-end experience and performance work across the pre-purchase funnel (product page → cart → checkout), and built a CVR health-monitoring dashboard so results are visible and verifiable

**2) B2C Core Transaction Flow (2025.02 – 2026.08)**
- **USJ (Universal Studios Japan) booking-date changes**: re-architected across four services, authoring 7 SA/SD documents. Turned scattered coupon and loyalty-point revalidation rules into an auditable decision table — approved by all four teams in a single review; rebuilt the price calculator and order state machine, securing renewal with a top-tier ticketing supplier
- **Major outage response (as primary responder)**: traced the root cause to a microservice dependency exhausting the PHP-FPM worker pool and shipped P0+P1 hardening in 7 days — cart/validate API p99 from 25s+ to <2s, iOS checkout white-screen eliminated, 5xx held below 0.01% for many weeks since
- **Ticketing/tour product architecture**: led package grouping, bundled products and OpenDate calendar delegation; established a "BFF-layer version compatibility + progressive app rollout" playbook and resolved 15+ cross-platform inconsistencies

**3) Affiliate Marketing Platform · Platform Owner (2022.11 – 2025.03)**
- Top contributor and owner of two core services — affiliate-service (majority of all commits) and affiliate-api — as Code Owner and PR gatekeeper; integrated Google's Things To Do channel and 10+ partner channels including ShopBack, Asia Miles and Naver Shopping, growing the affiliate business 200% YoY
- Designed the **commission settlement system**: rules engine, monthly settlement with re-run capability, BigQuery attribution
- Performance and observability: multi-tier caching with unified cache-key management, affiliate order monitoring and daily Slack digests — reducing API latency ~70% (120ms → 35ms)

---

### Shopex — Technical Expert / Lead Developer
**2017.12 – 2022.10 ｜ Shanghai, China (UTC+8)**

A leading domestic e-commerce and B2B MarTech/SCRM marketing-automation SaaS provider. Responsible for backend development across a marketing-automation microservice suite (Laravel/Yii2/YAF, 10+ services), and drove high-concurrency performance and stability work.

- **Apple China reseller platform** (the platform surpassed ¥10B GMV within 5 months of launch): personally owned the core flow — pre-order, checkout, payment callbacks, fulfilment and shipping — leading a **6–7 person cross-functional team** (backend / frontend / UI) to deliver the mini-program, plus release management and server operations; integrated 15+ payment and logistics systems including SF Express and Baozun OMS, serving 3,500+ retail stores and 250K+ DAU
- Received the company's **Golden Tomato Award** for a high-performance coupon system; raised H5 API throughput 17.5× (200 → 3,500 TPS)
- Contributed to a front-/back-end separation rewrite (v2) and legacy-system maintenance, while covering iteration and stability across 8+ microservices including EDM, an SMS gateway (built on go-zero), surveys, lead generation and WeCom integration — coordinating collaboration and scheduling across the teams involved

---

### Yuanfeng Technology Group — Full-Stack Engineer
**2013.06 – 2017.12 ｜ Shanghai, China (UTC+8)**

- Built a multi-merchant SaaS e-commerce platform serving 10,000+ merchants with 10-language support, cutting translation costs 70%
- Built an IM system on NetEase Cloud; designed a Redis caching layer that reduced database load 60%

---

## Open Source & Personal Projects

- **SwaggerNotes** (PHP/Laravel package, built solo): published on Packagist with 2.6k+ downloads
- **knuckleswtf/scribe** (2.3k ⭐ Laravel API documentation generator): 2 pull requests merged upstream, listed among official contributors
- **Technical blog**: 1,300+ articles covering PHP, architecture, databases and AI engineering — still actively updated

---

## Honors

- KKday Employee of the Year (2023, 2024 — two consecutive years)
- Shopex Golden Tomato Award (2020)
- Yuanfeng Technology Star (2016)
