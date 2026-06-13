---
title: MySQL 数据类型选型
tags: [MySQL, 数据库, SQL, Laravel, 数据类型]
keywords: [MySQL, 数据类型选型, 数据库]
categories:
  - database
date: 2019-04-20 10:00:00
description: 'MySQL 数据类型选型完全指南：深入对比 INT/BIGINT/TINYINT 整数类型、CHAR/VARCHAR/TEXT 字符串类型、DATETIME/TIMESTAMP 时间类型、DECIMAL/FLOAT 浮点类型，结合 Laravel Eloquent 模型定义与 Migration 最佳实践，附生产环境踩坑案例与性能影响分析，帮助开发者在建表时做出正确选择。'
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
  - /images/content/databases-1-content-1.jpg
  - /images/content/databases-1-content-2.jpg

---

# 一句话

> **选最小的、能装下你数据的类型。** 类型小 = 索引小 = 内存命中率高 = 快。

# 一、整数类型

| 类型 | 字节 | 范围（无符号） | 用途 |
|---|---|---|---|
| TINYINT  | 1 | 0 ~ 255 | 状态枚举、布尔 |
| SMALLINT | 2 | 0 ~ 65535 | 较小计数 |
| MEDIUMINT | 3 | 0 ~ 1677w | 较少用 |
| **INT**  | 4 | 0 ~ 42亿 | **大多数主键、ID** |
| BIGINT   | 8 | 0 ~ 1844亿亿 | 雪花 ID、大表主键 |

```sql
-- ❌ 用户性别用 INT
gender INT
-- ✅ 用 TINYINT
gender TINYINT UNSIGNED COMMENT '0未知 1男 2女'
```

> **`INT(11)` 里的 11 不是长度**！只是显示宽度（已废弃），实际仍是 4 字节。

![MySQL 数据类型选型 - 数据结构](/images/content/databases-1-content-1.jpg)

# 二、字符串类型详细对比

| 类型 | 最大长度 | 存储开销 | 是否可索引 | 适用场景 |
|---|---|---|---|---|
| CHAR(n) | 255 字符 | 固定 n 字节 | 普通索引 | 固定长度：MD5、UUID、国家代码 |
| VARCHAR(n) | 65535 字节 | 1-2 字节长度 + 实际 | 普通索引 | 变长：用户名、邮箱、标题 |
| TINYTEXT | 255 字节 | 1 字节长度 + 实际 | 前缀索引 | 短备注 |
| TEXT | 65535 字节 | 2 字节长度 + 实际 | 前缀索引 | 文章正文、描述 |
| MEDIUMTEXT | 16MB | 3 字节长度 + 实际 | 前缀索引 | 长文章、富文本 |
| LONGTEXT | 4GB | 4 字节长度 + 实际 | 前缀索引 | 极少见，慎用 |

> **核心原则**：VARCHAR 能解决的，别用 TEXT。TEXT 列会导致临时表使用磁盘（`Using temporary`），严重影响查询性能。

## CHAR vs VARCHAR 详细对比

| 维度 | CHAR | VARCHAR |
|---|---|---|
| 存储方式 | 固定长度，不足补空格 | 1-2 字节长度前缀 + 实际内容 |
| 读取速度 | 略快（定长直接偏移） | 略慢（需解析长度前缀） |
| 空间效率 | 浪费（固定占满） | 节省（按需分配） |
| 尾部空格 | 存储时截断（MySQL 5.0.3+） | 保留 |
| 适用场景 | 长度真正固定（如 bcrypt hash CHAR(60)） | 长度变化的业务字段 |

```sql
-- CHAR(36) 存 UUID：固定 36 字符，CHAR 最合适
uuid CHAR(36) NOT NULL

-- VARCHAR(128) 存用户名：长度变化大
username VARCHAR(128) NOT NULL
```

# ENUM vs SET vs VARCHAR

