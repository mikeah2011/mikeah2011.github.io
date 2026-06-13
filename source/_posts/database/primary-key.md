---

title: MySQL 主键设计：自增 vs UUID vs 雪花算法选型
keywords: [MySQL, vs UUID vs, 主键设计, 自增, 雪花算法选型, 数据库]
tags:
- MySQL
- 主键
- UUID
- 性能优化
- 数据库
- 雪花算法
- 分布式
categories:
  - database
date: 2019-03-20 15:05:07
description: 深入对比MySQL主键设计方案：自增ID vs UUID vs ULID vs Snowflake雪花算法，从InnoDB B+Tree页分裂原理、存储空间开销、INSERT性能Benchmark到分布式ID生成策略，详解联合主键踩坑案例与主键选择最佳实践。无论单库还是分库分表场景，一文搞懂MySQL主键设计的核心要点与性能优化技巧。
cover: https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&h=630&fit=crop
images:
- /images/content/databases-1-content-1.jpg
- /images/content/databases-1-content-2.jpg
---



## 主键选择的核心问题

在MySQL中，主键的选择直接影响数据库的**写入性能**、**存储效率**和**查询速度**。常见的主键方案有：自增ID（AUTO_INCREMENT）、UUID、ULID和Snowflake。本文从InnoDB底层存储结构出发，深入分析各方案的优劣。

![MySQL数据库索引性能](/images/content/databases-1-content-1.jpg)

## 一、自增ID vs UUID：核心差异

### 1. InnoDB B+Tree 与页分裂

InnoDB使用B+树组织聚簇索引数据，每个数据页大小为**16KB**。主键值决定了数据在B+树中的物理存储位置：

- **自增ID**：值单调递增，新行始终追加到B+树的最右侧叶子节点，不会发生**页分裂（Page Split）**。
- **UUID**：值无序随机，插入位置不确定，可能插入到已满的数据页中间，触发页分裂。页分裂会导致：
  - 产生一个新的数据页（16KB）
  - 将原页约50%的数据移动到新页
  - 更新父节点指针
  - 产生额外的磁盘I/O和重做日志（Redo Log）

### 2. 存储空间对比

| 类型 | 大小 | 字符串表示 | 二级索引额外开销 |
|------|------|-----------|-----------------|
| INT自增 | 4字节 | 无 | 每个二级索引多4字节 |
| BIGINT自增 | 8字节 | 无 | 每个二级索引多8字节 |
| UUID | 16字节（BINARY）/ 36字节（VARCHAR） | `550e8400-e29b-41d4-a716-446655440000` | 每个二级索引多16~36字节 |

> **关键**：InnoDB的每个二级索引都会存储一份主键值。一张表有5个二级索引时，UUID主键比BIGINT自增多占用 `5 × (16 - 8) = 40` 字节/行。百万级数据表空间浪费显著。

### 3. INSERT性能测试

```sql
-- 创建自增主键表
CREATE TABLE test_auto (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 创建UUID主键表（BINARY存储）
CREATE TABLE test_uuid (
    id BINARY(16) PRIMARY KEY,
    name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
```

```sql
-- 批量插入10万条数据对比
-- 自增ID：约 2.3 秒
INSERT INTO test_auto (name)
SELECT CONCAT('user_', seq) FROM (
    SELECT @rownum := @rownum + 1 AS seq
    FROM information_schema.columns a, information_schema.columns b,
         (SELECT @rownum := 0) r
    LIMIT 100000
) t;

-- UUID：约 6.8 秒（约慢 3 倍）
INSERT INTO test_uuid (id, name)
SELECT UUID_TO_BIN(UUID()), CONCAT('user_', seq) FROM (
    SELECT @rownum := @rownum + 1 AS seq
    FROM information_schema.columns a, information_schema.columns b,
         (SELECT @rownum := 0) r
    LIMIT 100000
) t;
```

## 二、自增主键 vs UUID 性能 Benchmark（Python + mysql-connector）

