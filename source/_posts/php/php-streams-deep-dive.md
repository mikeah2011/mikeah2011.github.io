---

title: PHP Streams 深度剖析：流式读写、Wrapper 自定义与大文件处理
keywords: [PHP Streams, Wrapper, 深度剖析, 流式读写, 自定义与大文件处理, PHP]
date: 2026-06-10 08:36:00
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
tags:
- PHP
- Streams
- Laravel
- IO
- 性能优化
- 文件处理
description: 深入理解 PHP Streams 机制，从流式读写、自定义 Wrapper 到 Laravel 中的大文件处理实战，掌握底层 I/O 与性能优化技巧。
---



PHP Streams 是 PHP I/O 操作的底层基石。无论是 `file_get_contents()`、`fopen()`，还是 `file_put_contents()`，最终都走 Streams 这条路。理解 Streams，意味着你能精准控制文件读写行为、自定义协议、处理 GB 级大文件而不爆内存。

这篇文章从原理到实战，带你彻底搞懂 Streams。

<!--more-->

## 一、什么是 Streams

Stream 是一个可读、可写、可寻址的数据流资源。PHP 中所有 I/O 操作都基于 Stream：

```php
// 这些底层都是 stream 操作
$contents = file_get_contents('data.txt');        // 读取
file_put_contents('out.txt', 'hello');            // 写入
$fp = fopen('log.txt', 'r');                      // 打开文件流
$fp = fopen('https://api.example.com/data', 'r'); // HTTP 流
$fp = fopen('php://memory', 'r+');                // 内存流
```

### Stream 的三要素

每个 Stream 由三个部分组成：

1. **Wrapper（包装器）**：决定协议处理方式，如 `file://`、`http://`、`php://`
2. **Protocol（协议）**：Wrapper 支持的操作集（读/写/可选的 seek/truncate）
3. **Filter（过滤器）**：在数据经过 Stream 时进行转换处理

```php
// 查看当前注册的 wrapper
print_r(stream_get_wrappers());

// 查看当前注册的 filter
print_r(stream_get_filters());
```

## 二、PHP 内置 Stream Wrapper

### 2.1 file:// — 本地文件

最常用的 wrapper，省略协议前缀时默认使用：

```php
$fp = fopen('/tmp/test.txt', 'r');
$fp = fopen('file:///tmp/test.txt', 'r'); // 等价写法
```

### 2.2 php:// — 特殊流

```php
// php://stdin      - 标准输入
// php://stdout     - 标准输出
// php://stderr     - 标准错误
// php://input      - 原始 POST 数据
// php://temp       - 临时文件（超过 2MB 写磁盘）
// php://memory     - 纯内存流
// php://filter     - 流过滤器链

// 读取原始请求体（API 开发常用）
$body = file_get_contents('php://input');

// 带 Base64 编码过滤器读取文件
$encoded = file_get_contents('php://filter/read=convert.base64-encode/resource=/tmp/secret.txt');
```

### 2.3 http:// / https:// — 网络流

```php
$fp = fopen('https://api.example.com/data', 'r', false, stream_context_create([
    'http' => [
        'method' => 'GET',
        'timeout' => 5,
        'header' => "Authorization: Bearer xxx\r\n"
    ]
]));
```

### 2.4 compress.zlib:// / compress.bzip2://

直接读写压缩文件，无需手动解压：

```php
// 读取 .gz 文件
$data = file_get_contents('compress.zlib:///tmp/data.gz');

// 写入 .gz 文件
file_put_contents('compress.zlib:///tmp/output.gz', $largeString);
```

## 三、Stream Context：控制流行为

Context 是 Streams 的配置层，通过 `stream_context_create()` 创建：

```php
$ctx = stream_context_create([
    'http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/json\r\nAuthorization: Bearer token123",
        'content' => json_encode(['name' => 'Michael']),
        'timeout' => 10,
        'ignore_errors' => true, // 不要因为 4xx/5xx 抛 warning
    ],
    'ssl' => [
        'verify_peer'      => true,
        'verify_peer_name' => true,
        'allow_self_signed' => false,
    ],
]);

$response = file_get_contents('https://api.example.com/users', false, $ctx);
$meta = stream_get_meta_data($fp); // 可以读到 response headers
```