| 维度 | ENUM | SET | VARCHAR + 字典表 |
|---|---|---|---|
| 存储 | 1-2 字节（内部整数） | 1-8 字节（位图） | 实际字符串长度 |
| 可选值 | 单选，最多 65535 个 | 多选，最多 64 个 | 无限制 |
| 修改选项 | 需 ALTER TABLE（锁表） | 需 ALTER TABLE（锁表） | 改字典表即可 |
| 查询 | 可直接比较字符串 | FIND_IN_SET() | JOIN 字典表 |
| 推荐度 | ⭐⭐ 不推荐 | ⭐ 不推荐 | ⭐⭐⭐⭐⭐ 推荐 |

```sql
-- ❌ ENUM：新增"待审核"状态需要 ALTER TABLE
status ENUM('active', 'inactive') NOT NULL

-- ✅ TINYINT + 字典表：灵活、高效
status TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0待审核 1正常 2禁用'
```

# 三、日期时间

| 类型 | 字节 | 范围 | 时区 |
|---|---|---|---|
| DATE      | 3 | 1000-01-01 ~ 9999-12-31 | 无 |
| TIME      | 3 | -838:59:59 ~ 838:59:59 | 无 |
| **DATETIME** | 8 | 1000 ~ 9999 | **不存时区** |
| **TIMESTAMP** | 4 | 1970 ~ 2038 | **存 UTC，按 session 时区显示** |
| YEAR      | 1 | 1901 ~ 2155 | 无 |

## DATETIME vs TIMESTAMP 详细对比

| 维度 | DATETIME | TIMESTAMP |
|---|---|---|
| 字节 | 8 字节 | 4 字节 |
| 范围 | 1000-01-01 ~ 9999-12-31 | 1970-01-01 ~ **2038-01-19 03:14:07 UTC** |
| 时区 | **不做任何转换**，存什么显示什么 | **存入时转 UTC，读取时按 session 时区转换** |
| 默认值 | 不支持自动填充（8.0 前） | `DEFAULT CURRENT_TIMESTAMP` |
| NULL 行为 | 允许 NULL | 建议 NOT NULL，否则可能被自动赋值 |
| 推荐场景 | 生日、合同到期日、跨 2038 的日期 | `created_at`、`updated_at`、日志时间 |

```sql
-- 时区行为演示：
-- session 时区 = Asia/Shanghai (UTC+8)

-- 插入 '2024-01-01 12:00:00'
INSERT INTO demo (dt, ts) VALUES ('2024-01-01 12:00:00', '2024-01-01 12:00:00');

-- 切换到 UTC 时区
SET time_zone = '+00:00';
SELECT dt, ts FROM demo;
-- dt: 2024-01-01 12:00:00  （不变）
-- ts: 2024-01-01 04:00:00  （自动转为 UTC）

-- 结论：TIMESTAMP 存储的是绝对时间点，DATETIME 存储的是字面值
```

> 2038 问题：TIMESTAMP 上限 2038-01-19 03:14:07 UTC，长期合同/出生日期一定用 DATETIME。
> MySQL 8.0.28+ 已在内部将 TIMESTAMP 改为 8 字节存储，解决了 2038 问题，但 API 层行为不变。

![MySQL 数据类型选型 - 代码实现](/images/content/databases-1-content-2.jpg)

# 四、浮点 vs 定点

| 类型 | 字节 | 精度 | 存储方式 | 用途 |
|---|---|---|---|---|
| FLOAT | 4 | 约 7 位有效数字 | IEEE 754 浮点 | 科学计算、GPS 坐标 |
| DOUBLE | 8 | 约 15 位有效数字 | IEEE 754 浮点 | 统计汇总、平均值 |
| **DECIMAL(M,D)** | 按 M 动态 | **精确到 D 位小数** | 定点 BCD | **金额、汇率、价格** |

## DECIMAL(M,D) 精度详解

`M` = 总位数（整数 + 小数），`D` = 小数位数。整数位数 = M - D。

