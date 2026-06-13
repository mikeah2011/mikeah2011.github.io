---

title: PHP 内置系统函数精选：字符串、数组、文件处理常用 API
keywords: [PHP, API, 内置系统函数精选, 字符串, 数组, 文件处理常用]
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- 内置函数
- 性能优化
- 字符串处理
- 数组操作
categories:
- php
date: 2019-03-20 15:05:07
description: PHP 内置函数是日常开发中最常用的工具，涵盖字符串处理、数组操作、数学计算、日期时间、文件操作和 JSON 解析等核心领域。本文全面梳理 PHP 内置函数的分类与用法，提供可运行的代码示例，深入分析 isset 与 empty、strpos 与 str_contains 等常见易混淆点，对比 PHP 8.x 新增函数的性能优势，并给出生产环境下的最佳实践建议，帮助开发者写出更高效、更安全的 PHP 代码。
---




# PHP 内置系统函数完全指南

PHP 提供了数千个内置函数，覆盖字符串处理、数组操作、数学计算、日期时间、文件 I/O、JSON 解析等方方面面。熟练掌握这些函数，不仅能大幅提升开发效率，还能避免重复造轮子带来的性能和安全隐患。本文将系统梳理常用内置函数，提供可运行的代码示例，并深入分析常见踩坑点和 PHP 8.x 的新特性。

---

## 一、基础检测函数

PHP 提供了一组用于检测函数、类、方法和属性是否存在的函数，在编写灵活的框架代码或插件系统时非常有用。

| 函数              | 意义                       | 备注 |
| ----------------- | -------------------------- | ---- |
| `function_exists` | 系统或自定义函数是否存在   | 参数为字符串 |
| `class_exists`    | 类是否存在                 | 第二个参数控制是否自动加载 |
| `method_exists`   | 类方法是否定义             | 不区分访问修饰符 |
| `property_exists` | 类属性是否定义             | 包括不可见的私有属性 |
| `empty`           | 变量是否为空               | `0`、`""`、`null`、`[]` 均为 true |
| `isset`           | 变量是否存在且非 null      | 不触发 `__isset` |
| `is_null`         | 变量是否为 null            | 对未定义变量会发出警告 |

### 代码示例

```php
function greet(string $name): string {
    return "Hello, {$name}!";
}

var_dump(function_exists('greet'));          // true
var_dump(function_exists('nonexistent'));    // false

class User {
    private $name;
    public function getName(): string { return $this->name; }
}

var_dump(class_exists('User'));              // true
var_dump(method_exists('User', 'getName'));  // true
var_dump(property_exists('User', 'name'));   // true
```

---

## 二、字符串处理函数

字符串操作是 PHP 开发中最常见的任务。PHP 提供了丰富的字符串函数，从简单的截取替换到复杂的正则匹配。

### 2.1 常用函数速查

| 函数              | 用途                     | 返回值类型 |
| ----------------- | ------------------------ | ---------- |
| `strlen`          | 获取字符串长度           | int        |
| `strpos`          | 查找子串首次出现的位置   | int\|false |
| `str_contains`    | 判断是否包含子串 (8.0+)  | bool       |
| `str_starts_with` | 判断是否以子串开头 (8.0+)| bool       |
| `str_ends_with`   | 判断是否以子串结尾 (8.0+)| bool       |
| `substr`          | 截取子串                 | string     |
| `str_replace`     | 替换子串                 | string     |
| `explode`         | 按分隔符拆分为数组       | array      |
| `implode`         | 将数组拼接为字符串       | string     |
| `trim`            | 去除首尾空白字符         | string     |
| `strtolower`      | 转小写                   | string     |
| `strtoupper`      | 转大写                   | string     |
| `ucfirst`         | 首字母大写               | string     |
| `sprintf`         | 格式化字符串             | string     |
| `preg_match`      | 正则匹配                 | int\|false |

### 2.2 代码示例

```php
// 截取与查找
$email = 'user@example.com';
$pos = strpos($email, '@');
$username = substr($email, 0, $pos);  // 'user'
$domain = substr($email, $pos + 1);   // 'example.com'

// PHP 8.0+ 新函数 — 更语义化
var_dump(str_contains($email, 'example'));  // true
var_dump(str_starts_with($email, 'user'));  // true
var_dump(str_ends_with($email, '.com'));    // true

// 格式化
$total = 49.5;
echo sprintf('总价：¥%.2f', $total);  // 总价：¥49.50

// 正则提取
$html = '<div class="content">Hello World</div>';
if (preg_match('/<div[^>]*>(.*?)<\/div>/', $html, $matches)) {
    echo $matches[1];  // Hello World
}
```