### Laravel 中的 Stream Context

Laravel HTTP Client（基于 Guzzle）底层也用 Streams：

```php
// Laravel HTTP Client —— 实际是 Guzzle 的封装
$response = Http::withHeaders([
    'Authorization' => 'Bearer ' . $token,
])->timeout(30)->get('https://api.example.com/data');

// 如果需要流式下载大响应
$response = Http::withHeaders([
    'Authorization' => 'Bearer ' . $token,
])->stream()->get('https://api.example.com/large-file');

$fp = fopen('/tmp/download.zip', 'w');
foreach ($response as $chunk) {
    fwrite($fp, $chunk);
}
fclose($fp);
```

## 四、Stream Filters：数据过滤器

过滤器可以在数据流经 Stream 时实时转换，无需先读完再处理。

### 4.1 内置过滤器

```php
// 写入时自动 Base64 编码
$fp = fopen('php://output', 'w');
stream_filter_append($fp, 'convert.base64-encode');
fwrite($fp, 'Hello World'); // 输出 Base64 编码后的内容

// 字符串转换
$fp = fopen('php://output', 'w');
stream_filter_append($fp, 'string.toupper');
fwrite($fp, 'hello'); // 输出 HELLO

// 压缩
$fp = fopen('/tmp/data.gz', 'w');
stream_filter_append($fp, 'zlib.deflate');
fwrite($fp, $largeContent); // 自动压缩写入
```

### 4.2 自定义 Stream Filter

自定义过滤器需要实现 `php_user_filter` 接口：

```php
class MarkdownToHtmlFilter extends php_user_filter
{
    public $filtername = 'markdown.to-html';

    public function onCreate(): bool
    {
        return true;
    }

    public function onClose(): void
    {
        // 清理资源
    }

    public function intread($in, $out, &$consumed, bool $closing): int
    {
        $return = PSWG_PASS_ON;

        while ($bucket = stream_bucket_make_writeable($in)) {
            // 将 Markdown 内容转为 HTML
            $bucket->data = $this->convertMarkdown($bucket->data);
            $consumed += $bucket->datalen;
            stream_bucket_append($out, $bucket);
        }

        return $return;
    }

    private function convertMarkdown(string $text): string
    {
        // 简化的 Markdown 转换
        $text = preg_replace('/^### (.+)$/m', '<h3>$1</h3>', $text);
        $text = preg_replace('/^## (.+)$/m', '<h2>$1</h2>', $text);
        $text = preg_replace('/^# (.+)$/m', '<h1>$1</h1>', $text);
        $text = preg_replace('/\*\*(.+?)\*\*/', '<strong>$1</strong>', $text);
        $text = preg_replace('/\*(.+?)\*/', '<em>$1</em>', $text);
        return $text;
    }
}

// 注册过滤器
stream_filter_register('markdown.to-html', 'MarkdownToHtmlFilter');

// 使用
$fp = fopen('README.md', 'r');
stream_filter_append($fp, 'markdown.to-html');
$html = stream_get_contents($fp);
fclose($fp);

echo $html; // 输出转换后的 HTML
```

### 4.3 过滤器链

可以串联多个过滤器，按添加顺序执行：

```php
$fp = fopen('/tmp/output.txt', 'w');

// 先转大写，再 Base64 编码
stream_filter_append($fp, 'string.toupper');
stream_filter_append($fp, 'convert.base64-encode');

fwrite($fp, 'hello world');
fclose($fp);
```

## 五、自定义 Stream Wrapper

这是 Streams 最强大的能力——自定义协议。

### 5.1 完整示例：实现 csv:// 协议