| 定义 | 整数位 | 小数位 | 最大值 | 占用字节 | 适用 |
|---|---|---|---|---|---|
| DECIMAL(10,2) | 8 | 2 | 99,999,999.99 | 5 | 订单金额 |
| DECIMAL(12,4) | 8 | 4 | 99,999,999.9999 | 6 | 汇率（精确到万分位） |
| DECIMAL(16,8) | 8 | 8 | 99,999,999.99999999 | 8 | 加密货币价格 |
| DECIMAL(5,2) | 3 | 2 | 999.99 | 3 | 百分比评分 |
| DECIMAL(20,4) | 16 | 4 | 超大整数 + 4 位小数 | 10 | 企业级财务 |

```sql
-- ❌ 用 FLOAT 存钱：经典精度丢失
SET @a = 0.1 + 0.2;
SELECT @a;            -- 0.30000000000000004

-- ✅ DECIMAL 精确计算
CREATE TABLE orders (
    price    DECIMAL(10, 2) NOT NULL COMMENT '单价，最大 99999999.99',
    quantity INT UNSIGNED    NOT NULL,
    total    DECIMAL(12, 2) GENERATED ALWAYS AS (price * quantity) STORED COMMENT '总价，自动生成'
);

-- 加密货币场景：需要 8 位小数
CREATE TABLE crypto_prices (
    symbol VARCHAR(10)    NOT NULL,
    price  DECIMAL(16, 8) NOT NULL COMMENT 'BTC 价格可到亿分之一',
    ts     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

> **最佳实践**：金额字段建议存整数"分"（`INT UNSIGNED`），避免 DECIMAL 运算性能开销。100 元存为 10000，展示时除以 100。

# 五、JSON

```sql
profile JSON

-- 写入
INSERT INTO users (profile) VALUES ('{"city": "Taipei", "tags": ["dev"]}');

-- 查询
SELECT profile->>'$.city' FROM users;
SELECT * FROM users WHERE JSON_CONTAINS(profile->'$.tags', '"dev"');

-- 索引（虚拟列）
ALTER TABLE users ADD city VARCHAR(20)
  AS (profile->>'$.city') STORED,
  ADD INDEX idx_city(city);
```

**注意**：JSON 灵活但失去强 schema，能用普通列就别用 JSON。

# 六、设计经验

1. **能 NOT NULL 就 NOT NULL** —— NULL 让索引、统计、计算都更复杂
2. **整数无符号** `UNSIGNED` —— 范围加倍、避免负数业务 bug
3. **避免 ENUM** —— 改值要 ALTER TABLE，用 TINYINT + 字典表
4. **TEXT/BLOB 单独存表** —— 主表行长可控
5. **手机号用 VARCHAR** —— +号、前导 0、国家码
6. **金额绝不用 FLOAT** —— 用 DECIMAL 或存"分"用 INT
7. **VARCHAR 长度按需设置** —— VARCHAR(255) 和 VARCHAR(50) 在内存临时表中占用不同
8. **TIMESTAMP 注意时区** —— 多服务器不同时区会导致数据不一致

# 七、生产环境踩坑案例

## 踩坑 1：VARCHAR(255) 的隐性代价

```sql
-- 看似"安全"的写法
title VARCHAR(255) NOT NULL
```

**问题**：MySQL 使用 MEMORY 引擎的临时表时，VARCHAR 按**定义长度**分配内存。`VARCHAR(255)` 在临时表中每行占用 255 × 字符集字节数（utf8mb4 = 1020 字节），而 `VARCHAR(100)` 只占 400 字节。大表 JOIN / GROUP BY 时内存暴涨，溢出到磁盘。

**教训**：按业务实际最大长度定义，标题用 `VARCHAR(200)`，邮箱用 `VARCHAR(254)`。

## 踩坑 2：TIMESTAMP 默认值冲突

```sql
-- 两个 TIMESTAMP 列只允许一个 DEFAULT CURRENT_TIMESTAMP（MySQL 5.6 之前）
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
-- ❌ MySQL 5.5 报错：Incorrect table definition
```

**解决**：MySQL 5.6+ 放宽限制，或给第二个列显式 DEFAULT：
```sql
updated_at TIMESTAMP DEFAULT '1970-01-01 00:00:00' ON UPDATE CURRENT_TIMESTAMP
```

## 踩坑 3：INT UNSIGNED 减法产生意外溢出

```sql
-- 表结构
balance INT UNSIGNED NOT NULL DEFAULT 0;

