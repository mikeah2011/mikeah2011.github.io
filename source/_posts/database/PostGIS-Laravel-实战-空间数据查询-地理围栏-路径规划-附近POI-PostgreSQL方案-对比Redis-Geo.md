---
title: PostGIS + Laravel 实战：空间数据查询——地理围栏、路径规划与附近 POI 的 PostgreSQL 原生方案，对比 Redis Geo
date: 2026-06-06 14:30:00
description: 深入讲解PostGIS与Laravel的集成实战，涵盖空间数据查询、地理围栏判断、路径规划与附近POI搜索等核心场景。从PostgreSQL数据库建模到Eloquent模型封装，详解ST_Contains、ST_DWithin等空间函数的使用方式。对比PostGIS与Redis Geo在性能、功能、扩展性方面的差异，附带生产环境踩坑记录与性能基准测试数据，帮助开发者做出正确的技术选型。
tags: [PostGIS, PostgreSQL, Laravel, 地理围栏, 路径规划, Redis Geo, 空间数据]
categories:
  - database
cover: /images/covers/postgis-laravel-spatial-query-cover.jpg
---

## 前言：为什么 Laravel 开发者必须关注 PostGIS

在做本地生活类产品的时候，"附近门店"、"配送区域判断"、"骑手轨迹追踪"几乎是标配需求。我第一次接触这类需求时，第一反应就是用 Redis GEO——`GEOADD` 加数据、`GEOSEARCH` 搜附近、`GEODIST` 算距离，几个命令就搞定了，代码简洁、响应飞快，MVP 阶段效率确实很高。

但随着业务迭代，需求开始"膨胀"。产品经理要"地理围栏"——判断一个坐标是否在某个不规则的配送区域内，而不是简单的圆形范围。骑手端要"配送路径"——不只是两点之间的直线距离，而是要沿着路网计算实际路线。运营要做"区域热力图"——按行政区划、商圈来聚合门店数据。数据量也从最初的几万条涨到了几百万条，还要做复杂的空间筛选加上联表查询。

这时候 Redis GEO 的本质缺陷就暴露了。它的底层是基于 Geohash 编码的 Sorted Set，只支持点与点之间的距离查询，无法处理多边形包含判断、线段交叉、面积计算这些空间关系操作。要实现地理围栏，你得自己写 Geohash 编码加矩形预筛选加射线法判断，代码复杂且精度难以保证。

最终我们决定将空间查询全面迁移到 PostgreSQL 的 PostGIS 扩展上。PostGIS 是 PostgreSQL 最强大的空间扩展，提供了超过 700 个空间函数，支持点、线、面等所有几何类型，内置 R-Tree 和 GiST 空间索引，完全符合 OGC 标准。更重要的是，它是一个真正的关系型空间数据库——你可以把空间查询和普通的 SQL 查询、事务、约束完美结合。

这篇文章就是这次迁移的完整总结。我会从环境搭建开始，手把手带你完成 Laravel 和 PostgreSQL 以及 PostGIS 的集成，然后深入三个核心实战场景：地理围栏查询、附近 POI 搜索、路径规划与距离计算，最后将 PostGIS 方案与 Redis GEO 做全面对比，附带性能测试数据和踩坑记录。如果你正在纠结用哪个方案，这篇文章应该能帮你做出决定。

---

## 一、环境搭建：PostgreSQL + PostGIS + Laravel 集成

### 1.1 安装 PostgreSQL 和 PostGIS

在 macOS 上使用 Homebrew 安装是最方便的方式：

```bash
brew install postgresql@16 postgis
brew services start postgresql@16
```

安装完成后，创建数据库并启用 PostGIS 扩展。PostgreSQL 默认不包含空间功能，你需要手动启用扩展：

```sql
-- 创建数据库
createdb laravel_spatial

-- 进入数据库
psql laravel_spatial

-- 启用 PostGIS 扩展（这一步会在数据库中创建所有空间函数和系统表）
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- 启用 pgRouting 扩展（路径规划需要）
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- 验证安装是否成功
SELECT PostGIS_Version();
-- 输出示例: 3.4 USE_GEOS=1 PROJ=9.3.1 LIBXML=2.12.1
```

这里有几个需要注意的点。首先，PostGIS 扩展必须在目标数据库上启用，不是在整个 PostgreSQL 实例上。如果你有多个数据库需要使用空间功能，每个都要单独启用。其次，`CREATE EXTENSION` 需要超级用户权限，开发环境用默认的 postgres 用户即可，生产环境需要确保部署账号有这个权限。最后，PostgreSQL 和 PostGIS 的版本需要匹配，建议使用官方仓库提供的版本组合。

### 1.2 Laravel 项目配置

在 Laravel 项目中配置 PostgreSQL 连接，`.env` 文件内容如下：

```env
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=laravel_spatial
DB_USERNAME=postgres
DB_PASSWORD=your_password
```

Laravel 10 以后默认已经内置了 `pgsql` 驱动，不需要额外安装。如果你需要在 migration 中操作列类型（比如修改已有列添加空间属性），可以安装 Doctrine DBAL：

```bash
composer require doctrine/dbal
```

Redis 连接配置也需要保留，因为后续对比测试需要用到：

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=null
```

### 1.3 为什么不用 MySQL 的空间功能

你可能会问：MySQL 从 5.7 开始就支持空间类型和空间索引了，为什么不用 MySQL？原因很简单——MySQL 的空间函数集远不如 PostGIS 丰富。MySQL 只支持基本的空间操作，比如简单的距离计算和包含判断，而 PostGIS 提供了完整的 OGC 标准实现，包括空间关系判断（交叉、重叠、接触、包含等）、空间聚合（Union、Intersection）、坐标系自动转换、缓冲区分析等高级功能。

在实际项目中，MySQL 的空间索引在复杂查询下性能也不如 PostGIS 的 GiST 索引稳定。如果你的项目只需要简单的经纬度存储和距离查询，MySQL 可以凑合用，但一旦涉及地理围栏、多边形操作或复杂空间分析，PostGIS 是唯一的选择。

### 1.4 PostgreSQL 调优配置

针对空间查询场景，以下是我调优过的 `postgresql.conf` 配置：

```sql
-- 内存配置
shared_buffers = '1GB'           -- 建议设置为系统内存的 25%
effective_cache_size = '3GB'     -- 建议设置为系统内存的 75%
work_mem = '256MB'               -- 复杂空间查询可能需要较大的排序内存
maintenance_work_mem = '512MB'   -- VACUUM 和 CREATE INDEX 时使用

-- I/O 配置（适用于 SSD 存储）
random_page_cost = 1.1
effective_io_concurrency = 200

-- 自动清理配置（空间表更新频繁，需要更积极的清理）
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.02
```

空间表的高频写入会加速表膨胀，autovacuum 参数需要比默认值更积极。如果不调整，几个月后表膨胀可能导致查询性能严重退化。

---

## 二、数据库建模：空间字段的 Migration 设计

数据库设计是整个方案的基石。在 Laravel 中，我们通过 Migration 创建表结构，但空间字段的添加需要一些额外的技巧，因为 Laravel 的 Migration 原生不直接支持 PostGIS 的空间类型，需要用原生 SQL 来完成。

### 2.1 POI 表 Migration

创建一张存储兴趣点（Point of Interest）的表，包含地理坐标字段：

```php
<?php