### 2.3 常见踩坑：`strpos` vs `str_contains`

```php
// ❌ 经典错误：strpos 返回 0 时被当作 false
$search = 'apple';
if (strpos($search, 'apple')) {
    echo 'Found';  // 不会执行！因为 'apple' 在位置 0
}

// ✅ 正确写法
if (strpos($search, 'apple') !== false) {
    echo 'Found';
}

// ✅ PHP 8.0+ 最佳实践：直接用 str_contains
if (str_contains($search, 'apple')) {
    echo 'Found';
}
```

### 2.4 性能对比：`strpos` vs `str_contains`

`str_contains` 内部同样是 C 层实现，但语义更清晰，且避免了 `!== false` 的判断错误。在 PHP 8.0+ 项目中，**优先使用 `str_contains` / `str_starts_with` / `str_ends_with`**。

```
// 简单基准测试（100万次调用）
strpos + !== false:  ~0.12s
str_contains:        ~0.11s  （略快，且代码更清晰）
```

---

## 三、数组操作函数

PHP 的数组是其最强大的数据结构之一，相关函数极其丰富。

### 3.1 核心函数

| 函数            | 用途                         | 备注 |
| --------------- | ---------------------------- | ---- |
| `count`         | 计算数组元素个数             |      |
| `array_push`    | 末尾添加元素                 | 不如 `$arr[]` 高效 |
| `array_pop`     | 弹出末尾元素                 |      |
| `array_shift`   | 弹出首个元素                 | 会重置数字索引 |
| `array_unshift` | 头部添加元素                 |      |
| `array_merge`   | 合并数组                     | 字符串键后者覆盖 |
| `array_map`     | 对每个元素应用回调           |      |
| `array_filter`  | 过滤元素                     |      |
| `array_reduce`  | 归约为单个值                 |      |
| `array_column`  | 提取二维数组的某一列         |      |
| `array_unique`  | 去重                         |      |
| `array_key_exists` | 检查键是否存在            |      |
| `in_array`      | 检查值是否存在               | 注意松散比较 |
| `sort` / `usort`| 排序                         |      |
| `array_keys`    | 获取所有键                   |      |
| `array_values`  | 获取所有值                   |      |
| `array_combine` | 用一个数组作键、另一个作值   |      |
| `compact`       | 变量名 => 值 组成数组        |      |
| `extract`       | 将数组展开为变量             | 慎用 |

### 3.2 代码示例

```php
// array_map + array_filter 组合
$prices = [100, 250, 30, 80, 420, 15];
$expensive = array_filter($prices, fn($p) => $p >= 100);
// [100, 250, 420]

$doubled = array_map(fn($p) => $p * 2, $prices);
// [200, 500, 60, 160, 840, 30]

// array_column 提取数据库结果的某一列
$users = [
    ['id' => 1, 'name' => 'Alice', 'age' => 30],
    ['id' => 2, 'name' => 'Bob',   'age' => 25],
    ['id' => 3, 'name' => 'Carol', 'age' => 35],
];
$names = array_column($users, 'name');
// ['Alice', 'Bob', 'Carol']

// array_reduce 计算总和
$total = array_reduce($prices, fn($carry, $item) => $carry + $item, 0);
// 895

// array_combine 创建关联数组
$keys = ['name', 'email', 'age'];
$vals = ['Alice', 'alice@example.com', 30];
$user = array_combine($keys, $vals);
// ['name' => 'Alice', 'email' => 'alice@example.com', 'age' => 30]
```

### 3.3 常见踩坑

#### `isset` vs `array_key_exists`

```php
$data = ['name' => 'Alice', 'email' => null];

// ❌ isset 对 null 值返回 false
var_dump(isset($data['email']));         // false

// ✅ array_key_exists 只检查键是否存在
var_dump(array_key_exists('email', $data)); // true
```

#### `in_array` 的松散比较陷阱

```php
$list = [0, 1, 2, 3];

// ❌ 松散比较导致 'foo' == 0 为 true
var_dump(in_array('foo', $list));  // true！

// ✅ 使用严格模式
var_dump(in_array('foo', $list, true));  // false
```

#### `array_merge` 与引用

