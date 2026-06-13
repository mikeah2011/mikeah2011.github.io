#!/usr/bin/env python3
import os, re

blog_dir = 'source/_posts'

# Tag normalization map: lowercase -> canonical form
tag_map = {
    'laravel': 'Laravel', 'php': 'PHP', 'mysql': 'MySQL', 'redis': 'Redis',
    'docker': 'Docker', 'kubernetes': 'Kubernetes', 'k8s': 'Kubernetes',
    'nginx': 'Nginx', 'git': 'Git', 'github': 'GitHub', 'gitlab': 'GitLab',
    'linux': 'Linux', 'aws': 'AWS', 'gcp': 'GCP', 'azure': 'Azure',
    'cloudflare': 'Cloudflare', 'vercel': 'Vercel', 'stripe': 'Stripe',
    'openai': 'OpenAI', 'anthropic': 'Anthropic', 'google': 'Google',
    'meta': 'Meta', 'apple': 'Apple', 'microsoft': 'Microsoft',
    'rust': 'Rust', 'go': 'Go', 'elixir': 'Elixir', 'swift': 'Swift',
    'kotlin': 'Kotlin', 'typescript': 'TypeScript', 'javascript': 'JavaScript',
    'python': 'Python', 'ruby': 'Ruby', 'java': 'Java',
    'postgresql': 'PostgreSQL', 'sqlite': 'SQLite', 'mongodb': 'MongoDB',
    'elasticsearch': 'Elasticsearch', 'kafka': 'Kafka', 'rabbitmq': 'RabbitMQ',
    'graphql': 'GraphQL', 'restful': 'RESTful', 'api': 'API',
    'jwt': 'JWT', 'oauth': 'OAuth', 'ssh': 'SSH', 'http': 'HTTP',
    'https': 'HTTPS', 'tcp': 'TCP', 'udp': 'UDP', 'css': 'CSS',
    'html': 'HTML', 'json': 'JSON', 'yaml': 'YAML', 'xml': 'XML',
    'sql': 'SQL', 'nosql': 'NoSQL', 'ai': 'AI', 'llm': 'LLM',
    'ml': 'ML', 'nlp': 'NLP', 'rag': 'RAG', 'mcp': 'MCP',
    'sse': 'SSE', 'websocket': 'WebSocket', 'grpc': 'gRPC',
    'ci/cd': 'CI/CD', 'ci-cd': 'CI/CD', 'tdd': 'TDD', 'bdd': 'BDD',
    'orm': 'ORM', 'mvc': 'MVC', 'spa': 'SPA', 'ssr': 'SSR',
    'ssg': 'SSG', 'cdn': 'CDN', 'dns': 'DNS', 'iot': 'IoT',
    'vr': 'VR', 'ar': 'AR', 'macos': 'macOS', 'ios': 'iOS',
    'android': 'Android', 'vue': 'Vue', 'vue3': 'Vue3', 'react': 'React',
    'next.js': 'Next.js', 'nuxt': 'Nuxt', 'svelte': 'Svelte',
    'htmx': 'HTMX', 'tailwind': 'Tailwind', 'vite': 'Vite',
    'webpack': 'Webpack', 'vitest': 'Vitest', 'jest': 'Jest',
    'cypress': 'Cypress', 'playwright': 'Playwright', 'terraform': 'Terraform',
    'ansible': 'Ansible', 'prometheus': 'Prometheus', 'grafana': 'Grafana',
    'datadog': 'Datadog', 'sentry': 'Sentry', 'obsidian': 'Obsidian',
    'notion': 'Notion', 'slack': 'Slack', 'discord': 'Discord',
    'telegram': 'Telegram', 'whatsapp': 'WhatsApp', 'wechat': 'WeChat',
    'youtube': 'YouTube', 'reddit': 'Reddit', 'medium': 'Medium',
    'hexo': 'Hexo', 'hugo': 'Hugo', 'jekyll': 'Jekyll', 'astro': 'Astro',
    'pwa': 'PWA', 'wasm': 'WASM', 'webassembly': 'WebAssembly',
    'deno': 'Deno', 'bun': 'Bun', 'node.js': 'Node.js',
    'express': 'Express', 'fastify': 'Fastify', 'nestjs': 'NestJS',
    'spring': 'Spring', 'django': 'Django', 'flask': 'Flask',
    'fastapi': 'FastAPI', 'rails': 'Rails', 'symfony': 'Symfony',
    'swoole': 'Swoole', 'hyperf': 'Hyperf', 'rector': 'Rector',
    'phpstan': 'PHPStan', 'phpunit': 'PHPUnit', 'pest': 'Pest',
    'composer': 'Composer', 'npm': 'npm', 'yarn': 'Yarn', 'pnpm': 'pnpm',
    'homebrew': 'Homebrew', 'vim': 'Vim', 'neovim': 'Neovim',
    'emacs': 'Emacs', 'cursor': 'Cursor', 'copilot': 'Copilot',
    'claude': 'Claude', 'gpt': 'GPT', 'chatgpt': 'ChatGPT',
    'gemini': 'Gemini', 'openclaw': 'OpenClaw', 'hermes': 'Hermes',
    'openhuman': 'OpenHuman', 'deepseek': 'DeepSeek', 'ollama': 'Ollama',
    'llama': 'LLaMA', 'vllm': 'vLLM', 'lora': 'LoRA', 'gguf': 'GGUF',
    'embedding': 'Embedding', 'vector': 'Vector', 'database': 'Database',
    'agent': 'Agent', 'workflow': 'Workflow', 'prompt': 'Prompt',
    'memory': 'Memory', 'context': 'Context', 'security': 'Security',
    'authentication': 'Authentication', 'encryption': 'Encryption',
    'monitoring': 'Monitoring', 'logging': 'Logging', 'performance': 'Performance',
    'testing': 'Testing', 'debugging': 'Debugging', 'devops': 'DevOps',
    'frontend': 'Frontend', 'backend': 'Backend',
    # Keep Chinese tags as-is
    '性能优化': '性能优化', '微服务': '微服务', '分布式': '分布式',
    '架构': '架构', '缓存': '缓存', '消息队列': '消息队列',
    '数据库': '数据库', '前端': '前端', '后端': '后端', '运维': '运维',
    '设计模式': '设计模式', '算法': '算法', '数据结构': '数据结构',
    '面试': '面试', '电商': '电商', '代码质量': '代码质量',
    # Some specific ones
    'kkday': 'KKday', 'b2c': 'B2C', 'dto': 'DTO', 'ddd': 'DDD',
    'cqrs': 'CQRS', 'bff': 'BFF', 'tall': 'TALL',
    'eloquent': 'Eloquent', 'artisan': 'Artisan', 'livewire': 'Livewire',
    'inertia': 'Inertia', 'sanctum': 'Sanctum', 'octane': 'Octane',
    'pint': 'Pint', 'opcache': 'OPcache', 'jit': 'JIT',
    'fiber': 'Fiber', 'fibers': 'Fibers', 'backstage': 'Backstage',
    'istio': 'Istio', 'cilium': 'Cilium', 'nats': 'NATS', 'pulsar': 'Pulsar',
    'debezium': 'Debezium', 'ferretdb': 'FerretDB', 'postgis': 'PostGIS',
    'pgbouncer': 'PgBouncer', 'proxysql': 'ProxySQL', 'clickhouse': 'ClickHouse',
    'supabase': 'Supabase', 'neon': 'Neon', 'litestream': 'Litestream',
    'serverless': 'Serverless', 'finops': 'FinOps',
    'openapi': 'OpenAPI', 'graphql': 'GraphQL', 'restful': 'RESTful',
    'postman': 'Postman', 'figma': 'Figma', 'nix': 'Nix',
    'terraform': 'Terraform', 'vagrant': 'Vagrant',
    'react': 'React', 'vue': 'Vue', 'svelte': 'Svelte',
    'flutter': 'Flutter', 'dart': 'Dart', 'tauri': 'Tauri',
    'solidjs': 'SolidJS', 'qwik': 'Qwik', 'alpine': 'Alpine',
    'htmx': 'HTMX', 'solid': 'SOLID', 'clean': 'Clean',
    'kong': 'Kong', 'apisix': 'APISIX', 'envoy': 'Envoy',
    'caddy': 'Caddy', 'traefik': 'Traefik',
    'tokio': 'Tokio', 'actix': 'Actix', 'axum': 'Axum',
    'zig': 'Zig', 'eBPF': 'eBPF', 'ebpf': 'eBPF',
    'quic': 'QUIC', 'http/3': 'HTTP/3', 'webtransport': 'WebTransport',
    'grpc': 'gRPC', 'protobuf': 'Protobuf',
    'opentelemetry': 'OpenTelemetry', 'jaeger': 'Jaeger', 'tempo': 'Tempo',
    'pyroscope': 'Pyroscope', 'sentry': 'Sentry',
    'trivy': 'Trivy', 'sbom': 'SBOM', 'slsa': 'SLSA',
    'chaos': 'Chaos', 'gremlin': 'Gremlin',
    'gitops': 'GitOps', 'argocd': 'ArgoCD', 'fluxcd': 'FluxCD',
    'kamal': 'Kamal', 'keda': 'KEDA', 'knative': 'Knative',
    'thinkphp': 'ThinkPHP', 'codeigniter': 'CodeIgniter', 'cakephp': 'CakePHP',
    'phalcon': 'Phalcon', 'yi': 'Yii',
    'uni-app': 'uni-app', 'taro': 'Taro', 'electron': 'Electron',
    'capacitor': 'Capacitor', 'cordova': 'Cordova',
    'langchain': 'LangChain', 'langgraph': 'LangGraph', 'llamaindex': 'LlamaIndex',
    'langfuse': 'LangFuse', 'langsmith': 'LangSmith',
    'dify': 'Dify', 'coze': 'Coze', 'autogen': 'AutoGen', 'crewai': 'CrewAI',
    'sqlite': 'SQLite', 'planetscale': 'PlanetScale', 'tidb': 'TiDB',
    'surrealdb': 'SurrealDB', 'cockroachdb': 'CockroachDB',
    'valkey': 'Valkey', 'dragonfly': 'Dragonfly',
    'influxdb': 'InfluxDB', 'timescaledb': 'TimescaleDB',
    'efk': 'EFK', 'loki': 'Loki', 'mimir': 'Mimir',
    'datadog': 'Datadog', 'newrelic': 'NewRelic', 'honeycomb': 'Honeycomb',
    'coroot': 'Coroot', 'signoz': 'SigNoz',
    'dependency': 'Dependency', 'injection': 'Injection',
    'abac': 'ABAC', 'rbac': 'RBAC', 'pbac': 'PBAC',
    'oauth2': 'OAuth2', 'oidc': 'OIDC', 'saml': 'SAML',
    'sso': 'SSO', 'mfa': 'MFA', 'passkey': 'Passkey',
    'webauthn': 'WebAuthn', 'fido2': 'FIDO2',
    'cors': 'CORS', 'csp': 'CSP', 'csrf': 'CSRF', 'xss': 'XSS',
    'ssrf': 'SSRF', 'sqli': 'SQLi',
    'owasp': 'OWASP', 'cve': 'CVE',
    'gdpr': 'GDPR', 'hipaa': 'HIPAA', 'ccpa': 'CCPA', 'soc2': 'SOC2',
}