以下是一个完整的 Python Benchmark 脚本，可直接在本地运行对比自增主键、UUID、有序UUID（时间戳交换）三种方案的插入性能：

```python
"""
MySQL 主键性能 Benchmark：自增ID vs UUID vs 有序UUID
依赖: pip install mysql-connector-python
"""
import time
import uuid
import mysql.connector
from contextlib import contextmanager

DB_CONFIG = {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "your_password",
    "database": "benchmark_test",
}

BATCH_SIZE = 1000
TOTAL_ROWS = 100_000

@contextmanager
def get_conn():
    conn = mysql.connector.connect(**DB_CONFIG)
    try:
        yield conn
    finally:
        conn.close()

def setup_tables():
    """建表"""
    with get_conn() as conn:
        cur = conn.cursor()
        for tbl in ["bench_auto", "bench_uuid", "bench_uuid_ordered"]:
            cur.execute(f"DROP TABLE IF EXISTS {tbl}")

        cur.execute("""
            CREATE TABLE bench_auto (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(64),
                payload VARCHAR(256),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_name (name)
            ) ENGINE=InnoDB
        """)
        cur.execute("""
            CREATE TABLE bench_uuid (
                id BINARY(16) PRIMARY KEY,
                name VARCHAR(64),
                payload VARCHAR(256),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_name (name)
            ) ENGINE=InnoDB
        """)
        cur.execute("""
            CREATE TABLE bench_uuid_ordered (
                id BINARY(16) PRIMARY KEY,
                name VARCHAR(64),
                payload VARCHAR(256),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_name (name)
            ) ENGINE=InnoDB
        """)
        conn.commit()

def benchmark_auto_increment():
    """自增ID批量插入"""
    with get_conn() as conn:
        cur = conn.cursor()
        sql = "INSERT INTO bench_auto (name, payload) VALUES (%s, %s)"
        start = time.perf_counter()
        for i in range(0, TOTAL_ROWS, BATCH_SIZE):
            batch = [(f"user_{j}", f"payload_{j}" * 3) for j in range(i, i + BATCH_SIZE)]
            cur.executemany(sql, batch)
            conn.commit()
        elapsed = time.perf_counter() - start
    return elapsed

def benchmark_uuid():
    """随机UUID批量插入"""
    with get_conn() as conn:
        cur = conn.cursor()
        sql = "INSERT INTO bench_uuid (id, name, payload) VALUES (%s, %s, %s)"
        start = time.perf_counter()
        for i in range(0, TOTAL_ROWS, BATCH_SIZE):
            batch = [
                (uuid.uuid4().bytes, f"user_{j}", f"payload_{j}" * 3)
                for j in range(i, i + BATCH_SIZE)
            ]
            cur.executemany(sql, batch)
            conn.commit()
        elapsed = time.perf_counter() - start
    return elapsed

def benchmark_uuid_ordered():
    """有序UUID（时间戳前缀）批量插入"""
    with get_conn() as conn:
        cur = conn.cursor()
        sql = "INSERT INTO bench_uuid_ordered (id, name, payload) VALUES (%s, %s, %s)"
        start = time.perf_counter()
        for i in range(0, TOTAL_ROWS, BATCH_SIZE):
            batch = [
                (uuid.uuid1().bytes, f"user_{j}", f"payload_{j}" * 3)
                for j in range(i, i + BATCH_SIZE)
            ]
            cur.executemany(sql, batch)
            conn.commit()
        elapsed = time.perf_counter() - start
    return elapsed

def check_table_size():
    """查看各表的磁盘占用"""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT table_name,
                   table_rows,
                   ROUND(data_length / 1024 / 1024, 2) AS data_mb,
                   ROUND(index_length / 1024 / 1024, 2) AS index_mb
            FROM information_schema.tables
            WHERE table_schema = 'benchmark_test'
              AND table_name LIKE 'bench_%'
            ORDER BY table_name
        """)
        return cur.fetchall()

if __name__ == "__main__":
    setup_tables()
    print(f"开始 Benchmark：每批 {BATCH_SIZE} 条，共 {TOTAL_ROWS} 条\n")

    t1 = benchmark_auto_increment()
    t2 = benchmark_uuid()
    t3 = benchmark_uuid_ordered()

    print(f"{'方案':<25} {'耗时(秒)':>10} {'相对倍数':>10}")
    print("-" * 50)
    base = t1
    print(f"{'AUTO_INCREMENT':<25} {t1:>10.2f} {'1.00x':>10}")
    print(f"{'UUID (随机)':<25} {t2:>10.2f} {t2/base:>9.2f}x")
    print(f"{'UUID (有序uuid1)':<25} {t3:>10.2f} {t3/base:>9.2f}x")

    print(f"\n磁盘空间占用：")
    for row in check_table_size():
        print(f"  {row[0]}: rows={row[1]}, data={row[2]}MB, index={row[3]}MB")
```

