---

title: phpunit.jenkins.xml 实战：Laravel 项目自动化测试流水线配置
cover: https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=630&fit=crop
date: 2026-05-05 02:00:14
updated: 2026-05-05 02:02:25
categories:
  - devops
  - cicd
keywords: [phpunit.jenkins.xml, Laravel, 项目自动化测试流水线配置]
tags:
- CI/CD
- Laravel
- PHPUnit
- Jenkins
- 自动化
- 持续集成
- 测试
description: 基于 Laravel 项目的 PHPUnit 与 Jenkins 自动化测试流水线完整实战指南。从零搭建 phpunit.jenkins.xml 配置文件，详解 CI/CD 环境下数据库隔离策略、XML 报告输出、代码覆盖率门禁、PCOV 性能优化、Paratest 并行加速，以及内存泄漏、顺序依赖、Mock 耦合等 8 大踩坑解决方案，附 30+ 微服务持续集成统一模板方案。
---



# phpunit.jenkins.xml 实战：Laravel 项目自动化测试流水线配置

## 为什么需要独立的 phpunit.jenkins.xml？

在本地开发时，我们用 `phpunit.xml` 跑测试，它连接本地 MySQL/Redis，输出到终端。但在 Jenkins CI 环境中，需求完全不同：

| 差异点 | 本地 phpunit.xml | Jenkins 专用配置 |
|--------|------------------|------------------|
| 数据库 | localhost:3306 | jenkins-mysql:3306（Docker 网络） |
| Redis | 127.0.0.1 | redis-ci:6379 |
| 日志输出 | terminal | JUnit XML + HTML report |
| 覆盖率 | 不关心（或 Xdebug） | 必须生成 Clover XML |
| 环境变量 | .env | Jenkins credentials 注入 |
| 超时 | 不限 | 单个测试 60s，总测试 300s |

**核心原则**：`phpunit.xml` 是开发用的，`phpunit.jenkins.xml` 是 CI 用的。两者维护不同的 `.env` 和 reporter 配置，互不干扰。

---

## 1. phpunit.jenkins.xml 完整配置

```xml
<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
         verbose="true"
         beStrictAboutTestsThatDoNotTestAnything="true"
         beStrictAboutOutputDuringTests="true"
         failOnRisky="true"
         failOnWarning="true"
         stopOnFailure="false"
         stopOnError="false"
         executionOrder="random"
         cacheResultFile=".phpunit.result.cache.jenkins">

    <testsuites>
        <!-- 单元测试：快速反馈 -->
        <testsuite name="Unit">
            <directory suffix="Test.php">./tests/Unit</directory>
            <exclude>./tests/Unit/Legacy</exclude>
        </testsuite>

        <!-- Feature 测试：API 集成验证 -->
        <testsuite name="Feature">
            <directory suffix="Test.php">./tests/Feature</directory>
            <exclude>./tests/Feature/SkipOnCI</exclude>
        </testsuite>

        <!-- BFF 契约测试：跨服务验证 -->
        <testsuite name="Contract">
            <directory suffix="Test.php">./tests/Contract</directory>
        </testsuite>
    </testsuites>

    <coverage processUncoveredFiles="true">
        <include>
            <directory suffix=".php">./app</directory>
            <exclude>
                <directory suffix=".php">./app/Console</directory>
                <file>./app/Providers/AppServiceProvider.php</file>
                <directory suffix=".php">./app/Http/Middleware</directory>
            </exclude>
        </include>
        <report>
            <!-- Jenkins Clover 插件读取 -->
            <clover outputFile="build/logs/clover.xml"/>
            <!-- HTML 报告供人工查看 -->
            <html outputDirectory="build/coverage-html"/>
        </report>
    </coverage>

    <logging>
        <!-- Jenkins JUnit 插件读取 -->
        <junit outputFile="build/logs/junit.xml"/>
    </logging>

    <php>
        <!-- 环境覆盖：强制测试环境 -->
        <env name="APP_ENV" value="testing"/>
        <env name="DB_CONNECTION" value="mysql"/>
        <env name="DB_HOST" value="mysql-ci"/>
        <env name="DB_PORT" value="3306"/>
        <env name="DB_DATABASE" value="test_${BUILD_NUMBER}"/>
        <env name="DB_USERNAME" value="root"/>
        <env name="DB_PASSWORD" value=""/>
        <env name="CACHE_DRIVER" value="redis"/>
        <env name="REDIS_HOST" value="redis-ci"/>
        <env name="QUEUE_CONNECTION" value="sync"/>
        <env name="MAIL_MAILER" value="array"/>
        <env name="SESSION_DRIVER" value="array"/>
        <env name="BCRYPT_ROUNDS" value="4"/>
        <!-- 禁用外部 API 调用 -->
        <env name="GATEWAY_TIMEOUT" value="3"/>
        <env name="MOCK_EXTERNAL_API" value="true"/>
    </php>
</phpunit>
```