changes = []
for root, dirs, files in os.walk(blog_dir):
    for fname in files:
        if not fname.endswith('.md'):
            continue
        fpath = os.path.join(root, fname)
        with open(fpath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Find frontmatter
        fm_match = re.match(r'^(---\n)(.*?)(\n---)', content, re.DOTALL)
        if not fm_match:
            continue
        
        fm = fm_match.group(2)
        prefix = fm_match.group(1)
        suffix = fm_match.group(3)
        rest = content[fm_match.end():]
        
        # Process tags in frontmatter
        lines = fm.split('\n')
        new_lines = []
        in_tags = False
        modified = False
        
        for line in lines:
            stripped = line.strip()
            
            # Inline tags: tags: [tag1, tag2, tag3]
            if stripped.startswith('tags:'):
                tag_inline = re.match(r'^tags:\s*\[([^\]]+)\]$', stripped)
                if tag_inline:
                    tags = [t.strip().strip('"').strip("'") for t in tag_inline.group(1).split(',')]
                    new_tags = []
                    for t in tags:
                        lt = t.lower()
                        if lt in tag_map:
                            canon = tag_map[lt]
                            if canon != t:
                                modified = True
                                changes.append((fpath, t, canon))
                            new_tags.append(canon)
                        else:
                            new_tags.append(t)
                    new_lines.append(f'tags: [{", ".join(new_tags)}]')
                    continue
                else:
                    # Multi-line tags
                    in_tags = True
                    new_lines.append(line)
                    continue
            
            if in_tags:
                tag_match = re.match(r'^(\s+)-\s+(.+)$', line)
                if tag_match:
                    indent = tag_match.group(1)
                    tag_name = tag_match.group(2).strip().strip('"').strip("'")
                    lt = tag_name.lower()
                    if lt in tag_map:
                        canon = tag_map[lt]
                        if canon != tag_name:
                            new_lines.append(f'{indent}- {canon}')
                            modified = True
                            changes.append((fpath, tag_name, canon))
                            continue
                    new_lines.append(line)
                elif stripped == '' or any(stripped.startswith(p) for p in ['date:', 'cover:', 'description:', 'keywords:', 'categories:']):
                    in_tags = False
                    new_lines.append(line)
                else:
                    in_tags = False
                    new_lines.append(line)
            else:
                new_lines.append(line)
        
        if modified:
            new_fm = '\n'.join(new_lines)
            new_content = prefix + new_fm + suffix + rest
            with open(fpath, 'w', encoding='utf-8') as f:
                f.write(new_content)

print(f'Total files modified: {len(set(c[0] for c in changes))}')
print(f'Total tag changes: {len(changes)}')
print()
# Show top changes
from collections import Counter
change_counts = Counter()
for f, old, new in changes:
    change_counts[f'{old} -> {new}'] += 1
print('Top tag changes:')
for change, count in change_counts.most_common(30):
    print(f'  {count:3d}x  {change}')