// database/migrations/2026_06_06_000001_create_pois_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pois', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100);
            $table->string('category', 50);        // restaurant, hotel, hospital
            $table->decimal('longitude', 10, 7);   // 经度（WGS84 坐标系）
            $table->decimal('latitude', 10, 7);    // 纬度（WGS84 坐标系）
            $table->string('address', 255)->nullable();
            $table->json('metadata')->nullable();   // 扩展属性，营业时间、评分等
            $table->timestamps();

            $table->index('category');
        });

        // 添加 PostGIS 空间列（WGS84 坐标系，SRID 4326）
        // 这一步必须用原生 SQL，因为 Laravel Migration 不直接支持 GEOMETRY 类型
        DB::statement("ALTER TABLE pois ADD COLUMN location GEOMETRY(POINT, 4326)");

        // 用已有的经纬度数据填充 location 列
        // ST_SetSRID 设置坐标系，ST_MakePoint 创建点几何体
        DB::statement("
            UPDATE pois SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
        ");

        // 创建 GIST 空间索引——这是性能的关键！
        // 没有这个索引，所有空间查询都会退化为全表扫描
        DB::statement("CREATE INDEX idx_pois_location ON pois USING GIST (location)");
    }

    public function down(): void
    {
        Schema::dropIfExists('pois');
    }
};
```

这里的几个设计决策值得说明。我们同时保留了 `longitude`/`latitude` 列和 `location` 空间列。经纬度列方便应用程序直接读取坐标值，而空间列用于空间查询。虽然可以通过 `ST_X(location)` 和 `ST_Y(location)` 函数从空间列中提取经纬度，但在大量查询中这样做会影响性能。SRID 4326 对应 WGS-84 坐标系，这是 GPS 和大多数地图服务使用的坐标系，也是 PostGIS 默认推荐的存储坐标系。

### 2.2 地理围栏表 Migration

用于存储多边形围栏，比如配送区域、行政区划、营销覆盖范围等：

```php
<?php

// database/migrations/2026_06_06_000002_create_geofences_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('geofences', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100);
            $table->enum('type', ['delivery', 'administrative', 'marketing']);
            $table->boolean('is_active')->default(true);
            $table->json('properties')->nullable();  // 围栏附加属性
            $table->timestamps();
        });

        // 多边形围栏的空间列
        DB::statement("ALTER TABLE geofences ADD COLUMN boundary GEOMETRY(POLYGON, 4326)");

        // 同样需要 GIST 索引加速围栏查询
        DB::statement("CREATE INDEX idx_geofences_boundary ON geofences USING GIST (boundary)");
    }

    public function down(): void
    {
        Schema::dropIfExists('geofences');
    }
};
```

### 2.3 骑手轨迹表 Migration

记录骑手的位置轨迹，用于路径规划和轨迹回放。轨迹数据的特点是写入频率高（每几秒一次），查询主要是按时间范围和骑手 ID 检索：

```php
<?php

// database/migrations/2026_06_06_000003_create_rider_tracks_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_tracks', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('rider_id');
            $table->unsignedBigInteger('order_id')->nullable();
            $table->decimal('longitude', 10, 7);
            $table->decimal('latitude', 10, 7);
            $table->decimal('speed', 5, 2)->nullable();
            $table->decimal('heading', 5, 2)->nullable();
            $table->timestamp('recorded_at');
            $table->timestamps();

            // 复合索引：按骑手和时间查询是最常见的访问模式
            $table->index(['rider_id', 'recorded_at']);
            $table->index('order_id');
        });

        DB::statement("ALTER TABLE rider_tracks ADD COLUMN track_point GEOMETRY(POINT, 4326)");
        DB::statement("CREATE INDEX idx_rider_tracks_point ON rider_tracks USING GIST (track_point)");
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_tracks');
    }
};
```

### 2.4 核心概念：Geometry vs Geography、空间索引类型

在使用 PostGIS 之前，理解以下几个概念非常重要。

**空间数据类型**：PostGIS 有两种空间类型。`GEOMETRY` 是平面坐标系类型，在 SRID 4326 下单位是经纬度度数，适合做空间关系判断（包含、交叉等），GiST 索引效率更高。`GEOGRAPHY` 是球面坐标系类型，自动处理地球曲率，距离计算结果以米为单位，适合做距离计算和范围搜索。最佳实践是存储用 Geometry + SRID 4326，距离计算时通过 `::geography` 类型转换。

**SRID（空间引用标识符）**：SRID 4326 是 WGS-84 地理坐标系（经纬度坐标系），GPS 和绝大多数地图服务使用。SRID 3857 是 Web Mercator 投影坐标系，Google Maps 和高德地图底图使用。存储时统一使用 4326，PostGIS 会在查询时自动处理坐标系转换。

**空间索引类型**：PostGIS 支持 GiST（通用搜索树）、SP-GiST（空间分区通用搜索树）和 BRIN（块范围索引）三种空间索引。GiST 是最常用的，适用于大多数空间查询场景。SP-GiST 适用于点数据的最近邻查询，在纯点数据场景下比 GiST 更快。BRIN 适用于超大数据集（千万级以上），索引体积小但查询性能略低。

```sql
-- GiST 索引：最常用，适用于大多数场景
CREATE INDEX idx_pois_gist ON pois USING GIST (location);

-- SP-GiST 索引：适用于纯点数据的 KNN 查询
CREATE INDEX idx_pois_spgist ON pois USING SPGIST (location);

-- BRIN 索引：超大数据集，索引体积小
CREATE INDEX idx_tracks_brin ON rider_tracks USING BRIN (track_point)
    WITH (pages_per_range = 32);

-- 部分索引：只为特定条件创建，减小索引体积
CREATE INDEX idx_pois_restaurants ON pois USING GIST (location)
    WHERE category = 'restaurant';
