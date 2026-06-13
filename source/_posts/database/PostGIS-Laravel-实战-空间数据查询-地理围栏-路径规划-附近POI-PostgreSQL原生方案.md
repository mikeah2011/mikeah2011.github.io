---
title: PostGIS + Laravel 实战：空间数据查询——地理围栏、路径规划与附近 POI 的 PostgreSQL 原生方案
date: 2026-06-06 19:24:21
description: PostGIS + Laravel 实战教程，深入讲解 PostgreSQL PostGIS 扩展的空间数据查询方案。涵盖附近 POI 查询（ST_DWithin）、地理围栏（ST_Contains/ST_Intersects）、骑手轨迹路径规划等核心场景的完整 Laravel 代码示例，对比 PostGIS vs Redis Geo vs MySQL Spatial vs MongoDB GeoJSON 四种空间方案的性能与适用场景，并汇总生产环境中常见的坐标系偏移、索引失效、WKB 序列化等踩坑经验与性能优化最佳实践。
tags: [postgresql, postgis, laravel, 空间数据, gis]
categories:
  - database
cover: /images/covers/postgis-laravel-spatial-query-cover.jpg
---

## 前言：为什么我从 Redis Geo 迁移到了 PostGIS

去年在做一个本地生活服务的项目时，"附近的人"、"附近门店"这类需求几乎是标配。最开始我们团队用的是最常见也最省事的方案——Redis Geo。几个 `GEOADD`、`GEODIST`、`GEORADIUS` 命令就搞定了，代码简洁、响应飞快，项目初期确实没什么问题。

但随着业务迭代，需求逐渐"膨胀"了：

1. 产品经理要"地理围栏"功能——判断一个坐标是否在某个不规则的配送区域内（不是简单的圆形）。
2. 骑手端要展示"配送路径"——不只是两个点之间的直线距离，而是要沿着路网计算实际路线。
3. 运营要做"区域热力图"——按行政区划、商圈来聚合门店数据。
4. 数据量从几万涨到了几百万，还要做复杂的空间筛选 + 联表查询。

Redis Geo 的本质就是一个基于 Geohash 的 sorted set，它只支持点与点之间的距离查询，无法处理多边形包含判断、线段交叉、面积计算这些空间关系操作。要实现地理围栏，你得自己写 Geohash 编码 + 矩形预筛选 + 射线法判断，代码复杂且精度难以保证。

最终我们决定将空间查询全面迁移到 PostgreSQL 的 PostGIS 扩展上。这篇文章就是这次迁移的完整总结，包含安装配置、Laravel 集成、三个核心实战场景、与 Redis Geo 的深度对比，以及我在生产环境中踩过的那些坑。

---

## 一、PostGIS 简介

### 1.1 什么是 PostGIS

PostGIS 是 PostgreSQL 数据库的一个空间扩展，它为 PostgreSQL 增加了对地理空间对象的支持。简单来说，它让 PostgreSQL 从一个关系型数据库升级为了一个"空间数据库"。

PostGIS 实现了 Open Geospatial Consortium (OGC) 的 Simple Features for SQL 规范，提供了：

- **空间数据类型**：Point、LineString、Polygon、MultiPolygon、GeometryCollection 等
- **空间函数**：超过 800 个空间计算函数，涵盖距离计算、拓扑关系判断、几何运算、坐标转换等
- **空间索引**：基于 GiST（Generalized Search Tree）的 R-Tree 索引，加速空间查询
- **坐标系支持**：完整的 SRID（Spatial Reference System Identifier）支持，可以进行不同坐标系之间的转换

简单来说，如果你需要存储和查询"带地理位置的数据"，PostGIS 几乎是开源世界中最成熟、功能最完整的方案。它被广泛应用于城市规划、物流配送、地理信息系统（GIS）、LBS（基于位置的服务）等领域。

在实际的后端开发中，我们经常遇到的场景包括：根据用户当前位置查询附近的餐厅、药店、便利店等兴趣点（POI）；根据订单配送地址判断是否在商家的配送范围内；记录和分析骑手的配送轨迹；以及根据不同区域的地理边界进行数据聚合和可视化。这些需求都离不开空间数据库的支持。

### 1.3 PostGIS 的版本选择与兼容性

目前 PostGIS 最新稳定版本是 3.4 系列，推荐在 PostgreSQL 14 或更高版本上使用。如果你使用的是 Docker 部署，可以直接使用官方镜像：

```bash
docker run -d --name postgis \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=laravel \
  -p 5432:5432 \
  postgis/postgis:16-3.4
```

这个镜像已经预装了 PostGIS 扩展，开箱即用。在生产环境中，建议将数据库配置为持久化存储：

```bash
docker run -d --name postgis \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=laravel \
  -v /data/postgres:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgis/postgis:16-3.4
```

### 1.4 Laravel 集成

**macOS（Homebrew）：**

```bash
brew install postgis
```

**Ubuntu/Debian：**

```bash
sudo apt-get install postgis postgresql-15-postgis-3
```

**启用扩展（在目标数据库中执行）：**

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
-- 验证安装
SELECT PostGIS_Version();
-- 输出类似：3.4 USE_GEOS=1 USE_PROJ=1 USE_STATS=1
```

> **踩坑提醒**：PostGIS 扩展是针对单个数据库启用的，不是全局的。如果你有多个数据库，每个都需要单独执行 `CREATE EXTENSION`。另外，PostGIS 版本需要与 PostgreSQL 主版本匹配，否则可能安装失败。建议用 `apt` 或 `brew` 的官方源安装，避免版本不兼容的问题。

### 1.5 Laravel 集成

Laravel 本身没有原生的 PostGIS 支持，但社区有一个非常成熟的包 `mstaaravel/geo`，或者使用更流行的 `grimzy/laravel-postgis`。不过我个人推荐直接使用原始 SQL + Eloquent 的 `selectRaw` / `whereRaw` 方式，因为：

1. 社区包更新可能不及时
2. 对于复杂的空间查询，最终还是要写原始 SQL
3. 你能完全控制生成的 SQL 语句

首先确保 `.env` 中配置了 PostgreSQL 连接：

```env
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=your_database
DB_USERNAME=your_username
DB_PASSWORD=your_password
```

如果你确实想用封装好的包，可以安装 `grimzy/laravel-postgis`：

```bash
composer require grimzy/laravel-postgis
```

但在这篇文章中，我会以原生 SQL + Eloquent 结合的方式为主，因为这样更灵活，也更容易让你理解背后的 SQL 逻辑。

---

## 二、空间数据类型详解

PostGIS 支持多种空间数据类型，理解它们是使用空间查询的基础。

### 2.1 Point（点）

最基础的空间类型，表示一个坐标位置。

```sql
-- WKT（Well-Known Text）格式
SELECT ST_SetSRID(ST_MakePoint(116.397128, 39.916527), 4326);
-- 表示北京天安门广场的坐标（经度, 纬度）

