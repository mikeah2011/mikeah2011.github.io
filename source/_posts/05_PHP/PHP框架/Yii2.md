---
title: Yii2
tags: [PHP, 架构]categories:
  - PHP
  - PHP框架
date: 2019-03-20 15:05:07
description: 'Yii2 是高性能 PHP 框架，主打 Active Record、Gii 代码生成、RBAC 权限、Asset Bundle 前端管理，适合企业级 Web 应用和后台快速搭建。'
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

---

## 七、踩坑笔记

| 坑 | 现象 | 解法 |
|----|------|------|
| **`runtime` 不可写** | 500 错误 | 配权限：`chmod -R 775 runtime web/assets` |
| **Asset 资源 404** | CSS/JS 加载失败 | 检查 `web/assets` 可写、`@webroot` 别名正确 |
| **CSRF 报错** | POST 提示 "Unable to verify your data" | 表单加 `<?= Html::csrfMetaTags() ?>` 或关 `enableCsrfValidation` |
| **数据库时间字段** | 存进去 0000-00-00 | 配置 `attributeBehaviors` 自动写时间戳 |
| **Advanced 模板路由乱** | URL 变 `/frontend/web/` | nginx 用 rewrite 隐藏 `frontend/web` |
| **PHP 8.1+ 兼容** | deprecation warnings 满屏 | 升 Yii2.0.45+，老版本不兼容 |

---

## 八、Yii2 vs Yii3

Yii3 已开发多年仍未正式发布，**Yii2 仍是当前推荐版本**。如果你看到 Yii3 的资料，目前还不建议生产使用。

---

## 参考

- 官网：<https://www.yiiframework.com>
- 中文文档：<https://www.yiichina.com>
- GitHub：<https://github.com/yiisoft/yii2>