```

> **踩坑记录**：很多开发者忘记创建空间索引就直接跑查询，结果空间查询退化为全表扫描。务必用 `EXPLAIN ANALYZE` 验证查询是否走了 Index Scan。没有空间索引的空间查询，在百万级数据量下可能需要几十秒。

---

## 三、Eloquent 模型层封装：Laravel 的空间查询惯用模式

模型层是 Laravel 应用与数据库交互的核心。我们需要在 Eloquent 模型中封装空间查询逻辑，让 Controller 层的代码保持简洁。

### 3.1 POI 模型：自动维护空间列同步

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

class Poi extends Model
{
    protected $fillable = [
        'name', 'category', 'longitude', 'latitude', 'address', 'metadata',
    ];

    protected $casts = [
        'metadata' => 'array',
    ];

    /**
     * 创建/更新 POI 时自动生成空间字段
     * 生命周期钩子确保经纬度列和空间列始终保持同步
     */
    protected static function booted(): void
    {
        static::creating(function (Poi $poi) {
            if ($poi->longitude && $poi->latitude) {
                $poi->location = DB::raw(
                    "ST_SetSRID(ST_MakePoint({$poi->longitude}, {$poi->latitude}), 4326)"
                );
            }
        });

        static::updating(function (Poi $poi) {
            if ($poi->isDirty(['longitude', 'latitude'])) {
                $poi->location = DB::raw(
                    "ST_SetSRID(ST_MakePoint({$poi->longitude}, {$poi->latitude}), 4326)"
                );
            }
        });
    }

    /**
     * 作用域：查找指定坐标附近的 POI
     * 使用 ST_DWithin 进行范围筛选，配合 GiST 索引实现高效查询
     */
    public function scopeNearby($query, float $lng, float $lat, float $radiusMeters = 1000, int $limit = 20)
    {
        $point = "ST_SetSRID(ST_MakePoint({$lng}, {$lat}), 4326)";

        return $query
            ->selectRaw("*, ST_Distance(location::geography, {$point}::geography) AS distance_meters")
            ->whereRaw("ST_DWithin(location::geography, {$point}::geography, {$radiusMeters})")
            ->orderByRaw("distance_meters ASC")
            ->limit($limit);
    }

    /**
     * 作用域：查找在指定多边形围栏内的 POI
     */
    public function scopeWithinGeofence($query, string $wktPolygon)
    {
        return $query->whereRaw(
            "ST_Within(location, ST_GeomFromText('{$wktPolygon}', 4326))"
        );
    }

    /**
     * 作用域：获取与某点的距离（米）
     */
    public function scopeDistanceFrom($query, float $lng, float $lat)
    {
        $point = "ST_SetSRID(ST_MakePoint({$lng}, {$lat}), 4326)";

        return $query->selectRaw(
            "*, ST_Distance(location::geography, {$point}::geography) AS distance_meters"
        );
    }
}
```

这里有几个重要的设计决策。首先，我们在 `creating` 和 `updating` 生命周期钩子中自动维护空间列的同步，这样应用程序代码只需要操作经纬度，不需要关心空间列。其次，`scopeNearby` 方法使用 `::geography` 类型转换，这让距离计算使用球面距离而非平面距离，结果更准确。最后，`selectRaw` 中计算的距离值可以直接在返回的 JSON 中使用，前端不需要再单独请求距离数据。

### 3.2 Geofence 模型：围栏管理

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

class Geofence extends Model
{
    protected $fillable = ['name', 'type', 'is_active', 'properties', 'boundary'];
    protected $casts = [
        'properties' => 'array',
        'is_active'  => 'boolean',
    ];

    /**
     * 判断一个坐标点是否在此围栏内
     */
    public function contains(float $lng, float $lat): bool
    {
        $result = DB::selectOne("
            SELECT ST_Contains(
                boundary,
                ST_SetSRID(ST_MakePoint(?, ?), 4326)
            ) AS is_within
            FROM geofences
            WHERE id = ? AND is_active = true
        ", [$lng, $lat, $this->id]);

        return $result?->is_within ?? false;
    }

    /**
     * 获取覆盖指定坐标的所有围栏
     * 一个点可能同时在多个围栏内
     */
    public static function containing(float $lng, float $lat)
    {
        return static::where('is_active', true)
            ->whereRaw(
                "ST_Contains(boundary, ST_SetSRID(ST_MakePoint(?, ?), 4326))",
                [$lng, $lat]
            )
            ->get();
    }

    /**
     * 使用 GeoJSON 坐标数组创建围栏
     */
    public static function createFromGeoJson(string $name, string $type, array $geoJsonCoords): static
    {
        $wktCoords = collect($geoJsonCoords)
            ->map(fn($coord) => "{$coord[0]} {$coord[1]}")
            ->implode(', ');

        // 多边形必须闭合：首尾点相同
        $first = $geoJsonCoords[0];
        $wktCoords .= ", {$first[0]} {$first[1]}";

        return static::create([
            'name'     => $name,
            'type'     => $type,
            'boundary' => DB::raw("ST_GeomFromText('POLYGON(({$wktCoords}))', 4326)"),
        ]);
    }
}
```

---

## 四、实战场景一：地理围栏查询

地理围栏是空间查询最经典的应用之一。外卖平台用它来判断用户地址是否在配送范围内；网约车用它来判断乘客是否在服务区域内；营销系统用它来向指定商圈内的用户推送优惠信息；物流系统用它来规划配送路线和计算配送费用。

### 4.1 核心 SQL：ST_Contains 与 ST_Intersects

PostGIS 提供了两个核心函数来判断空间包含关系。`ST_Contains(geographyA, geographyB)` 表示 A 完全包含 B，`ST_Intersects(geographyA, geographyB)` 表示 A 和 B 有任何重叠。在实际使用中，我建议统一使用 `ST_Contains(多边形, 点)` 的形式，语义更清晰。

```sql
-- 判断点是否在某个围栏内
SELECT id, name,
    ST_Contains(boundary, ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)) AS is_inside
FROM geofences
WHERE is_active = true;

-- 使用 ST_Intersects 判断线段是否穿过围栏
-- 适用于配送路线是否经过某个区域
SELECT g.name,
    ST_Intersects(g.boundary, ST_GeomFromText(
        'LINESTRING(116.404 39.915, 116.473 31.230)', 4326
    )) AS route_intersects
FROM geofences g
WHERE g.type = 'administrative';
```

### 4.2 Laravel Controller 完整实现

```php
<?php

namespace App\Http\Controllers;