> **预期结果**：随机UUID插入耗时约为自增ID的 **2.5~4倍**，有序UUID约为 **1.5~2倍**。随机UUID的索引空间占用也明显更大。

## 三、四种主键方案全面对比

| 特性 | 自增ID (AUTO_INCREMENT) | UUID | ULID | Snowflake |
|------|------------------------|------|------|-----------|
| **大小** | 4~8字节 | 16字节(BINARY) | 16字节(BINARY) | 8字节(BIGINT) |
| **有序性** | ✅ 严格有序 | ❌ 无序 | ✅ 时间有序 | ✅ 时间有序 |
| **可排序** | ✅ | ❌ | ✅ | ✅ |
| **分布式生成** | ❌ 需要发号器 | ✅ 本地生成 | ✅ 本地生成 | ✅ 本地生成 |
| **页分裂风险** | ✅ 无 | ❌ 高 | ⚠️ 极低 | ✅ 无 |
| **INSERT性能** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **全局唯一性** | ❌ 单库唯一 | ✅ | ✅ | ✅ |
| **可读性** | 高 | 中(UUID格式) | 低 | 低 |
| **排序能力** | 自然排序 | 不可排序 | 可排序 | 可排序 |
| **适用场景** | 单库单表 | 分布式(不推荐) | 分布式/时序 | 分布式高并发 |

### ULID简介

**ULID（Universally Unique Lexicographically Sortable Identifier）** 是一种时间有序的唯一标识，长度128位（16字节），编码后为26个字符：

```
01ARZ3NDEKTSV4RRFFQ69G5FAV
└─ 时间戳(48bit)  └─ 随机数(80bit)
```

优势：时间前缀保证了B+树插入的**近似有序性**，页分裂概率极低。

### Snowflake简介

**Snowflake**（Twitter开源）使用64位BIGINT存储，结构如下：

```
| 1bit符号位 | 41bit时间戳 | 10bit机器ID | 12bit序列号 |
```

- 总大小仅8字节，与BIGINT自增相当
- 支持毫秒级时间排序
- 每台机器每毫秒可生成4096个ID
- 需要解决时钟回拨问题

## 四、分布式环境雪花算法生成主键（示例代码）

### Python 实现