```php
$a = ['key' => 'original'];
$b = ['key' => 'overwritten'];
$merged = array_merge($a, $b);
// ['key' => 'overwritten'] — 字符串键后者覆盖

// 数字键会重新索引
$c = [1, 2, 3];
$d = [4, 5];
$merged = array_merge($c, $d);
// [1, 2, 3, 4, 5] — 不是 [[1,2,3], [4,5]]

// PHP 8.1+ 可用展开运算符
$merged = [...$c, ...$d];  // 同上
```

---

## 四、数学函数

| 函数      | 用途                 | 示例 |
| --------- | -------------------- | ---- |
| `abs`     | 绝对值               | `abs(-5)` → 5 |
| `ceil`    | 向上取整             | `ceil(4.2)` → 5 |
| `floor`   | 向下取整             | `floor(4.8)` → 4 |
| `round`   | 四舍五入             | `round(4.5)` → 5 |
| `max`     | 最大值               | `max(1, 3, 2)` → 3 |
| `min`     | 最小值               | `min(1, 3, 2)` → 1 |
| `pow`     | 幂运算               | `pow(2, 10)` → 1024 |
| `sqrt`    | 平方根               | `sqrt(144)` → 12 |
| `intval`  | 转整数               | `intval('42abc')` → 42 |
| `floatval`| 转浮点数             | `floatval('3.14')` → 3.14 |

```php
// 金额计算精度
$price = 0.1 + 0.2;
var_dump($price === 0.3);           // false！
var_dump(round($price, 2) === 0.3); // true

// 使用 bcadd 进行精确计算
$result = bcadd('0.1', '0.2', 1);  // '0.3'
```

> ⚠️ **浮点数精度问题**：永远不要用 `==` 比较浮点数。涉及金额计算时，使用 `round()` 或 `bcmath` 扩展。

---

## 五、日期与时间函数

### 5.1 常用函数

```php
// 获取当前时间戳
$timestamp = time();

// 格式化日期
echo date('Y-m-d H:i:s');           // 2024-01-15 14:30:00
echo date('Y年m月d日');              // 2024年01月15日

// 字符串转时间戳
$ts = strtotime('2024-01-15 14:30:00');
$ts = strtotime('+1 day');
$ts = strtotime('next Monday');

// 计算时间差
$start = strtotime('2024-01-01');
$end = strtotime('2024-03-01');
$days = ($end - $start) / 86400;  // 60 天

// DateTime 对象（推荐用法）
$date = new DateTime('2024-01-15');
$date->modify('+1 month');
echo $date->format('Y-m-d');  // 2024-02-15

// 时区处理
$date = new DateTime('now', new DateTimeZone('Asia/Shanghai'));
echo $date->format('Y-m-d H:i:s P');  // +08:00

// PHP 8.3+ DateTimeImmutable 推荐
$now = new DateTimeImmutable();
$tomorrow = $now->modify('+1 day');
// $now 不变，$tomorrow 是新对象
```

### 5.2 常见踩坑

```php
// ❌ date() 默认使用 php.ini 中的时区
// ✅ 在项目入口处设置
date_default_timezone_set('Asia/Shanghai');

// ❌ strtotime 在 32 位系统上有 2038 年问题
// ✅ 使用 DateTime 对象
$date = new DateTime('2039-01-01');  // 安全
```

---

## 六、文件与目录操作

### 6.1 常用函数

| 函数             | 用途                   | 备注 |
| ---------------- | ---------------------- | ---- |
| `file_get_contents` | 读取文件全部内容    | 支持 URL |
| `file_put_contents` | 写入内容到文件      | 支持 `FILE_APPEND` |
| `fopen` / `fclose`  | 打开/关闭文件       |      |
| `fread` / `fwrite`  | 读/写文件           |      |
| `is_file`        | 是否为文件               |      |
| `is_dir`         | 是否为目录               |      |
| `file_exists`    | 文件或目录是否存在       |      |
| `mkdir`          | 创建目录                 |      |
| `scandir`        | 列出目录内容             |      |
| `glob`           | 按模式匹配文件           |      |
| `pathinfo`       | 获取路径信息             |      |
| `realpath`       | 获取绝对路径             |      |

### 6.2 代码示例

