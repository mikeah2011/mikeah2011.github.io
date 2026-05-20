---
title: phpunit.jenkins.xml 实战：Laravel 项目自动化测试流水线配置
date: 2026-05-05 02:00:14
updated: 2026-05-05 02:02:25
categories:
  - 07_CICD
tags: [CI/CD, Laravel, 测试]description: >
  从零搭建 Jenkins + phpunit.jenkins.xml 流水线的真实踩坑记录。
  包含多环境配置分离、并行测试拆分、覆盖率报告集成、
  以及在 30+ Laravel 微服务仓库中统一 CI 配置的工程化方案。
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
