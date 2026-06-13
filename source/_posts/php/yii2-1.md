---

title: Yii2 框架入门：Gii 代码生成与 ActiveRecord 实战
keywords: [Yii2, Gii, ActiveRecord, 框架入门, 代码生成与]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- Yii2
- 架构
- RBAC
- Active Record
categories:
- php
date: 2019-03-20 15:05:07
description: Yii2 是一款高性能 PHP 框架，以 Active Record ORM、Gii 代码生成器和内置 RBAC 权限管理系统为核心特色。本文全面介绍 Yii2 的安装配置、目录结构、Active Record 数据库操作、Gii 快速生成 Model 与 CRUD、RBAC 角色权限设计、Behavior 行为扩展、RESTful API 开发、数据库迁移、缓存系统、国际化方案，以及与 Laravel、ThinkPHP 的对比分析和常见踩坑解决方案，适合 PHP 开发者快速上手企业级 Web 应用开发。
---



## 一、Yii2 简介

Yii 取自「**Y**es **I**t **I**s」—— 强调"快"。Yii2 在国内外都有稳定用户群，特点：

- **Active Record + Query Builder** 双模式 ORM，比 Laravel Eloquent 更灵活
- **Gii 代码生成器**：图形化生成 Model / CRUD / 模块，5 分钟出一套后台
- **内置 RBAC**：角色权限管理开箱即用
- **Asset Bundle**：前端资源打包/版本管理（早于 webpack 时代的解决方案）
- **两套骨架**：Basic（小项目）和 Advanced（前后台分离）

性能在传统 PHP 框架里属于第一梯队，仅次于 Yaf/Phalcon 这类 C 扩展。

---

## 二、安装

```bash
# Basic 模板
composer create-project --prefer-dist yiisoft/yii2-app-basic basic

# Advanced 模板（前后台分离）
composer create-project --prefer-dist yiisoft/yii2-app-advanced advanced
cd advanced && php init   # 初始化环境
```

启动：

```bash
php yii serve              # 内置开发服务器
```

---

## 三、目录结构（Basic）

```
basic/
├── assets/         # Asset Bundle 编译产物
├── commands/       # 命令行控制器
├── config/         # 配置（db.php / web.php / params.php）
├── controllers/
├── models/
├── views/
├── web/            # web 根目录（指向这里）
├── runtime/        # 缓存/日志（要可写）
└── yii             # 命令行入口
```

---

## 四、Active Record 示例

```php
<?php
namespace app\models;

use yii\db\ActiveRecord;

class Order extends ActiveRecord
{
    public static function tableName() { return 'orders'; }

    public function getUser()
    {
        return $this->hasOne(User::class, ['id' => 'user_id']);
    }

    public function rules()
    {
        return [
            [['user_id', 'amount'], 'required'],
            ['amount', 'number', 'min' => 0],
        ];
    }
}

// 使用
$orders = Order::find()
    ->with('user')
    ->where(['status' => 1])
    ->orderBy(['id' => SORT_DESC])
    ->limit(20)
    ->all();
```

---

## 五、Gii 代码生成

开 `config/web.php`：

```php
if (YII_ENV_DEV) {
    $config['modules']['gii'] = [
        'class' => 'yii\gii\Module',
        'allowedIPs' => ['127.0.0.1', '::1'],
    ];
}
```

访问 `http://localhost/index.php?r=gii`，可视化生成：

- **Model Generator**：根据表结构生成 AR 模型
- **CRUD Generator**：生成完整的增删改查页面
- **Module Generator**：生成模块骨架

后台快速搭建神器。
**自定义 Gii 模板**：可以在项目中覆盖默认模板，生成符合团队规范的代码：
```
├── gii/
│   └── generators/
│       ├── model/
│       │   └── default/          # 覆盖 Model 模板
│       │       ├── form.php
│       │       └── model.php
│       └── crud/
│           └── default/          # 覆盖 CRUD 模板
│               ├── controller.php
│               ├── index.php
│               └── _form.php
```
在 `config/web.php` 中指定自定义模板路径：
```php
$config['modules']['gii'] = [
    'class' => 'yii\gii\Module',
    'generators' => [
        'crud' => [
            'class' => 'yii\gii\generators\crud\Generator',
            'templates' => [
                'my_template' => '@app/gii/generators/crud/default',
            ],
        ],
        'model' => [
            'class' => 'yii\gii\generators\model\Generator',
            'templates' => [
                'my_template' => '@app/gii/generators/model/default',
            ],
        ],
    ],
];
```
常用自定义点：给所有 Model 添加 `behaviors()` 默认时间戳；给 CRUD Controller 添加统一的 `AccessControl`；给 View 模板添加统一的面包屑导航等。

