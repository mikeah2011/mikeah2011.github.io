# Michael Ma（马成军）

**AI Engineer / Senior Backend Engineer · Claude API & Agent Orchestration · 13 Years of Engineering Experience**

mikeah2011@gmail.com ｜ +86 188-0196-3698 ｜ Shanghai, China (UTC+8)
GitHub: [github.com/mikeah2011](https://github.com/mikeah2011) ｜ LinkedIn: [linkedin.com/in/michael-ma-923223116](https://www.linkedin.com/in/michael-ma-923223116/) ｜ Tech Blog: [mikeah2011.github.io](https://mikeah2011.github.io)

---

## Profile

13 years of high-concurrency backend engineering, with the past year extended into **AI engineering** — where the first things I built were a convergence layer and cost controls, not another generator. Having maintained core transaction systems for years and led incident response on a large-scale outage, I know exactly what unreliable output costs once it reaches production. That's the first principle I bring to AI engineering.

**Review ~50%↓** — Maestro converging 4 AI review bots, 300+ PRs  
**20+** — Daily users of self-built AI platforms across 7 teams  
**40%↓** — Incident triage time via VM Health Center  
**13 yrs** — Backend engineering · high-concurrency systems background  
**¥10B+** — Apple platform GMV in 5 months (engineering-depth evidence)  
**25s → 2s** — Critical API p99 after major-outage response

- **AI engineering**: built a convergence layer for multiple AI review bots (Maestro) and an AI-assisted root-cause monitoring platform (VM Health Center), solving the practical problem of duplicated, unreliable, unconverged AI output; Claude API in production across nearly 3,000 product pages
- **Engineering fundamentals**: 13 years of high-concurrency backend work (PHP / Go / Node.js), maintaining core transaction flows and leading major incident response — which is why I'm more careful than most before putting AI output in front of production traffic
- **Transaction-systems depth**: top contributor and owner of KKday's affiliate marketing platform (200% YoY growth), and owner of the B2C core transaction flow

---

## AI Engineering

- **Maestro** (TypeScript CLI) — a **convergence layer for AI review bots**: orchestrates 4 bots (CodeRabbit, Copilot, Codex, Gemini) through classification → three-stage deduplication → auto-fix → thread replies and resolution → convergence monitoring and escalation to human review, turning divergent AI opinions into an actionable change queue. **Now part of the team's daily workflow**: 10 engineers, 300+ PRs processed; per the team's own assessment, review time cut roughly in half and false positives down about 70%
- **VM Health Center** (TypeScript / Node.js + Slack Bolt + Elasticsearch, built solo from scratch) — a team dashboard and service health monitor: aggregates Jira / GitHub / Confluence into daily and weekly reports, surfaces checkout-funnel and backend health alerts, with preliminary AI root-cause analysis — rule-based log-keyword matching narrows down 1–2 suspicious traces, then an LLM helps pinpoint the underlying issue. **Used daily by 20+ people across 7 teams** (Product / Web / App / QA / Order / B2C), firing alerts every day and cutting incident triage time by 40%
- **Claude API in production**: SEO slug generation across 8 locales covering nearly 3,000 product pages and ~50k API calls, with hash-based change detection skipping unchanged content to hold cost down; a Git workflow and AI code-review automation system deployable as CLI, webhook or GitHub Actions
- **Single-source multi-output content pipeline** (this résumé site): one content source exports 20+ artifacts across three languages × light/dark × HTML / PDF / PPTX / Markdown; four targeted versions layer deltas over a single base, so a factual correction lands everywhere at once instead of drifting between copies

---

## Core Skills

| Domain | Skill |
|------|------|
| AI Engineering | Claude API / Copilot SDK application development, multi-agent orchestration and convergence, prompt design and cost control, AI-assisted engineering process design |
| Languages & Frameworks | TypeScript / Node.js, PHP (expert, 8+ yrs), Go, Python (reading proficiency); Laravel / Hyperf, Gin / go-zero, Vue |
| Data & Messaging | Elasticsearch, Google BigQuery, MySQL, PostgreSQL, Redis, RabbitMQ, Kafka |
| Cloud & DevOps | Docker, Kubernetes, AWS Lambda / GCP Cloud Run, GitHub Actions, Prometheus / Grafana / Kibana |
| Architecture & Domain | Microservices and BFF layering, event-driven architecture, Redis circuit breakers; commission settlement, order transaction flows, dynamic pricing |

---

## Experience

### KKday — Senior Backend Engineer
**2022.11 – 2026.08 ｜ Shanghai, China (UTC+8)**

A leading global travel-experience platform operating in 50+ countries. Over nearly four years: affiliate platform owner → B2C mainline core backend → currently also owner of the Pre-Purchase Conversion Task Force. Maestro and VM Health Center were both self-initiated projects.

**1) Pre-Purchase Conversion Task Force · Owner (2026 H2)**
- Formed and lead a 6-person cross-platform team against a single north-star metric — conversion 1.2% → 1.8% (+50%); built a CVR health-monitoring dashboard so results are visible and verifiable