### 关键配置解析

**`executionOrder="random"`** — 强制随机执行顺序，暴露测试间隐式依赖。我们在一个 30+ 仓库的项目中，靠这个发现了 7 个「顺序依赖」bug：某个测试的副作用被另一个测试依赖了。

**`processUncoveredFiles="true"`** — 默认 PHPUnit 只统计被触及的文件覆盖率。开启后，未被任何测试引用的文件也会被计入，覆盖率数字更真实。

**`DB_DATABASE` 使用 `test_${BUILD_NUMBER}`** — 每次构建用独立数据库，避免并行构建互相污染。Jenkins 环境变量 `${BUILD_NUMBER}` 会自动注入。

---

## 2. Jenkinsfile 配置

```groovy
pipeline {
    agent {
        docker {
            image 'php:8.0-fpm'
            args '-v /var/run/docker.sock:/var/run/docker.sock'
        }
    }

    environment {
        COMPOSER_HOME = "${WORKSPACE}/.composer"
        COMPOSER_CACHE_DIR = "${WORKSPACE}/.composer/cache"
    }

    options {
        timeout(time: 15, unit: 'MINUTES')
        timestamps()
        ansiColor('xterm')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                sh '''
                    composer install \
                        --no-interaction \
                        --prefer-dist \
                        --no-progress \
                        --optimize-autoloader
                '''
            }
        }

        stage('Prepare Environment') {
            steps {
                sh '''
                    cp .env.ci .env
                    php artisan key:generate
                    php artisan config:cache
                '''
            }
        }

        stage('Migrate & Seed') {
            steps {
                sh '''
                    php artisan migrate --force
                    php artisan db:seed --force
                '''
            }
        }

        stage('Run Tests') {
            parallel {
                stage('Unit Tests') {
                    steps {
                        sh '''
                            vendor/bin/phpunit \
                                --configuration phpunit.jenkins.xml \
                                --testsuite Unit \
                                --log-junit build/logs/junit-unit.xml \
                                --coverage-clover build/logs/clover-unit.xml
                        '''
                    }
                    post {
                        always {
                            junit 'build/logs/junit-unit.xml'
                        }
                    }
                }

                stage('Feature Tests') {
                    steps {
                        sh '''
                            vendor/bin/phpunit \
                                --configuration phpunit.jenkins.xml \
                                --testsuite Feature \
                                --log-junit build/logs/junit-feature.xml
                        '''
                    }
                    post {
                        always {
                            junit 'build/logs/junit-feature.xml'
                        }
                    }
                }
            }
        }

        stage('Coverage Report') {
            steps {
                publishHTML(target: [
                    allowMissing: false,
                    alwaysLinkToLastBuild: true,
                    keepAll: true,
                    reportDir: 'build/coverage-html',
                    reportFiles: 'index.html',
                    reportName: 'Coverage Report'
                ])

                // Clover 覆盖率门禁
                sh '''
                    COVERAGE=$(php -r "
                        \$xml = simplexml_load_file('build/logs/clover.xml');
                        \$metrics = \$xml->project->metrics;
                        \$covered = (int)\$metrics['coveredstatements'];
                        \$total = (int)\$metrics['statements'];
                        echo \$total > 0 ? round(\$covered / \$total * 100, 2) : 0;
                    ")
                    echo "Coverage: ${COVERAGE}%"
                    if [ $(echo "$COVERAGE < 70" | bc) -eq 1 ]; then
                        echo "ERROR: Coverage ${COVERAGE}% < 70% threshold"
                        exit 1
                    fi
                '''
            }
        }

        stage('Static Analysis') {
            steps {
                sh '''
                    vendor/bin/phpstan analyse \
                        --configuration=phpstan.neon \
                        --error-format=junit > build/logs/phpstan.xml \
                    || true
                '''
            }
        }
    }

    post {
        always {
            sh 'php artisan migrate:rollback --force || true'
        }

        failure {
            slackSend(
                channel: '#ci-alerts',
                color: 'danger',
                message: "❌ Build #${BUILD_NUMBER} failed: ${env.JOB_NAME}"
            )
        }

        success {
            slackSend(
                channel: '#ci-alerts',
                color: 'good',
                message: "✅ Build #${BUILD_NUMBER} passed: ${env.JOB_NAME}"
            )
        }
    }
}
```