-- 扣款 100，但余额只有 50
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
-- ❌ 不报错！结果是 4294967246（无符号溢出）
```

**解决**：启用 `SET sql_mode = 'NO_UNSIGNED_SUBTRACTION'`，或在应用层校验余额。

## 踩坑 4：TEXT 列导致索引失效

```sql
-- 文章表
content TEXT NOT NULL;

-- 想建全文索引
ALTER TABLE articles ADD INDEX idx_content (content);
-- ❌ BLOB/TEXT 列不能直接建普通索引

-- ✅ 方案一：前缀索引（只索引前 N 个字符）
ALTER TABLE articles ADD INDEX idx_content (content(100));

-- ✅ 方案二：全文索引
ALTER TABLE articles ADD FULLTEXT INDEX ft_content (content);
SELECT * FROM articles WHERE MATCH(content) AGAINST('MySQL 优化');
```

## 踩坑 5：INT vs BIGINT 主键——悄无声息的溢出危机

```sql
-- INT UNSIGNED 最大 4,294,967,295（约 42 亿）
-- 高并发写入的订单表、日志表，2-3 年就可能耗尽！

-- ❌ 危险：订单表用 INT
CREATE TABLE orders (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,  -- 最多 42 亿
    order_no VARCHAR(32) NOT NULL,
    amount DECIMAL(10,2) NOT NULL
);

-- ✅ 安全：用 BIGINT
CREATE TABLE orders (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,  -- 最多 1844 亿亿
    order_no VARCHAR(32) NOT NULL,
    amount DECIMAL(10,2) NOT NULL
);