-- 或者用 ST_GeomFromText
SELECT ST_GeomFromText('POINT(116.397128 39.916527)', 4326);
```

> **重要提醒**：`ST_MakePoint` 的参数顺序是 **(经度, 纬度)**，即 (X, Y)，不是 (纬度, 经度)！这个顺序搞反是新手最常见的错误，我第一次用的时候也踩了这个坑，调试了半小时才发现门店全跑非洲去了。

### 2.2 LineString（线）

由一系列有序的点连接而成的折线，常用于表示道路、路径、河流等。

```sql
SELECT ST_GeomFromText('LINESTRING(116.397 39.916, 116.407 39.926, 116.417 39.910)', 4326);
```

### 2.3 Polygon（多边形）

由一系列首尾相连的点围成的封闭区域，常用于表示行政区划、配送范围、地理围栏等。

```sql
SELECT ST_GeomFromText(
  'POLYGON((116.350 39.900, 116.450 39.900, 116.450 39.950, 116.350 39.950, 116.350 39.900))',
  4326
);
-- 注意：第一个点和最后一个点必须相同，形成闭合
```

### 2.4 MultiPolygon（多多边形）

多个 Polygon 的集合，适用于不连续的区域，比如一个城市有多个不相邻的行政区。

```sql
SELECT ST_GeomFromText(
  'MULTIPOLYGON(
    ((116.350 39.900, 116.400 39.900, 116.400 39.950, 116.350 39.950, 116.350 39.900)),
    ((116.500 39.900, 116.550 39.900, 116.550 39.950, 116.500 39.950, 116.500 39.900))
  )',
  4326
);
```

### 2.5 SRID 与坐标系

SRID（Spatial Reference System Identifier）是空间坐标系的标识符。最常用的两个：

| SRID | 名称 | 说明 |
|------|------|------|
| 4326 | WGS 84 | GPS 原始坐标（经纬度），全球通用 |
| 3857 | Web Mercator | Web 地图（Google Maps、高德）使用的投影坐标 |

在存储地理坐标时，统一使用 4326。需要计算真实距离或面积时，可以临时转换为适合当地的投影坐标系（比如中国常用的 EPSG:4490），或者使用 PostGIS 的 Geography 类型。

### 2.6 Geometry 与 Geography 的区别

PostGIS 提供了两种空间数据类型：Geometry 和 Geography，它们的核心区别在于计算距离和面积的方式：

| 维度 | Geometry | Geography |
|------|----------|-----------|
| 坐标系 | 平面坐标（笛卡尔） | 球面坐标（椭球体） |
| 距离计算 | 平面欧几里得距离 | 球面大圆距离 |
| 面积计算 | 平面面积 | 球面面积 |
| 索引效率 | 更高（简单的 bounding box） | 稍低（需要球面计算） |
| 支持的函数 | 所有函数 | 部分函数 |

在实际项目中的选择建议：

```sql
-- 如果只存储和查询经纬度，用 geometry + SRID 4326
ALTER TABLE stores ADD COLUMN location geometry(Point, 4326);

-- 如果需要频繁计算距离和面积，用 geography
ALTER TABLE stores ADD COLUMN location geography(Point, 4326);
```

我的经验是：**存储用 Geometry，查询时按需转换**。这样既能享受 Geometry 的索引效率，又能在需要时获得精确的球面距离计算。比如：

```sql
-- 存储时使用 Geometry
INSERT INTO stores (name, location)
VALUES ('天安门店', ST_SetSRID(ST_MakePoint(116.397, 39.916), 4326));

-- 查询时转换为 Geography 计算精确距离
SELECT name,
       ST_Distance(
           location::geography,
           ST_SetSRID(ST_MakePoint(116.520, 39.950), 4326)::geography
       ) as distance_meters
FROM stores;
```

---

## 三、核心空间函数

### 3.1 ST_Distance —— 计算两点之间的距离

```sql
-- 计算两点之间的距离（单位取决于坐标系）
-- 对于 SRID 4326（经纬度），返回值单位是"度"
SELECT ST_Distance(
  ST_GeomFromText('POINT(116.397 39.916)', 4326),
  ST_GeomFromText('POINT(116.520 39.950)', 4326)
);

-- 使用 Geography 类型可以得到以"米"为单位的距离
SELECT ST_Distance(
  'SRID=4326;POINT(116.397 39.916)'::geography,
  'SRID=4326;POINT(116.520 39.950)'::geography
);
-- 输出约为 11000 米（约 11 公里）
```

### 3.2 ST_DWithin —— 判断两点是否在指定距离内

这是做"附近 POI"查询最核心的函数：

```sql
-- 判断天安门 5 公里内是否有某个门店
SELECT EXISTS (
  SELECT 1 FROM stores
  WHERE ST_DWithin(
    location::geography,
    ST_GeomFromText('POINT(116.397 39.916)', 4326)::geography,
    5000  -- 5000 米
  )
);
```

`ST_DWithin` 内部会自动利用空间索引，比手动计算距离再比较要高效得多。

### 3.3 ST_Contains —— 判断一个几何体是否完全包含另一个

```sql
-- 判断一个点是否在某个区域内（地理围栏核心函数）
SELECT ST_Contains(
  ST_GeomFromText('POLYGON((116.350 39.900, 116.450 39.900, 116.450 39.950, 116.350 39.950, 116.350 39.900))', 4326),
  ST_GeomFromText('POINT(116.400 39.920)', 4326)
);
-- 返回 true，表示该点在多边形区域内
```

### 3.4 ST_Intersects —— 判断两个几何体是否相交

```sql
-- 判断一条路线是否经过某个区域
SELECT ST_Intersects(
  ST_GeomFromText('LINESTRING(116.300 39.900, 116.500 39.950)', 4326),
  ST_GeomFromText('POLYGON((116.350 39.900, 116.450 39.900, 116.450 39.950, 116.350 39.950, 116.350 39.900))', 4326)
);
-- 返回 true
```

### 3.5 其他常用函数

| 函数 | 用途 |
|------|------|
| `ST_MakeLine` | 将多个点连成线 |
| `ST_Area` | 计算多边形面积 |
| `ST_Length` | 计算线的长度 |
| `ST_Buffer` | 以某点为中心生成缓冲区（圆形） |
| `ST_AsText` | 将几何体转为 WKT 文本 |
| `ST_X` / `ST_Y` | 获取 Point 的经度/纬度 |
| `ST_Union` | 合并多个几何体 |

### 3.5 坐标转换与距离单位

在实际项目中，坐标转换是一个常见需求。比如前端地图 SDK 返回的坐标可能需要转换格式，或者高德、百度地图的坐标系与 GPS 的 WGS 84 坐标系不同：

```sql
-- 将 WGS 84 (SRID 4326) 转换为 Web Mercator (SRID 3857)
SELECT ST_Transform(
    ST_GeomFromText('POINT(116.397 39.916)', 4326),
    3857
);