---

## 3. 踩坑记录

### 坑 1：数据库并行冲突

**现象**：两个并行构建同时跑 `php artisan migrate`，报 `Table already exists`。

**根因**：Jenkins 默认多个 executor 共享同一个 MySQL 实例，数据库名冲突。

**解决**：用 `BUILD_NUMBER` 做数据库名隔离，`phpunit.jenkins.xml` 中：

```xml
<env name="DB_DATABASE" value="test_${BUILD_NUMBER}"/>
```

Jenkins pipeline 中在 `Prepare Environment` 阶段动态创建数据库：

```groovy
stage('Prepare Environment') {
    steps {
        sh '''
            mysql -h mysql-ci -u root -e \
              "CREATE DATABASE IF NOT EXISTS test_${BUILD_NUMBER};"
        '''
    }
}
```

构建结束后在 `post.always` 清理：

```groovy
post {
    always {
        sh '''
            mysql -h mysql-ci -u root -e \
              "DROP DATABASE IF EXISTS test_${BUILD_NUMBER};" || true
        '''
    }
}
```

### 坑 2：Xdebug 覆盖率导致超时

**现象**：开启 Xdebug coverage 后，Feature 测试从 45s 飙到 8 分钟。

**根因**：Xdebug 的 `xdebug.mode=coverage` 会对每一行 PHP 代码做 hook，开销巨大。

**解决**：

1. **只在需要覆盖率的 stage 开启 Xdebug**，其他 stage 用 PCOV：

```groovy
stage('Unit Tests (with Coverage)') {
    steps {
        sh '''
            php -d xdebug.mode=coverage \
                vendor/bin/phpunit \
                --configuration phpunit.jenkins.xml \
                --testsuite Unit \
                --coverage-clover build/logs/clover-unit.xml
        '''
    }
}

stage('Feature Tests (fast, no coverage)') {
    steps {
        sh '''
            php -d xdebug.mode=off \
                vendor/bin/phpunit \
                --configuration phpunit.jenkins.xml \
                --testsuite Feature
        '''
    }
}
```

2. **升级 PCOV 替代 Xdebug**（推荐）：

```dockerfile
# Dockerfile.ci
FROM php:8.0-fpm

RUN pecl install pcov && docker-php-ext-enable pcov
ENV pcov.enabled=1
```

PCOV 比 Xdebug 快 **3-5 倍**，在 30+ 仓库的 CI 中实测：Feature 测试 + 覆盖率从 8 分钟降到 2 分钟。

### 坑 3：Jenkins JUnit XML 中文乱码

**现象**：测试名称含中文时，Jenkins JUnit 报告显示 `????`。

**根因**：PHPUnit 生成的 XML 文件缺少 `encoding="UTF-8"` 声明（某些版本 bug）。

**解决**：在 `phpunit.jenkins.xml` 顶部显式声明：

```xml
<?xml version="1.0" encoding="UTF-8"?>
```

同时 Jenkins 系统配置 → Manage Jenkins → System Properties 加入：

```properties
file.encoding=UTF-8
sun.jnu.encoding=UTF-8
```

### 坑 4：测试套件拆分后跳过某些测试

**场景**：某些测试只能在本地跑（依赖本地 VPN、本地文件系统等），CI 环境应跳过。

**解决**：使用 PHPUnit 的 `group` 机制：

```php
// tests/Feature/LocalOnlyTest.php

/**
 * @group local-only
 */
class LocalOnlyTest extends TestCase
{
    public function test_requires_local_vpn(): void
    {
        // 只在本地环境跑
    }
}
```

在 `phpunit.jenkins.xml` 中排除该 group：

```xml
<testsuites>
    <testsuite name="Feature">
        <directory suffix="Test.php">./tests/Feature</directory>
        <exclude>./tests/Feature/SkipOnCI</exclude>
    </testsuite>
</testsuites>
```

Jenkinsfile 中：

```groovy
sh '''
    vendor/bin/phpunit \
        --configuration phpunit.jenkins.xml \
        --exclude-group local-only
'''
```