```php
class CsvStreamWrapper
{
    private $data = [];
    private $position = 0;
    private $path = '';

    /**
     * 打开流
     */
    public function stream_open(string $path, string $mode, int $options, ?string &$opened_path): bool
    {
        $this->path = substr($path, strlen('csv://'));
        $this->position = 0;

        if (str_contains($mode, 'r')) {
            if (!file_exists($this->path)) {
                trigger_error("csv:// wrapper: file not found: {$this->path}", E_WARNING);
                return false;
            }
            $this->data = [];
            $handle = fopen($this->path, 'r');
            while (($row = fgetcsv($handle)) !== false) {
                $this->data[] = $row;
            }
            fclose($handle);
        } else {
            $this->data = [];
        }

        return true;
    }

    /**
     * 读取数据
     */
    public function stream_read(int $count): string|false
    {
        if ($this->position >= count($this->data)) {
            return false;
        }

        $result = '';
        $bytesRead = 0;

        while ($this->position < count($this->data) && $bytesRead < $count) {
            $line = implode(',', $this->data[$this->position]) . "\n";
            $lineBytes = strlen($line);

            if ($bytesRead + $lineBytes <= $count) {
                $result .= $line;
                $bytesRead += $lineBytes;
                $this->position++;
            } else {
                $remaining = $count - $bytesRead;
                $result .= substr($line, 0, $remaining);
                $bytesRead += $remaining;
            }
        }

        return $result;
    }

    /**
     * 写入数据
     */
    public function stream_write(string $data): int
    {
        $lines = explode("\n", rtrim($data, "\n"));
        foreach ($lines as $line) {
            $this->data[] = str_getcsv($line);
            $this->position++;
        }
        return strlen($data);
    }

    /**
     * 获取流信息
     */
    public function stream_stat(): array
    {
        return [
            'size'  => count($this->data),
            'mode'  => 0666,
            'mtime' => time(),
        ];
    }

    /**
     * 移动指针
     */
    public function stream_seek(int $offset, int $whence): bool
    {
        switch ($whence) {
            case SEEK_SET:
                $this->position = $offset;
                break;
            case SEEK_CUR:
                $this->position += $offset;
                break;
            case SEEK_END:
                $this->position = count($this->data) + $offset;
                break;
        }
        return $this->position >= 0 && $this->position <= count($this->data);
    }

    /**
     * 当前位置
     */
    public function stream_tell(): int
    {
        return $this->position;
    }

    /**
     * 是否到达末尾
     */
    public function stream_eof(): bool
    {
        return $this->position >= count($this->data);
    }

    /**
     * 关闭流
     */
    public function stream_close(): void
    {
        $this->data = [];
        $this->position = 0;
    }

    /**
     * 关闭时写回 CSV
     */
    public function stream_flush(): bool
    {
        if (!empty($this->data)) {
            $handle = fopen($this->path, 'w');
            foreach ($this->data as $row) {
                fputcsv($handle, $row);
            }
            fclose($handle);
            return true;
        }
        return false;
    }

    /**
     * 文件 stat（用于 file_exists 等）
     */
    public function url_stat(string $path, int $flags): array
    {
        $realPath = substr($path, strlen('csv://'));
        if (file_exists($realPath)) {
            return stat($realPath);
        }
        return false;
    }

    /**
     * 读取整个流（file_get_contents 用）
     */
    public function stream_set_option(int $option, int $arg1, int $arg2): bool
    {
        return false;
    }
}

// 注册并使用
stream_wrapper_register('csv', 'CsvStreamWrapper::class');

// 读取 CSV 为行数据
$fp = fopen('csv:///tmp/users.csv', 'r');
$content = stream_get_contents($fp);
fclose($fp);

// 也可以直接用 file_get_contents
$data = file_get_contents('csv:///tmp/users.csv');

// 写入
$fp = fopen('csv:///tmp/output.csv', 'w');
fwrite($fp, "name,email,age\n");
fwrite($fp, "Michael,m@example.com,30\n");
fclose($fp); // stream_flush 触发，写回磁盘
```

### 5.2 应用场景

自定义 Wrapper 的典型用途：

- **数据库协议**：`db://users` 直接读取表数据
- **缓存协议**：`cache://key` 读写 Redis/Memcached
- **加密文件系统**：`enc://` 自动加解密
- **虚拟文件**：`config://app` 读取配置值
- **日志协议**：`log://error` 写入结构化日志

