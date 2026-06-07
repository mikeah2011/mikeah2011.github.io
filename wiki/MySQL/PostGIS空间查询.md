# PostGIS 空间数据查询实战

## 定义

PostGIS 是 PostgreSQL 的空间数据扩展，提供地理空间数据的存储、查询和分析能力。支持点（Point）、线（LineString）、面（Polygon）等几何类型，以及空间索引（GiST）、距离计算、地理围栏、路径规划等高级功能。

## 核心概念

### 几何类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `POINT` | 点 | 经纬度坐标 |
| `LINESTRING` | 线 | 路线、轨迹 |
| `POLYGON` | 面 | 区域、围栏 |
| `MULTIPOINT` | 多点 | 多个门店位置 |
| `GEOMETRY` | 通用几何类型 | 任意几何体 |

### 坐标系（SRID）

| SRID | 名称 | 说明 |
|------|------|------|
| 4326 | WGS 84 | GPS 坐标系，经纬度 |
| 3857 | Web Mercator | Web 地图投影 |
| 4490 | CGCS 2000 | 中国国家坐标系 |

## 安装与配置

```sql
-- 创建扩展
CREATE EXTENSION postgis;
CREATE EXTENSION postgis_topology;

-- 验证
SELECT PostGIS_Version();
```

## 核心操作

### 存储空间数据

```sql
-- 创建带空间字段的表
CREATE TABLE stores (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    address TEXT,
    location GEOMETRY(Point, 4326),  -- WGS 84 坐标系
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 插入数据（经度, 纬度）
INSERT INTO stores (name, address, location) VALUES
('星巴克国贸店', '北京市朝阳区建国门外大街1号',
 ST_SetSRID(ST_MakePoint(116.461, 39.908), 4326)),
('星巴克三里屯店', '北京市朝阳区三里屯路19号',
 ST_SetSRID(ST_MakePoint(116.455, 39.935), 4326));

-- 简化写法
INSERT INTO stores (name, location) VALUES
('星巴克望京店', ST_GeomFromText('POINT(116.481 39.993)', 4326));
```

### 空间索引

```sql
-- 创建 GiST 空间索引
CREATE INDEX idx_stores_location ON stores USING GIST (location);

-- 验证索引
EXPLAIN SELECT * FROM stores WHERE ST_DWithin(
    location::geography,
    ST_GeomFromText('POINT(116.461 39.908)', 4326)::geography,
    1000
);
```

### 距离查询

```sql
-- 计算两点之间的距离（米）
SELECT ST_Distance(
    ST_GeomFromText('POINT(116.461 39.908)', 4326)::geography,
    ST_GeomFromText('POINT(116.455 39.935)', 4326)::geography
) AS distance_meters;

-- 查找 1 公里内的门店
SELECT name, address,
       ST_Distance(
           location::geography,
           ST_GeomFromText('POINT(116.461 39.908)', 4326)::geography
       ) AS distance_meters
FROM stores
WHERE ST_DWithin(
    location::geography,
    ST_GeomFromText('POINT(116.461 39.908)', 4326)::geography,
    1000  -- 1000 米
)
ORDER BY distance_meters;
```

### 地理围栏（Geofence）

```sql
-- 创建围栏区域
CREATE TABLE geofences (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    boundary GEOMETRY(Polygon, 4326)
);

-- 插入围栏（五边形区域）
INSERT INTO geofences (name, boundary) VALUES
('CBD区域', ST_GeomFromText(
    'POLYGON((116.45 39.90, 116.47 39.90, 116.48 39.92, 116.46 39.93, 116.44 39.91, 116.45 39.90))',
    4326
));

-- 判断点是否在围栏内
SELECT g.name
FROM geofences g
WHERE ST_Contains(
    g.boundary,
    ST_GeomFromText('POINT(116.461 39.908)', 4326)
);

-- 查找所有在围栏内的门店
SELECT s.name, s.address
FROM stores s
JOIN geofences g ON ST_Contains(g.boundary, s.location)
WHERE g.name = 'CBD区域';
```