-- 批量转换坐标系
UPDATE stores
SET location = ST_Transform(location, 3857)
WHERE location IS NOT NULL;
```

国内地图常用的坐标系转换：

```sql
-- WGS 84 (GPS) -> GCJ 02 (高德/腾讯)
-- 需要安装 pg_fuzzygeo 扩展或自行实现转换函数
-- 建议在应用层用 Laravel 的辅助类处理，而非在数据库层做
```

> **踩坑记录**：高德地图使用的是 GCJ 02 坐标系，百度地图使用的是 BD 09 坐标系，与 GPS 的 WGS 84 坐标系存在偏移。如果你直接把高德的坐标插入 PostGIS 而不做转换，距离计算会有 100-500 米的误差。我们项目中专门写了一个 Laravel 的辅助类来做坐标转换：

```php
// app/Services/CoordinateService.php
class CoordinateService
{
    // WGS 84 -> GCJ 02
    public static function wgs84ToGcj02(float $lng, float $lat): array
    {
        // 使用成熟的第三方库，比如 php-coord-trans
        // 这里省略具体转换算法
    }

    // GCJ 02 -> WGS 84
    public static function gcj02ToWgs84(float $lng, float $lat): array
    {
        // 逆转换算法
    }
}
```

---

## 四、实战场景一：附近 POI 查询

这是最常见的 LBS 需求——查找用户 5 公里范围内的门店。

### 4.1 建表与数据准备

```php
// Laravel Migration
Schema::create('stores', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->decimal('longitude', 10, 7);  // 经度
    $table->decimal('latitude', 10, 7);   // 纬度
    $table->string('address');
    $table->timestamps();
});
```

> **经验分享**：我强烈建议同时存储经纬度的独立字段和 PostGIS 的 geometry 字段。独立字段方便业务逻辑读取，geometry 字段专门用于空间查询。虽然有点冗余，但在实际项目中这样做最灵活。

添加 PostGIS geometry 字段：

```php
// 在 Migration 中使用 raw SQL
DB::statement("ALTER TABLE stores ADD COLUMN location geometry(Point, 4326)");