```php
// 实际应用：加密文件 wrapper
class EncryptedStreamWrapper
{
    private $fp;
    private $key;

    public function stream_open(string $path, string $mode, int $options, ?string &$opened_path): bool
    {
        $realPath = substr($path, strlen('enc://'));
        $this->key = getenv('FILE_ENCRYPTION_KEY');
        $this->fp = fopen($realPath, $mode);
        return $this->fp !== false;
    }

    public function stream_read(int $count): string
    {
        $encrypted = fread($this->fp, $count + 16); // 多读 16 bytes for padding
        return $this->decrypt($encrypted);
    }

    public function stream_write(string $data): int
    {
        $encrypted = $this->encrypt($data);
        return fwrite($this->fp, $encrypted);
    }

    public function stream_close(): void
    {
        fclose($this->fp);
    }

    private function encrypt(string $data): string
    {
        $iv = random_bytes(16);
        $encrypted = openssl_encrypt($data, 'aes-256-cbc', $this->key, 0, $iv);
        return base64_encode($iv . base64_decode($encrypted));
    }

    private function decrypt(string $data): string
    {
        $decoded = base64_decode($data);
        $iv = substr($decoded, 0, 16);
        $encrypted = substr($decoded, 16);
        return openssl_decrypt(base64_encode($encrypted), 'aes-256-cbc', $this->key, 0, $iv);
    }
}

stream_wrapper_register('enc', 'EncryptedStreamWrapper::class');

// 自动加密写入
file_put_contents('enc:///tmp/secret.dat', '敏感数据');

// 自动解密读取
$data = file_get_contents('enc:///tmp/secret.dat');
```

## 六、大文件处理：流式是王道

### 6.1 逐行读取 GB 级文件

```php
// ❌ 错误：一次性读入内存
$lines = file('huge-log.txt'); // 内存爆炸

// ✅ 正确：逐行流式读取
$fp = fopen('huge-log.txt', 'r');
while (($line = fgets($fp)) !== false) {
    // 处理每一行，内存占用恒定
    processLine(trim($line));
}
fclose($fp);

// ✅ 更简洁：SplFileObject
$file = new SplFileObject('huge-log.txt');
$file->setFlags(SplFileObject::DROP_NEW_LINE | SplFileObject::SKIP_EMPTY);
foreach ($file as $line) {
    processLine($line);
}
```

### 6.2 流式写入大文件

```php
// 生成 10GB CSV，内存恒定
$fp = fopen('/tmp/huge.csv', 'w');
fputcsv($fp, ['id', 'name', 'email', 'created_at']);

for ($i = 1; $i <= 10_000_000; $i++) {
    fputcsv($fp, [
        $i,
        "User {$i}",
        "user{$i}@example.com",
        date('Y-m-d H:i:s', strtotime("-{$i} days")),
    ]);

    // 每 10 万行 flush 一次
    if ($i % 100_000 === 0) {
        fflush($fp);
    }
}

fclose($fp);
```

### 6.3 Laravel 中流式导出

```php
// Laravel + StreamedResponse
use Symfony\Component\HttpFoundation\StreamedResponse;

Route::get('/export/users', function () {
    $response = new StreamedResponse(function () {
        $handle = fopen('php://output', 'w');
        fputcsv($handle, ['ID', '姓名', '邮箱']);

        User::query()
            ->select('id', 'name', 'email')
            ->orderBy('id')
            ->chunk(1000, function ($users) use ($handle) {
                foreach ($users as $user) {
                    fputcsv($handle, [$user->id, $user->name, $user->email]);
                }
            });

        fclose($handle);
    });

    $response->headers->set('Content-Type', 'text/csv');
    $response->headers->set('Content-Disposition', 'attachment; filename="users.csv"');
    return $response;
});

// Maatwebsite Excel 流式导出（大文件推荐）
use Maatwebsite\Excel\Concerns\FromCollection;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\ShouldQueue; // 队列导出
use Maatwebsite\Excel\Concerns\WithChunkReading;

class UsersExport implements FromCollection, WithHeadings, ShouldQueue, WithChunkReading
{
    public function collection()
    {
        return User::select('id', 'name', 'email')->get();
    }

    public function headings(): array
    {
        return ['ID', '姓名', '邮箱'];
    }

    public function chunkSize(): int
    {
        return 1000;
    }
}

// 队列异步导出
Excel::queue(new UsersExport, 'users.xlsx');
```