### 空间聚合

```sql
-- 凸包（Convex Hull）：包含所有门店的最小凸多边形
SELECT ST_ConvexHull(ST_Collect(location)) FROM stores;

-- 中心点
SELECT ST_Centroid(ST_Collect(location)) FROM stores;

-- 按区域统计门店数量
SELECT g.name, COUNT(s.id) AS store_count
FROM geofences g
LEFT JOIN stores s ON ST_Contains(g.boundary, s.location)
GROUP BY g.name;
```

## Laravel 中的应用

```php
// Migration
Schema::create('stores', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->text('address');
    $table->decimal('lat', 10, 7);
    $table->decimal('lng', 10, 7);
    $table->timestamps();
});

// 创建空间列和索引
DB::statement('ALTER TABLE stores ADD COLUMN location GEOMETRY(Point, 4326)');
DB::statement('UPDATE stores SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)');
DB::statement('CREATE INDEX idx_stores_location ON stores USING GIST (location)');

// 查询附近门店
$lat = 39.908;
$lng = 116.461;
$radius = 1000; // 米

$stores = DB::select("
    SELECT id, name, address,
           ST_Distance(
               location::geography,
               ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
           ) AS distance
    FROM stores
    WHERE ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
        ?
    )
    ORDER BY distance
", [$lng, $lat, $lng, $lat, $radius]);

// 围栏查询
$inGeofence = DB::select("
    SELECT COUNT(*) as count
    FROM stores s
    JOIN geofences g ON ST_Contains(g.boundary, s.location)
    WHERE g.id = ?
", [$geofenceId]);
```

## PostGIS vs Redis Geo

| 维度 | PostGIS | Redis Geo |
|------|---------|-----------|
| 数据持久化 | ⭐⭐⭐ 数据库级 | ⭐⭐ Redis 持久化 |
| 查询能力 | ⭐⭐⭐ 复杂空间查询 | ⭐⭐ 简单距离查询 |
| 围栏支持 | ✅ 完整支持 | ❌ 不支持 |
| 路径规划 | ✅ pgRouting 扩展 | ❌ 不支持 |
| 性能 | ⭐⭐ 中等 | ⭐⭐⭐ 高性能 |
| 数据量 | 百万级 | 十万级 |
| 适用场景 | 复杂 GIS 分析 | 简单附近查询 |

### 选型建议

- **简单附近查询**（附近门店、附近的人）→ Redis Geo
- **复杂空间分析**（围栏、路径规划、区域统计）→ PostGIS
- **两者结合**：Redis Geo 做一级过滤，PostGIS 做精确查询

## 实战文章（来自博客）

- [PostGIS + Laravel 实战：空间数据查询——地理围栏、路径规划与附近 POI 的 PostgreSQL 原生方案，对比 Redis Geo](/categories/MySQL/PostGIS-Laravel-实战-空间数据查询/)

## 相关概念

- [数据结构](../Redis/数据结构.md) - Redis GEO 类型
- [PostgreSQL vs MySQL 选型](PostgreSQL-vs-MySQL选型.md) - PostgreSQL 扩展生态
- [PostgreSQL 扩展生态](../MySQL/PostgreSQL高级索引.md) - pg_trgm/pgvector 等

## 常见问题

**Q: 为什么查询要用 `::geography` 转换？**
A: `geometry` 类型按坐标单位计算距离（度），`geography` 类型按地球曲面计算距离（米）。地理查询需要使用 `geography` 类型。

**Q: 空间索引为什么用 GiST 而不是 B-Tree？**
A: B-Tree 适合一维数据，GiST（Generalized Search Tree）支持多维数据的空间索引，能高效处理范围查询和最近邻查询。

**Q: 数据量大时性能如何？**
A: 百万级点数据 + GiST 索引，附近查询通常在 10ms 内。超过千万级建议分区表 + 空间索引。