```php
// 读取文件
$content = file_get_contents('/path/to/file.txt');

// 写入文件
file_put_contents('/path/to/output.txt', 'Hello World');

// 追加写入
file_put_contents('/path/to/log.txt', "New log\n", FILE_APPEND);

// 安全读取（带锁）
$content = file_get_contents('/path/to/config.lock', false, null, 0, 0);

// 获取路径信息
$path = '/var/www/html/index.php';
$info = pathinfo($path);
// $info['dirname']  = '/var/www/html'
// $info['basename'] = 'index.php'
// $info['extension'] = 'php'
// $info['filename'] = 'index'

// 遍历目录
$files = glob('/var/www/html/*.php');
foreach ($files as $file) {
    echo basename($file) . "\n";
}

// 递归遍历目录（使用 RecursiveDirectoryIterator）
$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator('/var/www/html'),
    RecursiveIteratorIterator::SELF_FIRST
);
foreach ($iterator as $file) {
    if ($file->isFile() && $file->getExtension() === 'php') {
        echo $file->getPathname() . "\n";
    }
}
```

### 6.3 安全注意事项

```php
// ❌ 目录遍历漏洞
$userInput = $_GET['file'];
$content = file_get_contents("/uploads/{$userInput}");
// 攻击者可传入 ../../etc/passwd

// ✅ 使用 realpath 验证路径
$baseDir = '/uploads/';
$realPath = realpath($baseDir . $userInput);
if ($realPath === false || strpos($realPath, $baseDir) !== 0) {
    throw new RuntimeException('Invalid path');
}
$content = file_get_contents($realPath);
```

---

## 七、JSON 处理函数

### 7.1 核心函数

```php
// 编码
$data = ['name' => 'Alice', 'age' => 30, 'hobbies' => ['reading', 'coding']];
$json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
echo $json;
// {
//     "name": "Alice",
//     "age": 30,
//     "hobbies": ["reading", "coding"]
// }

// 解码
$decoded = json_decode($json, true);  // true 返回关联数组
$decoded = json_decode($json);        // 返回对象

// 错误处理（重要！）
$json = '{"name": "Alice", age: 30}';  // 无效 JSON
$result = json_decode($json, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    echo 'JSON 解析错误：' . json_last_error_msg();
}

// PHP 8.x 推荐方式：使用 throwOnError 参数
try {
    $result = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException $e) {
    echo 'JSON 错误：' . $e->getMessage();
}
```

### 7.2 常用 JSON 常量

| 常量                        | 用途                     |
| --------------------------- | ------------------------ |
| `JSON_UNESCAPED_UNICODE`    | 不转义中文字符           |
| `JSON_UNESCAPED_SLASHES`    | 不转义斜杠               |
| `JSON_PRETTY_PRINT`         | 格式化输出               |
| `JSON_THROW_ON_ERROR`       | 出错时抛异常 (7.3+)      |
| `JSON_INVALID_UTF8_SUBSTITUTE` | 替换无效 UTF-8 (7.2+) |
| `JSON_FORCE_OBJECT`         | 强制输出为对象           |

---

## 八、类型转换与验证函数

### 8.1 类型检测

```php
is_string($var)    // 是否为字符串
is_int($var)       // 是否为整数
is_float($var)     // 是否为浮点数
is_bool($var)      // 是否为布尔值
is_array($var)     // 是否为数组
is_object($var)    // 是否为对象
is_numeric($var)   // 是否为数字或数字字符串
is_callable($var)  // 是否可调用
is_resource($var)  // 是否为资源
```

### 8.2 `isset` vs `empty` vs `is_null` 深度对比

这是 PHP 开发者最容易混淆的三个函数：

```php
// 测试数据
$a = null;
$b = '';
$c = 0;
$d = false;
$e = [];
$f = '0';
$g = 0.0;

// isset 检测：变量存在且不为 null
isset($a) → false
isset($b) → true
isset($c) → true
isset($d) → true
isset($e) → true
isset($f) → true

// empty 检测：值是否为"空"
empty($a) → true
empty($b) → true
empty($c) → true
empty($d) → true
empty($e) → true
empty($f) → true   // '0' 也被视为空！
empty($g) → true

// 最佳实践
// 1. 检查变量是否存在 → isset()
// 2. 检查是否有有效数据 → !empty()
// 3. 明确检查 null → is_null() 或 === null
// 4. 检查字符串是否为空 → $str === ''
```

> ⚠️ **`empty('0')` 返回 `true`！** 如果你的业务逻辑中 `'0'` 是有效值，使用 `empty()` 会导致 bug。

---

## 九、PHP 8.x 新增实用函数

### 9.1 PHP 8.0