### 6.4 流式上传处理

```php
// Laravel 流式处理上传的大文件
public function upload(Request $request)
{
    $file = $request->file('document');
    $stream = fopen($file->getRealPath(), 'r');

    // 流式上传到 S3，不经过内存
    Storage::disk('s3')->writeStream('uploads/' . $file->getClientOriginalName(), $stream);

    fclose($stream);

    return response()->json(['status' => 'uploaded']);
}

// 分块读取上传文件
public function processUpload(Request $request)
{
    $file = $request->file('csv');
    $fp = fopen($file->getRealPath(), 'r');
    $header = fgetcsv($fp); // 读取表头
    $rowCount = 0;

    while (($row = fgetcsv($fp)) !== false) {
        DB::table('imports')->insert([
            'col1' => $row[0] ?? null,
            'col2' => $row[1] ?? null,
            'col3' => $row[2] ?? null,
        ]);
        $rowCount++;
    }

    fclose($fp);

    return response()->json(['rows_imported' => $rowCount]);
}
```

## 七、Stream 性能优化技巧

### 7.1 缓冲区大小控制

```php
// 查看默认缓冲区大小（通常 8192 bytes）
$fp = fopen('test.txt', 'r');
echo stream_set_read_buffer($fp, 0); // 设置为无缓冲

// 针对大文件，增大缓冲区提升吞吐
$fp = fopen('huge.bin', 'rb');
stream_set_read_buffer($fp, 1024 * 1024); // 1MB 缓冲区
```

### 7.2 非阻塞 I/O

```php
// 设置非阻塞模式
$fp = fopen('pipe://some-process', 'r');
stream_set_blocking($fp, false);

// 非阻塞读取
$data = fread($fp, 4096);
if ($data === false) {
    // 没有数据可读，稍后重试
}
```

### 7.3 流通知机制

```php
// 监听流事件
$fp = fopen('https://api.example.com/stream', 'r');
stream_set_blocking($fp, false);

stream_set_chunk_size($fp, 1);

if (stream_select($read = [$fp], $write = null, $except = null, 0)) {
    $data = fread($fp, 8192);
}
```

### 7.4 内存流 vs 临时文件流

```php
// 内存流 —— 适合小数据量（< 2MB）
$mem = fopen('php://memory', 'r+');
fwrite($mem, 'small data');
rewind($mem);
$content = stream_get_contents($mem);
fclose($mem);

// 临时文件流 —— 适合大数据量（自动溢出到磁盘）
$temp = fopen('php://temp', 'r+');
fwrite($temp, str_repeat('x', 10 * 1024 * 1024)); // 10MB，自动写磁盘
rewind($temp);
$content = stream_get_contents($temp);
fclose($temp);

// 指定阈值：超过 1MB 写磁盘
$temp = fopen('php://temp/maxmemory:1048576', 'r+');
```

## 八、踩坑记录

### 踩坑 1：忘记关闭流导致资源泄漏

```php
// ❌ 异常时流不会关闭
$fp = fopen('data.txt', 'r');
$data = fread($fp, 1024);
processData($data); // 如果抛异常，$fp 永远不会关闭
fclose($fp);

// ✅ 用 try-finally 或 try-with-resources 思维
$fp = fopen('data.txt', 'r');
try {
    $data = fread($fp, 1024);
    processData($data);
} finally {
    fclose($fp);
}

// ✅ PHP 8.1+ 用 Fiber 或更简洁的写法
$fp = fopen('data.txt', 'r');
defer(fn() => fclose($fp)); // 如果你用了并发框架
```

### 踩坑 2：fread 的 length 参数

```php
// fread 不保证返回 exactly $length 字节！
$fp = fopen('data.txt', 'r');
$chunk = fread($fp, 8192); // 可能返回少于 8192 字节

// 如果需要精确读取指定字节数
function readExact($fp, int $length): string
{
    $result = '';
    while (strlen($result) < $length) {
        $chunk = fread($fp, $length - strlen($result));
        if ($chunk === false || $chunk === '') {
            break; // EOF 或错误
        }
        $result .= $chunk;
    }
    return $result;
}
```