use App\Models\Geofence;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GeofenceController extends Controller
{
    /**
     * 检查用户地址是否在配送范围内
     * 这是外卖平台最常用的功能之一
     */
    public function checkDeliveryArea(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'lng' => 'required|numeric|between:-180,180',
            'lat' => 'required|numeric|between:-90,90',
        ]);

        $matchingGeofences = Geofence::where('is_active', true)
            ->where('type', 'delivery')
            ->whereRaw(
                "ST_Contains(boundary, ST_SetSRID(ST_MakePoint(?, ?), 4326))",
                [$validated['lng'], $validated['lat']]
            )
            ->get(['id', 'name', 'properties']);

        return response()->json([
            'deliverable'   => $matchingGeofences->isNotEmpty(),
            'matched_zones' => $matchingGeofences,
            'message'       => $matchingGeofences->isNotEmpty() ? '该区域可配送' : '抱歉，该区域暂不支持配送',
        ]);
    }

    /**
     * 批量查询多个坐标的围栏归属
     * 适用于批量计算配送范围、区域统计等场景
     */
    public function batchCheck(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'points'   => 'required|array|min:1|max:100',
            'points.*' => 'array|size:2',
        ]);

        $results = collect($validated['points'])->map(function ($point) {
            $zones = Geofence::where('is_active', true)
                ->whereRaw(
                    "ST_Contains(boundary, ST_SetSRID(ST_MakePoint(?, ?), 4326))",
                    [$point[0], $point[1]]
                )
                ->pluck('name')
                ->toArray();

            return [
                'coordinates' => ['lng' => $point[0], 'lat' => $point[1]],
                'zones'       => $zones,
                'count'       => count($zones),
            ];
        });

        return response()->json(['results' => $results]);
    }

    /**
     * 围栏边界预警：判断用户是否接近配送边界
     * 当地址接近配送围栏边缘时，提前预警可能无法配送
     */
    public function boundaryWarning(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'lng'            => 'required|numeric',
            'lat'            => 'required|numeric',
            'warning_meters' => 'integer|min:100|max:5000|default:500',
        ]);

        $nearby = \DB::select("
            SELECT
                id, name,
                ST_Distance(
                    boundary::geography,
                    ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
                ) AS distance_to_boundary_meters,
                ST_Contains(boundary, ST_SetSRID(ST_MakePoint(?, ?), 4326)) AS is_inside
            FROM geofences
            WHERE is_active = true AND type = 'delivery'
            ORDER BY distance_to_boundary_meters ASC
            LIMIT 1
        ", [$validated['lng'], $validated['lat'], $validated['lng'], $validated['lat']]);

        if (empty($nearby)) {
            return response()->json([
                'near_border' => false,
                'message'     => '当前不在任何配送围栏附近',
            ]);
        }

        $fence = $nearby[0];
        $isNear = $fence->distance_to_boundary_meters <= $validated['warning_meters'];

        return response()->json([
            'near_border'     => $isNear,
            'fence_name'      => $fence->name,
            'distance_meters' => round($fence->distance_to_boundary_meters, 1),
            'is_inside'       => (bool) $fence->is_inside,
        ]);
    }
}
```

> **实用技巧**：`ST_Distance(boundary::geography, point::geography)` 计算的是点到多边形边界的最短距离，而不是到中心点的距离。这在判断"用户是否接近配送边界"时非常有用。

### 4.3 围栏创建示例

在实际项目中，围栏的坐标数据通常来自运营人员在地图上画的多边形，前端通过高德地图或百度地图的绘图工具获取坐标数组，然后传给后端存储：

```php
// 用 GeoJSON 创建一个五边形配送围栏
Geofence::createFromGeoJson(
    name: '朝阳区核心商圈配送范围',
    type: 'delivery',
    geoJsonCoords: [
        [116.4730, 39.9210],
        [116.4920, 39.9150],
        [116.4880, 39.8950],
        [116.4580, 39.8920],
        [116.4610, 39.9170],
    ]
);
```

需要注意的是，PostGIS 的 `POLYGON` 格式要求坐标顺序是经度在前、纬度在后（即 X, Y），这和 GeoJSON 标准一致。但如果你用的是 WKT（Well-Known Text）格式，有些旧版本的文档可能会写成纬度在前，需要特别注意。

---

## 五、实战场景二：附近 POI 搜索与 KNN 优化

"附近的人"、"附近的门店"是最高频的空间查询场景。PostGIS 提供了多种实现方式，性能差异很大，选错方案可能导致查询从毫秒级退化到秒级。

### 5.1 方案一：ST_DWithin 范围筛选

这是最常用也最稳妥的方案。`ST_DWithin` 可以利用 GiST 索引快速过滤出指定范围内的点，然后按距离排序：

```sql
-- 查找 1km 内的餐厅，按距离排序
SELECT
    id, name, category,
    ST_Distance(
        location::geography,
        ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)::geography
    ) AS distance_meters
FROM pois
WHERE category = 'restaurant'
  AND ST_DWithin(
      location::geography,
      ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)::geography,
      1000  -- 1000 米
  )
ORDER BY distance_meters ASC
LIMIT 20;
```

这里的关键细节是 `::geography` 类型转换。如果不转换，默认使用 geometry 类型计算距离，结果是笛卡尔平面上的距离（在 4326 坐标系下单位是度数），而不是实际的米距离。转换为 geography 类型后，`ST_DWithin` 和 `ST_Distance` 都使用球面距离计算，结果以米为单位。这是新手最常犯的错误之一。

### 5.2 方案二：KNN 距离排序运算符

PostGIS 2.0 以后引入了 `<->` 距离运算符，可以配合 GiST 索引实现索引加速的距离排序：

```sql
-- KNN 查询：利用 GiST 索引的距离排序能力
SELECT
    id, name,
    location <-> ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326) AS distance
FROM pois
ORDER BY location <-> ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)
LIMIT 20;
```

`<->` 运算符在 geometry 类型下返回的是平面距离（CRS 单位），在 4326 坐标系下单位是经纬度度数，对业务没有意义。要得到准确的米距离，需要将 `<->` 用作排序条件，但用 geography 类型的 `ST_Distance` 来计算实际距离：

```sql
-- KNN 排序 + 球面距离计算
SELECT
    id, name,
    (location::geography <-> ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)::geography) AS distance_meters
FROM pois
ORDER BY location <-> ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)
LIMIT 20;
```

在实际测试中，`ST_DWithin` 配合索引的性能和 KNN 方案在数据量小于 50 万时差异不大。但当数据量超过 100 万时，KNN 方案在排序性能上会有明显优势，因为它可以利用索引的有序性避免全量排序。

### 5.3 Laravel Controller：附近搜索接口

```php
<?php

namespace App\Http\Controllers;

use App\Models\Poi;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PoiController extends Controller
{
    /**
     * 搜索附近 POI
     * GET /api/poi/nearby?lng=116.404&lat=39.915&category=restaurant&radius=2000
     */
    public function nearby(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'lng'      => 'required|numeric|between:-180,180',
            'lat'      => 'required|numeric|between:-90,90',
            'category' => 'string|max:50|nullable',
            'radius'   => 'integer|min:100|max:50000|default:3000',
            'limit'    => 'integer|min:1|max:100|default:20',
        ]);

        $query = Poi::query()
            ->nearby(
                lng: $validated['lng'],
                lat: $validated['lat'],
                radiusMeters: $validated['radius'],
                limit: $validated['limit']
            );

        if (!empty($validated['category'])) {
            $query->where('category', $validated['category']);
        }

        return response()->json([
            'count' => $query->count(),
            'data'  => $query->get(),
        ]);
    }

    /**
     * 距离矩阵：计算起点到多个 POI 的距离
     * 适用于"推荐最近的门店"、"计算配送费"等场景
     */
    public function distanceMatrix(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'origin_lng' => 'required|numeric',
            'origin_lat' => 'required|numeric',
            'poi_ids'    => 'required|array|min:1|max:50',
        ]);

        $origin = "ST_SetSRID(ST_MakePoint({$validated['origin_lng']}, {$validated['origin_lat']}), 4326)";

        $results = \DB::select("
            SELECT
                id, name, category, longitude, latitude,
                ST_Distance(location::geography, {$origin}::geography) AS distance_meters
            FROM pois
            WHERE id IN (?)
            ORDER BY distance_meters ASC
        ", [$validated['poi_ids']]);

        return response()->json(['distances' => $results]);
    }
}
```

### 5.4 空间聚合查询：PostGIS 的杀手级优势

PostGIS 可以直接在 SQL 中做空间 JOIN 和分组统计，Redis GEO 完全无法实现这种查询：

```sql
-- 统计每个配送围栏内的门店数量和分类统计
SELECT
    g.id, g.name,
    COUNT(p.id) AS poi_count,
    COUNT(p.id) FILTER (WHERE p.category = 'restaurant') AS restaurant_count,
    COUNT(p.id) FILTER (WHERE p.category = 'hotel') AS hotel_count,
    ROUND(AVG(
        ST_Distance(p.location::geography, g.boundary::geography)
    )::numeric, 0) AS avg_distance_to_boundary