### 坑 5：Redis 缓存导致测试状态污染

**现象**：单独跑 A 测试通过，单独跑 B 测试通过，一起跑 A 失败。

**根因**：Feature 测试中某接口缓存了数据到 Redis，另一个测试读到了脏缓存。

**解决**：在 `phpunit.jenkins.xml` 中使用 `array` 缓存驱动，或在 `TestCase` 的 `setUp` 中强制清除：

```php
// tests/TestCase.php
protected function setUp(): void
{
    parent::setUp();

    if (config('cache.default') === 'redis') {
        Redis::flushdb();
    }
}
```

更稳妥的做法：CI 环境使用 `array` 作为缓存驱动，在 `phpunit.jenkins.xml` 中：

```xml
<env name="CACHE_DRIVER" value="array"/>
<env name="SESSION_DRIVER" value="array"/>
<env name="QUEUE_CONNECTION" value="sync"/>
```

---

## 4. 多仓库统一方案（30+ 微服务）

在 KKday 的 B2C 后端团队中，30+ 个 Laravel 微服务仓库需要统一 CI 配置。我们采用以下方案：

### 4.1 共享 phpunit.jenkins.xml 模板

在内部 Composer 私有包 `kkday/ci-config` 中维护模板：

```
kkday/ci-config/
├── phpunit.jenkins.xml.dist
├── Jenkinsfile.template
├── phpstan.neon.dist
└── .env.ci.example
```

每个微服务仓库通过 `composer require kkday/ci-config --dev` 安装，然后在 CI 脚本中：

```groovy
stage('Prepare CI Config') {
    steps {
        sh '''
            cp vendor/kkday/ci-config/phpunit.jenkins.xml.dist phpunit.jenkins.xml
            # 动态替换仓库特定的环境变量
            sed -i "s/\${DB_DATABASE}/test_${BUILD_NUMBER}/g" phpunit.jenkins.xml
        '''
    }
}
```

### 4.2 Jenkins Shared Library

将公共 pipeline 逻辑抽到 Jenkins Shared Library：

```groovy
// vars/kkdayPipeline.groovy
def call(Map config = [:]) {
    pipeline {
        agent { docker { image config.get('phpImage', 'php:8.0-fpm') } }

        stages {
            stage('Test') {
                steps {
                    script {
                        def suites = config.get('testSuites', ['Unit', 'Feature'])
                        suites.each { suite ->
                            sh "vendor/bin/phpunit --configuration phpunit.jenkins.xml --testsuite ${suite}"
                        }
                    }
                }
            }
        }

        post {
            always { junit 'build/logs/junit*.xml' }
        }
    }
}
```

每个微服务的 `Jenkinsfile` 简化到：

```groovy
@Library('kkday-shared-lib') _

kkdayPipeline(
    phpImage: 'php:8.0-fpm',
    testSuites: ['Unit', 'Feature', 'Contract']
)
```

---

## 5. 完整目录结构

```
project-root/
├── phpunit.xml                  # 本地开发用
├── phpunit.jenkins.xml          # Jenkins CI 专用
├── .env.ci                      # CI 环境变量
├── Jenkinsfile                  # 流水线定义
├── phpstan.neon                 # 静态分析配置
├── build/
│   ├── logs/
│   │   ├── junit.xml            # JUnit 报告
│   │   └── clover.xml           # 覆盖率报告
│   └── coverage-html/           # HTML 覆盖率
├── tests/
│   ├── Unit/
│   ├── Feature/
│   ├── Contract/
│   └── TestCase.php
└── app/
```

---

## 6. CI 环境下测试数据库的隔离策略

在 CI 环境中，数据库隔离是保证测试可靠性的关键。以下是三种主流方案及其适用场景：

### 方案一：SQLite in-memory（推荐小型项目）

SQLite 内存数据库无需额外服务，启动速度快，适合单元测试和简单的 Feature 测试：

```xml
<!-- phpunit.jenkins.xml -->
<php>
    <env name="DB_CONNECTION" value="sqlite"/>
    <env name="DB_DATABASE" value=":memory:"/>
</php>
```

```php
// database/migrations 目录下确保迁移兼容 SQLite
// 避免使用 MySQL 特有的 JSON 索引、全文索引等
Schema::table('posts', function (Blueprint $table) {
    // SQLite 不支持 ALGORITHM=INSTANT
    $table->string('slug')->nullable()->change();
});
```