---

## 六、RBAC 权限

```php
$auth = Yii::$app->authManager;

// 创建权限
$createPost = $auth->createPermission('createPost');
$auth->add($createPost);

// 创建角色
$author = $auth->createRole('author');
$auth->add($author);
$auth->addChild($author, $createPost);

// 给用户分配角色
$auth->assign($author, $userId);

// 检查
if (Yii::$app->user->can('createPost')) { ... }
```

RBAC 支持**规则(Rule)**实现动态权限判断，例如"只能编辑自己的文章"：
```php
$rule = new \app\rbac\AuthorRule();
$auth->add($rule);

$updateOwnPost = $auth->createPermission('updateOwnPost');
$updateOwnPost->ruleName = $rule->name;
$auth->add($updateOwnPost);
$auth->addChild($author, $updateOwnPost);
```
```php
// AuthorRule.php
class AuthorRule extends yii\rbac\Rule
{
    public $name = 'isAuthor';
    public function execute($user, $item, $params)
    {
        return isset($params['post']) ? $params['post']->created_by == $user : false;
    }
}
```
---

## 七、行为（Behaviors）

Behavior 是 Yii2 实现 **AOP（面向切面编程）** 的核心机制，可以在不修改类代码的情况下动态注入功能。

### 7.1 定义 Behavior

```php
<?php
namespace app\behaviors;

use yii\base\Behavior;
use yii\db\ActiveRecord;

class SluggableBehavior extends Behavior
{
    public $sourceAttribute = 'title';
    public $targetAttribute = 'slug';

    public function events()
    {
        return [
            ActiveRecord::EVENT_BEFORE_INSERT => 'generateSlug',
            ActiveRecord::EVENT_BEFORE_UPDATE => 'generateSlug',
        ];
    }

    public function generateSlug($event)
    {
        $this->owner->{$this->targetAttribute} =
            \yii\helpers\Inflector::slug($this->owner->{$this->sourceAttribute});
    }
}
```

### 7.2 使用 Behavior

```php
class Article extends ActiveRecord
{
    public function behaviors()
    {
        return [
            // 内置时间戳行为
            'timestamp' => [
                'class' => \yii\behaviors\TimestampBehavior::class,
                'attributes' => [
                    ActiveRecord::EVENT_BEFORE_INSERT => ['created_at', 'updated_at'],
                    ActiveRecord::EVENT_BEFORE_UPDATE => ['updated_at'],
                ],
            ],
            // 自定义 Slug 行为
            'slug' => [
                'class' => \app\behaviors\SluggableBehavior::class,
                'sourceAttribute' => 'title',
            ],
        ];
    }
}
```

### 7.3 BlameableBehavior

自动记录操作人，审计日志利器：

```php
'blameable' => [
    'class' => \yii\behaviors\BlameableBehavior::class,
    'createdByAttribute' => 'created_by',
    'updatedByAttribute' => 'updated_by',
],
```

---

## 八、RESTful API

Yii2 内置完善的 RESTful 支持，开箱即用。

### 8.1 ActiveController

```php
<?php
namespace app\controllers\api;

use yii\rest\ActiveController;

class PostController extends ActiveController
{
    public $modelClass = 'app\models\Post';

    public function behaviors()
    {
        $behaviors = parent::behaviors();
        $behaviors['authenticator'] = [
            'class' => \yii\filters\auth\HttpBearerAuth::class,
        ];
        $behaviors['rateLimiter'] = [
            'class' => \yii\filters\RateLimiter::class,
        ];
        return $behaviors;
    }

    public function actionSearch($keyword)
    {
        return Post::find()
            ->where(['like', 'title', $keyword])
            ->all();
    }
}
```

### 8.2 自定义序列化

```php
public function fields()
{
    return [
        'id',
        'title',
        'author' => function ($model) {
            return $model->author ? $model->author->nickname : null;
        },
        'created_at' => function ($model) {
            return date('Y-m-d H:i', $model->created_at);
        },
    ];
}
```