```python
"""
Snowflake ID 生成器（Python 实现）
结构: 1bit符号 + 41bit时间戳 + 10bit机器ID + 12bit序列号
"""
import time
import threading

class SnowflakeGenerator:
    # 起始时间戳 (2024-01-01 00:00:00 UTC，毫秒)
    EPOCH = 1704067200000

    # 各部分位数
    MACHINE_BITS = 10
    SEQUENCE_BITS = 12

    # 最大值
    MAX_MACHINE = (1 << MACHINE_BITS) - 1   # 1023
    MAX_SEQUENCE = (1 << SEQUENCE_BITS) - 1  # 4095

    # 位移
    MACHINE_SHIFT = SEQUENCE_BITS
    TIMESTAMP_SHIFT = SEQUENCE_BITS + MACHINE_BITS

    def __init__(self, machine_id: int):
        if machine_id < 0 or machine_id > self.MAX_MACHINE:
            raise ValueError(f"机器ID必须在 0~{self.MAX_MACHINE} 之间")
        self.machine_id = machine_id
        self.sequence = 0
        self.last_timestamp = -1
        self._lock = threading.Lock()

    def _current_millis(self) -> int:
        return int(time.time() * 1000)

    def generate(self) -> int:
        with self._lock:
            ts = self._current_millis()

            if ts < self.last_timestamp:
                # 时钟回拨处理：等待到上次时间戳
                wait = (self.last_timestamp - ts) / 1000
                raise RuntimeError(f"时钟回拨 {wait:.3f}秒，拒绝生成ID")

            if ts == self.last_timestamp:
                self.sequence = (self.sequence + 1) & self.MAX_SEQUENCE
                if self.sequence == 0:
                    # 序列号用尽，等待下一毫秒
                    while ts <= self.last_timestamp:
                        ts = self._current_millis()
            else:
                self.sequence = 0

            self.last_timestamp = ts

            return (
                ((ts - self.EPOCH) << self.TIMESTAMP_SHIFT)
                | (self.machine_id << self.MACHINE_SHIFT)
                | self.sequence
            )

    def decode(self, snowflake_id: int) -> dict:
        """解码雪花ID，提取时间戳和机器ID"""
        binary = bin(snowflake_id)[2:].zfill(64)
        timestamp = (snowflake_id >> self.TIMESTAMP_SHIFT) + self.EPOCH
        machine_id = (snowflake_id >> self.MACHINE_SHIFT) & self.MAX_MACHINE
        sequence = snowflake_id & self.MAX_SEQUENCE
        return {
            "id": snowflake_id,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S",
                                       time.localtime(timestamp / 1000)),
            "machine_id": machine_id,
            "sequence": sequence,
        }


# 使用示例
if __name__ == "__main__":
    gen = SnowflakeGenerator(machine_id=1)

    # 生成10个ID
    ids = [gen.generate() for _ in range(10)]
    print("生成的雪花ID:")
    for sid in ids:
        info = gen.decode(sid)
        print(f"  ID={sid}, 时间={info['timestamp']}, "
              f"机器={info['machine_id']}, 序列={info['sequence']}")
```

### Java 实现（Spring Boot 项目集成）

```java
/**
 * 雪花算法ID生成器
 */
public class SnowflakeIdGenerator {

    private static final long EPOCH = 1704067200000L; // 2024-01-01
    private static final long MACHINE_BITS = 10L;
    private static final long SEQUENCE_BITS = 12L;
    private static final long MAX_MACHINE = ~(-1L << MACHINE_BITS);
    private static final long MAX_SEQUENCE = ~(-1L << SEQUENCE_BITS);
    private static final long MACHINE_SHIFT = SEQUENCE_BITS;
    private static final long TIMESTAMP_SHIFT = SEQUENCE_BITS + MACHINE_BITS;

    private final long machineId;
    private long sequence = 0L;
    private long lastTimestamp = -1L;

    public SnowflakeIdGenerator(long machineId) {
        if (machineId < 0 || machineId > MAX_MACHINE) {
            throw new IllegalArgumentException("机器ID超出范围");
        }
        this.machineId = machineId;
    }

    public synchronized long nextId() {
        long timestamp = System.currentTimeMillis();

        if (timestamp < lastTimestamp) {
            throw new RuntimeException("时钟回拨，拒绝生成ID");
        }

        if (timestamp == lastTimestamp) {
            sequence = (sequence + 1) & MAX_SEQUENCE;
            if (sequence == 0) {
                while (timestamp <= lastTimestamp) {
                    timestamp = System.currentTimeMillis();
                }
            }
        } else {
            sequence = 0L;
        }

        lastTimestamp = timestamp;
        return ((timestamp - EPOCH) << TIMESTAMP_SHIFT)
                | (machineId << MACHINE_SHIFT)
                | sequence;
    }

    public static void main(String[] args) {
        SnowflakeIdGenerator gen = new SnowflakeIdGenerator(1);
        for (int i = 0; i < 10; i++) {
            System.out.println(gen.nextId());
        }
    }
}
```