**2) B2C Core Transaction Flow (2025.02 – 2026.08)**
- **USJ (Universal Studios Japan) booking-date changes**: re-architected across four services (B2C/Order/MKT/Member), authoring 7 SA/SD documents; introduced an "entitlements inherit, conditions re-evaluate" principle that turned scattered coupon and loyalty-point revalidation rules into an auditable decision table
- **Major outage response (as primary responder)**: traced the root cause to a microservice dependency exhausting the PHP-FPM worker pool and shipped P0+P1 hardening in 7 days — cart/validate API p99 from 25s+ to <2s, 5xx held below 0.01% for many weeks since
- **Ticketing/tour product architecture**: established a "BFF-layer version compatibility + progressive app rollout" playbook and resolved 15+ cross-platform inconsistencies

**3) Affiliate Marketing Platform · Platform Owner (2022.11 – 2025.03)**
- Top contributor and owner of two core services — affiliate-service (majority of all commits) and affiliate-api; integrated Google's Things To Do and 10+ partner channels, growing the affiliate business 200% YoY
- Designed the **commission settlement system**: rules engine, monthly settlement with re-run capability, BigQuery attribution

---

### Shopex — Technical Expert / Lead Developer
**2017.12 – 2022.10 ｜ Shanghai, China (UTC+8)**

- **Apple China reseller platform** (the platform surpassed ¥10B GMV within 5 months of launch): personally owned the core flow — pre-order, checkout, payment callbacks, fulfilment and shipping; integrated 15+ payment and logistics systems including SF Express and Baozun OMS, serving 3,500+ retail stores and 250K+ DAU
- Received the company's **Golden Tomato Award** for a high-performance coupon system; raised H5 API throughput 17.5× (200 → 3,500 TPS)
- Contributed to a front-/back-end separation rewrite (v2), while covering iteration and stability across 8+ microservices including EDM and an SMS gateway (built on go-zero)

---

### Yuanfeng Technology Group — Full-Stack Engineer
**2013.06 – 2017.12 ｜ Shanghai, China (UTC+8)**

- Built a multi-merchant SaaS e-commerce platform with 10-language support, using a hybrid Google/Youdao translation pipeline that cut translation costs 70%
- Built an IM system on NetEase Cloud; designed a Redis caching layer that reduced database load 60%

---

## Open Source & Personal Projects

- **SwaggerNotes** (PHP/Laravel package, built solo): published on Packagist with 2.6k+ downloads
- **knuckleswtf/scribe** (2.3k ⭐ Laravel API documentation generator): 2 pull requests merged upstream, listed among official contributors
- **Technical blog**: 1,300+ articles covering PHP, architecture, databases and AI engineering — still actively updated

---

## Honors

KKday Employee of the Year (2023, 2024 — two consecutive years) · Shopex Golden Tomato Award (2020) · Yuanfeng Technology Star (2016, 2018)