```php
// str_contains / str_starts_with / str_ends_with
str_contains('Hello World', 'World');  // true
str_starts_with('Hello', 'He');        // true
str_ends_with('Hello', 'lo');          // true

// match 表达式（不是函数，但常用）
$status = match($code) {
    200 => 'OK',
    301 => 'Moved',
    404 => 'Not Found',
    default => 'Unknown',
};

// Named Arguments（命名参数）
$html = htmlspecialchars($string, double_encode: false);

// Nullsafe Operator
$country = $user?->address?->country;
```

### 9.2 PHP 8.1

```php
// enum 类型
enum Status: string {
    case Active = 'active';
    case Inactive = 'inactive';
}

// readonly 属性
class User {
    public function __construct(
        public readonly string $name,
    ) {}
}

// array_is_list — 判断数组是否为列表
array_is_list([1, 2, 3]);           // true
array_is_list([0 => 'a', 2 => 'b']); // false
array_is_list(['name' => 'Alice']);  // false

// fsync / fdatasync
$fp = fopen('file.txt', 'w');
fwrite($fp, 'data');
fsync($fp);  // 强制刷盘

// Fibers（纤程，协程基础）
$fiber = new Fiber(function (): void {
    $value = Fiber::suspend('fiber started');
    echo "Fiber received: {$value}";
});
$result = $fiber->start();  // 'fiber started'
$fiber->resume('hello');    // "Fiber received: hello"
```

### 9.3 PHP 8.2

```php
// readonly class
readonly class Point {
    public function __construct(
        public float $x,
        public float $y,
    ) {}
}

// true / false / null 作为独立类型
function alwaysTrue(): true {
    return true;
}

// 析取范式（DNF）类型
function process((A&B)|null $value): void {}

// Random 扩展（密码学安全的随机数）
$rng = new Random\Randomizer();
$randomInt = $rng->getInt(1, 100);
$randomBytes = $rng->getBytes(16);
$shuffled = $rng->shuffleArray([1, 2, 3, 4, 5]);
$shuffledStr = $rng->shuffleBytes('hello');

// mb_str_pad（多字节安全的 str_pad）
mb_str_pad('你好', 10, ' ', STR_PAD_RIGHT);
```

### 9.4 PHP 8.3

```php
// json_validate — 验证 JSON 字符串是否合法（不解码）
json_validate('{"name": "Alice"}');  // true
json_validate('{invalid}');          // false

// 比 json_decode 验证更快，因为不需要创建数据结构

// Override 类常量的类型
interface HasId {
    public const int ID;
}
class User implements HasId {
    public const int ID = 1;
}

// Randomizer 新方法
$rng = new Random\Randomizer();
$rng->getBytesFromString('abcdef', 10);  // 从指定字符集中随机生成
$rng->getFloat(0.0, 1.0);                // 随机浮点数
$rng->nextFloat();                        // 0.0 到 1.0 之间
```

### 9.5 PHP 8.4

```php
// array_find — 在数组中查找满足条件的第一个元素
$users = [
    ['name' => 'Alice', 'age' => 30],
    ['name' => 'Bob',   'age' => 17],
    ['name' => 'Carol', 'age' => 25],
];
$adult = array_find($users, fn($user) => $user['age'] >= 18);
// ['name' => 'Alice', 'age' => 30]

// array_find_key — 返回找到的键
$key = array_find_key($users, fn($user) => $user['age'] < 18);
// 1

// array_any — 是否有任一元素满足条件
$hasMinor = array_any($users, fn($user) => $user['age'] < 18);
// true

// array_all — 是否所有元素满足条件
$allAdults = array_all($users, fn($user) => $user['age'] >= 18);
// false

// Deprecated: 隐式可空参数类型
// PHP 8.4 开始，function foo(string $a = null) 需写成
// function foo(?string $a = null)
```

---

## 十、安全相关函数

```php
// HTML 转义（防 XSS）
echo htmlspecialchars($userInput, ENT_QUOTES, 'UTF-8');

// SQL 转义（防注入，推荐使用 PDO 预处理）
$safe = addslashes($input);  // 不推荐，仅作了解

// 密码哈希
$hash = password_hash('my_password', PASSWORD_DEFAULT);
var_dump(password_verify('my_password', $hash));  // true

// 随机数
$token = bin2hex(random_bytes(32));  // 64 字符的随机 token

// 过滤输入
$email = filter_input(INPUT_GET, 'email', FILTER_VALIDATE_EMAIL);
$ip = filter_var($userIp, FILTER_VALIDATE_IP);
$int = filter_var('42', FILTER_VALIDATE_INT);
```