### 配合 MySQL 建表

```sql
-- 雪花ID作为主键的建表语句
CREATE TABLE orders (
    id BIGINT UNSIGNED NOT NULL PRIMARY KEY COMMENT '雪花算法生成',
    order_no VARCHAR(32) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status TINYINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE INDEX uk_order_no (order_no),
    INDEX idx_user_id (user_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## 五、联合主键的使用场景与踩坑案例

### 什么是联合主键

联合主键（Composite Primary Key）是由**两个或多个列**组合而成的主键，用于唯一标识一行数据。

```sql
-- 典型的联合主键：学生选课表
CREATE TABLE student_course (
    student_id BIGINT NOT NULL,
    course_id  BIGINT NOT NULL,
    score      DECIMAL(5,2),
    enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_id, course_id)
) ENGINE=InnoDB;
```

### 适用场景

1. **多对多关系表**：如用户-角色关联表、学生-选课表
2. **天然复合唯一键**：如 `(region_code, order_no)` 天然唯一
3. **时序数据去重**：如 `(device_id, metric_time)` 保证同一设备同一时刻只有一条记录

### 踩坑案例

**坑1：联合主键导致二级索引膨胀**

```sql
-- 反例：用两个大字段做联合主键
CREATE TABLE user_tags (
    user_uuid  BINARY(16) NOT NULL,
    tag_key    VARCHAR(64) NOT NULL,
    tag_value  VARCHAR(256),
    PRIMARY KEY (user_uuid, tag_key),
    INDEX idx_tag_key (tag_key)  -- 二级索引会存储完整的联合主键(16+64=80字节!)
) ENGINE=InnoDB;
```

> **问题**：每个二级索引额外存储 80 字节主键数据，百万行数据索引膨胀严重。
>
> **修复**：改用自增ID做主键，联合唯一索引保证业务唯一性：

```sql
CREATE TABLE user_tags (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_uuid  BINARY(16) NOT NULL,
    tag_key    VARCHAR(64) NOT NULL,
    tag_value  VARCHAR(256),
    UNIQUE INDEX uk_user_tag (user_uuid, tag_key),
    INDEX idx_tag_key (tag_key)  -- 只存8字节自增ID
) ENGINE=InnoDB;
```

**坑2：联合主键顺序影响查询性能**

```sql
-- 联合主键 (student_id, course_id)
PRIMARY KEY (student_id, course_id)

-- ✅ 能命中主键索引的查询
SELECT * FROM student_course WHERE student_id = 100;
SELECT * FROM student_course WHERE student_id = 100 AND course_id = 200;

-- ❌ 无法命中主键索引（违反最左前缀原则）
SELECT * FROM student_course WHERE course_id = 200;  -- 全表扫描！
```

> **教训**：联合主键的列顺序必须考虑查询模式，高频查询的列放在前面。

**坑3：ORM 框架兼容性问题**

部分 ORM 框架（如早期的 Laravel Eloquent）对联合主键支持不友好：

```php
// Laravel Eloquent 默认假设主键是单列 'id'
// 联合主键需要额外处理
class StudentCourse extends Model
{
    // 需要手动指定
    protected $primaryKey = null;
    public $incrementing = false;