// 创建 GiST 空间索引
DB::statement("CREATE INDEX stores_location_idx ON stores USING GIST (location)");
```

插入数据时，同步更新 geometry 字段：

```php
class Store extends Model
{
    protected static function booted(): void
    {
        static::saving(function (Store $store) {
            if ($store->longitude && $store->latitude) {
                $store->location = DB::raw(
                    "ST_SetSRID(ST_MakePoint({$store->longitude}, {$store->latitude}), 4326)"
                );
            }
        });
    }
}
```

或者在插入后批量更新：

```php
DB::statement("
    UPDATE stores
    SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
    WHERE location IS NULL
");
```

### 4.2 查询 5 公里内的门店

**方法一：使用 Geography 类型（推荐，精度高）**

```php
$userLng = 116.397128;
$userLat = 39.916527;
$radiusMeters = 5000;

$nearbyStores = DB::select("
    SELECT
        id,
        name,
        address,
        ST_Distance(
            location::geography,
            ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
        ) AS distance_meters
    FROM stores
    WHERE ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
        ?
    )
    ORDER BY distance_meters ASC
    LIMIT 50
", [$userLng, $userLat, $userLng, $userLat, $radiusMeters]);
```

**方法二：使用 ST_Buffer + Geometry（适合对精度要求不高的场景）**

```php
$nearbyStores = Store::whereRaw("
    ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
        ?
    )
", [$userLng, $userLat, $radiusMeters])
->selectRaw("
    *,
    ST_Distance(
        location::geography,
        ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
    ) as distance
", [$userLng, $userLat])
->orderBy('distance')
->limit(50)
->get();
```

### 4.3 性能对比

在一个包含 50 万条门店数据的表上测试：

| 方案 | 响应时间 | 备注 |
|------|----------|------|
| PostGIS + GiST 索引 | 3-8ms | 精确地理距离 |
| Redis Geo GEORADIUS | 1-3ms | Geohash 精度约 ±0.5% |
| MySQL Haversine 公式 | 200-500ms | 全表扫描，无空间索引 |
| MySQL + SPATIAL INDEX | 15-40ms | MySQL 空间索引功能有限 |

> **踩坑记录**：第一次写 `ST_DWithin` 时，我忘了在 `location` 后面加 `::geography`，直接用的 geometry 类型。结果查询返回的距离值看起来"正常"但实际上是"度"不是"米"，5000度≈555000公里，相当于查了半个地球。这个 bug 上了测试环境才被 QA 发现，大家引以为戒。

---

## 五、实战场景二：地理围栏

地理围栏（Geofencing）是指判断一个坐标点是否落在某个不规则的多边形区域内。常见于：

- 配送范围判断：骑手是否在商户配送区域内
- 行政区划归属：某个坐标属于哪个区
- 电子围栏报警：车辆是否驶出指定区域

### 5.1 存储配送区域

```php
// Migration
Schema::create('delivery_zones', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->timestamps();
});

DB::statement("ALTER TABLE delivery_zones ADD COLUMN boundary geometry(Polygon, 4326)");
DB::statement("CREATE INDEX delivery_zones_boundary_idx ON delivery_zones USING GIST (boundary)");
```

插入一个配送区域（以北京朝阳区的一小块为例）：

```php
DB::statement("
    INSERT INTO delivery_zones (name, boundary, created_at, updated_at) VALUES (
        '朝阳区核心配送区',
        ST_GeomFromText(
            'POLYGON((116.400 39.900, 116.500 39.900, 116.500 39.960, 116.400 39.960, 116.400 39.900))',
            4326
        ),
        NOW(), NOW()
    )
");
```

### 5.2 判断骑手是否在配送区域内

```php
$riderLng = 116.450;
$riderLat = 39.930;

$zones = DB::select("
    SELECT id, name
    FROM delivery_zones
    WHERE ST_Contains(
        boundary,
        ST_SetSRID(ST_MakePoint(?, ?), 4326)
    )
", [$riderLng, $riderLat]);

if (empty($zones)) {
    // 骑手不在任何配送区域内
    return response()->json(['error' => '超出配送范围'], 422);
}
```

### 5.3 使用 GeoJSON 导入不规则区域

实际项目中，配送区域通常是运营在地图上手动圈画的，前端会传回 GeoJSON 格式的数据。PostGIS 可以直接解析 GeoJSON：

```php
// 前端传来的 GeoJSON
$geojson = '{
    "type": "Polygon",
    "coordinates": [[[116.400,39.900],[116.500,39.900],[116.520,39.940],[116.480,39.960],[116.400,39.960],[116.400,39.900]]]
}';

DB::statement("
    INSERT INTO delivery_zones (name, boundary, created_at, updated_at) VALUES (
        '自定义配送区',
        ST_SetSRID(ST_GeomFromGeoJSON(?), 4326),
        NOW(), NOW()
    )
", [$geojson]);
```

也可以反过来，将数据库中的 geometry 导出为 GeoJSON 用于前端地图展示：

```php
$zones = DB::select("
    SELECT id, name, ST_AsGeoJSON(boundary) as geojson
    FROM delivery_zones
");

// 返回给前端的数据结构
foreach ($zones as $zone) {
    $zone->boundary_geojson = json_decode($zone->geojson);
}
```

### 5.4 批量归属判断

当需要为大量订单批量判断所属配送区域时，可以用空间连接查询：

```php
// 一次性判断多个订单坐标的区域归属
DB::statement("
    CREATE TEMP TABLE temp_orders AS
    SELECT 1 as order_id, 116.450 as lng, 39.930 as lat
    UNION ALL
    SELECT 2, 116.350, 39.930
    UNION ALL
    SELECT 3, 116.600, 39.930
");

$results = DB::select("
    SELECT t.order_id, dz.id as zone_id, dz.name as zone_name
    FROM temp_orders t
    LEFT JOIN delivery_zones dz ON ST_Contains(
        dz.boundary,
        ST_SetSRID(ST_MakePoint(t.lng, t.lat), 4326)
    )
");
```

> **踩坑记录**：地理围栏的多边形坐标必须是逆时针顺序（OGC 标准），如果你从某些地图工具导出的坐标是顺时针的，`ST_Contains` 会返回反向结果——点在外面它说在里面。解决方法是用 `ST_ForceRHR`（Force Right-Hand Rule）强制转为逆时针：`ST_ForceRHR(ST_GeomFromGeoJSON(?))`。这个坑我排查了一整天。

---

## 六、实战场景三：路径规划基础

严格意义上的路径规划需要路网数据（OpenStreetMap + pgRouting），这超出了本文的范围。但 PostGIS 提供的基础几何运算已经能满足很多"轻量级路径"需求。

### 6.1 记录骑手轨迹

```php
// 创建轨迹表
Schema::create('rider_tracks', function (Blueprint $table) {
    $table->id();
    $table->foreignId('rider_id');
    $table->foreignId('order_id');
    $table->timestamps();
});

DB::statement("ALTER TABLE rider_tracks ADD COLUMN track geometry(LineString, 4326)");
```

骑手端每几秒上报一次坐标，后端将这些点串成线：

```php
// 假设收集到了一系列轨迹点
$points = [
    [116.397, 39.916],
    [116.400, 39.918],
    [116.405, 39.920],
    [116.410, 39.922],
    [116.415, 39.925],
];

// 构建 WKT 格式的 LINESTRING
$wktPoints = collect($points)->map(fn($p) => "{$p[0]} {$p[1]}")->implode(', ');

DB::statement("
    UPDATE rider_tracks
    SET track = ST_GeomFromText('LINESTRING({$wktPoints})', 4326)
    WHERE id = ?
", [$trackId]);
```

### 6.2 计算轨迹总距离

```php
// 使用 Geography 类型计算真实的地表距离（米）
$result = DB::select("
    SELECT
        ST_Length(track::geography) as total_distance_meters,
        ST_NumPoints(track) as num_points,
        ST_StartPoint(track) as start_point,
        ST_EndPoint(track) as end_point
    FROM rider_tracks
    WHERE id = ?
", [$trackId]);

$distanceMeters = $result[0]->total_distance_meters;
```

### 6.3 判断骑手轨迹是否偏离规划路线

```php
// 假设有一条规划路线
$plannedRoute = 'LINESTRING(116.397 39.916, 116.420 39.930, 116.440 39.940)';

// 计算骑手实际轨迹与规划路线的最大偏离距离
$result = DB::select("
    SELECT
        ST_MaxDistance(
            track::geography,
            ST_GeomFromText(?, 4326)::geography
        ) as max_deviation_meters
    FROM rider_tracks
    WHERE id = ?
", [$plannedRoute, $trackId]);

if ($result[0]->max_deviation_meters > 500) {
    // 偏离路线超过 500 米，触发告警
}
```

### 6.4 沿线插值——估算骑手当前位置

如果骑手上报的坐标有延迟，可以通过沿线插值估算其当前位置：

```php
// 假设骑手已经完成了 60% 的路线
$result = DB::select("
    SELECT ST_AsText(
        ST_LineInterpolatePoint(
            ST_GeomFromText(?, 4326),
            0.6
        )
    ) as estimated_position
", [$plannedRoute]);
// 返回路线 60% 处的坐标点
```

> **经验分享**：`ST_LineInterpolatePoint` 在做骑手位置预测和进度展示时非常有用。你可以结合骑手上报的最后一个坐标和规划路线，用最近点投影（`ST_LineLocatePoint`）计算骑手在路线上的进度百分比，然后结合订单的预计送达时间做平滑展示。

---

## 七、与 Redis Geo 的深度对比

这是很多人最关心的问题：到底该用 PostGIS 还是 Redis Geo？

### 7.1 功能维度对比

| 维度 | PostGIS | Redis Geo |
|------|---------|-----------|
| **数据类型** | 点、线、多边形、多多边形、几何集合 | 仅支持点（Point） |
| **距离查询** | ✅ 球面精确距离（Geography） | ✅ 基于 Geohash 的近似距离 |
| **范围查询** | ✅ 任意多边形范围 | ❌ 仅支持圆形/矩形范围 |
| **地理围栏** | ✅ ST_Contains 直接判断 | ❌ 需要自行实现 |
| **路径/线** | ✅ 原生 LineString 支持 | ❌ 不支持 |
| **面积计算** | ✅ ST_Area | ❌ 不支持 |
| **坐标转换** | ✅ 支持数千种坐标系 | ❌ 仅 WGS 84 |
| **拓扑关系** | ✅ 相交、包含、覆盖、相邻等 9 种 DE-9IM 关系 | ❌ 不支持 |
| **空间聚合** | ✅ ST_Union、ST_Collect、ST_Cluster | ❌ 需要手动实现 |

### 7.2 性能维度对比

| 场景 | PostGIS（50 万数据） | Redis Geo（50 万数据） |
|------|---------------------|----------------------|
| 附近 5km 点查询 | 3-8ms | 1-3ms |
| 地理围栏判断 | 2-5ms | 不支持（自实现 50-200ms） |
| 写入单条数据 | 0.5-2ms | 0.1-0.5ms |
| 联表查询 + 空间过滤 | 10-30ms | 不支持 |

Redis Geo 在纯"附近点查询"场景下确实更快，因为数据全部在内存中。但 PostGIS 的查询性能在有索引的情况下也非常优秀，3-8ms 完全可以满足绝大多数在线业务的需求。

### 7.3 可靠性维度对比

| 维度 | PostGIS | Redis Geo |
|------|---------|-----------|
| 数据持久化 | ✅ PostgreSQL 事务保障 | ⚠️ 取决于 Redis 持久化策略 |
| 数据一致性 | ✅ ACID 事务 | ❌ 最终一致性 |
| 复杂查询 | ✅ SQL 是图灵完备的查询语言 | ❌ 只有基础的几个命令 |
| 数据分析 | ✅ 可直接对接 GIS 工具、QGIS、Mapbox | ❌ 需要额外导出 |
| 运维成本 | 需要维护 PostgreSQL | 需要维护 Redis |

### 7.4 Redis Geo 的局限性深入分析

在实际项目中，Redis Geo 的局限性主要体现在以下几个方面：

**1. 只支持圆形查询**

Redis Geo 的 `GEORADIUS` 命令只能查询圆形范围内的点。但现实中的地理围栏往往是不规则多边形。比如一个配送区域可能是沿着河流、道路等自然边界划定的，不可能是完美的圆形。要实现多边形查询，你得：

```php
// Redis Geo 只能用矩形+射线法
// 第一步：用矩形粗筛
$minLng = 116.350;
$maxLng = 116.500;
$minLat = 39.900;
$maxLat = 39.960;

$potentialPoints = Redis::georadius(
    'geofence_key',
    ($minLng + $maxLng) / 2,
    ($minLat + $maxLat) / 2,
    $maxDistance,
    'km',
    'WITHCOORD'
);

// 第二步：对每个点用射线法判断是否在多边形内
foreach ($potentialPoints as $point) {
    if ($this->pointInPolygon($point, $polygon)) {
        // 在围栏内
    }
}
// 这种方式既慢又不精确
```

**2. Geohash 精度问题**

Redis Geo 底层使用 Geohash 索引，其精度约为 ±0.6% 的距离误差。对于 5 公里范围的查询，误差可能达到 30 米。在大多数场景下这可以接受，但在需要精确到厘米级的场景（比如测量两个建筑之间的精确距离）就不够用了。

**3. 无法处理复杂的空间关系**

Redis Geo 完全不支持以下操作：
- 两个多边形是否相交
- 一条线是否穿过某个区域
- 计算两个多边形的重叠面积
- 判断点是否在某个不规则区域内

这些操作在地理围栏、城市规划、物流调度等场景中是刚需。

**4. 数据同步困难**

如果你的门店数据存储在 MySQL/PostgreSQL 中，同时又需要在 Redis 中维护一份 Geohash 索引，那么数据同步就是一个大问题。门店信息更新时需要同时更新两个数据源，很容易出现不一致。而 PostGIS 直接在数据库层解决了这个问题，没有额外的同步开销。

### 7.5 适用场景建议

**选择 Redis Geo 的场景：**
- 纯粹的"附近的人"功能，只有点数据
- 对响应时间要求极端苛刻（亚毫秒级）
- 数据量不大（< 100 万），且数据可以完全放在内存中
- 已经在用 Redis 做其他缓存，不想引入新的依赖

**选择 PostGIS 的场景：**
- 需要地理围栏（多边形包含判断）
- 需要处理线、面等复杂几何体
- 需要与业务数据联表查询（比如"5 公里内且评分大于 4.5 的门店"）
- 数据量大（> 100 万），不适合全部放内存
- 需要数据持久化和事务保障
- 需要做空间分析（热力图、区域聚合、路径分析）

**我的建议**：如果你的项目只有"附近的人"一个简单需求，且数据量不大，用 Redis Geo 完全没问题。但只要你的需求稍微复杂一点——比如加上地理围栏、配送范围、轨迹记录——就直接上 PostGIS，不要犹豫。"用 Redis Geo 硬撑复杂空间查询"的技术债，远比"引入 PostGIS"的学习成本高。

### 7.5 混合架构

实际上两者并不冲突，很多大厂的架构是：

- **PostGIS** 作为空间数据的主存储和复杂查询引擎
- **Redis Geo** 作为空间查询的缓存层，加速高频的"附近点查询"

```php
// 先查 Redis 缓存
$cacheKey = "nearby:stores:{$userLng}:{$userLat}:5km";
$storeIds = Redis::georadius($cacheKey, $userLng, $userLat, 5, 'km', 'ASC', 'COUNT', 20);

if (empty($storeIds)) {
    // 缓存未命中，查 PostGIS
    $stores = // ... PostGIS 查询 ...
    // 写入 Redis 缓存
    foreach ($stores as $store) {
        Redis::geoadd($cacheKey, $store->longitude, $store->latitude, $store->id);
    }
    Redis::expire($cacheKey, 300); // 5 分钟过期
}
```

---

## 八、Laravel 中的 Eloquent 集成与原始 SQL 查询

### 8.1 封装一个空间查询 Trait

为了在项目中更方便地使用 PostGIS，我封装了一个 Trait：

```php
// app/Traits/HasSpatialQuery.php
trait HasSpatialQuery
{
    /**
     * 查询指定范围内的记录
     */
    public function scopeWithinDistance(
        $query,
        float $lng,
        float $lat,
        int $distanceMeters,
        string $column = 'location'
    ) {
        return $query->whereRaw("
            ST_DWithin(
                {$column}::geography,
                ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
                ?
            )
        ", [$lng, $lat, $distanceMeters]);
    }

    /**
     * 计算到指定点的距离（米）
     */
    public function scopeWithDistance(
        $query,
        float $lng,
        float $lat,
        string $column = 'location'
    ) {
        return $query->selectRaw("
            *,
            ST_Distance(
                {$column}::geography,
                ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
            ) as distance_meters
        ", [$lng, $lat]);
    }

    /**
     * 判断是否在指定区域内
     */
    public function scopeWithinPolygon(
        $query,
        string $geojson,
        string $column = 'location'
    ) {
        return $query->whereRaw("
            ST_Contains(
                ST_SetSRID(ST_GeomFromGeoJSON(?), 4326),
                {$column}
            )
        ", [$geojson]);
    }
}
```

使用示例：

```php
// Store 模型
class Store extends Model
{
    use HasSpatialQuery;
}

// 控制器中
$stores = Store::withinDistance(116.397, 39.916, 5000)
    ->withDistance(116.397, 39.916)
    ->orderBy('distance_meters')
    ->limit(20)
    ->get();

// 复合查询：5 公里内 + 营业中 + 评分 4.5 以上
$stores = Store::withinDistance(116.397, 39.916, 5000)
    ->withDistance(116.397, 39.916)
    ->where('is_open', true)
    ->where('rating', '>=', 4.5)
    ->orderBy('distance_meters')
    ->get();
```

### 8.2 使用 DB::raw 和 selectRaw

对于更复杂的场景，直接写 SQL 往往更清晰：

```php
// 获取某区域内的门店统计（按商圈聚合）
$results = DB::select("
    SELECT
        dz.name as zone_name,
        COUNT(s.id) as store_count,
        AVG(s.rating) as avg_rating
    FROM delivery_zones dz
    JOIN stores s ON ST_Contains(dz.boundary, s.location)
    WHERE dz.name IN ('朝阳区', '海淀区', '东城区')
    GROUP BY dz.name
    ORDER BY store_count DESC
");
```

### 8.3 处理 geometry 字段的序列化

当 Eloquent 模型返回 geometry 字段时，默认的值是 WKB（Well-Known Binary）格式的二进制数据，前端无法直接使用。需要在模型中做转换：

```php
class Store extends Model
{
    // 将 geometry 字段转为 GeoJSON
    protected $appends = ['geojson_location'];

    public function getGeojsonLocationAttribute(): ?array
    {
        if (!$this->location) return null;

        $result = DB::selectOne(
            "SELECT ST_AsGeoJSON(?) as geojson",
            [$this->attributes['location']]
        );

        return $result ? json_decode($result->geojson, true) : null;
    }

    // 或者直接在获取器中返回经纬度
    public function getLngLatAttribute(): ?array
    {
        $result = DB::selectOne("
            SELECT
                ST_X(location::geometry) as lng,
                ST_Y(location::geometry) as lat
            FROM stores WHERE id = ?
        ", [$this->id]);

        return $result ? ['lng' => $result->lng, 'lat' => $result->lat] : null;
    }
}
```

> **踩坑记录**：在 Laravel 中使用 `DB::select` 执行 PostGIS 查询时，如果 SQL 中有 `?` 占位符且参数中包含 GeoJSON 字符串（里面有很多花括号），有时候 PDO 会解析出错。我的解决方案是：对于复杂参数，先用 `addslashes` 或 `pg_escape_string` 处理，或者干脆用 prepared statement。另外一个办法是使用 `DB::unprepared` 先创建临时变量。

---

## 九、空间索引（GiST）与性能优化

### 9.1 创建空间索引

PostGIS 使用 GiST（Generalized Search Tree）索引，底层实现是 R-Tree：

```sql
-- 在 geometry 列上创建空间索引
CREATE INDEX idx_stores_location ON stores USING GIST (location);

-- 在 geography 列上创建空间索引（如果使用 geography 类型存储）
CREATE INDEX idx_stores_geo ON stores USING GIST (location::geography);
```

### 9.2 验证索引是否生效

使用 `EXPLAIN ANALYZE` 查看查询计划：

```sql
EXPLAIN ANALYZE
SELECT id, name
FROM stores
WHERE ST_DWithin(
    location::geography,
    ST_SetSRID(ST_MakePoint(116.397, 39.916), 4326)::geography,
    5000
);
```

如果索引生效，你会在执行计划中看到 `Index Scan using idx_stores_location`。如果看到 `Seq Scan`，说明索引没有被使用——常见原因包括：

1. 没有创建空间索引
2. 使用了函数转换导致索引无法匹配（比如列是 geometry 类型但查询中转成了 geography）
3. 数据量太小，PostgreSQL 优化器选择了全表扫描

### 9.3 索引优化策略

**策略一：同时创建 geometry 和 geography 索引**

如果你在查询中经常用到 `::geography` 转换，建议单独创建一个 geography 列，或者创建表达式索引：

```sql
-- 表达式索引
CREATE INDEX idx_stores_geo_exp ON stores USING GIST (location::geography);
```

**策略二：使用 bounding box 预过滤**

对于非常复杂的空间计算，可以先用简单的 bounding box（边界矩形）做第一轮筛选，再做精确计算：

```sql
SELECT id, name, ST_Distance(
    location::geography,
    ST_SetSRID(ST_MakePoint(116.397, 39.916), 4326)::geography
) as distance
FROM stores
WHERE location && ST_MakeEnvelope(116.347, 39.866, 116.447, 39.966, 4326)  -- 粗略矩形
  AND ST_DWithin(
    location::geography,
    ST_SetSRID(ST_MakePoint(116.397, 39.916), 4326)::geography,
    5000
  )
ORDER BY distance
LIMIT 50;
```

`&&` 操作符只做 bounding box 比较，速度极快，可以大幅减少后续精确计算的数据量。

**策略三：分区表**

对于超大规模数据（千万级），考虑使用 PostgreSQL 的表分区：

```sql
-- 按城市分区
CREATE TABLE stores (
    id BIGSERIAL,
    name TEXT,
    city_code VARCHAR(10),
    location geometry(Point, 4326)
) PARTITION BY LIST (city_code);

CREATE TABLE stores_beijing PARTITION OF stores FOR VALUES IN ('110000');
CREATE TABLE stores_shanghai PARTITION OF stores FOR VALUES IN ('310000');
-- 每个分区创建独立的空间索引
```

### 9.4 连接池与并发

在高并发场景下，PostgreSQL 的连接管理很重要：

```php
// config/database.php 中配置连接池
'pgsql' => [
    'driver' => 'pgsql',
    'host' => env('DB_HOST'),
    // ...
    'options' => [
        PDO::ATTR_PERSISTENT => true,  // 持久连接
    ],
],
```

对于高并发场景，建议在 Laravel 前面加一个 PgBouncer 做连接池管理。

---

## 十、踩坑汇总与最佳实践

### 10.1 经典踩坑汇总

| 踩坑 | 问题描述 | 解决方案 |
|------|----------|----------|
| 经纬度顺序 | `ST_MakePoint` 参数是 (lng, lat)，不是 (lat, lng) | 始终记住：X = 经度，Y = 纬度 |
| 单位混淆 | geometry 类型的距离单位是"度"不是"米" | 查询距离时加 `::geography` 转换 |
| 多边形方向 | OGC 标准要求逆时针，某些工具导出的是顺时针 | 用 `ST_ForceRHR` 强制转换 |
| NULL 值 | geometry 字段为 NULL 时，空间函数会报错 | 在查询中添加 `WHERE location IS NOT NULL` |
| 索引失效 | `::geography` 转换导致 GiST 索引无法使用 | 创建表达式索引 `USING GIST (col::geography)` |
| WKB 输出 | Eloquent 获取 geometry 字段返回二进制 WKB | 使用 `ST_AsText` 或 `ST_AsGeoJSON` 转换 |
| 大多边形性能 | ST_Contains 对包含数千个顶点的多边形查询很慢 | 先用 bounding box 预过滤 |

### 10.2 最佳实践

1. **统一使用 WGS 84（SRID 4326）存储**，展示时再根据前端地图 API 的坐标系做转换。

2. **始终存储独立的经纬度字段**。虽然 PostGIS 的 geometry 字段包含坐标信息，但在业务逻辑中直接读写 `longitude` / `latitude` 字段更方便。

3. **空间索引要尽早创建**。在数据量大的时候再加索引会锁表很久。

4. **用 `ST_DWithin` 而不是 `ST_Distance < n`**。前者能利用索引，后者会全表扫描。

5. **定期执行 `VACUUM ANALYZE`**。PostgreSQL 的查询优化器依赖统计信息来选择最优执行计划，空间数据尤其如此。

6. **考虑使用 `geography` 类型直接存储**。虽然写入时稍慢，但查询时不需要每次做 `::geography` 转换，也不容易出错：

```php
DB::statement("
    ALTER TABLE stores ADD COLUMN geo_location geography(Point, 4326)
");
DB::statement("
    CREATE INDEX stores_geo_idx ON stores USING GIST (geo_location)
");
DB::statement("
    UPDATE stores SET geo_location = location::geography
");
```

7. **监控慢查询**。开启 PostgreSQL 的慢查询日志，关注空间查询的执行时间：

```sql
-- postgresql.conf
log_min_duration_statement = 50  -- 记录超过 50ms 的查询
```

---

## 十一、扩展：pgRouting 与路网规划

如果你需要真正的路径规划（沿路网的最短路径），可以安装 pgRouting 扩展：

```sql
CREATE EXTENSION IF NOT EXISTS pgrouting;
```

pgRouting 在 PostGIS 的基础上提供了 Dijkstra、A*、双向 Dijkstra 等图算法，可以基于 OpenStreetMap 的路网数据做真正的路径规划。但这需要额外的数据导入（osm2pgrouting）和更复杂的配置，留作后续文章单独展开。

### 11.1 数据批量导入与导出

在实际项目中，我们经常需要批量导入和导出空间数据。PostGIS 提供了多种便捷的方式：

**1. 使用 COPY 命令批量导入 CSV 数据**

```sql
-- 假设 CSV 文件格式为：id,name,longitude,latitude
-- 导入数据
CREATE TEMP TABLE temp_stores (
    id INTEGER,
    name VARCHAR(255),
    longitude DECIMAL(10, 7),
    latitude DECIMAL(10, 7)
);

COPY temp_stores FROM '/path/to/stores.csv' WITH (FORMAT csv, HEADER true);

-- 批量更新 geometry 字段
UPDATE temp_stores
SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
WHERE location IS NULL;

-- 插入主表
INSERT INTO stores (id, name, longitude, latitude, location)
SELECT id, name, longitude, latitude, location FROM temp_stores;
```

**2. 使用 pg_dump 导出带有空间数据的备份**

```bash
# 导出整个数据库（包含 PostGIS 扩展和空间数据）
pg_dump -h localhost -U postgres -d laravel -F c -f backup.dump

# 导出为 SQL 格式（可读）
pg_dump -h localhost -U postgres -d laravel -F p -f backup.sql

# 只导出特定表的空间数据
pg_dump -h localhost -U postgres -d laravel -t stores -F p | \
  sed 's/\\x[0-9a-f]*/ST_AsText(location) as location_text/g' > stores_export.sql
```

**3. 使用 PostGIS 的 ST_GeomFromGeoJSON 导入 GeoJSON 文件**

```php
// 读取 GeoJSON 文件并导入到数据库
$geojson = file_get_contents('/path/to/areas.geojson');
$features = json_decode($geojson, true);

foreach ($features['features'] as $feature) {
    DB::statement("
        INSERT INTO delivery_zones (name, boundary, created_at, updated_at)
        VALUES (?, ST_SetSRID(ST_GeomFromGeoJSON(?), 4326), NOW(), NOW())
    ", [$feature['properties']['name'], json_encode($feature['geometry'])]);
}
```

**4. 使用 ST_AsGeoJSON 导出为 GeoJSON 格式**

```sql
-- 导出整个表为 GeoJSON 格式
SELECT json_build_object(
    'type', 'FeatureCollection',
    'features', json_agg(
        json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
                'id', dz.id,
                'name', dz.name
            ),
            'geometry', ST_AsGeoJSON(dz.boundary)::json
        )
    )
)
FROM delivery_zones dz;
```

### 11.2 生产环境部署建议

**1. 数据库连接池配置**

在高并发场景下，合理配置连接池非常重要：

```php
// config/database.php
'pgsql' => [
    'driver' => 'pgsql',
    'host' => env('DB_HOST'),
    'port' => env('DB_PORT', 5432),
    'database' => env('DB_DATABASE'),
    'username' => env('DB_USERNAME'),
    'password' => env('DB_PASSWORD'),
    'charset' => 'utf8',
    'prefix' => '',
    'prefix_indexes' => true,
    // 启用持久连接
    'options' => extension_loaded('pdo_pgsql') ? [
        PDO::ATTR_PERSISTENT => true,
    ] : [],
],
```

**2. 配置 PgBouncer 连接池**

对于大规模部署，建议在 Laravel 和 PostgreSQL 之间加一层 PgBouncer：

```ini
# /etc/pgbouncer/pgbouncer.ini
[databases]
laravel = host=127.0.0.1 port=5432 dbname=laravel

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 20
```

**3. 监控与告警**

```sql
-- 监控慢查询（创建扩展）
CREATE EXTENSION pg_stat_statements;

-- 查看最慢的 10 个查询
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
WHERE query LIKE '%ST_%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**4. 定期维护任务**

```php
// app/Console/Commands/PostgisMaintenance.php
class PostgisMaintenance extends Command
{
    protected $signature = 'postgis:maintenance';

    public function handle()
    {
        // 更新统计信息
        DB::statement('ANALYZE stores');
        DB::statement('ANALYZE delivery_zones');

        // 清理过期的轨迹数据
        DB::statement("
            DELETE FROM rider_tracks
            WHERE created_at < NOW() - INTERVAL '90 days'
        ");

        // 重建索引（在低峰期执行）
        // DB::statement('REINDEX INDEX stores_location_idx');

        $this->info('PostGIS 维护任务完成');
    }
}
```

### 11.3 性能基准测试

在我们的生产环境中（PostgreSQL 15 + PostGIS 3.4，200 万门店数据，4 核 8GB 内存），测试结果如下：

| 查询场景 | 平均响应时间 | P99 响应时间 |
|---------|------------|-------------|
| 附近 5km 点查询 | 4.2ms | 12ms |
| 地理围栏判断 | 2.8ms | 8ms |
| 轨迹距离计算 | 3.5ms | 15ms |
| 区域聚合统计 | 45ms | 120ms |
| 批量插入 1 万条 | 280ms | 450ms |

这些数据表明，PostGIS 在有合适索引的情况下，完全能够满足在线业务的性能要求。

---

## 总结

从 Redis Geo 迁移到 PostGIS 是一次值得的技术决策。虽然 PostGIS 的初始配置比 Redis Geo 复杂一些，但它带来的功能完整性和查询灵活性是 Redis Geo 无法比拟的。特别是在需要处理地理围栏、不规则区域、轨迹数据、复杂联表查询这些场景时，PostGIS 几乎是唯一的选择。

对于 Laravel 项目，PostGIS 的集成成本并不高。通过 Trait 封装 + 原始 SQL 的方式，既保持了 Eloquent 的便利性，又保留了 PostGIS 的全部能力。配合 GiST 空间索引，50 万级别的数据查询完全可以在 10ms 以内完成。

最后，给一个简单的决策树：

1. 只需要"附近点"查询 → 数据量小且已有 Redis → **Redis Geo**
2. 需要"附近点"查询 → 数据量大或需要联表 → **PostGIS**
3. 需要地理围栏/区域判断 → **PostGIS**（Redis 做不了）
4. 需要路径/轨迹/面积计算 → **PostGIS**（Redis 做不了）
5. 以上都要 → **PostGIS 为主，Redis Geo 做缓存**

希望这篇文章能帮你少走弯路。如果你的空间查询需求已经超出了简单的"附近的人"，是时候认真考虑 PostGIS 了。
---

## 附录：四大空间方案横向对比

除了 PostGIS 和 Redis Geo，MySQL Spatial 和 MongoDB GeoJSON 也是常见的空间数据方案。下表从多个维度进行了全面对比：

| 维度 | PostGIS (PostgreSQL) | MySQL Spatial | MongoDB GeoJSON | Redis Geo |
|------|---------------------|---------------|-----------------|-----------|
| **空间数据类型** | 点/线/面/多边形/几何集合，完整 OGC Simple Features | 点/线/面/几何集合，功能较全 | GeoJSON/GeoBSON（点/线/面） | 仅点（Point） |
| **空间函数数量** | 800+ 个函数 | ~50 个函数 | ~30 个操作符/聚合 | 6 个命令 |
| **空间索引** | GiST R-Tree，支持表达式索引 | R-Tree，仅支持 Geometry 类型 | 2dsphere 索引 | Geohash Sorted Set |
| **地理围栏** | ✅ ST_Contains / ST_Intersects 原生支持 | ⚠️ ST_Contains 存在 bug（MySQL 8.0 以下） | ✅ $geoWithin / $geoIntersects | ❌ 需自行实现 |
| **路径/线段** | ✅ 原生 LineString + pgRouting | ⚠️ 基础 LineString，无路网算法 | ✅ LineString，无路网算法 | ❌ 不支持 |
| **面积/长度计算** | ✅ ST_Area / ST_Length（球面+平面） | ⚠️ ST_Area 仅平面计算 | ⚠️ 仅通过聚合管道 | ❌ 不支持 |
| **坐标系转换** | ✅ ST_Transform 支持数千种 SRID | ⚠️ 有限的 SRID 支持 | ⚠️ 仅 WGS 84 (4326) | ❌ 仅 WGS 84 |
| **联表空间查询** | ✅ 原生 JOIN + 空间条件 | ⚠️ 支持但优化器经常选错执行计划 | ⚠️ $lookup 性能差 | ❌ 不支持 |
| **GeoJSON 导入导出** | ✅ ST_GeomFromGeoJSON / ST_AsGeoJSON | ❌ 不支持 GeoJSON | ✅ 原生 GeoJSON 存储 | ❌ 不支持 |
| **事务 ACID** | ✅ 完整支持 | ✅ InnoDB 支持 | ⚠️ 4.0+ 多文档事务 | ❌ 仅 Lua 脚本原子性 |
| **写入性能** | ⚠️ 较慢（500 条/秒） | ✅ 较快（1000+ 条/秒） | ✅ 快（批量写入优化好） | ✅ 最快（内存操作） |
| **读取性能（有索引）** | ✅ 3-8ms（50 万数据） | ⚠️ 15-40ms（优化器不稳定） | ⚠️ 10-30ms | ✅ 1-3ms |
| **大数据量支持** | ✅ 千万级无压力 | ⚠️ 百万级以上性能下降明显 | ✅ 千万级可水平扩展 | ⚠️ 受限于内存 |
| **Laravel 集成** | ⚠️ 需原生 SQL 或 grimzy 包 | ✅ Eloquent 原生支持 | ✅ MongoDB Laravel 包 | ✅ phpredis 原生支持 |
| **适用场景** | 复杂空间查询、地理围栏、路径规划 | 简单附近查询、轻量 GIS | 文档型空间数据、快速原型 | 纯附近点查询、高并发缓存 |

### MySQL Spatial 的主要坑

1. **ST_Contains 的 bug**：MySQL 8.0.27 以下版本中，`ST_Contains` 在处理跨越 180° 经线的多边形时会返回错误结果。
2. **空间索引仅支持 Geometry 类型**：无法对 Geography 或 JSON 中的坐标创建空间索引。
3. **优化器问题**：MySQL 的查询优化器在处理空间函数时，经常选择全表扫描而不是使用空间索引，需要手动 `USE INDEX` 强制指定。
4. **SRID 支持有限**：MySQL 8.0 之前甚至不支持 SRID 的约束校验。

```sql
-- MySQL 空间索引的常见用法
CREATE SPATIAL INDEX idx_location ON stores (location);

-- 但查询时必须显式转换为 MBR 才能走索引
SELECT * FROM stores
WHERE MBRContains(
    ST_GeomFromText('POLYGON((...))', 4326),
    location
) FORCE INDEX (idx_location);
```

### MongoDB GeoJSON 的适用场景

MongoDB 的 `$geoWithin` 和 `$geoNear` 在文档型数据场景下有优势：

```javascript
// MongoDB 地理围栏查询
db.stores.find({
  location: {
    $geoWithin: {
      $geometry: {
        type: "Polygon",
        coordinates: [[[116.400,39.900],[116.500,39.900],[116.500,39.960],[116.400,39.960],[116.400,39.900]]]
      }
    }
  }
});
```

但 MongoDB 在以下方面不如 PostGIS：
- 不支持复杂的拓扑关系判断（如 `ST_Covers`、`ST_Overlaps`）
- 不支持空间聚合（如 `ST_ClusterDBSCAN`）
- `$lookup` 联表查询性能差，无法替代 SQL JOIN

### 选型建议总结

| 场景 | 推荐方案 |
|------|----------|
| 简单的"附近的人"，已有 Redis | **Redis Geo** |
| 需要地理围栏 + 轨迹 + 联表 | **PostGIS** |
| 简单 GIS + 用 MySQL | **MySQL Spatial**（但要注意 bug） |
| 文档型数据 + 快速原型 | **MongoDB GeoJSON** |
| 复杂空间分析 + 企业级 | **PostGIS** |

希望这篇文章能帮你少走弯路。如果你的空间查询需求已经超出了简单的"附近的人"，是时候认真考虑 PostGIS 了。

---

## 相关阅读

- [PostgreSQL Advisory Lock 实战进阶：会话级互斥、分布式任务调度与 PgBouncer 兼容性踩坑](/categories/01_MySQL/PostgreSQL-Advisory-Lock-实战进阶-会话级互斥-分布式任务调度-PgBouncer兼容性踩坑/)
- [PostgreSQL Vacuum 调优实战：autovacuum 参数、表膨胀治理与索引碎片整理](/categories/01_MySQL/PostgreSQL-Vacuum-调优实战-autovacuum参数表膨胀治理索引碎片整理/)
- [pg_stat_statements vs MySQL Performance Schema：慢查询监控实战](/categories/01_MySQL/2026-06-05-pg-stat-statements-MySQL-Performance-Schema-慢查询监控实战/)