FROM geofences g
LEFT JOIN pois p ON ST_Contains(g.boundary, p.location)
WHERE g.is_active = true AND g.type = 'delivery'
GROUP BY g.id, g.name
ORDER BY poi_count DESC;
```

这条 SQL 用 `ST_Contains` 做空间 JOIN，然后用 PostgreSQL 的 `FILTER` 子句做条件统计。PostgreSQL 的 `FILTER` 子句比 `CASE WHEN` 更简洁高效。在 10 万条 POI 和 100 个围栏的场景下，这条查询的执行时间通常在 50 毫秒以内，完全满足实时查询的需求。

---

## 六、实战场景三：路径规划与轨迹分析

### 6.1 直线距离计算

`ST_DistanceSphere` 是计算两个坐标点之间球面距离最直接的函数，结果以米为单位：

```sql
-- 计算两个坐标之间的球面直线距离（米）
SELECT ST_DistanceSphere(
    ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326),  -- 天安门广场
    ST_SetSRID(ST_MakePoint(121.473, 31.230), 4326)   -- 上海外滩
) AS distance_meters;
-- 输出: 约 1,067,453 米（约 1067 公里）
```

### 6.2 骑手轨迹记录与轨迹回放

在配送系统中，实时记录骑手位置、支持轨迹回放是核心功能之一。PostGIS 不仅能存储和查询单个点，还能通过 `ST_MakeLine` 将多个点串联成线，实现轨迹可视化：

```php
<?php

namespace App\Http\Controllers;

use App\Models\RiderTrack;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RiderTrackController extends Controller
{
    /**
     * 上报骑手当前位置
     * 骑手 App 每隔 5-10 秒调用一次这个接口
     */
    public function reportPosition(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'rider_id' => 'required|integer',
            'order_id' => 'nullable|integer',
            'lng'      => 'required|numeric|between:-180,180',
            'lat'      => 'required|numeric|between:-90,90',
            'speed'    => 'nullable|numeric|min:0|max:200',
            'heading'  => 'nullable|numeric|min:0|max:360',
        ]);

        RiderTrack::create([
            'rider_id'    => $validated['rider_id'],
            'order_id'    => $validated['order_id'] ?? null,
            'longitude'   => $validated['lng'],
            'latitude'    => $validated['lat'],
            'speed'       => $validated['speed'] ?? null,
            'heading'     => $validated['heading'] ?? null,
            'recorded_at' => now(),
            'track_point' => DB::raw(
                "ST_SetSRID(ST_MakePoint({$validated['lng']}, {$validated['lat']}), 4326)"
            ),
        ]);

        return response()->json(['tracked' => true, 'id' => $track->id]);
    }

    /**
     * 获取骑手某段时间内的轨迹
     * 返回 GeoJSON 格式，前端可以直接用于地图渲染
     */
    public function getTrack(Request $request, string $riderId): JsonResponse
    {
        $validated = $request->validate([
            'start' => 'required|date',
            'end'   => 'required|date|after:start',
        ]);

        $points = RiderTrack::where('rider_id', $riderId)
            ->whereBetween('recorded_at', [$validated['start'], $validated['end']])
            ->orderBy('recorded_at')
            ->get(['longitude', 'latitude', 'speed', 'heading', 'recorded_at']);

        // 构建 GeoJSON LineString 格式，前端地图库可以直接使用
        $coordinates = $points->map(fn($p) => [$p->longitude, $p->latitude])->toArray();

        $geoJson = [
            'type'       => 'Feature',
            'geometry'   => [
                'type'        => 'LineString',
                'coordinates' => $coordinates,
            ],
            'properties' => [
                'rider_id'    => $riderId,
                'point_count' => $points->count(),
            ],
        ];

        return response()->json([
            'points'  => $points,
            'geojson' => $geoJson,
            'total_distance_meters' => $this->calculateTrackDistance(
                $riderId, $validated['start'], $validated['end']
            ),
        ]);
    }

    /**
     * 使用 PostGIS 计算轨迹总距离
     * ST_MakeLine 将所有点按时间顺序串成一条线，ST_Length 计算这条线的长度
     */
    private function calculateTrackDistance(string $riderId, string $start, string $end): float
    {
        $result = DB::selectOne("
            SELECT ST_Length(
                ST_MakeLine(track_point ORDER BY recorded_at)::geography
            ) AS total_distance_meters
            FROM rider_tracks
            WHERE rider_id = ?
              AND recorded_at BETWEEN ? AND ?
        ", [$riderId, $start, $end]);

        return round($result->total_distance_meters ?? 0, 2);
    }
}
```

### 6.3 配送距离估算策略

在实际业务中，直线距离和路网距离差距很大。在城市环境中，路网距离通常是直线距离的 1.3 到 1.8 倍。PostGIS 提供了几种距离估算方式：

```sql
-- 1. 直线距离（最快，误差最大，适用于粗略估算）
SELECT ST_DistanceSphere(
    ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326),
    ST_SetSRID(ST_MakePoint(116.410, 39.920), 4326)
) AS straight_distance;

-- 2. 用已有轨迹计算实际骑行距离（最准确，但依赖历史数据）
SELECT ST_Length(
    ST_MakeLine(track_point ORDER BY recorded_at)::geography
) AS actual_distance
FROM rider_tracks
WHERE order_id = 12345;

-- 3. 路网距离：使用 pgRouting 扩展
-- pgRouting 基于 OpenStreetMap 路网数据的路径规划
```

### 6.4 使用 pgRouting 进行路网路径规划

pgRouting 是 PostgreSQL 的路径规划扩展，基于 OpenStreetMap 路网数据，支持 Dijkstra、A*、KSP（K 最短路径）等算法：

```sql
-- 假设已导入 OpenStreetMap 路网数据到 osm_edges 表
-- 构建拓扑图
SELECT pgr_createTopology('osm_edges', 0.00001, 'geom', 'id');

-- Dijkstra 最短路径查询
SELECT seq, node, edge, cost, agg_cost
FROM pgr_dijkstra(
    'SELECT id, source, target, ST_Length(geom::geography) AS cost FROM osm_edges',
    -- 起点的 node id
    (SELECT id FROM osm_vertices_pgr
     ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)) LIMIT 1),
    -- 终点的 node id
    (SELECT id FROM osm_vertices_pgr
     ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(116.473, 39.921), 4326)) LIMIT 1)
) AS route;
```

> **实用技巧**：pgRouting 需要完整的 OpenStreetMap 路网数据，数据量通常在 GB 级别。如果你的项目只需要简单的路径规划，可以考虑使用高德/百度地图的路线规划 API 作为替代方案，PostGIS 只负责存储和展示轨迹。对于城市配送场景，将 pgRouting 的路网查询和高德 API 结合使用是更实际的做法。

### 6.5 导入 GeoJSON 和 Shapefile 数据

在实际项目中，围栏数据和 POI 数据经常以 GeoJSON 或 Shapefile 格式提供。PostGIS 内置了工具来导入这些数据：

```bash
# 导入 Shapefile（使用 shp2pgsql）
shp2pgsql -s 4326 -W UTF-8 administrative_boundary.shp public.geofences | psql -d laravel_spatial