    // find() 方法无法直接使用
    // 需要改用 where 条件查询
    StudentCourse::where('student_id', 100)
                 ->where('course_id', 200)
                 ->first();
}
```

### 联合主键使用建议

| 场景 | 建议 |
|------|------|
| 多对多关系表 | 用自增ID + 联合唯一索引，避免联合主键 |
| 字段少且查询固定 | 可以用联合主键，注意列顺序 |
| 需要频繁变更主键列 | 不要用联合主键，改用代理键 |
| ORM重度使用项目 | 优先自增ID，减少框架兼容问题 |

## 六、主键选择最佳实践（生产环境经验）

### 1. 单库单表场景

```sql
-- 标准方案：BIGINT AUTO_INCREMENT
ALTER TABLE orders MODIFY id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT;
```

- 选择 `BIGINT UNSIGNED`（而非 `INT`），上限 18,446,744,073,709,551,615，足够绝大多数业务
- 如果数据量预计超千万，提前规划 `AUTO_INCREMENT` 步长和分库分表方案

### 2. 分库分表场景

**首选：雪花算法（Snowflake）**

```sql
-- 使用雪花ID的分库分表建表
CREATE TABLE order_0 (
    id BIGINT UNSIGNED NOT NULL PRIMARY KEY COMMENT '雪花ID',
    ...
) ENGINE=InnoDB;
```

优势总结：
- 8字节存储，与 BIGINT 自增相同
- 全局唯一，无需中心化发号器
- 时间有序，B+树插入性能好
- 可从ID中解析出创建时间

**次选：ULID + BINARY(16)**

```sql
CREATE TABLE distributed_events (
    id BINARY(16) PRIMARY KEY COMMENT 'ULID',
    event_type VARCHAR(64),
    payload JSON,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_created (created_at)
) ENGINE=InnoDB;
```

### 3. 绝对不要做的事

| ❌ 反模式 | 问题 | ✅ 正确做法 |
|-----------|------|------------|
| 用业务字段做主键（如手机号） | 业务字段可能变更，主键不可变 | 自增ID + 业务字段加唯一索引 |
| VARCHAR 主键 | 字符串比较慢，空间大 | BIGINT 或 BINARY(16) |
| 随机UUID做主键 | 页分裂，性能差 | 至少用有序UUID或雪花算法 |
| INT 而非 BIGINT | 上限仅21亿，易溢出 | BIGINT UNSIGNED |
| 不设自增起始值 | 分表时ID冲突 | 每张表设置不同起始值和步长 |

### 4. 生产环境 Checklist

```
□ 主键是否足够小？（建议 ≤ 8 字节）
□ 插入是否有序？（避免页分裂）
□ 是否全局唯一？（分布式场景必须）
□ 二级索引存储开销是否可接受？
□ 是否需要从主键解析时间信息？
□ 是否与 ORM 框架兼容？
□ INT/BIGINT 是否会溢出？（检查数据增长速率）
□ 分库分表后ID是否冲突？（雪花算法的机器ID分配）
□ 时钟回拨如何处理？（雪花算法必须考虑）
```

### 5. 各方案性能总结

```
                    写入性能    存储效率    全局唯一    可排序    分布式
AUTO_INCREMENT       ★★★★★     ★★★★★      ✗          ✓        ✗
UUID (随机)          ★★         ★★          ✓          ✗        ✓
UUID (有序uuid1)     ★★★★       ★★          ✓          ✓        ✓
ULID                 ★★★★       ★★★         ✓          ✓        ✓
Snowflake            ★★★★★     ★★★★★       ✓          ✓        ✓
```

## 七、总结

**一般没有特定的业务要求，都不推荐使用UUID作为主键**。核心原因：

1. **无序插入**触发页分裂，写入性能下降约3倍
2. **存储空间大**（16~36字节 vs 8字节），放大二级索引开销
3. **字符串比较**比整数比较慢，影响查询性能

选型建议：

- 单库 → `BIGINT AUTO_INCREMENT`
- 分布式 → `Snowflake`（最优）或 `ULID`
- 如必须UUID → `BINARY(16)` + 时间戳交换优化

## 相关阅读

- [SQL查询语句的流程](/categories/Databases/query/)
- [索引采用的算法——为什么用B+树](/categories/Databases/b-tree/)
- [前缀索引](/categories/Databases/prefix-index/)
- [聚簇索引与非聚簇索引](/categories/Databases/clustered-vs-nonclustered/)
- [MySQL存储引擎](/categories/Databases/storage-engine/)
- [MySQL优化经验总结](/categories/Databases/sql-optimization/)
