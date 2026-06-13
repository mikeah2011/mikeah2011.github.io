---

title: Ansible 实战：Laravel 应用自动化部署与配置管理——从 SSH 手工操作到声明式基础设施踩坑记录
keywords: [Ansible, Laravel, SSH, 应用自动化部署与配置管理, 手工操作到声明式基础设施踩坑记录]
date: 2026-06-01
categories:
- devops
tags:
- Ansible
- Laravel
- DevOps
- 自动化
- 配置管理
- IaC
description: 基于 KKday B2C Backend Team 30+ 仓库的运维经验，记录 Ansible 在 Laravel 项目中的落地实践：Inventory 设计、Playbook 编写、Role 抽象、Vault 密钥管理、滚动部署、零停机发布，以及 Jinja2 模板渲染陷阱、幂等性违背、handler 时序、权限提升踩坑等真实问题。
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
- /images/content/devops-ansible-content-1.jpg
- /images/content/devops-ansible-content-2.jpg
---



# Ansible 实战：Laravel 应用自动化部署与配置管理——从 SSH 手工操作到声明式基础设施踩坑记录

## 一、为什么写这篇？

在 KKday B2C Backend Team，我们有 30+ 个 Laravel 微服务。最开始，部署流程是这样的：

```bash
# 某个同事写的 deploy.sh（真实存在过）
ssh deploy@prod-server "cd /var/www/api && git pull origin main"
ssh deploy@prod-server "cd /var/www/api && composer install --no-dev"
ssh deploy@prod-server "cd /var/www/api && php artisan migrate --force"
ssh deploy@prod-server "cd /var/www/api && php artisan config:cache"
ssh deploy@prod-server "sudo systemctl restart php8.0-fpm"
```

这段脚本有**至少五个致命问题**：

1. **没有幂等性**：重复执行会出错（重复 migrate、重复 git pull 报冲突）
2. **没有回滚能力**：部署失败后只能手动恢复
3. **没有环境隔离**：staging 和 production 用同一个脚本，靠注释切换
4. **没有密钥管理**：数据库密码明文写在 `.env` 里，通过 `scp` 传
5. **没有并行部署**：5 台服务器串行部署，一次发布要 10 分钟

后来我们尝试过 Deployer（PHP 生态的部署工具），功能够用但对系统配置管理（Nginx、PHP-FPM、Supervisor、Cron）力不从心。最终选了 **Ansible**，原因是：

- **无 Agent**：SSH 即可，不需在目标机器装任何东西
- **YAML 声明式**：Playbook 可读性好，新人能快速理解
- **幂等性设计**：大部分模块天然幂等
- **生态丰富**：Galaxy 上有大量 Laravel/PHP 相关 Role
- **Jinja2 模板**：配置文件生成灵活强大

这篇文章记录的是我们从零到一用 Ansible 管理 Laravel 部署的完整过程，包括那些官方文档不会告诉你的踩坑细节。

## 二、核心概念/原理

![Ansible 架构与 DevOps 自动化](/images/content/devops-ansible-content-1.jpg)

### 2.1 Ansible 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    Control Node (你的笔记本/CI)           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │Inventory │  │Playbooks │  │  Roles   │              │
│  │(主机清单) │  │(编排剧本) │  │(可复用)  │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│       └──────────────┼──────────────┘                    │
│                      │                                   │
│              ┌───────▼───────┐                           │
│              │  Ansible Engine│                           │
│              │  (Play 执行)   │                           │
│              └───────┬───────┘                           │
└──────────────────────┼──────────────────────────────────┘
                       │ SSH (无 Agent)
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │ Web-01  │   │ Web-02  │   │ Web-03  │
   │ (Prod)  │   │ (Prod)  │   │ (Prod)  │
   └─────────┘   └─────────┘   └─────────┘
```

**核心术语：**

| 术语 | 含义 | 类比 |
|------|------|------|
| Inventory | 主机清单，定义管理哪些机器 | 通讯录 |
| Playbook | YAML 格式的任务编排文件 | 部署脚本 |
| Task | 单个操作步骤 | 一行命令 |
| Role | 可复用的任务集合 | 函数/模块 |
| Handler | 被 notify 触发的特殊任务 | 事件回调 |
| Vault | 加密敏感数据 | 密码管理器 |
| Facts | 自动收集的主机信息 | `uname -a` |
| Jinja2 | 模板引擎 | Blade/Smarty |

### 2.2 为什么 Ansible 适合 Laravel 项目？

Laravel 应用的部署不只是 `git pull`，还涉及：

| 部署阶段 | 涉及组件 | Ansible 模块 |
|----------|----------|-------------|
| 代码同步 | Git/SVN | `git` |
| 依赖安装 | Composer | `composer` / `shell` |
| 配置生成 | .env、Nginx、PHP-FPM | `template` |
| 数据库变更 | Migrations | `shell` |
| 缓存清理 | Artisan commands | `shell` |
| 队列管理 | Supervisor/Horizon | `supervisorctl` / `systemd` |
| Web 服务器 | Nginx/Apache | `template` + `service` |
| SSL 证书 | Let's Encrypt | `openssl_certificate` |
| 定时任务 | Cron | `cron` |
| 日志轮转 | Logrotate | `template` |
| 权限管理 | Storage 目录 | `file` |

## 三、实战代码

![服务器部署与云基础设施](/images/content/devops-ansible-content-2.jpg)

### 3.1 项目结构设计

这是我们实际使用的 Ansible 项目结构：

```
ansible-laravel-deploy/
├── ansible.cfg                # Ansible 全局配置
├── inventories/
│   ├── production/
│   │   ├── hosts.yml          # 生产主机清单
│   │   └── group_vars/
│   │       ├── all.yml        # 所有主机共享变量
│   │       └── web.yml        # Web 组变量
│   └── staging/
│       ├── hosts.yml
│       └── group_vars/
│           └── all.yml
├── playbooks/
│   ├── site.yml               # 主入口
│   ├── deploy.yml             # 部署 Playbook
│   ├── provision.yml          # 初始化 Playbook
│   └── rollback.yml           # 回滚 Playbook
├── roles/
│   ├── common/                # 基础配置（时区、NTP、用户）
│   ├── php/                   # PHP-FPM 安装与配置
│   ├── nginx/                 # Nginx 虚拟主机
│   ├── composer/              # Composer 安装
│   ├── laravel/               # Laravel 部署逻辑
│   ├── supervisor/            # Supervisor 进程管理
│   ├── redis/                 # Redis 服务
│   └── ssl/                   # SSL 证书
├── files/                     # 静态文件
├── templates/                 # Jinja2 模板（跨 Role 共享）
└── vault/                     # 加密的密钥文件
    ├── production.yml
    └── staging.yml
