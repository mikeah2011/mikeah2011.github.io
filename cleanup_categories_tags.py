#!/usr/bin/env python3
"""清理博客分类和标签：去重、统一大小写、合并重复"""
import os, re, sys

POSTS_DIR = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "source/_posts")

CATEGORY_MAP = {
    "PHP": "php", "Laravel": "php", "05_PHP/Laravel": "php",
    "PHP/Laravel": "php", "Laravel/PHP": "php",
    "Architecture": "architecture", "00_架构": "architecture", "架构": "architecture",
    "DevOps": "devops", "06_运维": "devops", "运维": "devops",
    "AI": "ai", "AI Agent": "ai", "AI-Agent": "ai", "AI/Agent": "ai",
    "AI/ML": "ai", "AI 工程化": "ai", "AI/架构": "ai",
    "Frontend": "frontend", "前端": "frontend", "前端架构": "frontend", "前端工程化": "frontend",
    "macOS": "macos",
    "Engineering": "engineering", "工程实践": "engineering", "工程化": "engineering", "工程效能": "engineering",
    "Misc": "misc", "杂记": "misc",
    "移动端": "mobile", "跨平台": "mobile", "跨平台开发": "mobile", "uni-app": "mobile",
    "Network": "network", "databases": "database", "MySQL": "database",
    "PostgreSQL": "database", "Redis": "database", "数据库": "database",
    "Kubernetes": "kubernetes", "Docker": "docker", "Tools": "tools",
    "Runtime": "runtime", "Testing": "testing", "testing": "testing",
    "Search": "search", "Docs": "docs", "Process": "process",
    "Algorithms": "algorithms", "AWS": "aws", "Editor": "editor",
    "API": "api", "Infra": "infra", "Logging": "logging",
    "CI/CD": "cicd", "BFF": "bff", "DDD": "ddd",
    "Microservice": "microservice", "Auth": "auth",
    "Performance": "performance", "Quality": "quality", "Payment": "payment",
    "Web3": "web3", "Go": "go", "Rust": "rust", "Swift": "swift", "Nuxt": "nuxt",
    "Vue3": "frontend", "安全": "security", "后端": "backend",
    "业务设计": "architecture", "功能开关": "engineering", "灰度发布": "engineering",
    "性能优化": "engineering", "消息队列": "mq", "EventDriven": "mq", "测试": "testing",
    "Observability": "devops",
}

TAG_MAP = {
    "laravel": "Laravel", "php": "PHP", "mysql": "MySQL", "redis": "Redis",
    "postgresql": "PostgreSQL", "ai": "AI", "devops": "DevOps", "macos": "macOS",
    "docker": "Docker", "kubernetes": "Kubernetes", "ai agent": "AI Agent",
    "ai-agent": "AI Agent", "typescript": "TypeScript", "javascript": "JavaScript",
    "vue": "Vue", "vue3": "Vue 3", "react": "React", "flutter": "Flutter",
    "go": "Go", "rust": "Rust", "python": "Python", "nginx": "Nginx", "git": "Git",
    "aws": "AWS", "ci-cd": "CI/CD", "ci/cd": "CI/CD", "bff": "BFF", "llm": "LLM",
    "api": "API", "openclaw": "OpenClaw", "hermes": "Hermes", "kkday": "KKday",
    "openhuman": "OpenHuman", "sse": "SSE", "websocket": "WebSocket", "grpc": "gRPC",
    "elasticsearch": "Elasticsearch", "composer": "Composer", "serverless": "Serverless",
    "swoole": "Swoole", "phpunit": "PHPUnit", "phpstan": "PHPStan", "vite": "Vite",
    "css": "CSS", "cli": "CLI", "seo": "SEO", "jwt": "JWT", "oauth": "OAuth",
    "sql": "SQL", "ddd": "DDD", "rag": "RAG", "mcp": "MCP", "cdc": "CDC",
    "olap": "OLAP", "gdpr": "GDPR", "dto": "DTO", "opcache": "OPcache", "jit": "JIT",
    "php-fpm": "PHP-FPM", "github actions": "GitHub Actions",
    "opentelemetry": "OpenTelemetry", "grafana": "Grafana", "prometheus": "Prometheus",
    "clickhouse": "ClickHouse", "sqlite": "SQLite", "pgbouncer": "PgBouncer",
    "envoy": "Envoy", "langchain": "LangChain", "stripe": "Stripe",
    "livewire": "Livewire", "playwright": "Playwright", "webpack": "Webpack",
    "node.js": "Node.js", "graphql": "GraphQL", "restful": "RESTful", "saas": "SaaS",
    "openai": "OpenAI", "claude": "Claude", "claude code": "Claude Code",
    "cursor": "Cursor", "copilot": "Copilot", "frankenphp": "FrankenPHP",
    "pest": "Pest", "octane": "Octane", "reverb": "Reverb", "fiber": "Fiber",
    "bun": "Bun", "elixir": "Elixir", "webassembly": "WebAssembly",
    "monorepo": "Monorepo", "sidecar": "Sidecar", "xss": "XSS", "ssl": "SSL",
    "tls": "TLS", "mtls": "mTLS", "hermes agent": "Hermes Agent",
    "openapi": "OpenAPI", "http/2": "HTTP/2", "http2": "HTTP/2",
    "mqtt": "MQTT", "amqp": "AMQP",
    "ai agent": "AI Agent", "ai-agent": "AI Agent",
}

