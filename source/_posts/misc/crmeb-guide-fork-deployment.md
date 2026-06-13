---

title: CRMEB-开源商城二次实战-从-fork-到生产部署踩坑记录
keywords: [CRMEB, fork, 开源商城二次实战, 到生产部署踩坑记录]
cover: https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
date: 2026-05-05 10:15:59
updated: 2026-05-05 10:23:51
categories:
- misc
tags:
- Docker
- Nginx
- ThinkPHP
- 二次开发
- crmeb
- 架构
description: 基于 CRMEB 开源商城系统的真实二次开发经验，完整记录从 fork 上游仓库、本地环境搭建、核心模块定制开发到生产环境部署的全流程实战。覆盖目录结构解析、支付/商品/订单模块改造、Docker 容器化部署、Nginx 反向配置以及上线后踩过的 12 个真实坑点。
---



# CRMEB 开源商城二次实战：从 Fork 到生产部署踩坑记录

> 本文基于 [CRMEB](https://github.com/crmeb/crmeb_java) 开源商城系统的真实二次开发项目经验，记录从 fork 到生产部署的完整生命周期。不是概念介绍，是真刀真枪改了 60+ 文件、踩了 12 个坑、最终跑在生产环境上的实战复盘。

---

## 一、为什么选 CRMEB 做二次开发？

在接到来自东南亚客户的 B2C 电商需求时，我们在「从零开发」和「基于开源二次开发」之间做了评估：

| 维度 | 从零开发 | CRMEB 二次开发 |
|------|----------|----------------|
| 上线周期 | 3-4 个月 | 4-6 周 |
| 基础功能 | 需全部自建 | 商品/订单/支付/用户/营销已就绪 |
| 技术债 | 可控 | 需接受上游架构约束 |
| 维护成本 | 完全自主 | 需同步上游安全补丁 |

CRMEB 的优势在于**功能完整度高**——商品管理、订单流程、支付对接（微信/支付宝）、分销系统、营销活动（秒杀/拼团/优惠券）都开箱即用。我们的二次开发主要集中在三个方向：

1. **支付通道扩展**：增加东南亚本地支付（GrabPay、PromptPay）
2. **商品模型改造**：支持多 SKU 组合 + 自定义属性
3. **订单流程定制**：增加预售、分批发货、售后自动化

<!-- more -->

## 二、Fork 与本地环境搭建

### 2.1 Fork 策略

```bash
# 1. Fork 到组织账号
# GitHub UI: https://github.com/crmeb/crmeb_java → Fork

# 2. Clone 到本地
git clone git@github.com:your-org/crmeb-custom.git
cd crmeb-custom

# 3. 添加上游 remote（方便后续同步安全补丁）
git remote add upstream https://github.com/crmeb/crmeb_java.git

# 4. 创建开发分支（永远不动 main）
git checkout -b feature/custom-payment
```

**踩坑 #1**：不要直接在 `main` 分支上改代码。我们第一个版本就是直接改 main，结果上游发安全补丁时 cherry-pick 冲突了 40+ 文件。后来用 `git rebase -i` 重写了历史才理清。

### 2.2 目录结构解析

CRMEB Java 版的项目结构：

```
crmeb-custom/
├── crmeb-admin/          # 管理后台 API（Spring Boot）
├── crmeb-app/            # 前台商城 API（Spring Boot）
├── crmeb-common/         # 公共模块（工具类、常量、枚举）
├── crmeb-service/        # 核心业务 Service 层
│   ├── src/main/java/com/xxx/crmeb/
│   │   ├── controller/   # Controller 层
│   │   ├── service/      # Service 接口
│   │   ├── service/impl/ # Service 实现
│   │   ├── mapper/       # MyBatis Mapper
│   │   ├── entity/       # 数据库实体
│   │   └── vo/           # 视图对象
├── sql/                  # 初始化 SQL
├── docker-compose.yml    # Docker 部署配置
└── pom.xml               # Maven 父 POM
```

**踩坑 #2**：CRMEB 的 `crmeb-common` 模块被所有子模块依赖，改 common 里的任何类都会触发全量编译。我们一开始不知道，改了一个枚举值结果编译了 8 分钟。后来学会了 `mvn -pl crmeb-common -am compile` 只编译指定模块。

### 2.3 本地开发环境

```yaml
# docker-compose.dev.yml（本地开发专用）
version: '3.8'
services:
  mysql:
    image: mysql:8.0
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: dev_password_123
      MYSQL_DATABASE: crmeb
    volumes:
      - ./sql/crmeb.sql:/docker-entrypoint-initdb.d/init.sql
      - mysql_data:/var/lib/mysql

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  adminer:
    image: adminer
    ports:
      - "8080:8080"

volumes:
  mysql_data:
```

```bash
# 启动本地环境
docker compose -f docker-compose.dev.yml up -d

# 导入初始数据
docker exec -i crmeb-mysql mysql -uroot -pdev_password_123 crmeb < sql/crmeb.sql

# 启动应用（开发模式）
cd crmeb-app
mvn spring-boot:run -Dspring.profiles.active=dev
```

## 三、核心模块二次开发

### 3.1 支付通道扩展：增加 GrabPay

CRMEB 原生支持微信/支付宝，我们需要增加东南亚本地支付。核心改动：

```java
// 新增支付枚举
public enum PayTypeEnum {
    WECHAT(1, "微信支付"),
    ALIPAY(2, "支付宝"),
    GRABPAY(3, "GrabPay"),        // 新增
    PROMPTPAY(4, "PromptPay");    // 新增

    private final Integer type;
    private final String name;

    PayTypeEnum(Integer type, String name) {
        this.type = type;
        this.name = name;
    }
    // getter 省略
}
```

```java
// 新增 GrabPay 支付实现
@Service
public class GrabPayServiceImpl implements PayService {

    private final GrabPayClient grabPayClient;
    private final OrderService orderService;

    @Override
    public String createPayment(PayOrderInfo orderInfo) {
        GrabPayRequest request = GrabPayRequest.builder()
            .merchantId(grabPayConfig.getMerchantId())
            .amount(orderInfo.getPayPrice().multiply(new BigDecimal("100")).intValue())
            .currency("THB")
            .orderId(orderInfo.getOrderId())
            .callbackUrl(grabPayConfig.getCallbackUrl())
            .build();

        GrabPayResponse response = grabPayClient.createPayment(request);
        return response.getPaymentUrl(); // 返回支付跳转 URL
    }

    @Override
    public boolean verifyCallback(Map<String, String> params) {
        String sign = params.get("sign");
        String rawSign = buildSign(params); // HMAC-SHA256 签名
        return sign.equals(rawSign);
    }
}
```

**踩坑 #3**：GrabPay 的 webhook 回调是 JSON 格式，但 CRMEB 原生的支付回调处理是 form-urlencoded。我们在 Controller 层被迫写了一个适配器：

```java
@RestController
@RequestMapping("/api/pay/callback")
public class PayCallbackController {

    @PostMapping("/grabpay")
    public String grabPayCallback(HttpServletRequest request) {
        // 读取 JSON body（CRMEB 原生是 form 表单，这里需要手动解析）
        String body = request.getReader().lines().collect(Collectors.joining());
        JSONObject json = JSON.parseObject(body);

        // 转换为 CRMEB 统一的回调格式
        Map<String, String> params = new HashMap<>();
        params.put("order_id", json.getString("merchantTransactionId"));
        params.put("trade_no", json.getString("grabTransactionId"));
        params.put("sign", json.getString("sign"));

        // 走统一的支付结果处理
        payService.handleCallback(PayTypeEnum.GRABPAY, params);
        return "SUCCESS";
    }
}
```

**踩坑 #4**：GrabPay 的金额单位是「分」（100 = 1 THB），但 CRMEB 内部全部用 `BigDecimal` 元为单位存储。我们因为没做单位转换，导致一笔 299 泰铢的订单实际扣了 29900 泰铢。这个 bug 在测试环境没被发现（测试账号不真实扣款），直到生产第一笔订单才发现。教训：**支付金额必须写单元测试，而且要覆盖所有币种的精度**。

### 3.2 商品模型改造：多 SKU 组合

CRMEB 原生的商品 SKU 是简单的「规格值」组合，但客户需求是支持三级 SKU（颜色 → 尺寸 → 材质）：

```sql
-- 新增 SKU 组合表
CREATE TABLE `eb_product_sku_combination` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `product_id` bigint NOT NULL COMMENT '商品ID',
  `sku_id` bigint NOT NULL COMMENT 'SKU ID',
  `attr_value_id_1` bigint DEFAULT NULL COMMENT '一级属性值ID',
  `attr_value_id_2` bigint DEFAULT NULL COMMENT '二级属性值ID',
  `attr_value_id_3` bigint DEFAULT NULL COMMENT '三级属性值ID',
  `stock` int NOT NULL DEFAULT 0 COMMENT '库存',
  `price` decimal(10,2) NOT NULL COMMENT '价格',
  `image` varchar(500) DEFAULT NULL COMMENT 'SKU 图片',
  PRIMARY KEY (`id`),
  KEY `idx_product_sku` (`product_id`, `sku_id`),
  KEY `idx_attr_combo` (`attr_value_id_1`, `attr_value_id_2`, `attr_value_id_3`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SKU 组合表';
```

```java
// SKU 查询 Service 改造
@Service
public class ProductSkuServiceImpl implements ProductSkuService {

    /**
     * 获取商品的 SKU 矩阵（用于前端展示选择器）
     * 原版只支持二维，改造后支持三维
     */
    public SkuMatrixVO getSkuMatrix(Long productId) {
        List<ProductSkuCombination> combinations =
            skuCombinationMapper.selectByProductId(productId);

        SkuMatrixVO matrix = new SkuMatrixVO();
        // 提取所有一级属性值
        matrix.setLevel1Values(combinations.stream()
            .map(ProductSkuCombination::getAttrValueId1)
            .distinct()
            .collect(Collectors.toList()));
        // 二级、三级同理...

        // 构建 SKU 价格/库存映射（key: "attr1_attr2_attr3"）
        Map<String, SkuDetailVO> skuMap = new HashMap<>();
        for (ProductSkuCombination combo : combinations) {
            String key = combo.getAttrValueId1() + "_"
                + combo.getAttrValueId2() + "_"
                + combo.getAttrValueId3();
            skuMap.put(key, convertToDetailVO(combo));
        }
        matrix.setSkuMap(skuMap);
        return matrix;
    }
}
```

**踩坑 #5**：原版 CRMEB 的前端 SKU 选择器是硬编码两层的 JavaScript。我们改成三层后，需要联动刷新价格和库存。前端同事写了一个递归生成器，但没处理「某些组合不存在」的边界情况——比如「红色 + XL + 纯棉」有库存，但「红色 + XL + 亚麻」不存在。结果用户选到最后一步时页面白屏。解法：前端在渲染前先查询 `skuMap` 做可用性过滤。

### 3.3 订单流程定制：预售 + 分批发货

```java
// 订单状态机扩展
public enum OrderStatusEnum {
    PENDING_PAYMENT(0, "待付款"),
    PAID(1, "已付款"),
    PRE_SALE(2, "预售中"),           // 新增
    PARTIAL_SHIPPED(3, "部分发货"),   // 新增
    SHIPPED(4, "已发货"),
    COMPLETED(5, "已完成"),
    CANCELLED(6, "已取消"),
    REFUNDING(7, "退款中");

    private final Integer status;
    private final String name;
}

// 分批发货 Service
@Service
public class PartialShipmentServiceImpl {

    @Transactional(rollbackFor = Exception.class)
    public void shipPartial(ShipmentRequest request) {
        OrderInfo order = orderService.getById(request.getOrderId());

        // 校验：不能超过总数量
        List<ShipmentRecord> existingRecords =
            shipmentRecordMapper.selectByOrderId(order.getId());
        int totalShipped = existingRecords.stream()
            .mapToInt(ShipmentRecord::getQuantity).sum();

        if (totalShipped + request.getQuantity() > order.getTotalNum()) {
            throw new CrmebException("发货数量超过订单总量");
        }

        // 记录本次发货
        ShipmentRecord record = new ShipmentRecord();
        record.setOrderId(order.getId());
        record.setQuantity(request.getQuantity());
        record.setTrackingNo(request.getTrackingNo());
        record.setCarrier(request.getCarrier());
        shipmentRecordMapper.insert(record);

        // 判断是否全部发完
        if (totalShipped + request.getQuantity() >= order.getTotalNum()) {
            orderService.updateStatus(order.getId(), OrderStatusEnum.SHIPPED);
        } else {
            orderService.updateStatus(order.getId(), OrderStatusEnum.PARTIAL_SHIPPED);
        }
    }
}
```

**踩坑 #6**：CRMEB 的订单表 `eb_order` 里有一个 `paid_num` 字段（已发货数量），但原版只在整单发货时更新。我们分批发货后这个字段没同步更新，导致后台列表的「发货状态」显示错误。后来加了定时任务每小时校验一次，但更好的做法是在 `shipPartial()` 里直接更新。

## 四、生产环境部署架构

### 4.1 整体架构图

```
                    ┌─────────────────────────────────────────────────┐
                    │                    CDN (阿里云)                   │
                    │              静态资源 / 前端 H5 / 小程序          │
                    └──────────────────────────┬──────────────────────┘
                                               │
                                               ▼
                    ┌──────────────────────────────────────────────────┐
                    │              Nginx (SSL + 反向代理)                │
                    │    /api/admin/*  → crmeb-admin:8080              │
                    │    /api/app/*    → crmeb-app:8081                │
                    │    /upload/*     → 静态文件 (OSS)                 │
                    └─────┬─────────────────────┬──────────────────────┘
                          │                     │
                          ▼                     ▼
               ┌──────────────────┐   ┌──────────────────┐
               │  crmeb-admin     │   │  crmeb-app        │
               │  (Spring Boot)   │   │  (Spring Boot)    │
               │  管理后台 API     │   │  前台商城 API      │
               └────────┬─────────┘   └────────┬──────────┘
                        │                       │
                        ▼                       ▼
               ┌─────────────────────────────────────────┐
               │          MySQL 8.0 (主从)                │
               │          Redis 7 (缓存 + 队列)           │
               └─────────────────────────────────────────┘
```

### 4.2 Docker Compose 生产配置

```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  nginx:
    image: nginx:1.24-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d
      - ./nginx/ssl:/etc/nginx/ssl
      - ./uploads:/var/www/uploads
    depends_on:
      - crmeb-admin
      - crmeb-app
    restart: always

  crmeb-admin:
    image: your-registry/crmeb-admin:${VERSION}
    environment:
      - SPRING_PROFILES_ACTIVE=prod
      - DB_HOST=mysql-master
      - DB_PORT=3306
      - DB_NAME=crmeb
      - DB_USER=${DB_USER}
      - DB_PASS=${DB_PASS}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      mysql-master:
        condition: service_healthy
      redis:
        condition: service_started
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '1.0'
    restart: always

  crmeb-app:
    image: your-registry/crmeb-app:${VERSION}
    environment:
      - SPRING_PROFILES_ACTIVE=prod
      - DB_HOST=mysql-master
      - DB_PORT=3306
      - DB_NAME=crmeb
      - DB_USER=${DB_USER}
      - DB_PASS=${DB_PASS}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 1G
          cpus: '1.0'
    restart: always

  mysql-master:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASS}
      MYSQL_DATABASE: crmeb
    volumes:
      - mysql_data:/var/lib/mysql
      - ./mysql/conf.d:/etc/mysql/conf.d
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASS} --maxmemory 512mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    restart: always

volumes:
  mysql_data:
  redis_data:
```

**踩坑 #7**：CRMEB 默认的配置文件里数据库连接池用的是 HikariCP 默认配置（最大连接数 10）。生产环境两个 `crmeb-app` 实例 + 一个 `crmeb-admin` 实例，加起来才 30 个连接。但大促时并发请求涌入，连接池直接打满，日志疯狂报 `Connection is not available, request timed out`。后来调到了：

```yaml
# application-prod.yml
spring:
  datasource:
    hikari:
      maximum-pool-size: 30
      minimum-idle: 10
      connection-timeout: 30000
      idle-timeout: 600000
      max-lifetime: 1800000
```

**踩坑 #8**：Nginx 配置里没有设置 `proxy_read_timeout`。CRMEB 的报表导出接口（导出 Excel）在数据量大时需要 30-60 秒，Nginx 默认 60 秒超时刚好卡在边界。偶尔超时、偶尔成功，排查了很久才发现。最终设置：

```nginx
location /api/admin/ {
    proxy_pass http://crmeb-admin:8080;
    proxy_read_timeout 300s;    # 报表导出接口需要更长超时
    proxy_send_timeout 300s;
    proxy_connect_timeout 10s;
    proxy_buffering off;         # 流式响应关闭缓冲
}
```

### 4.3 CI/CD 流水线

```yaml
# .github/workflows/deploy.yml
name: Build and Deploy

on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Build with Maven
        run: mvn clean package -DskipTests -pl crmeb-admin,crmeb-app -am

      - name: Build Docker images
        run: |
          docker build -t $REGISTRY/crmeb-admin:${{ github.sha }} -f crmeb-admin/Dockerfile .
          docker build -t $REGISTRY/crmeb-app:${{ github.sha }} -f crmeb-app/Dockerfile .

      - name: Push to Registry
        run: |
          echo ${{ secrets.REGISTRY_PASS }} | docker login -u ${{ secrets.REGISTRY_USER }} --password-stdin
          docker push $REGISTRY/crmeb-admin:${{ github.sha }}
          docker push $REGISTRY/crmeb-app:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/v')
    steps:
      - name: Deploy to production
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.PROD_HOST }}
          username: ${{ secrets.PROD_USER }}
          key: ${{ secrets.PROD_SSH_KEY }}
          script: |
            cd /opt/crmeb
            export VERSION=${{ github.sha }}
            docker compose -f docker-compose.prod.yml pull
            docker compose -f docker-compose.prod.yml up -d --remove-orphans
            # 等待健康检查
            sleep 30
            curl -f http://localhost:8080/actuator/health || exit 1
```

**踩坑 #9**：我们一开始没有 `--remove-orphans` 参数，导致旧版容器残留。更新后新旧两个版本的 `crmeb-app` 同时注册到 Nginx upstream，请求随机打到旧容器上，出现「更新了代码但没生效」的假象。

## 五、上线后踩坑集锦

### 踩坑 #10：MySQL 字符集不一致

CRMEB 初始化 SQL 用的是 `utf8`（MySQL 的 3 字节 UTF-8），但东南亚语言（泰语、越南语）的某些字符需要 4 字节。商品名称包含 emoji 或特殊字符时直接报 `Incorrect string value`。

```sql
-- 修复：将所有表转为 utf8mb4
ALTER DATABASE crmeb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 批量转换表（写成脚本跑）
SELECT CONCAT('ALTER TABLE `', TABLE_NAME, '` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;')
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'crmeb' AND TABLE_TYPE = 'BASE TABLE';
```

### 踩坑 #11：Redis Key 命名冲突

CRMEB 和另一个项目共用同一个 Redis 实例（客户为了省钱），key 前缀都是 `crmeb:`。导致缓存数据互相覆盖。解法：加环境前缀。

```yaml
# application-prod.yml
redis:
  key-prefix: "prod_crmeb:"
```

### 踩坑 #12：定时任务重复执行

CRMEB 用 `@Scheduled` 做定时任务（自动取消超时订单、自动确认收货等）。但我们部署了 2 个 `crmeb-app` 实例，定时任务在两个实例上同时跑，导致订单被重复取消。

```java
// 解决方案：用 ShedLock 做分布式锁
@Scheduled(cron = "0 */5 * * * ?")
@SchedulerLock(name = "cancelTimeoutOrders",
    lockAtLeastFor = "PT4M",   // 至少锁 4 分钟
    lockAtMostFor = "PT5M")    // 最多锁 5 分钟
public void cancelTimeoutOrders() {
    orderService.cancelTimeoutOrders();
}
```

```xml
<!-- pom.xml 添加 ShedLock 依赖 -->
<dependency>
    <groupId>net.javacrumbs.shedlock</groupId>
    <artifactId>shedlock-spring</artifactId>
    <version>5.10.0</version>
</dependency>
<dependency>
    <groupId>net.javacrumbs.shedlock</groupId>
    <artifactId>shedlock-provider-jdbc-template</artifactId>
    <version>5.10.0</version>
</dependency>
```

## 六、经验总结

```
┌───────────────────────────────────────────────────────────────┐
│              CRMEB 二次开发的关键决策树                          │
│                                                                │
│  需要改动 < 20 个文件？                                         │
│  ├── 是 → 直接改，维护成本可控                                  │
│  └── 否 → 考虑是否 fork 成本过高，是否应该自研                   │
│                                                                │
│  改动涉及核心模块（支付/订单/库存）？                             │
│  ├── 是 → 必须写完整的集成测试，不能只靠手动测试                  │
│  └── 否 → 单元测试 + 手动测试即可                               │
│                                                                │
│  需要同步上游更新？                                              │
│  ├── 是 → 保持自定义代码在独立文件/模块中，减少冲突面              │
│  └── 否 → 可以自由改，但要做好安全审计                           │
└───────────────────────────────────────────────────────────────┘
```

### 核心教训

## 七、环境要求对比

部署 CRMEB 前，务必确认服务器环境满足以下要求。不同版本的 CRMEB 对环境依赖有差异，以下是基于 CRMEB Java 版（v4.x）的实测对比：

| 环境项 | 最低要求 | 推荐配置 | 备注 |
|--------|---------|---------|------|
| 操作系统 | CentOS 7+ / Ubuntu 18.04+ | Ubuntu 22.04 LTS | Debian 系优于 RHEL 系，包管理更方便 |
| Java | JDK 11+ | JDK 17 (Temurin) | JDK 8 已不支持 Spring Boot 3.x |
| MySQL | 5.7+ | 8.0 | 必须用 utf8mb4 字符集，否则东南亚语言报错 |
| Redis | 6.0+ | 7.x (Alpine) | 需开启持久化，生产环境建议 512MB+ 内存 |
| Node.js | 16+ | 18 LTS | 仅管理后台前端构建需要 |
| Maven | 3.6+ | 3.9.x | 低于 3.8 可能遇到依赖解析问题 |
| Docker | 20.10+ | 24.x + Compose V2 | 生产环境推荐容器化部署 |
| 最低内存 | 2GB | 4GB（admin + app 各 1GB） | 单实例 2GB 够用，双实例建议 4GB+ |
| 磁盘空间 | 20GB | 50GB+ SSD | 含上传文件、日志、MySQL 数据 |

> ⚠️ **注意**：CRMEB 的 PHP 版和 Java 版环境要求差异极大。PHP 版需要 LNMP 环境（PHP 7.4+、Nginx、MySQL），Java 版需要 JDK + Spring Boot 运行时。选型时务必确认版本。

## 八、常见部署问题排查指南

### 8.1 启动报错：`Access denied for user 'root'@'localhost'`

**现象**：应用启动时 MySQL 连接被拒绝。

**排查步骤**：
1. 确认 MySQL 容器已启动：`docker ps | grep mysql`
2. 检查 MySQL 健康状态：`docker exec mysql mysqladmin ping -h localhost -uroot -p${PASS}`
3. 确认 `application-prod.yml` 中的 `DB_USER`、`DB_PASS` 与 MySQL 初始化一致
4. 检查 MySQL 是否只允许本地连接：`SELECT user, host FROM mysql.user;`

**解决**：如果是密码错误，重建 MySQL 容器并正确设置 `MYSQL_ROOT_PASSWORD` 环境变量。

### 8.2 前端页面空白：API 返回 404

**现象**：后台管理页面打开后一片空白，浏览器控制台显示 `/api/admin/` 请求返回 404。

**排查步骤**：
1. 检查 Nginx 配置中的 `proxy_pass` 是否指向正确的容器名和端口
2. 运行 `docker exec nginx curl -v http://crmeb-admin:8080/actuator/health` 测试 Nginx 到后端的连通性
3. 确认 `crmeb-admin` 容器日志无异常：`docker logs crmeb-admin --tail 50`

**常见原因**：`docker-compose.prod.yml` 中 `depends_on` 不会等待容器完全就绪，需要配合 `healthcheck` 使用。

### 8.3 上传图片失败：`413 Request Entity Too Large`

**现象**：上传商品图片时返回 413 错误。

**解决**：修改 Nginx 配置，增加 `client_max_body_size`：
```nginx
client_max_body_size 50m;
```
同时检查 Spring Boot 的文件大小限制：
```yaml
spring:
  servlet:
    multipart:
      max-file-size: 50MB
      max-request-size: 100MB
```

### 8.4 WebSocket / 小程序实时消息不通

**现象**：WebSocket 连接建立失败，或小程序消息推送不及时。

**排查步骤**：
1. 确认 Nginx 已配置 WebSocket 升级：
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```
2. 检查防火墙是否开放了 WebSocket 端口
3. 证书是否支持 WSS（HTTPS 下的 WebSocket）

### 8.5 Docker 镜像构建失败：`mvn: command not found`

**现象**：CI/CD 构建阶段报找不到 Maven。

**原因**：Dockerfile 中未正确安装 Maven，或使用了精简基础镜像。

**解决**：使用官方 Maven 镜像作为构建阶段：
```dockerfile
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn clean package -DskipTests

FROM eclipse-temurin:17-jre
COPY --from=builder /app/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### 核心教训

| # | 教训 | 代价 |
|---|------|------|
| 1 | 永远不要在 main 分支直接改 | 2 天重写 Git 历史 |
| 2 | 支付金额必须写单元测试 | 生产多扣 100 倍 |
| 3 | 数据库字符集一开始就用 utf8mb4 | 上线后迁移影响服务 2 小时 |
| 4 | 多实例部署必须处理定时任务重复 | 订单被重复取消 |
| 5 | 连接池配置不能用默认值 | 大促时接口全面超时 |
| 6 | Nginx 超时要覆盖最慢接口 | 报表导出偶发失败 |
| 7 | Docker 更新加 --remove-orphans | 旧容器残留导致「幽灵 bug」 |
| 8 | Redis 加环境 key 前缀 | 缓存数据互相覆盖 |

CRMEB 是一个优秀的开源商城系统，但二次开发的隐性成本在于：**你需要理解它的架构约定，然后在这个约定下做扩展，而不是对抗它。** 如果改动量超过 60 个文件，认真考虑一下自研是否更划算。

---

## 相关阅读

- [Eventual Consistency 实战：最终一致性在电商场景中的工程化](/Eventual-Consistency-实战-最终一致性在电商场景中的工程化-反压冲突解决与用户感知延迟/) — 电商场景中分布式一致性问题的深度剖析
- [OpenHuman Cloud Deploy 实战：云端部署与多设备同步](/OpenHuman-Cloud-Deploy-实战-云端部署与多设备同步/) — 多环境云部署方案与容器编排经验
- [WebAssembly (Wasm) 实战：PHP 开发者的跨平台新赛道](/WebAssembly-Wasm实战-用Rust-AssemblyScript编写高性能浏览器模块-PHP开发者的跨平台新赛道/) — PHP 生态的跨平台技术探索