### 8.3 分页

```php
// GET /posts?page=2&per-page=20
public function actionIndex()
{
    $dataProvider = new \yii\data\ActiveDataProvider([
        'query' => Post::find(),
        'pagination' => [
            'pageSize' => 20,
            'pageSizeParam' => false,
        ],
    ]);
    return $dataProvider;
}
```

### 8.4 认证方案

| 方式 | 适用场景 |
|------|----------|
| `HttpBasicAuth` | 内部 API、调试 |
| `HttpBearerAuth` | JWT / Token 认证 |
| `QueryParamAuth` | URL 参数传 token |
| `CompositeAuth` | 多种方式组合 |

---

## 九、数据库迁移（Migration）

```bash
# 创建迁移
php yii migrate/create create_order_table

# 执行迁移
php yii migrate

# 回滚最近一次
php yii migrate/down
```

迁移文件示例：

```php
<?php
use yii\db\Migration;

class m240101_120000_create_order_table extends Migration
{
    public function safeUp()
    {
        $this->createTable('{{%order}}', [
            'id' => $this->primaryKey(),
            'user_id' => $this->integer()->notNull(),
            'amount' => $this->decimal(10, 2)->notNull()->defaultValue(0),
            'status' => $this->smallInteger()->notNull()->defaultValue(0),
            'remark' => $this->text(),
            'created_at' => $this->integer()->notNull(),
            'updated_at' => $this->integer()->notNull(),
        ]);

        $this->createIndex('idx-order-user_id', '{{%order}}', 'user_id');
        $this->addForeignKey(
            'fk-order-user_id', '{{%order}}', 'user_id',
            '{{%user}}', 'id', 'CASCADE'
        );
    }

    public function safeDown()
    {
        $this->dropForeignKey('fk-order-user_id', '{{%order}}');
        $this->dropTable('{{%order}}');
    }
}
```

> **Tips**：始终使用 `safeUp()` / `safeDown()` 而非 `up()` / `down()`，确保迁移在事务中执行失败可回滚。

---

## 十、缓存系统

### 10.1 数据缓存

```php
// 配置缓存组件（config/web.php）
'components' => [
    'cache' => [
        'class' => 'yii\caching\FileCache',  // 文件缓存
        // 'class' => 'yii\redis\Cache',      // Redis 缓存
    ],
],
```

```php
$cache = Yii::$app->cache;

$key = 'article_list_' . $categoryId;
$data = $cache->get($key);
if ($data === false) {
    $data = Article::find()
        ->where(['category_id' => $categoryId])
        ->all();
    $cache->set($key, $data, 3600); // 缓存 1 小时
}

// 带依赖的缓存
$cache->set($key, $data, 3600, new \yii\caching\DbDependency([
    'sql' => 'SELECT MAX(updated_at) FROM article',
]));
```

### 10.2 片段缓存

```php
<?php if ($this->beginCache('sidebar', ['duration' => 3600])): ?>
    <div class="sidebar">
        <?= $this->render('_sidebar') ?>
    </div>
<?php $this->endCache(); endif; ?>
```

### 10.3 页面缓存

```php
public function behaviors()
{
    return [
        'pageCache' => [
            'class' => \yii\filters\PageCache::class,
            'only' => ['index'],
            'duration' => 600,
            'variations' => [Yii::$app->language],
        ],
    ];
}
```

### 10.4 HTTP 缓存

```php
public function behaviors()
{
    return [
        'httpCache' => [
            'class' => \yii\filters\HttpCache::class,
            'only' => ['view'],
            'lastModified' => function ($action, $params) {
                $q = new \yii\db\Query();
                return $q->from('article')->max('updated_at');
            },
            'etagSeed' => function ($action, $params) {
                return Yii::$app->request->getUrl();
            },
        ],
    ];
}
```

---

## 十一、国际化（i18n）

### 11.1 配置

```php
'components' => [
    'i18n' => [
        'translations' => [
            'app*' => [
                'class' => 'yii\i18n\PhpMessageSource',
                'basePath' => '@app/messages',
                'fileMap' => [
                    'app' => 'app.php',
                    'app/error' => 'error.php',
                ],
            ],
        ],
    ],
],
```

### 11.2 翻译文件

```php
// messages/zh-CN/app.php
return [
    'Welcome' => '欢迎',
    'Hello, {name}!' => '你好，{name}！',
];
```