**优点**：零依赖、极速启动、天然隔离（内存数据库每次重建）。

**缺点**：不支持 MySQL 特有语法（如 `JSON_CONTAINS`、`FULLTEXT` 索引），Feature 测试中使用原生 SQL 的场景可能失败。

### 方案二：Docker MySQL 容器（推荐中大型项目）

使用 Docker Compose 在 CI 中启动独立的 MySQL 容器，与生产环境保持一致：

```yaml
# docker-compose.ci.yml
version: '3.8'
services:
  mysql-ci:
    image: mysql:8.0
    environment:
      MYSQL_ALLOW_EMPTY_PASSWORD: 'yes'
      MYSQL_DATABASE: test_${BUILD_NUMBER}
    ports:
      - "3306:3306"
    command: >
      --default-authentication-plugin=mysql_native_password
      --innodb-buffer-pool-size=256M
      --max-connections=100
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Jenkinsfile 中集成 Docker Compose：

```groovy
stage('Start Services') {
    steps {
        sh '''
            docker-compose -f docker-compose.ci.yml up -d
            # 等待 MySQL 就绪
            timeout 60 bash -c "until docker-compose exec mysql-ci mysqladmin ping -h localhost; do sleep 2; done"
        '''
    }
}
```

### 方案三：Testbench + 数据库事务回滚

Laravel 的 `RefreshDatabase` trait 会在每个测试后回滚迁移，适合 Feature 测试：

```php
use Illuminate\Foundation\Testing\RefreshDatabase;

class OrderTest extends TestCase
{
    use RefreshDatabase;

    public function test_create_order(): void
    {
        // 每个测试方法运行前自动 migrate:fresh
        // 运行后自动 rollback，数据完全隔离
        $order = Order::factory()->create();
        $this->assertDatabaseHas('orders', ['id' => $order->id]);
    }
}
```

**注意**：`RefreshDatabase` 会增加测试时间（每个测试方法都会 migrate）。对于大量测试，推荐使用 `DatabaseMigrations` trait 一次性迁移，或在 `TestCase::setUp()` 中手动控制。

### 方案对比

| 方案 | 启动速度 | MySQL 兼容性 | 隔离性 | 适用场景 |
|------|----------|-------------|--------|----------|
| SQLite in-memory | ⚡ 极快 | ❌ 部分不兼容 | ✅ 天然隔离 | 纯单元测试 |
| Docker MySQL | 🐢 较慢 | ✅ 完全兼容 | ✅ 独立容器 | Feature/集成测试 |
| 事务回滚 | ⚡ 快 | ✅ 完全兼容 | ⚠️ 需要 trait | 单个测试类 |

**最佳实践**：Unit 测试用 SQLite in-memory，Feature 测试用 Docker MySQL + `RefreshDatabase`，两者通过不同的 `phpunit.jenkins.xml` testsuite 配置区分。

---

## 7. 测试覆盖率报告的生成与 Jenkins 集成

### 7.1 覆盖率驱动选择

| 驱动 | 性能 | 安装难度 | 推荐场景 |
|------|------|----------|----------|
| Xdebug | 慢（3-5x 开销） | 预装 | 调试时使用 |
| PCOV | 快（接近原生） | `pecl install pcov` | CI 环境首选 |
| phpdbg | 快 | 预装 | 已弃用，不推荐 |

**推荐在 CI 中使用 PCOV**，它比 Xdebug 快 3-5 倍，且支持 PHPUnit 的覆盖率收集：

```dockerfile
# Dockerfile.ci - 带 PCOV 的 PHP 镜像
FROM php:8.2-fpm

RUN pecl install pcov && docker-php-ext-enable pcov
ENV pcov.enabled=1
ENV pcov.directory=/var/www/html/app
```

### 7.2 生成多种覆盖率格式

```bash
# Clover XML - Jenkins Clover 插件读取
vendor/bin/phpunit --configuration phpunit.jenkins.xml \
    --coverage-clover build/logs/clover.xml

# HTML 报告 - 人工查看
vendor/bin/phpunit --configuration phpunit.jenkins.xml \
    --coverage-html build/coverage-html

# Cobertura XML - Jenkins Cobertura 插件
vendor/bin/phpunit --configuration phpunit.jenkins.xml \
    --coverage-cobertura build/logs/cobertura.xml