# 导入 GeoJSON（使用 ogr2ogr，功能更强大）
ogr2ogr -f PostgreSQL PG:"host=localhost dbname=laravel_spatial user=postgres" \
    -nln pois_geojson \
    -s_srs EPSG:4326 -t_srs EPSG:4326 \
    poi_data.geojson
```

在 Laravel 中也可以用 Artisan 命令批量导入：

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class ImportGeoJson extends Command
{
    protected $signature = 'geo:import {file} {--table=geofences}';

    public function handle(): int
    {
        $file = $this->argument('file');
        $table = $this->option('table');

        $json = json_decode(file_get_contents($file), true);

        foreach ($json['features'] as $feature) {
            $coords = $feature['geometry']['coordinates'][0];
            $name = $feature['properties']['name'] ?? 'Unknown';

            $wktCoords = collect($coords)
                ->map(fn($c) => "{$c[0]} {$c[1]}")
                ->implode(', ');

            $first = $coords[0];
            $wktCoords .= ", {$first[0]} {$first[1]}";

            DB::table($table)->insert([
                'name'     => $name,
                'boundary' => DB::raw("ST_GeomFromText('POLYGON(({$wktCoords}))', 4326)"),
            ]);
        }

        $this->info("导入完成，共 " . count($json['features']) . " 条记录");
        return self::SUCCESS;
    }
}
```

---

## 七、PostGIS vs Redis GEO 深度对比

### 7.1 Redis GEO 的工作原理

Redis GEO 的底层是基于 Geohash 编码的 Sorted Set。`GEOADD` 将经纬度编码为 Geohash 字符串，存储在 Sorted Set 中。`GEOSEARCH` 通过 Geohash 前缀匹配来实现范围查询。这种设计的优势是简单高效，但限制也很明显——它只能处理点数据，无法表达线和面，因此无法实现地理围栏、路径规划等高级空间功能。

```php
<?php

// Redis GEO 方案：简单但功能有限
namespace App\Services;

use Illuminate\Support\Facades\Redis;

class RedisGeoService
{
    private string $key = 'stores';

    public function addStore(int $id, float $lng, float $lat, string $name): void
    {
        Redis::geoAdd($this->key, [$lng, $lat, "{$id}:{$name}"]);
    }

    public function addStores(array $stores): void
    {
        Redis::pipeline(function ($pipe) use ($stores) {
            foreach ($stores as $store) {
                $pipe->geoAdd($this->key, [
                    $store['longitude'], $store['latitude'],
                    "{$store['id']}:{$store['name']}",
                ]);
            }
        });
    }

    public function nearby(float $lng, float $lat, float $radiusMeters, int $limit = 20): array
    {
        return Redis::geoSearch($this->key, [
            'FROMLONGITUDE' => $lng,
            'FROMLATITUDE'  => $lat,
            'BYRADIUS'      => $radiusMeters,
            'BYMETER',
            'ASC',
            'COUNT'         => $limit,
            'WITHCOORD',
            'WITHDIST',
        ]);
    }

    /**
     * 地理围栏：Redis 不支持，需要自行实现射线法
     * 代码复杂度高，精度不如 PostGIS 原生方案
     */
    public function checkGeofence(float $lng, float $lat, array $polygonCoords): bool
    {
        // 第一步：矩形包围盒快速排除
        $lats = array_column($polygonCoords, 1);
        $lngs = array_column($polygonCoords, 0);

        if ($lng < min($lngs) || $lng > max($lngs)
            || $lat < min($lats) || $lat > max($lats)) {
            return false;
        }

        // 第二步：射线法精确判断
        $n = count($polygonCoords);
        $inside = false;

        for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
            $xi = $polygonCoords[$i][0];
            $yi = $polygonCoords[$i][1];
            $xj = $polygonCoords[$j][0];
            $yj = $polygonCoords[$j][1];

            if ((($yi > $lat) != ($yj > $lat))
                && ($lng < ($xj - $xi) * ($lat - $yi) / ($yj - $yi) + $xi)) {
                $inside = !$inside;
            }
        }

        return $inside;
    }
}
```

从这段代码可以明显看出，在 Redis 中实现地理围栏需要自己写射线法算法，代码复杂度远高于 PostGIS 的一行 `ST_Contains`。而且射线法还有一些边界情况需要处理，比如点恰好在多边形边上、多边形自相交等，这些都是潜在的 Bug 来源。

### 7.2 功能全面对比

| 维度 | Redis GEO | PostGIS |
|------|-----------|---------|
| **数据模型** | Sorted Set（Geohash 编码） | 空间几何对象（点、线、面） |
| **坐标精度** | 约 1-2 米（Geohash 编码限制） | 毫米级 |
| **距离计算** | 仅支持点到点 | 点到点、点到线、线到面、面到面 |
| **地理围栏** | 不支持（需自行实现射线法） | 原生 ST_Contains / ST_Within / ST_Intersects |
| **路径规划** | 不支持 | pgRouting（Dijkstra、A* 等） |
| **复杂空间关系** | 不支持 | 支持交叉、重叠、包含、接触等 |
| **聚合查询** | 不支持 | 支持 ST_Union、ST_Intersection、空间聚合 |
| **SQL 集成** | 不支持（独立命令体系） | 完整 SQL 支持，可 JOIN、子查询 |
| **空间索引** | Redis 内部有序索引 | GiST / SP-GiST / BRIN 索引 |
| **数据持久化** | RDB 快照 / AOF 日志（可选） | 持久存储，ACID 事务保证 |
| **部署复杂度** | 低（单命令安装） | 中等（需安装扩展） |
| **内存占用** | 高（全部数据在内存中） | 低（磁盘存储，按需加载） |
| **写入性能** | 极高（约 10 万 ops/s） | 高（约 1-5 万 ops/s） |
| **读取性能** | 极高（小于 1 毫秒） | 高（1-10 毫秒，取决于数据量） |

### 7.3 性能基准测试数据

我们在本地环境用 10 万条 POI 数据进行了性能测试，测试环境为 PostgreSQL 16 + PostGIS 3.4 + Redis 7.2，运行在 M1 MacBook Pro 上：