```

### 3.2 Inventory 设计

```yaml
# inventories/production/hosts.yml
---
all:
  children:
    web:
      hosts:
        web-01:
          ansible_host: 10.0.1.10
          ansible_user: deploy
          node_id: 1
        web-02:
          ansible_host: 10.0.1.11
          ansible_user: deploy
          node_id: 2
        web-03:
          ansible_host: 10.0.1.12
          ansible_user: deploy
          node_id: 3
    worker:
      hosts:
        worker-01:
          ansible_host: 10.0.1.20
          ansible_user: deploy
          queue_types: [default, high, billing]
        worker-02:
          ansible_host: 10.0.1.21
          ansible_user: deploy
          queue_types: [default, low]
    scheduler:
      hosts:
        scheduler-01:
          ansible_host: 10.0.1.30
          ansible_user: deploy
  vars:
    ansible_python_interpreter: /usr/bin/python3
    ansible_ssh_common_args: '-o StrictHostKeyChecking=no'
```

```yaml
# inventories/production/group_vars/all.yml
---
app_name: "kkday-api"
app_repo: "git@github.com:kkday/b2c-api.git"
app_branch: "main"
app_root: "/var/www/{{ app_name }}"
app_shared_dir: "{{ app_root }}/shared"
app_current_link: "{{ app_root }}/current"
app_releases_dir: "{{ app_root }}/releases"
keep_releases: 5

php_version: "8.0"
php_fpm_socket: "/run/php/php{{ php_version }}-fpm.sock"

nginx_server_name: "api.kkday.com"
nginx_worker_processes: "auto"

redis_host: "10.0.2.10"
redis_port: 6379