```

### 7.3 Jenkins 覆盖率门禁

在 Jenkinsfile 中添加覆盖率门禁，低于阈值则构建失败：

```groovy
stage('Coverage Gate') {
    steps {
        script {
            // 使用 Clover PHP 库解析覆盖率
            sh '''
                COVERAGE=$(php -r "
                    \\$xml = simplexml_load_file('build/logs/clover.xml');
                    \\$metrics = \\$xml->project->metrics;
                    \\$covered = (int)\\$metrics['coveredstatements'];
                    \\$total = (int)\\$metrics['statements'];
                    echo \\$total > 0 ? round(\\$covered / \\$total * 100, 2) : 0;
                ")
                echo "Current Coverage: ${COVERAGE}%"
                if [ $(echo "$COVERAGE < 70" | bc) -eq 1 ]; then
                    echo "❌ Coverage ${COVERAGE}% is below 70% threshold"
                    currentBuild.result = 'FAILURE'
                    error "Coverage gate failed"
                fi
            '''
        }
    }
    post {
        always {
            // 发布 HTML 覆盖率报告
            publishHTML(target: [
                allowMissing: false,
                alwaysLinkToLastBuild: true,
                keepAll: true,
                reportDir: 'build/coverage-html',
                reportFiles: 'index.html',
                reportName: 'Coverage Report'
            ])

            // 发布 Clover 覆盖率趋势
            publishHTML(target: [
                allowMissing: true,
                alwaysLinkToLastBuild: true,
                keepAll: true,
                reportDir: 'build/logs',
                reportFiles: 'clover.xml',
                reportName: 'Clover Coverage'
            ])
        }
    }
}
```

### 7.4 覆盖率趋势可视化

安装 Jenkins 的 **Clover PHP Plugin** 或 **Coverage Plugin**，可以：

- 查看每次构建的覆盖率变化趋势图
- 按模块（Unit/Feature）分别查看覆盖率
- 邮件通知覆盖率下降超过 5% 的构建

```groovy
// Jenkinsfile - 趋势报告
recordCoverage(
    tools: [[parser: 'COBERTURA', pattern: 'build/logs/cobertura.xml']],
    sourceDirectory: 'app'
)
```

---

## 8. 并行测试加速：Paratest

当测试数量增长到数千个时，串行执行会成为瓶颈。**Paratest** 可以利用多核 CPU 并行运行测试：

### 8.1 安装与配置

```bash
composer require --dev brianium/paratest
```

```bash
# 使用 4 个进程并行运行
vendor/bin/paratest \
    --configuration phpunit.jenkins.xml \
    --processes 4 \
    --runner WrapperRunner \
    --coverage-clover build/logs/clover.xml \
    --coverage-html build/coverage-html
```

### 8.2 与 Jenkins 集成

```groovy
stage('Parallel Tests') {
    steps {
        sh '''
            # 自动检测 CPU 核心数
            PROCESSORS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
            vendor/bin/paratest \
                --configuration phpunit.jenkins.xml \
                --processes $PROCESSORS \
                --runner WrapperRunner \
                --log-junit build/logs/junit.xml \
                --coverage-clover build/logs/clover.xml
        '''
    }
}
```

### 8.3 Paratest 注意事项

1. **数据库隔离**：每个 Paratest 进程需要独立的数据库连接，否则会冲突。推荐使用 `test_${BUILD_NUMBER}_${TEST_TOKEN}` 模式：

```php
// tests/TestCase.php
protected function setUp(): void
    {
        parent::setUp();

        // 为每个 Paratest 进程分配独立数据库
        $token = env('TEST_TOKEN', '1');
        config(['database.connections.mysql.database' => 'test_' . $token]);
    }
}
```

2. **静态属性污染**：Paratest 多进程运行，但共享内存空间。避免在测试中使用静态属性或单例。

3. **文件锁**：如果测试写入文件（如日志、临时文件），需要使用文件锁或唯一文件名。

### 8.4 性能对比

| 测试数量 | 串行执行 | Paratest (4进程) | 加速比 |
|----------|----------|------------------|--------|
| 500 个 | 8 分钟 | 2.5 分钟 | 3.2x |
| 1000 个 | 15 分钟 | 4.5 分钟 | 3.3x |
| 2000 个 | 28 分钟 | 8 分钟 | 3.5x |

**注意**：Paratest 与覆盖率收集结合时，需要合并多个进程的覆盖率数据，PCOV 支持此功能，Xdebug 也支持但更慢。

---

## 9. 高级踩坑：内存泄漏、测试顺序依赖、Mock 策略

### 坑 6：内存泄漏导致测试 OOM

**现象**：测试运行到 70% 左右时，报 `PHP Fatal error: Allowed memory size exhausted`。

**根因**：
- Laravel 的 `RefreshDatabase` trait 在每个测试后回滚但不释放内存
- 大量 Factory 创建的对象未被 GC 回收
- Event Listener 累积注册

**解决方案**：

```php
// tests/TestCase.php
abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;

    protected function tearDown(): void
    {
        parent::tearDown();

        // 强制垃圾回收
        if (gc_enabled()) {
            gc_collect_cycles();
        }

        // 清除 Laravel 缓存的实例
        $this->app->forgetScopedInstances();
    }
}
```

```bash
# Jenkinsfile 中增加内存限制
php -d memory_limit=512M vendor/bin/phpunit \
    --configuration phpunit.jenkins.xml