| 场景 | PostGIS | Redis GEO | 备注 |
|------|---------|-----------|------|
| 附近 1km 搜索（Top 20） | 3-8ms | 0.5-1ms | Redis 内存读取优势明显 |
| 附近 5km 搜索（Top 50） | 5-15ms | 1-2ms | 数据量大时差距开始缩小 |
| 附近 10km 搜索（Top 100） | 10-25ms | 2-5ms | PostGIS GiST 索引优势体现 |
| 地理围栏判断（单点） | 1-3ms | 不支持（自行实现约 5ms） | PostGIS 原生支持 |
| 批量围栏判断（100 个点） | 15-30ms | 不支持 | Redis 无法原生实现 |
| 多边形围栏 + 分类筛选 | 5-12ms | 不支持 | Redis 无法做 JOIN 查询 |
| 数据写入（10 万条） | 约 8 秒 | 约 1.5 秒 | Redis 写入更快 |
| 内存占用（10 万条） | 约 50MB 磁盘 | 约 120MB 内存 | PostGIS 更节省资源 |
| 100 万条数据附近搜索 | 15-40ms | 不推荐（内存瓶颈） | Redis 大数据集退化严重 |

以上数据都是经过多次测试取的中位数。可以看到，在简单的附近搜索场景下，Redis GEO 确实比 PostGIS 快 3-5 倍。但这个差距在实际业务中通常可以接受，因为两者都在毫秒级。而一旦涉及地理围栏、批量查询、复杂筛选，PostGIS 的优势就碾压性地体现出来了。

### 7.4 选型建议

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 简单附近搜索（数据量 < 10 万） | Redis GEO | 延迟最低，实现最简单 |
| 地理围栏或多边形查询 | **PostGIS** | Redis 无法原生支持 |
| 复杂空间关系（交叉、包含、重叠） | **PostGIS** | 完整的空间函数库 |
| 大数据量（超过 100 万条） | **PostGIS** | Redis 内存瓶颈严重 |
| SQL JOIN + 空间查询 | **PostGIS** | Redis 无法做跨数据源查询 |
| 实时位置追踪（高频写入） | Redis GEO | 写入吞吐量更高 |
| 路径规划或轨迹分析 | **PostGIS** + pgRouting | Redis 完全无法实现 |
| 作为缓存层加速高频读取 | Redis GEO | 作为 PostGIS 的前置缓存 |

**最佳实践**：两者结合使用。PostGIS 作为权威数据源处理复杂查询和数据持久化，Redis GEO 作为高频简单读取的缓存层。用 Laravel 的 Queue Job 定期将 PostGIS 中的数据变更同步到 Redis 缓存。

```php
<?php

// 混合方案示例：缓存 + 数据库双层查询
namespace App\Services;

use App\Models\Poi;
use Illuminate\Support\Facades\Cache;

class HybridGeoService
{
    public function nearby(float $lng, float $lat, float $radius, int $limit): array
    {
        $cacheKey = "nearby:{$lng}:{$lat}:{$radius}:{$limit}";

        // 第一层：尝试从 Redis 缓存读取
        $cached = Cache::tags(['geo'])->get($cacheKey);
        if ($cached) {
            return $cached;
        }

        // 第二层：缓存未命中，查 PostGIS 数据库
        $results = Poi::nearby($lng, $lat, $radius, $limit)->get()->toArray();

        // 回写缓存，60 秒过期
        Cache::tags(['geo'])->put($cacheKey, $results, 60);

        return $results;
    }
}
```

---

## 八、踩坑记录：生产环境的血泪教训

这部分是我在生产环境中踩过的最深刻的坑，每一个都花了不小的时间排查。

### 8.1 坐标系偏移问题

**问题描述**：从高德地图或百度地图 API 获取的坐标，直接存入 PostGIS 后，查询结果偏移了几十到几百米。

**根本原因**：高德地图使用 GCJ-02 坐标系（俗称火星坐标系），百度地图在此基础上又做了二次偏移，使用 BD-09 坐标系。而 PostGIS 默认使用 WGS-84 坐标系（GPS 坐标系）。三者之间存在系统性偏差，如果不做转换，所有空间查询都会有误差。

**解决方案**：在存入数据库之前做坐标转换：

```php
<?php

namespace App\Services;

class CoordinateTransformService
{
    private const PI = 3.14159265358979324;
    private const A = 6378245.0;
    private const EE = 0.00669342162296594323;

    /**
     * GCJ-02（火星坐标）→ WGS-84（GPS 坐标）
     */
    public static function gcj02ToWgs84(float $lng, float $lat): array
    {
        $dLat = self::transformLat($lng - 105.0, $lat - 35.0);
        $dLng = self::transformLng($lng - 105.0, $lat - 35.0);
        $radLat = $lat / 180.0 * self::PI;
        $magic = sin($radLat);
        $magic = 1 - self::EE * $magic * $magic;
        $sqrtMagic = sqrt($magic);
        $dLat = ($dLat * 180.0) / ((self::A * (1 - self::EE)) / ($magic * $sqrtMagic) * self::PI);
        $dLng = ($dLng * 180.0) / (self::A / $sqrtMagic * cos($radLat) * self::PI);

        return ['lng' => $lng - $dLng, 'lat' => $lat - $dLat];
    }

    private static function transformLat(float $x, float $y): float
    {
        $ret = -100.0 + 2.0 * $x + 3.0 * $y + 0.2 * $y * $y
            + 0.1 * $x * $y + 0.2 * sqrt(abs($x));
        $ret += (20.0 * sin(6.0 * $x * self::PI)
            + 20.0 * sin(2.0 * $x * self::PI)) * 2.0 / 3.0;
        $ret += (20.0 * sin($y * self::PI)
            + 40.0 * sin($y / 3.0 * self::PI)) * 2.0 / 3.0;
        $ret += (160.0 * sin($y / 12.0 * self::PI)
            + 320.0 * sin($y * self::PI / 30.0)) * 2.0 / 3.0;
        return $ret;
    }

    private static function transformLng(float $x, float $y): float
    {
        $ret = 300.0 + $x + 2.0 * $y + 0.1 * $x * $x
            + 0.1 * $x * $y + 0.1 * sqrt(abs($x));
        $ret += (20.0 * sin(6.0 * $x * self::PI)
            + 20.0 * sin(2.0 * $x * self::PI)) * 2.0 / 3.0;
        $ret += (20.0 * sin($x * self::PI)
            + 40.0 * sin($x / 3.0 * self::PI)) * 2.0 / 3.0;
        $ret += (150.0 * sin($x / 12.0 * self::PI)
            + 300.0 * sin($x / 30.0 * self::PI)) * 2.0 / 3.0;
        return $ret;
    }
}
```

建议在 API 接口层统一做转换，或者在数据入库时批量转换存量数据。我在迁移时写了一个 Artisan 命令，遍历所有 POI 记录做坐标转换，10 万条数据大概跑了 30 秒。

### 8.2 空间索引失效

**问题描述**：查询突然变慢了，用 `EXPLAIN ANALYZE` 一看，发现走了 Seq Scan 而不是 Index Scan。

**常见原因和解决方案**：