# 部署策略
deploy_strategy: "rolling"    # rolling | blue-green | canary
rolling_batch_size: 1
rolling_pause: 10             # 秒
health_check_url: "/api/health"
health_check_retries: 30
health_check_delay: 5
```

### 3.3 核心 Playbook：部署

```yaml
# playbooks/deploy.yml
---
- name: Deploy Laravel Application
  hosts: web
  serial: "{{ rolling_batch_size }}"
  max_fail_percentage: 0
  become: true

  vars:
    timestamp: "{{ ansible_date_time.epoch }}"
    release_dir: "{{ app_releases_dir }}/{{ timestamp }}"

  pre_tasks:
    - name: Set deployment facts
      ansible.builtin.set_fact:
        deploy_timestamp: "{{ timestamp }}"
        deploy_release_dir: "{{ release_dir }}"

    - name: Announce deployment start
      ansible.builtin.debug:
        msg: "🚀 Starting deployment {{ deploy_timestamp }} to {{ inventory_hostname }}"

    - name: Pull latest code
      ansible.builtin.git:
        repo: "{{ app_repo }}"
        dest: "{{ deploy_release_dir }}"
        version: "{{ app_branch }}"
        force: true
        accept_hostkey: true
        key_file: "/home/{{ ansible_user }}/.ssh/deploy_key"
      register: git_result

  roles:
    - role: composer
      vars:
        composer_working_dir: "{{ deploy_release_dir }}"

    - role: laravel
      vars:
        laravel_working_dir: "{{ deploy_release_dir }}"

  post_tasks:
    - name: Run database migrations
      ansible.builtin.command:
        cmd: "php artisan migrate --force"
        chdir: "{{ deploy_release_dir }}"
      register: migrate_result
      changed_when: "'Nothing to migrate' not in migrate_result.stdout"
      when: inventory_hostname == groups['web'][0]  # 只在第一台执行 migrate

    - name: Wait for migrations on other nodes
      ansible.builtin.wait_for:
        timeout: 10
      when: inventory_hostname != groups['web'][0]

    - name: Symlink shared resources
      ansible.builtin.file:
        src: "{{ app_shared_dir }}/{{ item }}"
        dest: "{{ deploy_release_dir }}/{{ item }}"
        state: link
        force: true
      loop:
        - storage
        - .env

    - name: Set storage permissions
      ansible.builtin.file:
        path: "{{ deploy_release_dir }}/storage"
        state: directory
        owner: www-data
        group: www-data
        recurse: true
        mode: '0775'

    - name: Create release symlink
      ansible.builtin.file:
        src: "{{ deploy_release_dir }}"
        dest: "{{ app_current_link }}"
        state: link
        force: true
      notify: Restart PHP-FPM

    - name: Clean old releases
      ansible.builtin.shell: |
        ls -dt {{ app_releases_dir }}/* | tail -n +{{ keep_releases + 1 }} | xargs rm -rf
      args:
        executable: /bin/bash
      changed_when: false

    - name: Health check
      ansible.builtin.uri:
        url: "http://127.0.0.1{{ health_check_url }}"
        status_code: 200
        timeout: 10
      register: health
      until: health.status == 200
      retries: "{{ health_check_retries }}"
      delay: "{{ health_check_delay }}"

    - name: Announce deployment complete
      ansible.builtin.debug:
        msg: "✅ Deployment {{ deploy_timestamp }} complete on {{ inventory_hostname }}"

  handlers:
    - name: Restart PHP-FPM
      ansible.builtin.systemd:
        name: "php{{ php_version }}-fpm"
        state: restarted
      listen: "Restart PHP-FPM"
```

### 3.4 Laravel Role 详解

```yaml
# roles/laravel/tasks/main.yml
---
- name: Ensure .env file exists (from Vault)
  ansible.builtin.template:
    src: env.j2
    dest: "{{ laravel_working_dir }}/.env"
    owner: www-data
    group: www-data
    mode: '0640'
  when: laravel_env_from_vault | default(true)
  no_log: true  # 防止敏感信息出现在日志中

- name: Cache config
  ansible.builtin.command:
    cmd: "php artisan config:cache"
    chdir: "{{ laravel_working_dir }}"
  changed_when: true
  notify: Restart PHP-FPM

- name: Cache routes
  ansible.builtin.command:
    cmd: "php artisan route:cache"
    chdir: "{{ laravel_working_dir }}"
  changed_when: true
  notify: Restart PHP-FPM

- name: Cache views
  ansible.builtin.command:
    cmd: "php artisan view:cache"
    chdir: "{{ laravel_working_dir }}"
  changed_when: true

- name: Cache events
  ansible.builtin.command:
    cmd: "php artisan event:cache"
    chdir: "{{ laravel_working_dir }}"
  changed_when: true
  ignore_errors: true  # Laravel < 11 可能不支持

- name: Create storage symlinks
  ansible.builtin.file:
    src: "{{ laravel_working_dir }}/storage/app/public"
    dest: "{{ laravel_working_dir }}/public/storage"
    state: link
    force: true

- name: Ensure storage directories exist
  ansible.builtin.file:
    path: "{{ laravel_working_dir }}/storage/{{ item }}"
    state: directory
    owner: www-data
    group: www-data
    mode: '0775'
    recurse: true
  loop:
    - app/public
    - framework/cache
    - framework/sessions
    - framework/views
    - logs
```

```jinja2
{# roles/laravel/templates/env.j2 #}
{# 来自 Vault 的环境变量 #}
APP_NAME="{{ app_name }}"
APP_ENV="{{ app_env }}"
APP_KEY="{{ app_key }}"
APP_DEBUG="{{ app_debug | lower }}"
APP_URL="{{ app_url }}

LOG_CHANNEL="{{ log_channel }}"
LOG_LEVEL="{{ log_level }}"

DB_CONNECTION=mysql
DB_HOST="{{ db_host }}"
DB_PORT="{{ db_port }}"
DB_DATABASE="{{ db_database }}"
DB_USERNAME="{{ db_username }}"
DB_PASSWORD="{{ db_password }}"

REDIS_HOST="{{ redis_host }}"
REDIS_PORT="{{ redis_port }}"
REDIS_PASSWORD="{{ redis_password | default('') }}"

CACHE_DRIVER=redis
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis

MAIL_MAILER=smtp
MAIL_HOST="{{ mail_host }}"
MAIL_PORT="{{ mail_port }}"
MAIL_USERNAME="{{ mail_username }}"
MAIL_PASSWORD="{{ mail_password }}"

STRIPE_KEY="{{ stripe_key }}"
STRIPE_SECRET="{{ stripe_secret }}"

{# 条件渲染：Sentry 只在 production 启用 #}
{% if app_env == 'production' %}
SENTRY_LARAVEL_DSN="{{ sentry_dsn }}"
{% endif %}
```

### 3.5 Nginx 配置模板

```jinja2
{# roles/nginx/templates/laravel.conf.j2 #}
server {
    listen 80;
    server_name {{ nginx_server_name }};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name {{ nginx_server_name }};

    root {{ app_current_link }}/public;
    index index.php;

    ssl_certificate /etc/letsencrypt/live/{{ nginx_server_name }}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{{ nginx_server_name }}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    charset utf-8;
    client_max_body_size {{ nginx_client_max_body_size | default('20M') }};

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;

    # Logging
    access_log /var/log/nginx/{{ app_name }}_access.log combined buffer=16k flush=5s;
    error_log /var/log/nginx/{{ app_name }}_error.log warn;

    # Health check endpoint (不写日志)
    location = /api/health {
        access_log off;
        try_files $uri $uri/ /index.php?$query_string;
    }

    # Static assets (长缓存)
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:{{ php_fpm_socket }};
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_read_timeout {{ php_fpm_timeout | default(300) }};
        fastcgi_buffers 16 16k;
        fastcgi_buffer_size 32k;
    }

    location ~ /\.(?!well-known).* {
        deny all;
    }
}
```

### 3.6 Supervisor 配置（队列 Worker）

```yaml
# roles/supervisor/tasks/main.yml
---
- name: Install Supervisor
  ansible.builtin.apt:
    name: supervisor
    state: present

- name: Configure Laravel queue workers
  ansible.builtin.template:
    src: laravel-worker.conf.j2
    dest: "/etc/supervisor/conf.d/{{ app_name }}-worker-{{ item }}.conf"
    owner: root
    group: root
    mode: '0644'
  loop: "{{ queue_types }}"
  notify: Reload Supervisor

- name: Ensure Supervisor is running
  ansible.builtin.systemd:
    name: supervisor
    state: started
    enabled: true
```

```jinja2
{# roles/supervisor/templates/laravel-worker.conf.j2 #}
[program:{{ app_name }}-worker-{{ item }}]
process_name=%(program_name)s_%(process_num)02d
command=php {{ app_current_link }}/artisan queue:work redis --queue={{ item }} --sleep=3 --tries=3 --max-time=3600
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
user=www-data
numprocs={{ queue_worker_count | default(2) }}
redirect_stderr=true
stdout_logfile=/var/log/{{ app_name }}/worker-{{ item }}.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
stopwaitsecs=3600
```

### 3.7 Vault 密钥管理

```bash
# 创建加密文件
ansible-vault create vault/production.yml

# 编辑已加密文件
ansible-vault edit vault/production.yml

# 加密单个变量
ansible-vault encrypt_string 'my-super-secret-password' --name 'db_password'
```

```yaml
# vault/production.yml（加密存储，以下为解密后的明文示例）
---
app_key: "base64:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
app_debug: false

db_host: "10.0.2.10"
db_port: 3306
db_database: "kkday_prod"
db_username: "kkday_app"
db_password: "xxxxxxxxxxxxxxxxxxxx"

redis_password: "xxxxxxxxxxxxxxxxxxxx"

mail_host: "smtp.kkday.com"
mail_port: 587
mail_username: "noreply@kkday.com"
mail_password: "xxxxxxxxxxxxxxxxxxxx"

stripe_key: "pk_live_xxxxxxxxxxxxxxxx"
stripe_secret: "sk_live_xxxxxxxxxxxxxxxx"

sentry_dsn: "https://xxx@sentry.io/xxx"
```

执行时带 `--ask-vault-pass` 或用 Vault password file：

```bash
# 方式一：交互式输入密码
ansible-playbook playbooks/deploy.yml --ask-vault-pass

# 方式二：使用密码文件（CI/CD 推荐，文件权限 600）
ansible-playbook playbooks/deploy.yml --vault-password-file ~/.vault_pass

# 方式三：环境变量（CI 管道）
export ANSIBLE_VAULT_PASSWORD_FILE=/tmp/vault_pass
echo "$VAULT_PASS" > /tmp/vault_pass && chmod 600 /tmp/vault_pass
ansible-playbook playbooks/deploy.yml
```

### 3.8 完整的 Provision Playbook（服务器初始化）

```yaml
# playbooks/provision.yml
---
- name: Provision Laravel Servers
  hosts: web
  become: true

  roles:
    - common
    - php
    - nginx
    - composer
    - redis
    - supervisor
    - ssl

  post_tasks:
    - name: Verify PHP version
      ansible.builtin.command: php --version
      register: php_ver
      changed_when: false

    - name: Display PHP version
      ansible.builtin.debug:
        msg: "PHP Version: {{ php_ver.stdout_lines[0] }}"

    - name: Verify Nginx is running
      ansible.builtin.systemd:
        name: nginx
        state: started
        enabled: true

    - name: Open firewall ports
      ansible.builtin.ufw:
        rule: "{{ item.rule }}"
        port: "{{ item.port }}"
        proto: "{{ item.proto | default('tcp') }}"
      loop:
        - { rule: allow, port: '22' }
        - { rule: allow, port: '80' }
        - { rule: allow, port: '443' }
      notify: Enable UFW
```

```yaml
# roles/php/tasks/main.yml
---
- name: Add PHP repository
  ansible.builtin.apt_repository:
    repo: "ppa:ondrej/php"
    update_cache: true

- name: Install PHP {{ php_version }} and extensions
  ansible.builtin.apt:
    name:
      - "php{{ php_version }}-fpm"
      - "php{{ php_version }}-cli"
      - "php{{ php_version }}-mysql"
      - "php{{ php_version }}-redis"
      - "php{{ php_version }}-mbstring"
      - "php{{ php_version }}-xml"
      - "php{{ php_version }}-curl"
      - "php{{ php_version }}-zip"
      - "php{{ php_version }}-gd"
      - "php{{ php_version }}-bcmath"
      - "php{{ php_version }}-intl"
      - "php{{ php_version }}-opcache"
      - "php{{ php_version }}-soap"
      - "php{{ php_version }}-imagick"
    state: present

- name: Configure PHP-FPM pool
  ansible.builtin.template:
    src: www.conf.j2
    dest: "/etc/php/{{ php_version }}/fpm/pool.d/www.conf"
    owner: root
    group: root
    mode: '0644'
  notify: Restart PHP-FPM

- name: Configure PHP OPcache
  ansible.builtin.template:
    src: opcache.ini.j2
    dest: "/etc/php/{{ php_version }}/mods-available/opcache.ini"
    owner: root
    group: root
    mode: '0644'
  notify: Restart PHP-FPM

- name: Configure PHP ini settings
  ansible.builtin.lineinfile:
    path: "/etc/php/{{ php_version }}/fpm/php.ini"
    regexp: "{{ item.regexp }}"
    line: "{{ item.line }}"
  loop:
    - { regexp: '^memory_limit', line: 'memory_limit = {{ php_memory_limit | default("512M") }}' }
    - { regexp: '^upload_max_filesize', line: 'upload_max_filesize = {{ php_upload_max | default("20M") }}' }
    - { regexp: '^post_max_size', line: 'post_max_size = {{ php_post_max | default("25M") }}' }
    - { regexp: '^max_execution_time', line: 'max_execution_time = {{ php_max_exec_time | default(300) }}' }
  notify: Restart PHP-FPM
```

### 3.9 回滚 Playbook

```yaml
# playbooks/rollback.yml
---
- name: Rollback Laravel Application
  hosts: web
  become: true

  vars:
    rollback_to: "{{ lookup('pipe', 'ls -1t ' + app_releases_dir + ' | head -2 | tail -1') }}"

  tasks:
    - name: Find current release
      ansible.builtin.command: readlink -f {{ app_current_link }}
      register: current_release
      changed_when: false

    - name: Find previous release
      ansible.builtin.shell: "ls -1t {{ app_releases_dir }} | head -2 | tail -1"
      register: previous_release
      changed_when: false

    - name: Confirm rollback
      ansible.builtin.debug:
        msg: |
          ⚠️  Rolling back:
          From: {{ current_release.stdout }}
          To:   {{ app_releases_dir }}/{{ previous_release.stdout }}

    - name: Symlink to previous release
      ansible.builtin.file:
        src: "{{ app_releases_dir }}/{{ previous_release.stdout }}"
        dest: "{{ app_current_link }}"
        state: link
        force: true
      notify: Restart PHP-FPM

    - name: Rollback database migrations (DANGEROUS)
      ansible.builtin.command:
        cmd: "php artisan migrate:rollback --force"
        chdir: "{{ app_current_link }}"
      when: rollback_migrations | default(false)
      register: rollback_result
      failed_when: rollback_result.rc != 0

    - name: Clear all caches
      ansible.builtin.command:
        cmd: "php artisan {{ item }}"
        chdir: "{{ app_current_link }}"
      loop:
        - config:clear
        - cache:clear
        - route:clear
        - view:clear

    - name: Health check after rollback
      ansible.builtin.uri:
        url: "http://127.0.0.1{{ health_check_url }}"
        status_code: 200
        timeout: 10
      register: health
      until: health.status == 200
      retries: 10
      delay: 5
```

### 3.10 与 GitHub Actions 集成

```yaml
# .github/workflows/deploy.yml
---
name: Deploy to Production
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    concurrency: production-deploy  # 防止并发部署

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install Ansible
        run: pip install ansible boto3 botocore

      - name: Setup SSH key
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.DEPLOY_SSH_KEY }}" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key

      - name: Setup Vault password
        run: |
          echo "${{ secrets.ANSIBLE_VAULT_PASS }}" > /tmp/vault_pass
          chmod 600 /tmp/vault_pass

      - name: Deploy
        env:
          ANSIBLE_HOST_KEY_CHECKING: 'False'
        run: |
          ansible-playbook \
            -i inventories/production/hosts.yml \
            --vault-password-file /tmp/vault_pass \
            playbooks/deploy.yml

      - name: Notify Slack
        if: always()
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          channel: '#deployments'
          fields: repo,message,commit,author
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

## 四、踩坑记录

### 踩坑 1：Jinja2 模板中 `| default()` 的陷阱

**问题：** 当变量值为 `0`（零）时，`| default('fallback')` 会把 `0` 当作 falsy，返回 `'fallback'`。

```jinja2
{# ❌ 错误：当 port=0 时会返回 3306 #}
{{ port | default(3306) }}

{# ✅ 正确：显式判断 undefined #}
{{ port if port is defined else 3306 }}
```

**实际影响：** 我们的 Redis 密码恰好是空字符串 `""`，`| default('my_password')` 把空字符串当 falsy，导致写入了一个不存在的密码，Redis 连接全部失败。

### 踩坑 2：Handler 的执行时机

**问题：** Handler 默认在 Play 结束时才执行，不是在 `notify` 调用时立即执行。如果你在中间某个 Task 需要重启后的状态，Handler 还没执行。

```yaml
# ❌ 可能有问题：config:cache 依赖新的 .env，但 .env 的 handler 还没执行
- name: Update .env
  template:
    src: env.j2
    dest: "{{ app_dir }}/.env"
  notify: Restart PHP-FPM  # 此时还没重启！

- name: Cache config (用的可能是旧 .env)
  command: php artisan config:cache

# ✅ 方案一：用 meta: flush_handlers 强制立即执行 handler
- name: Update .env
  template:
    src: env.j2
    dest: "{{ app_dir }}/.env"
  notify: Restart PHP-FPM

- name: Force handlers to run NOW
  ansible.builtin.meta: flush_handlers

- name: Cache config (现在用的是新 .env)
  command: php artisan config:cache

# ✅ 方案二：不用 handler，直接用 systemd 模块
- name: Restart PHP-FPM immediately
  ansible.builtin.systemd:
    name: php8.0-fpm
    state: restarted
```

### 踩坑 3：`command` vs `shell` 模块

**问题：** `command` 模块不经过 shell，所以管道 `|`、重定向 `>`、变量展开 `$VAR` 都不生效。

```yaml
# ❌ 不工作：command 不支持管道
- name: Find old releases
  ansible.builtin.command: ls -1t /var/www/releases | tail -n +6
  register: old_releases

# ✅ 正确：用 shell 模块
- name: Find old releases
  ansible.builtin.shell: ls -1t /var/www/releases | tail -n +6
  register: old_releases
  args:
    executable: /bin/bash
```

**最佳实践：** 优先用 `command`（更安全），需要 shell 特性时才用 `shell`。

### 踩坑 4：`become: true` 与 SSH 转发

**问题：** `become: true`（sudo）会切换用户，但 `SSH agent forwarding` 也随之失效。导致 Git clone 时找不到 deploy key。

```yaml
# ❌ 问题场景：sudo 后 deploy_key 不可访问
- name: Clone repo
  ansible.builtin.git:
    repo: "git@github.com:org/repo.git"
    dest: /var/www/app
    key_file: /home/deploy/.ssh/deploy_key
  become: true  # sudo www-data，但 deploy_key 属于 deploy 用户

# ✅ 解决方案一：先 clone 再改权限（不用 become 做 git 操作）
- name: Clone repo (as deploy user)
  ansible.builtin.git:
    repo: "git@github.com:org/repo.git"
    dest: "{{ release_dir }}"
    key_file: "~/.ssh/deploy_key"
  # 不用 become

- name: Fix ownership
  ansible.builtin.file:
    path: "{{ release_dir }}"
    owner: www-data
    group: www-data
    recurse: true
  become: true

# ✅ 解决方案二：用 HTTPS + Token 代替 SSH key
- name: Clone repo
  ansible.builtin.git:
    repo: "https://x-access-token:{{ github_token }}@github.com/org/repo.git"
    dest: "{{ release_dir }}"
```

### 踩坑 5：`serial` 部署时变量不一致

**问题：** 使用 `serial: 1`（滚动部署）时，每个 batch 的 `ansible_date_time.epoch` 值不同，导致每台服务器的 release 目录名不一样。

```yaml
# ❌ 每台服务器生成不同的 timestamp
- hosts: web
  serial: 1
  tasks:
    - name: Set timestamp
      set_fact:
        release_dir: "/var/www/releases/{{ ansible_date_time.epoch }}"
    # web-01: /var/www/releases/1717200001
    # web-02: /var/www/releases/1717200015  ← 不一样！

# ✅ 在 Play 级别设置一次，所有 host 共享
- hosts: web
  serial: 1
  vars:
    deploy_timestamp: "{{ lookup('pipe', 'date +%s') }}"
    release_dir: "/var/www/releases/{{ deploy_timestamp }}"
  tasks:
    - name: Use consistent release_dir
      debug:
        msg: "Deploying to {{ release_dir }}"
```

### 踩坑 6：Ansible 2.x → 2.15+ 的 FQCN 迁移

**问题：** Ansible 2.15 开始要求使用 Fully Qualified Collection Names (FQCN)，旧写法会产生 deprecation warning。

```yaml
# ❌ 旧写法（2.15+ 有 warning）
- name: Install package
  apt:
    name: nginx
    state: present

- name: Run command
  command: php artisan migrate
  register: result

# ✅ 新写法（FQCN）
- name: Install package
  ansible.builtin.apt:
    name: nginx
    state: present

- name: Run command
  ansible.builtin.command: php artisan migrate
  register: result
```

**建议：** 新项目一律用 FQCN，旧项目可以用 `ansible-lint --fix` 批量迁移。

### 踩坑 7：`no_log: true` 的必要性

**问题：** `ansible.builtin.debug` 和 `register` 默认会把所有变量输出到日志。如果不加 `no_log: true`，Vault 加密的密码会出现在 CI/CD 日志中。

```yaml
# ❌ 危险：密码会出现在 Ansible 输出中
- name: Set database password
  ansible.builtin.template:
    src: env.j2
    dest: /var/www/app/.env

# ✅ 安全：抑制日志输出
- name: Set database password
  ansible.builtin.template:
    src: env.j2
    dest: /var/www/app/.env
  no_log: true
```

### 踩坑 8：`--check` 模式下的 idempotency 验证

**问题：** 某些 `shell`/`command` 模块在 `--check` 模式下仍会执行（因为 Ansible 无法预测它们是否有副作用）。

```yaml
# 建议：用 changed_when 和 check_mode 控制行为
- name: Run artisan optimize
  ansible.builtin.command:
    cmd: php artisan optimize
    chdir: "{{ app_dir }}"
  changed_when: true
  check_mode: false  # check 模式下也执行（因为它是安全的）
```

## 五、对比/选型建议

### Ansible vs 其他部署方案

| 维度 | Ansible | Deployer (PHP) | Capistrano | Terraform + CI | shell 脚本 |
|------|---------|----------------|------------|----------------|-----------|
| 学习曲线 | 中等 | 低（PHP 生态） | 中等 | 高 | 最低 |
| 幂等性 | ✅ 大部分模块 | ✅ 内置任务 | ✅ 内置任务 | ✅ | ❌ 手动实现 |
| 系统配置管理 | ✅ 完整 | ❌ 只管部署 | ❌ 只管部署 | ✅ 基础设施 | ❌ |
| 无 Agent | ✅ SSH | ✅ SSH | ✅ SSH | ❌ 需要 Provider | ✅ SSH |
| 密钥管理 | ✅ Vault | ❌ 需外挂 | ❌ 需外挂 | ✅ TF Vault | ❌ |
| 回滚能力 | ✅ | ✅ 内置 | ✅ 内置 | 需手动 | ❌ |
| 社区生态 | ★★★★★ | ★★★☆☆ | ★★★☆☆ | ★★★★★ | N/A |
| 适合规模 | 10-1000 台 | 1-10 台 | 1-50 台 | 任意 | 1-5 台 |
| PHP 项目友好 | ★★★★☆ | ★★★★★ | ★★★★☆ | ★★★☆☆ | ★★★☆☆ |

### 我的建议

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 单体 Laravel，1-3 台服务器 | **Deployer** | PHP 生态原生，开箱即用 |
| Laravel 微服务，10+ 台服务器 | **Ansible** | Role 复用、系统配置管理 |
| 基础设施 + 应用部署 | **Terraform + Ansible** | TF 管基础设施，Ansible 管配置和部署 |
| 快速原型，临时项目 | **shell 脚本** | 够用就行，别过度工程化 |
| 企业级，100+ 服务器 | **Ansible + AWX/Tower** | Web UI、RBAC、审计日志 |

### Ansible + Deployer 组合方案

我们最终采用的是 **Ansible + Deployer 组合**：

```
┌─────────────────────────────────────────┐
│              GitHub Actions              │
│                                         │
│  1. Ansible Provision（首次/系统变更）     │
│     - 安装 PHP、Nginx、Supervisor        │
│     - 配置防火墙、SSH、用户权限           │
│     - 生成 .env（从 Vault）              │
│                                         │
│  2. Deployer Deploy（日常部署）           │
│     - Git pull → Composer install       │
│     - Artisan migrate → Cache           │
│     - Symlink 原子切换                   │
│     - Health check                      │
│                                         │
│  3. Ansible Rollback（异常回滚）          │
│     - 切换 symlink 到上一个 release       │
│     - 重启 PHP-FPM                      │
└─────────────────────────────────────────┘
```

这样做的好处是：
- **系统配置用 Ansible**：Role 复用，声明式管理
- **应用部署用 Deployer**：PHP 生态原生，内置 Laravel 任务
- **回滚用 Ansible**：Playbook 标准化，CI 直接调用

## 六、总结与最佳实践

### 核心收获

1. **幂等性是第一原则**：每个 Task 都应该可以安全地重复执行。用 `creates`/`removes` 参数、`changed_when`、`when` 条件确保幂等。

2. **Role 要小而美**：一个 Role 只管一件事（PHP、Nginx、Supervisor），不要做成万能 Role。

3. **Vault 是底线**：任何敏感信息都不能明文出现在 Playbook、Inventory 或 Git 中。

4. **Handler 要理解时机**：默认在 Play 结束执行，需要立即执行用 `meta: flush_handlers`。

5. **滚动部署用 `serial`**：配合 `max_fail_percentage` 实现零停机部署，一台失败全部回滚。

6. **Health check 不可省**：部署后必须验证应用是否正常，不能假设 "执行成功 = 部署成功"。

7. **`--check` 和 `--diff` 是好朋友**：每次改 Playbook 后先 dry-run 检查，避免生产事故。

8. **日志要脱敏**：涉及密码的 Task 加 `no_log: true`，CI/CD 日志也要脱敏。

### 生产级 Checklist

```yaml
# 生产部署前检查清单
pre_deploy:
  - [ ] Playbook 语法检查 (ansible-playbook --syntax-check)
  - [ ] Dry-run 验证 (ansible-playbook --check --diff)
  - [ ] Vault 密码可用
  - [ ] SSH 连通性正常
  - [ ] 目标服务器磁盘空间充足
  - [ ] 数据库备份已完成

deploy:
  - [ ] 滚动部署（serial: 1）
  - [ ] 只在第一台执行 migrate
  - [ ] Health check 通过
  - [ ] 旧 release 保留 5 个

post_deploy:
  - [ ] 监控指标正常（错误率、响应时间）
  - [ ] 队列 Worker 已重启
  - [ ] 日志无异常
  - [ ] Slack 通知已发送
```

### 一句话总结

> **Ansible 让部署从"手工 SSH + bash 脚本"进化为"声明式基础设施管理"，关键不是它有多强大，而是它让部署流程变得可审计、可复现、可回滚。**

## 七、Ansible 测试与调试技巧

在生产环境运行 Playbook 之前，务必在本地或 Staging 先验证。以下是我们的日常测试流程：

### 7.1 使用 ansible-lint 静态检查

```bash
# 安装 ansible-lint
pip install ansible-lint

# 检查整个项目
ansible-lint playbooks/deploy.yml

# 只检查特定规则（如幂等性）
ansible-lint -t idempotency playbooks/deploy.yml

# 自动修复可修复的问题
ansible-lint --fix playbooks/deploy.yml
```

常见的 lint 报错及修复：

| 规则 ID | 问题描述 | 修复方式 |
|---------|---------|---------|
| `yaml[line-length]` | YAML 行超过 160 字符 | 拆分为多行 |
| `name[missing]` | Task 缺少 `name` 字段 | 添加描述性 name |
| `fqcn[canonical]` | 使用短模块名 | 改用 `ansible.builtin.xxx` |
| `risky-shell-pipe` | shell 模块使用管道 | 改用 `command` 或加 `failed_when` |
| `no-changed-when` | shell/command 缺少 `changed_when` | 添加 `changed_when` 条件 |

### 7.2 使用 Molecule 测试 Role

[Molecule](https://molecule.readthedocs.io/) 是 Ansible Role 的测试框架，类似 PHPUnit 之于 PHP。

```bash
# 安装 Molecule（含 Docker 驱动）
pip install molecule molecule-docker docker

# 在 Role 目录下初始化测试场景
cd roles/php
 molecule init scenario -d docker

# 运行完整测试周期（create → converge → verify → destroy）
molecule test

# 只运行 converge（应用 Playbook）
molecule converge

# 登录到测试容器调试
molecule login

# 运行 idempotency 测试（第二次 converge 应无 changed）
molecule idempotence
```

Molecule 配置文件示例：

```yaml
# roles/php/molecule/default/molecule.yml
---
dependency:
  name: galaxy
driver:
  name: docker
platforms:
  - name: php-test
    image: geerlingguy/docker-ubuntu2204-ansible:latest
    pre_build_image: true
    privileged: true
    volumes:
      - /sys/fs/cgroup:/sys/fs/cgroup:rw
    command: /lib/systemd/systemd
provisioner:
  name: ansible
  inventory:
    host_vars:
      php-test:
        php_version: "8.2"
        php_memory_limit: "256M"
verifier:
  name: ansible
```

验证 Playbook 示例：

```yaml
# roles/php/molecule/default/verify.yml
---
- name: Verify PHP installation
  hosts: all
  gather_facts: false
  tasks:
    - name: Check PHP version
      ansible.builtin.command: php --version
      register: php_version
      changed_when: false

    - name: Assert PHP version is correct
      ansible.builtin.assert:
        that:
          - "'PHP 8.2' in php_version.stdout"
        fail_msg: "Expected PHP 8.2, got: {{ php_version.stdout_lines[0] }}"

    - name: Check required PHP extensions
      ansible.builtin.command: "php -m"
      register: php_modules
      changed_when: false

    - name: Assert extensions are loaded
      ansible.builtin.assert:
        that:
          - "'{{ item }}' in php_modules.stdout"
        fail_msg: "Missing PHP extension: {{ item }}"
      loop:
        - mbstring
        - xml
        - curl
        - mysql
        - redis
        - gd
```

### 7.3 Dry-run 与调试命令速查

```bash
# 语法检查（不执行任何任务）
ansible-playbook playbooks/deploy.yml --syntax-check

# Dry-run（--check 模式，不实际修改）
ansible-playbook playbooks/deploy.yml --check --diff -i inventories/staging/hosts.yml

# 只运行特定 Tag
ansible-playbook playbooks/deploy.yml --tags "nginx,php"

# 跳过特定 Tag
ansible-playbook playbooks/deploy.yml --skip-tags "migrate"

# 详细输出（-vvvv 最详细，用于 SSH 调试）
ansible-playbook playbooks/deploy.yml -vvvv 2>&1 | tee ansible-debug.log

# 只在特定主机运行
ansible-playbook playbooks/deploy.yml --limit web-01

# 列出所有任务（不执行）
ansible-playbook playbooks/deploy.yml --list-tasks

# 列出所有主机
ansible-playbook playbooks/deploy.yml --list-hosts

# 使用 ad-hoc 命令快速测试连通性
ansible web -m ping -i inventories/production/hosts.yml

# 收集主机 Facts（调试变量）
ansible web-01 -m setup -i inventories/production/hosts.yml | grep ansible_distribution
```

### 7.4 性能优化配置

当管理的服务器数量增多时，Ansible 执行速度可能变慢。以下是我们在 `ansible.cfg` 中的优化配置：

```ini
# ansible.cfg
[defaults]
# 开启 SSH pipelining（减少 SSH 连接次数，提速 2-5 倍）
pipelining = True

# 开启 fact 缓存（避免每次 gather_facts 重复收集）
gathering = smart
fact_caching = jsonfile
fact_caching_connection = /tmp/ansible_facts_cache
fact_caching_timeout = 86400  # 缓存 24 小时

# 控制并行度（默认 5，生产建议根据服务器数量调整）
forks = 10

# 关闭 host key 检查（CI 环境）
host_key_checking = False

# 超时设置
timeout = 30

[ssh_connection]
# SSH 多路复用（复用已建立的 SSH 连接）
ssh_args = -o ControlMaster=auto -o ControlPersist=60s -o StrictHostKeyChecking=no
control_path_dir = ~/.ssh/ansible-cp

# 使用 SCP 代替 SFTP（某些环境下更快）
scp_if_ssh = smart
```

> **注意：** `pipelining = True` 需要目标机器的 `/etc/sudoers` 中关闭 `requiretty`。如果遇到权限错误，在 sudoers 中添加 `Defaults:deploy !requiretty`。

---

*本文基于 KKday B2C Backend Team 的真实运维经验，涉及 30+ 个 Laravel 微服务的 Ansible 管理实践。所有代码示例均来自生产环境（已脱敏）。*

## 相关阅读

- [Terraform 实战：Laravel 应用基础设施即代码（IaC）— 从手动点 AWS 控制台到代码化部署的踩坑记录](/categories/07_CICD/Terraform-实战-Laravel-应用基础设施即代码-IaC-从手动-AWS-控制台到代码化部署踩坑记录/) — Terraform 管基础设施，Ansible 管配置和部署，两者互补
- [金丝雀发布实战：渐进式流量放量——Nginx/Envoy 权重路由与 Laravel 版本共存](/categories/07_CICD/Canary-Deployment-渐进式流量放量-Nginx-Envoy权重路由与Laravel版本共存/) — 在 Ansible 滚动部署基础上进一步实现流量级别的渐进发布
- [GitHub Actions 矩阵策略实战：多 PHP 版本、多数据库的并行测试与条件发布](/categories/07_CICD/GitHub-Actions-矩阵策略实战-多PHP版本多数据库并行测试与条件发布/) — CI 阶段的自动化测试与 Ansible 部署流水线的集成实践
- [GitHub Actions 自定义 Action 开发实战：复用 CI/CD 工作流组件](/categories/07_CICD/GitHub-Actions-自定义-Action-开发实战-复用-CICD-工作流组件踩坑记录/) — 将 Ansible 部署步骤封装为可复用的 GitHub Actions 组件