```

**进阶方案**：使用 `--no-coverage` 运行非覆盖率测试，覆盖率收集单独跑一个 testsuite。

### 坑 7：测试顺序依赖

**现象**：`--order-by=defects` 或随机顺序下，某些测试间歇性失败。

**根因**：测试 A 修改了数据库/缓存/文件，测试 B 隐式依赖了测试 A 的副作用。

**排查方法**：

```bash
# 使用 bisect 定位互相依赖的测试
vendor/bin/phpunit --configuration phpunit.jenkins.xml --order-by=random --random-state-seed=1234
# 如果失败，换 seed 再试
vendor/bin/phpunit --configuration phpunit.jenkins.xml --order-by=random --random-state-seed=5678
# 如果一个 seed 失败另一个成功，说明有顺序依赖
# 使用 PHPUnit 的 --bisect 找出最小失败集
vendor/bin/phpunit --configuration phpunit.jenkins.xml --filter "testA|testB|testC" --bisect
```

**解决方案**：

1. **每个测试自给自足**：使用 `RefreshDatabase` 或 `DatabaseTransactions` 确保数据隔离
2. **避免共享状态**：不在测试类的静态属性中存储状态
3. **明确设置随机种子**：在 Jenkinsfile 中记录种子值，便于复现

```groovy
// Jenkinsfile - 记录随机种子
sh '''
    SEED=$(date +%s)
    echo "Random seed: $SEED"
    vendor/bin/phpunit --configuration phpunit.jenkins.xml \
        --random-order-seed=$SEED
'''
```

### 坑 8：Mock 策略不当导致测试脆弱

**现象**：重构代码后，大量测试失败，但实际功能没有变化。

**根因**：过度 Mock 内部实现细节，导致测试与实现耦合。

**Mock 策略最佳实践**：

```php
// ❌ 错误：Mock 内部方法调用
class OrderServiceTest extends TestCase
{
    public function test_create_order(): void
    {
        $mock = $this->mock(OrderRepository::class);
        $mock->expects('save')->once()->andReturn(new Order());
        // 这种写法与内部实现耦合，重构时容易失败
    }
}

// ✅ 正确：Mock 外部依赖（HTTP、队列、文件系统）
class OrderServiceTest extends TestCase
{
    public function test_create_order_sends_notification(): void
    {
        Queue::fake();

        $order = OrderService::create(['product_id' => 1, 'quantity' => 2]);

        Queue::assertPushed(SendOrderNotification::class, function ($job) use ($order) {
            return $job->order->id === $order->id;
        });
    }
}
```

**Mock 分层策略**：

| 层级 | Mock 策略 | 工具 |
|------|----------|------|
| 外部 API | 必须 Mock | `Http::fake()`、Guzzle MockHandler |
| 队列/邮件 | 必须 Mock | `Queue::fake()`、`Mail::fake()` |
| 数据库 | 真实数据库（测试专用） | `RefreshDatabase` |
| 文件系统 | 可选 Mock | `Storage::fake()` |
| 内部服务 | 不 Mock | 直接调用真实实现 |

```php
// 外部 API Mock 示例
use Illuminate\Support\Facades\Http;