def norm_cat(c):
    return CATEGORY_MAP.get(c, c.lower())

def norm_tag(t):
    lower = t.lower().strip()
    return TAG_MAP.get(lower, t.strip())

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 找到 front matter
    m = re.match(r'^(---\s*\n)(.*?)(\n---\s*\n)', content, re.DOTALL)
    if not m:
        return False

    fm_lines = m.group(2).split('\n')
    rest = content[m.end():]

    # 找 categories 和 tags 的范围
    new_lines = []
    changed = False
    mode = None  # 'categories' or 'tags' or None
    seen = set()

    for line in fm_lines:
        # 检测 categories: 或 tags: 行
        if re.match(r'^categories:\s*$', line):
            mode = 'categories'
            seen = set()
            new_lines.append(line)
            continue
        elif re.match(r'^tags:\s*$', line):
            mode = 'tags'
            seen = set()
            new_lines.append(line)
            continue
        elif re.match(r'^categories:\s*\[', line):
            # 内联格式 categories: [PHP, Laravel]
            mode = 'categories_inline'
            new_lines.append(line)
            continue
        elif re.match(r'^tags:\s*\[', line):
            mode = 'tags_inline'
            new_lines.append(line)
            continue

        # 列表项
        item_match = re.match(r'^(\s*-\s*)(.+)$', line)
        if item_match and mode in ('categories', 'tags'):
            prefix = item_match.group(1)
            value = item_match.group(2).strip()

            if mode == 'categories':
                nv = norm_cat(value)
            else:
                nv = norm_tag(value)

            if nv in seen:
                changed = True
                continue  # 跳过重复
            seen.add(nv)

            if nv != value:
                changed = True
                new_lines.append(f'{prefix}{nv}')
            else:
                new_lines.append(line)
            continue

        # 非列表项 → 重置 mode
        if line.strip() and not line.startswith(' '):
            mode = None
            seen = set()

        new_lines.append(line)

    if not changed:
        return False

    new_fm = '\n'.join(new_lines)
    new_content = f'---\n{new_fm}\n---\n{rest}'

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)
    return True


def main():
    total = 0
    modified = 0
    errors = 0

    for root, dirs, files in os.walk(POSTS_DIR):
        for fn in sorted(files):
            if not fn.endswith('.md'):
                continue
            fp = os.path.join(root, fn)
            total += 1
            try:
                if process_file(fp):
                    modified += 1
                    print(f'  ✅ {os.path.relpath(fp, POSTS_DIR)}')
            except Exception as e:
                errors += 1
                print(f'  ❌ {os.path.relpath(fp, POSTS_DIR)}: {e}')

    print(f'\n=== 完成 ===')
    print(f'总文件: {total}')
    print(f'已修改: {modified}')
    print(f'错误: {errors}')

if __name__ == '__main__':
    main()