-- 诊断：查看当前自增值距离上限多远
SELECT TABLE_NAME, AUTO_INCREMENT,
       ROUND(AUTO_INCREMENT / 4294967295 * 100, 2) AS usage_pct
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND AUTO_INCREMENT IS NOT NULL
ORDER BY usage_pct DESC;
```

**教训**：日志表、订单表等高频写入表，主键一律用 `BIGINT UNSIGNED`。Laravel 默认 `$table->id()` 就是 BIGINT，已经做对了。如果要迁移旧表：
```sql
-- ⚠️ 低峰期执行，会锁表
ALTER TABLE orders MODIFY id BIGINT UNSIGNED AUTO_INCREMENT;
```
> 选择 INT 还是 BIGINT？**宁大勿小**——BIGINT 多占 4 字节，但溢出修复的代价是停机迁移。

## 踩坑 6：TIMESTAMP 列的隐式自动更新陷阱

```sql
-- 看似正常的表结构
CREATE TABLE products (
    id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(200) NOT NULL,
    price      DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ✅ 修改 price 时，updated_at 自动更新（符合预期）
UPDATE products SET price = 99.99 WHERE id = 1;

-- ❌ 但新增 TIMESTAMP 列时会踩坑：
ALTER TABLE products ADD COLUMN checked_at TIMESTAMP NOT NULL;
-- MySQL 自动给 checked_at 加上 DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
-- 导致每次任何字段 UPDATE 都会更新 checked_at！

-- ❌ 第二个坑：NOT NULL 且无默认值的 TIMESTAMP 列
-- 在记录创建时会被自动赋值为 CURRENT_TIMESTAMP，语义混乱
```

**解决**：新增 TIMESTAMP 列时**显式指定默认值**：
```sql
-- ✅ 明确指定 DEFAULT，避免隐式行为
ALTER TABLE products ADD COLUMN checked_at TIMESTAMP NOT NULL DEFAULT '1970-01-01 00:00:01';

-- ✅ 或者用 DATETIME，不会被隐式赋值
ALTER TABLE products ADD COLUMN checked_at DATETIME NULL DEFAULT NULL;
```

> **经验法则**：一张表中只有 `created_at` 和 `updated_at` 用 TIMESTAMP，其余时间字段一律用 DATETIME，避免隐式行为互相干扰。

# 八、Laravel 实战：Eloquent 模型定义与 Migration 最佳实践

## Migration 最佳写法

```php
// database/migrations/2024_01_01_create_orders_table.php
Schema::create('orders', function (Blueprint $table) {
    // ✅ 主键：BIGINT UNSIGNED AUTO_INCREMENT
    $table->id();  // 等价于 $table->bigIncrements('id')

    // ✅ 外键：unsignedBigInteger + foreign
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();

    // ✅ 金额：DECIMAL(10,2) 或存"分"用 unsignedInteger
    $table->decimal('amount', 10, 2)->default(0);
    // 或存分：
    $table->unsignedInteger('price_cents')->default(0);  // 100元 = 10000

    // ✅ 状态：TINYINT UNSIGNED
    $table->tinyInteger('status')->unsigned()->default(0)
          ->comment('0待支付 1已支付 2已发货 3已完成 4已取消');

    // ✅ 字符串按需设置长度
    $table->string('order_no', 32)->unique();  // 订单号固定格式
    $table->string('remark', 500)->nullable(); // 备注有长度限制

    // ✅ 时间戳：TIMESTAMP + 默认值
    $table->timestamps();  // created_at + updated_at，自动 TIMESTAMP

    // ✅ 软删除
    $table->softDeletes();  // deleted_at

    // ✅ 索引
    $table->index(['user_id', 'status']);
    $table->index('created_at');
});
```

## Eloquent Model Casting

```php
// app/Models/Order.php
class Order extends Model
{
    protected $table = 'orders';

    // ✅ 类型转换：数据库类型 → PHP 类型
    protected $casts = [
        'amount'       => 'decimal:2',       // DECIMAL → 始终保留2位小数字符串
        'price_cents'  => 'integer',          // 分转元在 Accessor 处理
        'status'       => 'integer',
        'created_at'   => 'datetime',         // TIMESTAMP → Carbon 实例
        'updated_at'   => 'datetime',
        'metadata'     => 'array',            // JSON → PHP 数组
        'is_vip'       => 'boolean',          // TINYINT(1) → true/false
    ];

    // ✅ 金额：分 → 元
    public function getPriceYuanAttribute(): string
    {
        return number_format($this->price_cents / 100, 2, '.', '');
    }

    // ✅ 状态常量（避免魔法数字）
    const STATUS_PENDING   = 0;
    const STATUS_PAID      = 1;
    const STATUS_SHIPPED   = 2;
    const STATUS_COMPLETED = 3;
    const STATUS_CANCELLED = 4;

    // ✅ 类型安全的关联
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
```

## 常见 Migration 陷阱

```php
// ❌ 不要用 change() 修改列类型（数据可能丢失）
$table->string('name', 100)->change();  // 需要 doctrine/dbal 包

// ❌ 不要在 Migration 里加 ENUM（Laravel 对 ENUM 支持不好）
$table->enum('status', ['active', 'inactive']);  // 改值要手动写 SQL

// ✅ 推荐：用 tinyInteger + 代码常量
$table->tinyInteger('status')->unsigned()->default(0);

// ❌ 不要用 nullable() 代替默认值
$table->string('remark')->nullable();  // NULL 参与索引时有坑
// ✅ 用空字符串默认值
$table->string('remark')->default('');
```

## MySQL 类型 → Laravel Migration 方法速查

| MySQL 类型 | Laravel Migration 方法 | 说明 |
|---|---|---|
| BIGINT UNSIGNED AUTO_INCREMENT | `$table->id()` | Laravel 默认主键，推荐 |
| BIGINT UNSIGNED | `$table->unsignedBigInteger('col')` | 外键、大数值 ID |
| INT UNSIGNED | `$table->unsignedInteger('col')` | 中等数值、金额分 |
| MEDIUMINT UNSIGNED | `$table->unsignedMediumInteger('col')` | 较小计数器 |
| SMALLINT UNSIGNED | `$table->unsignedSmallInteger('col')` | 小范围数值 |
| TINYINT UNSIGNED | `$table->tinyInteger('col')->unsigned()` | 状态、布尔 |
| VARCHAR(n) | `$table->string('col', n)` | 变长字符串 |
| CHAR(n) | `$table->char('col', n)` | 定长：UUID、Hash |
| TEXT | `$table->text('col')` | 长文本 |
| MEDIUMTEXT | `$table->mediumText('col')` | 富文本、HTML |
| LONGTEXT | `$table->longText('col')` | 极大文本，慎用 |
| DECIMAL(M,D) | `$table->decimal('col', M, D)` | 金额、精确数值 |
| FLOAT | `$table->float('col', M, D)` | 浮点，金额禁用 |
| DOUBLE | `$table->double('col', M, D)` | 统计汇总 |
| DATETIME | `$table->dateTime('col')` | 日期时间（无时区） |
| TIMESTAMP | `$table->timestamp('col')` | 自动时区转换 |
| DATE | `$table->date('col')` | 仅日期 |
| TIME | `$table->time('col')` | 仅时间 |
| JSON | `$table->json('col')` | JSON 数据 |
| BOOLEAN | `$table->boolean('col')` | 实为 TINYINT(1) |
| BINARY(n) | `$table->binary('col', n)` | 二进制定长 |
| BLOB | `$table->binary('col')` | 二进制大对象 |
| ENUM | `$table->enum('col', [...])` | ⚠️ 不推荐 |
| SET | 无原生支持 | 改用 JSON 或关联表 |
| IP 地址 | `$table->ipAddress('col')` | VARCHAR(45) |
| MAC 地址 | `$table->macAddress('col')` | VARCHAR(17) |
| UUID | `$table->uuid('col')` | CHAR(36) |
| ULID | `$table->ulid('col')` | CHAR(26)，Laravel 9+ |
| 年份 | `$table->year('col')` | YEAR 类型 |

> **Laravel 小贴士**：`$table->id()` 默认生成 `BIGINT UNSIGNED AUTO_INCREMENT`，比 MySQL 默认的 `INT` 更安全。外键用 `$table->foreignId('user_id')->constrained()` 会自动匹配 BIGINT 类型。

# 速查表

| 想存的内容 | 推荐类型 |
|---|---|
| 主键 ID | INT UNSIGNED 或 BIGINT |
| 性别/状态 | TINYINT UNSIGNED |
| 用户名 | VARCHAR(64) |
| 邮箱 | VARCHAR(255) |
| 密码 hash | CHAR(60) (bcrypt) |
| 手机号 | VARCHAR(20) |
| 金额 | DECIMAL(10,2) 或存分用 INT UNSIGNED |
| 时间戳 | TIMESTAMP（带时区）/ DATETIME |
| IP 地址 | INT UNSIGNED + INET_ATON()，或 VARBINARY(16) |
| 大文本 | TEXT，单独表 |
| 半结构化 | JSON，慎用 |
| 枚举状态 | TINYINT UNSIGNED + 代码常量 |
| UUID 主键 | CHAR(36) 或 BINARY(16) |
| 布尔开关 | TINYINT(1) / BOOLEAN |
| IPv4 地址 | INT UNSIGNED + INET_ATON/INET_NTOA |
| 邮政编码 | CHAR(6) 或 VARCHAR(10) |
| 头像 URL | VARCHAR(500) |
| 排序序号 | INT UNSIGNED DEFAULT 0 |

# 参考

- MySQL 文档 - Data Types: <https://dev.mysql.com/doc/refman/8.0/en/data-types.html>
- 《高性能 MySQL》第 4 章
- Laravel Migration 文档: <https://laravel.com/docs/migrations>

## 相关阅读

- [MySQL主键](/categories/Databases/primary-key/) —— 自增 ID vs UUID vs 雪花算法，主键选型决定写入性能
- [MySQL 索引优化实战：EXPLAIN 分析、覆盖索引、最左前缀原则](/categories/Databases/index-deep-dive-explain/) —— 数据类型直接影响索引效率与查询性能
- [MySQL三范式](/categories/Databases/normalization/) —— 好的数据类型选择需要配合规范化的表结构设计
- [百万级数据表查询优化实战](/categories/Databases/query-optimization-explain/) —— 从 EXPLAIN 分析到索引重构，大型数据表的性能治理