class PaymentServiceTest extends TestCase
{
    public function test_payment_success(): void
    {
        Http::fake([
            'api.payment-gateway.com/*' => Http::response([
                'status' => 'success',
                'transaction_id' => 'txn_12345'
            ], 200),
        ]);

        $result = PaymentService::charge(100.00);

        $this->assertTrue($result->success);
        $this->assertEquals('txn_12345', $result->transactionId);
    }
}
```

---

## 10. phpunit.jenkins.xml 与普通 phpunit.xml 的差异对照

为了让团队成员快速理解两个配置文件的用途差异，以下是完整的对照表：

| 配置项 | phpunit.xml（本地） | phpunit.jenkins.xml（CI） |
|--------|---------------------|--------------------------|
| `executionOrder` | `default`（按文件顺序） | `random`（暴露顺序依赖） |
| `stopOnFailure` | `true`（快速反馈） | `false`（跑完所有测试） |
| `beStrictAboutTestsThatDoNotTestAnything` | `false` | `true`（严格检查） |
| `cacheResultFile` | `.phpunit.result.cache` | `.phpunit.result.cache.jenkins` |
| `DB_CONNECTION` | `mysql`（本地） | `sqlite` 或 `mysql`（CI 容器） |
| `CACHE_DRIVER` | `redis`（本地） | `array`（无状态） |
| `QUEUE_CONNECTION` | `redis`（本地） | `sync`（同步执行） |
| `MAIL_MAILER` | `smtp`（本地 Mailpit） | `array`（不发邮件） |
| 覆盖率输出 | 可选 | 必须（Clover XML） |
| 日志格式 | terminal | JUnit XML（Jenkins 插件） |
| 超时控制 | 无 | 单测试 60s，总测试 300s |

**核心原则**：本地配置追求开发体验（快速反馈、连接真实服务），CI 配置追求可靠性（严格检查、环境隔离、报告输出）。

---

## 总结

| 实践 | 效果 |
|------|------|
| 独立 `phpunit.jenkins.xml` | 本地和 CI 环境彻底隔离 |
| 数据库名加 `BUILD_NUMBER` | 并行构建不再冲突 |
| PCOV 替代 Xdebug | 覆盖率收集提速 3-5x |
| `@group local-only` 跳过本地测试 | CI 不再因环境问题失败 |
| Shared Library 统一 pipeline | 30+ 仓库维护成本降低 80% |
| 覆盖率门禁 70% | 代码质量有底线保障 |

Jenkins + phpunit.jenkins.xml 的组合虽然没有 GitHub Actions 那么「现代」，但在企业内网环境下（私有 GitLab、VPN 隔离、合规审计）依然是最稳妥的选择。关键是把 CI 配置当作代码来管理——版本化、模板化、可复用。

---

## 相关阅读

- [PHPUnit 断言实战：Beyond assertEquals——掌握 expect、mock、stub 踩坑记录](/categories/PHP/phpunit-guide-beyond-assertequals-expect-mock-stub/) — PHPUnit Mock/Stub/断言体系详解，与本文 Mock 策略章节互补
- [PHPUnit 11.x 实战：新特性与最佳实践](/categories/05_PHP/Laravel/phpunit-11-x-guide-best-practices/) — PHPUnit 11 升级踩坑与 Attributes/Expectation API 新特性，与本文 PHPUnit 配置形成互补
- [Pest PHP 3.x 实战：简洁优雅的 PHP 测试框架深度剖析](/categories/PHP/pest-php-3x-elegant-php-testing-framework/) — Pest 测试框架实战，覆盖 Datasets 数据驱动与并行测试优化
- [Pest 单元测试实战：Laravel B2C API 数据驱动与并发测试踩坑记录](/categories/PHP/pest-testingguide-concurrencytesting/) — Pest 在 Laravel 项目中的并发测试、工厂模式与数据库隔离实战
- [GitHub Actions CI/CD 优化实战：Laravel 矩阵拆分与并行发布](/categories/PHP/github-actions-ci-cd-optimizationguide-laravel-cache/) — GitHub Actions 流水线优化，与本文 Jenkins CI/CD 方案互补
- [Snapshot Testing 实战：API 响应快照回归测试](/categories/测试/snapshot-testing-api-response-regression-testing/) — 用快照守护 API 接口契约，补充集成测试策略
- [Laravel Pint + PHPStan CI 集成实战：自动化代码规范与静态分析](/categories/DevOps/laravel-pint-phpstan-ciguide-automation/) — 同属 CI/CD 体系，代码质量门禁自动化
- [代码覆盖率实战：Xdebug + Coveralls 集成与报告](/categories/Engineering/guide-xdebug-coveralls-laravel/) — 从 PHPUnit 测试到覆盖率报告的完整 CI 链路