### 踩坑 3：Windows 换行符问题

```php
// Windows 上 \r\n 会导致行数计算错误
$fp = fopen('data.csv', 'r');
// 自动转换换行符（默认开启）
$line = fgets($fp); // 可能包含 \r\n

// 关闭自动转换
$fp = fopen('data.csv', 'rb'); // 二进制模式
// 或者用 SplFileObject
$file = new SplFileObject('data.csv');
$file->setFlags(SplFileObject::DROP_NEW_LINE);
```

### 踩坑 4：stream_context_create 的 header 格式

```php
// ❌ 错误：header 用数组
$ctx = stream_context_create([
    'http' => [
        'header' => ['Authorization: Bearer xxx', 'Content-Type: application/json'],
    ],
]);

// ✅ 正确：header 用 \r\n 分隔的字符串
$ctx = stream_context_create([
    'http' => [
        'header' => "Authorization: Bearer xxx\r\nContent-Type: application/json",
    ],
]);
```

### 踩坑 5：php://input 只能读一次

```php
// ❌ 第二次读取返回空
$body1 = file_get_contents('php://input'); // 有数据
$body2 = file_get_contents('php://input'); // 空！

// ✅ 读取后缓存
$body = file_get_contents('php://input');
// 后续使用 $body 变量
```

## 九、Streams 在 Laravel 中的实际应用

### 9.1 日志流处理

```php
// Laravel 日志底层使用 Stream
use Illuminate\Support\Facades\Log;

// 自定义 Stream Handler
// config/logging.php
'channels' => [
    'custom' => [
        'driver' => 'monolog',
        'handler' => Monolog\Handler\StreamHandler::class,
        'with' => [
            'stream' => storage_path('logs/custom.log'),
            'level' => 'debug',
        ],
    ],
],
```

### 9.2 响应流

```php
// Server-Sent Events (SSE)
Route::get('/events', function () {
    return response()->stream(function () {
        while (true) {
            $data = getDataFromQueue(); // 阻塞等待
            echo "data: " . json_encode($data) . "\n\n";
            ob_flush();
            flush();
        }
    }, 200, [
        'Content-Type' => 'text/event-stream',
        'Cache-Control' => 'no-cache',
        'X-Accel-Buffering' => 'no', // Nginx 禁用缓冲
    ]);
});
```

### 9.3 流式 JSON 生成

```php
// 生成大 JSON 文件，不撑爆内存
function streamJsonExport(string $filename, iterable $records): StreamedResponse
{
    return response()->stream(function () use ($records) {
        echo '[';
        $first = true;
        foreach ($records as $record) {
            if (!$first) echo ',';
            echo json_encode($record);
            $first = false;
        }
        echo ']';
    }, 200, [
        'Content-Type' => 'application/json',
        'Content-Disposition' => "attachment; filename=\"{$filename}\"",
    ]);
}
```

## 十、总结

| 特性 | 说明 |
|------|------|
| **统一接口** | 所有 I/O 操作通过 `fopen`/`fread`/`fwrite`/`fclose` |
| **协议可扩展** | `stream_wrapper_register` 自定义任意协议 |
| **过滤器链** | `stream_filter_append` 实时数据转换 |
| **内存安全** | 流式处理避免一次性加载大文件 |
| **Context 控制** | `stream_context_create` 精细控制超时、header、SSL |

**核心原则**：

1. 大文件必须流式处理，永远不要 `file_get_contents` 一个 GB 级文件
2. 需要自定义协议时，用 Wrapper 比 hack `file_get_contents` 优雅得多
3. 过滤器链适合管道式数据转换，比先读再转更高效
4. Laravel 的 `StreamedResponse` 和 `Http::stream()` 是流式处理的首选入口
5. 始终用 `try-finally` 确保流被关闭，避免资源泄漏

掌握 Streams，你就能在 PHP 中优雅地处理任何 I/O 场景——从简单的文件读写到 GB 级数据导出，再到自定义协议的文件系统抽象。