### 11.3 使用

```php
// 简单翻译
echo Yii::t('app', 'Welcome');

// 带参数
echo Yii::t('app', 'Hello, {name}!', ['name' => 'Yii2']);

// 日期时间格式化
echo Yii::$app->formatter->asDatetime(time());
```

### 11.4 语言切换

```php
// URL 方式切换语言
'urlManager' => [
    'enablePrettyUrl' => true,
    'rules' => [
        '<language:(en|zh-CN)>/<controller>/<action>' => '<controller>/<action>',
    ],
],
```

---

## 十二、踩坑笔记

| 坑 | 现象 | 解法 |
|----|------|------|
| **`runtime` 不可写** | 500 错误 | 配权限：`chmod -R 775 runtime web/assets` |
| **Asset 资源 404** | CSS/JS 加载失败 | 检查 `web/assets` 可写、`@webroot` 别名正确 |
| **CSRF 报错** | POST 提示 "Unable to verify your data" | 表单加 `<?= Html::csrfMetaTags() ?>` 或关 `enableCsrfValidation` |
| **数据库时间字段** | 存进去 0000-00-00 | 配置 `attributeBehaviors` 自动写时间戳 |
| **Advanced 模板路由乱** | URL 变 `/frontend/web/` | nginx 用 rewrite 隐藏 `frontend/web` |
| **PHP 8.1+ 兼容** | deprecation warnings 满屏 | 升 Yii2.0.45+，老版本不兼容 |
| **内存溢出** | 大批量 AR 查询导致 `Allowed memory size exhausted` | 使用 `->asArray()->all()` 减少对象开销，或 `->each(100)` 分批处理 |
| **AR 查询优化** | `find()->all()` 加载全量数据 OOM | 只 `select()` 需要的字段；大列表用 `ActiveDataProvider` 分页 |
| **N+1 查询问题** | 循环内访问关联对象，SQL 条数暴增 | 使用 `with('relation')` 预加载；`joinWith()` 用于需要 WHERE 过滤关联的场景 |
| **迁移失败锁表** | 迁移中途报错，表结构半成品 | 始终用 `safeUp()/safeDown()` 确保在事务中执行 |
| **Redis 缓存穿透** | 大量不存在的 key 打到 DB | 使用 `Cache::getOrSet()` 保证缓存击穿时只穿透一个请求 |

---

## 十三、Yii2 vs Laravel vs ThinkPHP

| 维度 | Yii2 | Laravel | ThinkPHP |
|------|------|---------|----------|
| **ORM** | Active Record + Query Builder | Eloquent ORM | ThinkORM |
| **模板引擎** | 原生 PHP + Widget | Blade | 原生 PHP + 模板标签 |
| **代码生成** | Gii 内置可视化生成 | 第三方 (InfyOm 等) | 内置代码生成 |
| **权限管理** | RBAC 内置完善 | 第三方 (Spatie Permission) | 内置 RBAC（较简单） |
| **社区生态** | 中等，中英文社区均有 | 最活跃，包最多 | 国内为主，中文生态 |
| **性能** | 优秀（接近原生） | 中等（大量抽象层） | 良好 |
| **学习曲线** | 中等偏高 | 中等（文档优秀） | 低（中文文档友好） |
| **适用场景** | 企业后台、API 服务 | 全栈 Web 应用 | 国内中小型项目 |

> 选型建议：追求**性能和快速出后台**选 Yii2；追求**开发体验和社区生态**选 Laravel；**国内团队快速交付**选 ThinkPHP。

---

## 十四、Yii2 vs Yii3

Yii3 已开发多年仍未正式发布，**Yii2 仍是当前推荐版本**。如果你看到 Yii3 的资料，目前还不建议生产使用。

---

## 参考

- 官网：<https://www.yiiframework.com>
- 中文文档：<https://www.yiichina.com>
- GitHub：<https://github.com/yiisoft/yii2>

---

## 相关阅读

- [ThinkPHP：国内最流行的PHP框架](/categories/PHP/thinkphp-1/)
- [Hyperf：PHP版Spring Boot](/categories/PHP/Runtime/hyperf-1/)
- [PHP面向对象编程](/categories/PHP/oop/)
- [PHP设计模式实践](/categories/PHP/design-patterns/)