> ⚠️ **永远不要使用 `md5()` 或 `sha1()` 做密码哈希！** 使用 `password_hash()` + `password_verify()`。

---

## 十一、最佳实践总结

### 11.1 函数选择原则

1. **优先使用内置函数**：PHP 内置函数用 C 实现，性能远超自定义 PHP 代码
2. **使用 PHP 8.x 新函数**：`str_contains` 比 `strpos !== false` 更安全、更清晰
3. **严格模式优先**：`in_array($val, $arr, true)` 使用严格比较
4. **处理返回值**：`json_decode`、`preg_match` 等函数可能返回 `false` 或 `null`

### 11.2 性能优化建议

```php
// ❌ 循环中重复计算
for ($i = 0; $i < count($array); $i++) {  // count() 每次调用
    // ...
}

// ✅ 提前计算
$len = count($array);
for ($i = 0; $i < $len; $i++) {
    // ...
}

// ❌ 用正则处理简单字符串
if (preg_match('/^hello/', $str)) { /* ... */ }

// ✅ 用字符串函数
if (str_starts_with($str, 'hello')) { /* ... */ }

// ❌ 反复拼接字符串
$result = '';
foreach ($items as $item) {
    $result .= $item;  // 每次创建新字符串
}

// ✅ 使用 implode
$result = implode('', $items);

// ❌ 用 array_push 添加单个元素
array_push($arr, $value);

// ✅ 直接赋值
$arr[] = $value;  // 更快
```

### 11.3 常用函数性能对比

| 操作                  | 快                | 慢                  | 差异 |
| --------------------- | ----------------- | ------------------- | ---- |
| 添加元素              | `$arr[] = $v`     | `array_push()`      | ~2x  |
| 字符串拼接            | `implode()`       | `.=` 循环           | ~3x  |
| 查找子串 (PHP 8+)     | `str_contains()`  | `strpos() !== false`| ~1x  |
| 验证 JSON             | `json_validate()` | `json_decode` + 检查| ~5x  |
| 检查数组值            | `isset($arr[$k])` | `in_array()`        | ~10x |

> `isset` 做哈希查找 O(1)，`in_array` 做线性扫描 O(n)。大数组查找值时，考虑先用 `array_flip` 翻转。

### 11.4 代码质量建议

1. 使用 `declare(strict_types=1)` 启用严格类型检查
2. 对可能失败的函数（`preg_match`、`json_decode`）始终检查返回值
3. 优先使用 `DateTimeImmutable` 而非 `DateTime`，避免副作用
4. 文件操作后检查返回值，使用 `is_readable` / `is_writable` 预检查
5. 使用 `mb_*` 系列函数处理多字节字符串（中文、emoji 等）

```php
declare(strict_types=1);

// ✅ 多字节安全的字符串操作
mb_strlen('你好世界');          // 4
mb_substr('你好世界', 0, 2);   // '你好'
mb_strpos('Hello你好', '你');  // 5
```

---

## 十二、速查备忘单

### 字符串
`strlen` `strpos` `str_contains` `str_starts_with` `str_ends_with` `substr` `str_replace` `explode` `implode` `trim` `ltrim` `rtrim` `strtolower` `strtoupper` `ucfirst` `lcfirst` `sprintf` `printf` `number_format` `wordwrap` `nl2br` `htmlspecialchars` `strip_tags` `addslashes` `stripslashes`

### 数组
`count` `array_push` `array_pop` `array_shift` `array_unshift` `array_merge` `array_map` `array_filter` `array_reduce` `array_column` `array_unique` `array_keys` `array_values` `array_combine` `array_flip` `array_search` `array_key_exists` `in_array` `array_slice` `array_splice` `array_chunk` `array_pad` `array_fill` `array_walk` `compact` `extract` `list` `sort` `rsort` `asort` `arsort` `ksort` `krsort` `usort` `uasort` `uksort`

### PHP 8.x 新增
`str_contains` `str_starts_with` `str_ends_with` `array_is_list` `json_validate` `array_find` `array_find_key` `array_any` `array_all`

---

## 相关阅读

- [PHP 中 Interface 与 Abstract Class 的区别](/php/vs-interfaceabstract/)
- [PHP 中 GET 与 POST 请求的深度对比](/php/vs-getpost/)
- [PHP 5 到 PHP 7 的重大变化与性能提升](/php/php5php7/)
- [PHP 安全编程最佳实践](/php/security/)