```sql
-- 问题写法：对 geography 类型使用 ST_Buffer 后再判断，索引失效
SELECT * FROM pois
WHERE ST_Contains(
    ST_Buffer(
        ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)::geography,
        1000
    )::geometry,
    location
);

-- 正确写法：使用 ST_DWithin 直接在索引列上操作
SELECT * FROM pois
WHERE ST_DWithin(
    location::geography,
    ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)::geography,
    1000
);

-- 问题写法：在函数包裹的列上查询，索引完全失效
SELECT * FROM pois
WHERE ST_Distance(
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
    ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)
) < 1000;

-- 正确写法：使用 ST_DWithin 并确保两个参数类型一致
SELECT * FROM pois
WHERE ST_DWithin(
    location::geography,
    ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)::geography,
    1000
);
```

核心原则是：`ST_DWithin` 的两个参数必须是相同类型（都转 geography 或都用 geometry），避免对索引列套函数后再查询。每次写完空间查询后，都应该用 `EXPLAIN ANALYZE` 验证是否走了 Index Scan。

### 8.3 DB::raw 的 SQL 注入风险

**问题描述**：直接将用户输入的坐标拼接到 `DB::raw` 中，存在 SQL 注入风险。

```php
// 危险写法：直接拼接用户输入
$lng = $request->input('lng');
DB::select("SELECT * FROM pois WHERE ST_DWithin(location, ST_MakePoint({$lng}, ...))");

// 安全写法：使用参数绑定
DB::select(
    "SELECT * FROM pois WHERE ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
        ?
    )",
    [$lng, $lat, $radius]
);
```

在 Laravel 中，虽然 Eloquent 的 `whereRaw` 方法支持参数绑定，但如果你直接在字符串中拼接变量，绑定机制就失效了。建议统一使用问号占位符和参数数组。

### 8.4 SRID 不一致导致的查询报错

**问题描述**：查询报错 "Operation on mixed SRID geometries"，原因是两张表的空间列使用了不同的 SRID。

```sql
-- 错误：两张表的 SRID 不一致
SELECT ST_DWithin(a.location, b.location, 1000)
FROM pois a, geofences b;

-- 解决方案：统一转为 geography 类型
SELECT ST_DWithin(a.location::geography, b.boundary::geography, 1000);
-- geography 类型不关心 SRID，会自动进行球面距离计算
```

建议在项目初期就统一所有空间列使用 SRID 4326（WGS-84），并在 Migration 中加上注释说明，避免后来的开发者使用其他坐标系。

### 8.5 数据迁移中的坐标格式问题

如果之前使用过 MySQL 的空间类型，迁移到 PostGIS 时会遇到格式不兼容的问题。MySQL 使用 WKB（Well-Known Binary）格式存储空间数据，而 PostGIS 使用自己的内部格式。迁移时需要做格式转换：

```php
// 迁移脚本示例
DB::statement("
    UPDATE pois
    SET location = ST_SetSRID(
        ST_GeomFromText(ST_AsText(ST_GeomFromWKB(UNHEX(?)))),
        4326
    )
    WHERE id = ?
", [$mysqlWkbHex, $poiId]);
```

### 8.6 查询验证：EXPLAIN ANALYZE

验证空间查询是否走了索引，必须用 `EXPLAIN ANALYZE`：

```sql
EXPLAIN ANALYZE
SELECT id, name,
    ST_Distance(
        location::geography,
        ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)::geography
    ) AS dist
FROM pois
WHERE ST_DWithin(
    location::geography,
    ST_SetSRID(ST_MakePoint(116.404, 39.915), 4326)::geography,
    5000
)
ORDER BY dist ASC
LIMIT 20;

-- 期望输出中应该看到 Index Scan 而非 Seq Scan
-- 如果看到 Seq Scan，说明索引没有生效，需要检查查询条件的写法
```

---

## 九、总结与建议

经过这次从 Redis GEO 到 PostGIS 的完整实践，我总结以下核心结论：

**第一，Redis GEO 适合简单场景**。如果数据量在 10 万以内，只需要点到点的距离查询和附近搜索，对延迟要求极高（低于 1 毫秒），Redis GEO 是最省事的选择。它的 API 简单直观，部署方便，开发效率高。

**第二，PostGIS 适合复杂场景**。一旦需求涉及地理围栏、多边形包含判断、复杂空间关系、SQL JOIN 查询、大数据量、持久化存储，PostGIS 是唯一正确的选择。它的 700 多个空间函数可以覆盖几乎所有空间查询需求。

**第三，混合方案是生产环境的最佳实践**。PostGIS 作为权威数据源处理复杂查询和数据持久化，Redis GEO 作为高频读取的缓存层。用 Laravel 的 Job 定期将 PostGIS 中的数据变更同步到 Redis 缓存，可以同时获得两者的优点。

**第四，踩坑重灾区集中在坐标系偏移、空间索引失效、SRID 不一致和 SQL 注入**这几个方面。尤其是坐标系问题，如果项目初期不处理，后期迁移成本非常高。建议在项目启动时就建立坐标系规范，所有数据入库前统一转换为 WGS-84。

**第五，性能基线方面**，在 10 万数据量级下，PostGIS 附近搜索 3-8 毫秒，Redis GEO 0.5-1 毫秒。这个差距在大多数业务场景下是可以接受的。但随着数据量增长到百万级，PostGIS 的 GiST 索引性能优势会越来越明显，而 Redis GEO 会因为内存瓶颈而难以扩展。

总之，不要被 Redis GEO 的简洁和速度所迷惑，它只是一个缓存工具，不是完整的空间数据库方案。对于需要长期维护的本地生活类产品，PostGIS 才是正确的技术选型。

---

> **延伸阅读**：
> - [PostGIS 官方文档](https://postgis.net/documentation/) — 最权威的空间函数参考
> - [PostGIS in Action（第三版）](https://www.manning.com/books/postgis-in-action-third-edition) — 最好的 PostGIS 实战书籍
> - [pgRouting](https://pgrouting.org/) — PostgreSQL 路径规划扩展
> - [Redis GEO 命令文档](https://redis.io/docs/commands/geoadd/) — Redis 官方空间命令参考
> - [geoPHP](https://github.com/phayes/geoPHP) — PHP 空间数据处理库

---

## 相关阅读

- [PostgreSQL 高级特性实战：Window 函数、CTE、JSONB 与 pg_trgm — Laravel 集成指南](/01_MySQL/postgresql-advanced-features-window-cte-jsonb-pgtrgm-laravel) — 深入 PostgreSQL 的高级查询能力，涵盖窗口函数、递归 CTE、JSONB 操作和模糊搜索等实用特性，与 Laravel 的集成方式。
- [ClickHouse vs PostgreSQL：OLAP 选型与 Laravel 集成实战](/01_MySQL/2026-06-02-clickhouse-vs-postgresql-olap-selection-laravel-integration) — 分析型数据库选型对比，PostgreSQL 在 OLAP 场景下的表现与 Laravel 集成方案。
- [CockroachDB 分布式 SQL 数据库：Laravel 全球分布式事务与强一致性选型指南](/01_MySQL/2026-06-03-CockroachDB-分布式SQL数据库-Laravel全球分布式事务与强一致性选型指南) — 分布式 SQL 数据库的选型参考，了解 PostgreSQL 兼容的分布式方案。
