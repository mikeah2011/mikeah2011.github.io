---

title: 导入&导出优选CSV格式的理由
keywords: [CSV, 导入, 导出优选, 格式的理由]
cover: https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&fit=crop
date: 2018-04-08 10:27:28
tags:
- CSV
- 数据格式
- 文件处理
- PHP
- 工程管理
categories:
- misc
description: CSV格式作为数据导入导出的首选方案，具有跨平台兼容性强、内存占用低、流式处理高效等核心优势。本文从文件格式对比出发，深入分析CSV与JSON、XML、Excel的差异，涵盖PHP CSV处理的完整代码示例（fgetcsv/fputcsv/SplFileObject），详解Laravel中Excel与League CSV包的实战用法，并探讨大文件处理、编码转换、特殊字符转义等常见问题的解决方案，以及CSV在数据分析与ETL流水线中的典型应用场景。
---



CSV，comma-separated values 逗号分隔值，通常被用于在使用纯文本的系统之间，交换表格类型的数据。

CSV是一种基于行的文件格式。也就是说，此类文件中的每一行都对应到数据表中的具体某一行。通常，CSV文件里包含有一个标题行，该标题行提供了数据的列名。如果没有标题行的话，该文件将被视为已部分完成了结构化工作。

单个CSV文件往往无法显示层次化的结构、或数据关系。而具体的数据连接关系往往需要通常多个CSV文件进行组织。各种外键(Foreign key)一般被存储在一个或多个文件的多个列中。不过这些文件之间的链接并非由其格式本身来表示。此外，由于并未完全标准化，因此在CSV格式文件中，您可以使用逗号以外的界定符，例如：制表符(tabs)或空格。

**CSV文件的另一个特性是：**只有处于未压缩的原始文件状态、或是运用诸如`bzip2`或`lzo`之类的解压缩工具时，CSV文件才能够被拆分(注意：`lzo`需要进行索引之后，方可执行拆分)。



> 优点：

- CSV易于人工阅读，也易于手动编辑。

- CSV提供了一种简单明了的信息模式(schema)。

- 几乎所有现有的应用程序都能够处理CSV文件。

- CSV文件比较易于实现和解析。

- 对于XML而言，您需要在每一行的每一列中分别添加开始与结束标签;而CSV比较简约，您只需一次性写入列标题即可。

  

> 缺点：

- 由于处置的是平面数据，因此需要事先对复杂的数据结构进行格式上的转换。
- 由于不支持列的类型，因此在文本列和数字列之间并无区别。
- 并无表示二进制数据的标准方法。
- 由于NULL和引号之间并无区别，因此导入CSV时可能会出现问题。
- 对于特殊字符的支持性较差。
- 缺乏通用的标准。



尽管存在着一定的局限性，但CSV文件仍然是数据共享领域的上乘之选。它经常被广泛地用于各类业务应用、消费者行业、以及科学分析程序中。当前，大多数批处理和流数据处理模块(如Spark和Hadoop)，都能够支持CSV文件的序列化与反序列化。它们在读取时提供了添加schema的方法。



> 导入功能优选CSV格式的理由：

1. 标准开放，即行业内标准，且支持市面上主流软件的各种操作、解析等；

2. 性能效率远胜于其他格式，消耗内存更小；

3. 支持流式处理，解析简单，消耗性能最小；

4. 读写效率最快。

   

> 导出功能优选CSV格式的理由：

1. 文件结构简单，与txt文本格式相差无几，且功能比txt文本强大；

2. 存储方式简单，减少存储数据的容量；

3. 支持流式处理，写入速度最快，占用内存极低，生成效率更高；

4. 服务器、浏览器等各终端处理起来非常迅速；

5. 轻松处理几百万行数据，理论上是不限量；

6. 支持Excel等格式互相转换；

   

PS: Excel格式处理上限65536行（.xlsx为1048576行），不支持流式处理，性能消耗大，内存占用较大，很容易导致内存溢出等情况

<!-- more -->

---

## CSV vs JSON vs XML vs Excel 格式详细对比

在选择数据交换格式时，了解各格式的优劣至关重要。以下从多个维度进行对比：

| 对比维度 | CSV | JSON | XML | Excel (XLSX) |
|---------|-----|------|-----|-------------|
| **文件大小** | ★★★★★ 最小 | ★★★☆☆ 中等 | ★★☆☆☆ 较大（标签开销） | ★★☆☆☆ 较大（压缩后） |
| **可读性** | ★★★★★ 纯文本，直接可读 | ★★★★☆ 结构清晰 | ★★★☆☆ 标签冗余 | ★★★☆☆ 需要软件打开 |
| **解析速度** | ★★★★★ 极快 | ★★★★☆ 快 | ★★★☆☆ 较慢（DOM解析） | ★★☆☆☆ 慢（需解压） |
| **数据类型** | ❌ 无类型，全部为文本 | ✅ 支持基础类型 | ✅ 丰富类型支持 | ✅ 完整类型系统 |
| **层次结构** | ❌ 仅支持扁平表格 | ✅ 嵌套对象/数组 | ✅ 树状结构 | ✅ 多Sheet支持 |
| **流式处理** | ✅ 逐行读取 | ⚠️ 需流式解析器 | ⚠️ 需SAX解析 | ❌ 需全量加载 |
| **跨平台兼容** | ★★★★★ 通用 | ★★★★★ 通用 | ★★★★☆ 需解析器 | ★★★☆☆ 依赖软件 |
| **大型数据集** | ★★★★★ 百万行无压力 | ★★★☆☆ 需分批 | ★★☆☆☆ 性能差 | ★★☆☆☆ 有行数限制 |
| **典型应用场景** | 数据导入导出、ETL、报表 | API通信、配置文件、NoSQL | 文档交换、SOAP、出版物 | 财务报表、数据分析 |

**结论：** 如果你的场景是批量数据的导入导出、系统间数据交换，CSV在性能和兼容性上有着无可比拟的优势。JSON适合API通信，XML适合复杂文档，Excel适合最终用户的可视化需求。

---

## PHP 处理CSV的完整代码示例

### 基础：使用 fputcsv 和 fgetcsv

这是PHP内置的CSV处理函数，无需安装任何扩展：

```php
<?php
// ==================== 写入CSV ====================
$users = [
    ['姓名', '邮箱', '年龄', '注册日期'],  // 表头
    ['张三', 'zhangsan@example.com', 28, '2024-01-15'],
    ['李四', 'lisi@example.com', 32, '2024-02-20'],
    ['王五', 'wangwu@example.com', 25, '2024-03-10'],
];

$fp = fopen('users.csv', 'w');
// 可选：添加BOM头以确保Excel正确识别UTF-8编码
fwrite($fp, "\xEF\xBB\xBF");

foreach ($users as $row) {
    fputcsv($fp, $row);
}
fclose($fp);

// ==================== 读取CSV ====================
$fp = fopen('users.csv', 'r');
// 跳过BOM
fread($fp, 3);

$headers = null;
$records = [];

while (($row = fgetcsv($fp)) !== false) {
    if ($headers === null) {
        $headers = $row;
        continue;
    }
    $records[] = array_combine($headers, $row);
}
fclose($fp);

print_r($records);
// 输出：Array([0] => Array([姓名] => 张三, [邮箱] => zhangsan@example.com, ...))
```

### 进阶：使用 SplFileObject 处理CSV

SplFileObject 提供了面向对象的接口，更适合现代PHP开发：

```php
<?php
// ==================== 使用 SplFileObject 写入 ====================
$file = new SplFileObject('export.csv', 'w');
$file->setCsvControl(',');  // 设置分隔符

$data = [
    ['ID', '商品名称', '价格', '库存'],
    [1, 'MacBook Pro', 14999, 100],
    [2, 'iPhone 15', 7999, 500],
    [3, 'AirPods Pro', 1899, 1000],
];

foreach ($data as $row) {
    $file->fputcsv($row);
}

// ==================== 使用 SplFileObject 读取 ====================
$file = new SplFileObject('export.csv');
$file->setFlags(
    SplFileObject::READ_CSV |
    SplFileObject::SKIP_EMPTY |
    SplFileObject::READ_AHEAD
);

foreach ($file as $index => $row) {
    if ($index === 0) continue; // 跳过表头
    echo sprintf("商品: %s, 价格: ¥%d\n", $row[1], $row[2]);
}
```

### 高级：使用 League CSV 库（推荐）

[League CSV](https://csv.thephpleague.com/) 是PHP生态中最成熟的CSV处理库：

```bash
composer require league/csv
```

```php
<?php
use League\Csv\Reader;
use League\Csv\Writer;
use League\Csv\CharsetConverter;

// ==================== 读取 ====================
$csv = Reader::createFromPath('users.csv', 'r');
$csv->setHeaderOffset(0);  // 第一行作为表头

// 自动检测编码并转换为UTF-8
$csv->addStreamFilter('convert.iconv.GBK/UTF-8');

// 获取所有记录
$records = $csv->getRecords();
foreach ($records as $record) {
    echo $record['姓名'] . ' - ' . $record['邮箱'] . PHP_EOL;
}

// 使用表达式筛选（类似SQL WHERE）
use League\Csv\QueryConstraint;

$results = (new QueryConstraint())
    ->select(['姓名', '邮箱'])
    ->where('年龄', '>', 25)
    ->process($csv);

// ==================== 写入 ====================
$csv = Writer::createFromPath('output.csv', 'w');
$csv->setOutputBOM(Writer::BOM_UTF8);  // 输出UTF-8 BOM

// 插入表头
$csv->insertOne(['姓名', '邮箱', '年龄']);

// 插入多行
$csv->insertAll([
    ['赵六', 'zhaoliu@example.com', 30],
    ['钱七', 'qianqi@example.com', 27],
]);
```

---

## 大文件CSV处理的最佳实践

当处理几百MB甚至几GB的CSV文件时，内存管理至关重要。

### 1. 流式逐行读取（内存恒定）

```php
<?php
/**
 * 流式读取大型CSV文件
 * 无论文件多大，内存占用始终保持在1MB以下
 */
function readLargeCsv(string $filePath, string $delimiter = ','): Generator
{
    $handle = fopen($filePath, 'r');
    if ($handle === false) {
        throw new RuntimeException("无法打开文件: {$filePath}");
    }

    $headers = null;

    while (($row = fgetcsv($handle, 0, $delimiter)) !== false) {
        if ($headers === null) {
            $headers = $row;
            continue;
        }

        // yield 逐行返回，不会将所有数据加载到内存
        yield array_combine($headers, $row);
    }

    fclose($handle);
}

// 使用方式 — 即使处理100万行也不会爆内存
foreach (readLargeCsv('/data/massive_export.csv') as $record) {
    // 逐条处理
    processRecord($record);
}

echo '当前内存峰值: ' . memory_get_peak_usage(true) / 1024 / 1024 . ' MB';
```

### 2. 分批写入（避免一次性生成巨型数组）

```php
<?php
/**
 * 分批导出大型CSV
 * 每批次处理 N 条记录，及时释放内存
 */
function exportLargeCsv(string $outputPath, callable $dataProvider, int $batchSize = 1000): void
{
    $handle = fopen($outputPath, 'w');
    $headersWritten = false;

    foreach ($dataProvider() as $batch) {
        if (!$headersWritten && !empty($batch)) {
            fputcsv($handle, array_keys($batch[0]));
            $headersWritten = true;
        }

        foreach ($batch as $row) {
            fputcsv($handle, $row);
        }

        // 显式释放当前批次内存
        unset($batch);
        gc_collect_cycles();
    }

    fclose($handle);
}

// 数据提供者：从数据库分批拉取
function dataProvider(): Generator
{
    $page = 0;
    $limit = 1000;

    while (true) {
        $records = DB::table('orders')
            ->offset($page * $limit)
            ->limit($limit)
            ->get()
            ->toArray();

        if (empty($records)) break;

        yield $records;
        $page++;
        unset($records);
    }
}

exportLargeCsv('/exports/orders.csv', dataProvider(...));
```

### 3. 命令行大文件处理

```bash
# 快速查看CSV行数（不加载到内存）
wc -l large_file.csv

# 提取前1000行作为样本
head -n 1000 large_file.csv > sample.csv

# 使用awk进行列提取（比PHP更快）
awk -F',' '{print $1,$3}' large_file.csv > extracted.csv

# 统计唯一值
cut -d',' -f2 large_file.csv | sort | uniq -c | sort -rn

# 替换分隔符（逗号→制表符）
sed 's/,/\t/g' data.csv > data.tsv
```

---

## CSV导入时常见的坑与解决方案

### 1. 编码问题（最常见！）

```php
<?php
/**
 * 处理CSV编码问题
 * Excel导出的CSV通常是GBK编码，而系统多为UTF-8
 */
function detectAndConvertEncoding(string $filePath): string
{
    $content = file_get_contents($filePath);
    $encoding = mb_detect_encoding($content, ['UTF-8', 'GBK', 'GB2312', 'BIG5', 'ISO-8859-1'], true);

    if ($encoding === false || $encoding === 'UTF-8') {
        return $filePath;
    }

    // 转换为UTF-8并写入临时文件
    $utf8Content = mb_convert_encoding($content, 'UTF-8', $encoding);
    $tempPath = tempnam(sys_get_temp_dir(), 'csv_');
    file_put_contents($tempPath, $utf8Content);

    return $tempPath;
}

// 流式转换（适合大文件）
$reader = Reader::createFromPath('gbk_file.csv');
$reader->addStreamFilter('convert.iconv.GBK/UTF-8');
```

### 2. 特殊字符转义

```php
<?php
// 问题：字段中含有逗号、引号、换行符
// 例如：备注字段包含 "用户说：'请，尽快发货'"
// 解决：fputcsv 会自动处理引号转义

$row = [
    '订单号',
    '001',
    '用户说："请，尽快发货"' . "\n" . '谢谢',
];
fputcsv($fp, $row);
// 输出：订单号,001,"用户说：""请，尽快发货""
// 谢谢"

// League CSV 提供更精细的控制
$csv = Writer::createFromString('');
$csv->setEscape('\\');  // 使用反斜杠转义
```

### 3. 大数字科学计数法问题

```php
<?php
// 问题：Excel打开CSV时，长数字被转为科学计数法
// 例如：6222021234567890123 → 6.22202E+18

// 解决方案1：写入时添加制表符前缀（Excel特有技巧）
$fp = fopen('bank_accounts.csv', 'w');
fputcsv($fp, [
    '姓名',
    "\t6222021234567890123",  // \t前缀防止Excel转换
    "\t9876543210123456789",
]);

// 解决方案2：使用="value"公式包裹
fputcsv($fp, [
    '姓名',
    '="6222021234567890123"',  // Excel会将其视为文本
]);

// 解决方案3：使用League CSV的公式格式化
use League\Csv\ExcelFormatter;

// 实际读取时，确保大数字不被PHP精度截断
ini_set('precision', '20');
// 对于超过PHP_FLOAT_DIG精度的数字，使用字符串处理
```

### 4. 空值与NULL处理

```php
<?php
// CSV中空值的几种表示：空字符串、NULL、\N
$row = fgetcsv($fp);

foreach ($row as $index => $value) {
    // 统一空值处理
    if ($value === '' || strtoupper($value) === 'NULL' || $value === '\N') {
        $row[$index] = null;
    }
}

// 写入时确保NULL输出为空
function safePutCsv($fp, array $row): void
{
    $row = array_map(fn($v) => $v === null ? '' : $v, $row);
    fputcsv($fp, $row);
}
```

### 5. 不同平台的换行符差异

```php
<?php
// Windows: \r\n | Unix/Mac: \n | 老Mac: \r
// PHP的fputcsv在不同平台输出不一致

// 解决：统一指定换行符
$csv = Writer::createFromPath('output.csv', 'w');
$csv->setNewline("\r\n");  // 统一使用Windows风格（Excel兼容性最佳）

// 或者读取时自动处理
$csv = Reader::createFromPath('mixed_line_endings.csv');
// League CSV会自动处理各种换行符
```

---

## Laravel 中 CSV 导入导出实战

### 方案一：使用 Maatwebsite/Excel（推荐新手）

这是Laravel生态中最流行的Excel/CSV处理包：

```bash
composer require maatwebsite/excel
```

```php
<?php
// ==================== 导出 ====================
// app/Exports/UsersExport.php
namespace App\Exports;

use App\Models\User;
use Maatwebsite\Excel\Concerns\FromCollection;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\WithMapping;
use Maatwebsite\Excel\Concerns\ShouldAutoSize;
use Maatwebsite\Excel\Concerns\WithChunkReading;

class UsersExport implements FromCollection, WithHeadings, WithMapping, ShouldAutoSize, WithChunkReading
{
    public function collection()
    {
        return User::select('id', 'name', 'email', 'created_at')->get();
    }

    public function headings(): array
    {
        return ['ID', '姓名', '邮箱', '注册时间'];
    }

    public function map($user): array
    {
        return [
            $user->id,
            $user->name,
            $user->email,
            $user->created_at->format('Y-m-d H:i:s'),
        ];
    }

    public function chunkSize(): int
    {
        return 1000;  // 每批1000条，优化内存使用
    }
}

// 控制器调用
use Maatwebsite\Excel\Facades\Excel;
use App\Exports\UsersExport;

public function export()
{
    // 导出为CSV（而非xlsx）
    return Excel::download(new UsersExport, 'users.csv', \Maatwebsite\Excel\Excel::CSV);
    // 也可导出为：XLSX, TSV, ODS, XLS
}

// 队列导出（大数据量推荐）
public function exportQueue()
{
    Excel::queue(new UsersExport, 'users.csv')->store('exports');
    return response()->json(['message' => '导出任务已加入队列']);
}
```

```php
<?php
// ==================== 导入 ====================
// app/Imports/UsersImport.php
namespace App\Imports;

use App\Models\User;
use Maatwebsite\Excel\Concerns\ToModel;
use Maatwebsite\Excel\Concerns\WithHeadingRow;
use Maatwebsite\Excel\Concerns\WithValidation;
use Maatwebsite\Excel\Concerns\WithBatchInserts;
use Maatwebsite\Excel\Concerns\WithChunkReading;

class UsersImport implements ToModel, WithHeadingRow, WithValidation, WithBatchInserts, WithChunkReading
{
    public function model(array $row)
    {
        return new User([
            'name'     => $row['姓名'],
            'email'    => $row['邮箱'],
            'password' => bcrypt('default_password'),
        ]);
    }

    public function rules(): array
    {
        return [
            '姓名' => 'required|string|max:50',
            '邮箱' => 'required|email|unique:users,email',
        ];
    }

    public function batchSize(): int
    {
        return 500;
    }

    public function chunkSize(): int
    {
        return 500;
    }
}

// 控制器调用
public function import(Request $request)
{
    $request->validate([
        'file' => 'required|mimes:csv,txt|max:10240',  // 最大10MB
    ]);

    try {
        Excel::import(new UsersImport, $request->file('file'));
        return back()->with('success', '导入成功！');
    } catch (\Maatwebsite\Excel\Validators\ValidationException $e) {
        $failures = $e->failures();
        return back()->with('errors', $failures);
    }
}
```

### 方案二：使用 League CSV + Laravel（推荐高级用户）

```php
<?php
namespace App\Services;

use League\Csv\Reader;
use League\Csv\Writer;
use League\Csv\Statement;
use Illuminate\Support\Facades\DB;

class CsvService
{
    /**
     * 流式导入大型CSV到数据库（内存友好）
     */
    public function importToDatabase(string $filePath, string $table, array $columnMap): int
    {
        $csv = Reader::createFromPath($filePath, 'r');
        $csv->setHeaderOffset(0);

        // 处理GBK编码
        if ($this->isGbk($filePath)) {
            $csv->addStreamFilter('convert.iconv.GBK/UTF-8');
        }

        $count = 0;
        $batch = [];
        $batchSize = 500;

        foreach ($csv->getRecords() as $record) {
            $row = [];
            foreach ($columnMap as $csvColumn => $dbColumn) {
                $row[$dbColumn] = $record[$csvColumn] ?? null;
            }
            $row['created_at'] = now();
            $row['updated_at'] = now();

            $batch[] = $row;

            if (count($batch) >= $batchSize) {
                DB::table($table)->insert($batch);
                $count += count($batch);
                $batch = [];
            }
        }

        // 处理剩余记录
        if (!empty($batch)) {
            DB::table($table)->insert($batch);
            $count += count($batch);
        }

        return $count;
    }

    /**
     * 从数据库导出大型CSV（流式写入）
     */
    public function exportFromDatabase(string $table, array $columns, string $outputPath): int
    {
        $csv = Writer::createFromPath($outputPath, 'w');
        $csv->setOutputBOM(Writer::BOM_UTF8);
        $csv->setNewline("\r\n");

        // 写入表头
        $csv->insertOne(array_values($columns));

        $count = 0;
        $chunkSize = 1000;
        $offset = 0;

        while (true) {
            $rows = DB::table($table)
                ->select(array_keys($columns))
                ->offset($offset)
                ->limit($chunkSize)
                ->get();

            if ($rows->isEmpty()) break;

            $csv->insertAll($rows->map(fn($row) => (array)$row)->toArray());
            $count += $rows->count();
            $offset += $chunkSize;

            unset($rows);
            gc_collect_cycles();
        }

        return $count;
    }

    private function isGbk(string $filePath): bool
    {
        $sample = file_get_contents($filePath, false, null, 0, 8192);
        return !mb_check_encoding($sample, 'UTF-8');
    }
}
```

### 完整的导入导出路由示例

```php
<?php
// routes/web.php
Route::middleware('auth')->group(function () {
    Route::get('/users/export', [UserController::class, 'export'])->name('users.export');
    Route::post('/users/import', [UserController::class, 'import'])->name('users.import');
});

// 控制器
class UserController extends Controller
{
    public function export()
    {
        $csvService = app(CsvService::class);
        $tempFile = storage_path('app/exports/users_' . now()->format('YmdHis') . '.csv');

        $columns = [
            'id' => 'ID',
            'name' => '姓名',
            'email' => '邮箱',
            'created_at' => '注册时间',
        ];

        $count = $csvService->exportFromDatabase('users', $columns, $tempFile);

        return response()->download($tempFile, '用户数据.csv', [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="users.csv"',
        ])->deleteFileAfterSend(true);
    }

    public function import(Request $request)
    {
        $request->validate(['file' => 'required|file|mimes:csv,txt|max:51200']);

        $file = $request->file('file');
        $tempPath = $file->storeAs('imports', 'import_' . time() . '.csv');

        $csvService = app(CsvService::class);
        $count = $csvService->importToDatabase(
            storage_path('app/' . $tempPath),
            'users',
            ['姓名' => 'name', '邮箱' => 'email']
        );

        return back()->with('success', "成功导入 {$count} 条记录");
    }
}
```

---

## CSV 在数据分析与ETL场景中的应用

### ETL 流水线中的角色

CSV在ETL（Extract-Transform-Load）流程中扮演着核心角色：

```
┌─────────────┐    CSV     ┌─────────────┐    CSV     ┌─────────────┐
│  数据源      │ ────────→ │  处理引擎     │ ────────→ │  目标存储    │
│  (数据库/API) │  Extract  │  (Spark/PHP)  │ Transform │ (DW/ES/DB)  │
└─────────────┘           └─────────────┘           └─────────────┘
       │                        │                         │
  导出为CSV中间格式         读取→清洗→转换            再导出为CSV
  便于跨系统传输           写入清洗后的CSV           供下游消费
```

**为什么ETL偏爱CSV：**

1. **跨系统兼容性**：几乎所有数据工具（Python Pandas、R、Spark、Hadoop、Tableau）都原生支持CSV
2. **性能优势**：相比JSON/XML，CSV的解析速度快3-10倍
3. **压缩友好**：CSV文本高度可压缩，gzip压缩比通常在5:1到10:1
4. **可拆分性**：并行处理时可按行拆分文件，充分利用多核CPU

### 实际ETL示例：PHP数据清洗管道

```php
<?php
/**
 * CSV数据清洗ETL管道
 * 场景：从多个系统导出CSV → 清洗合并 → 加载到数据仓库
 */
class CsvETLPipeline
{
    private array $transforms = [];

    public function addTransform(callable $fn): self
    {
        $this->transforms[] = $fn;
        return $this;
    }

    public function process(string $inputPath, string $outputPath): int
    {
        $reader = Reader::createFromPath($inputPath, 'r');
        $reader->setHeaderOffset(0);

        $writer = Writer::createFromPath($outputPath, 'w');
        $writer->setNewline("\r\n");

        // 获取清洗后的表头
        $headers = $reader->getHeader();
        $writer->insertOne($headers);

        $processed = 0;
        $skipped = 0;

        foreach ($reader->getRecords() as $record) {
            // 应用所有转换管道
            foreach ($this->transforms as $transform) {
                $record = $transform($record);
                if ($record === null) {
                    $skipped++;
                    continue 2;  // 跳过此记录
                }
            }

            $writer->insertOne($record);
            $processed++;
        }

        return $processed;
    }
}

// 使用
$pipeline = new CsvETLPipeline();

// 转换1：去除空白
$pipeline->addTransform(function ($row) {
    return array_map(fn($v) => is_string($v) ? trim($v) : $v, $row);
});

// 转换2：标准化手机号
$pipeline->addTransform(function ($row) {
    if (isset($row['phone'])) {
        $row['phone'] = preg_replace('/[^0-9]/', '', $row['phone']);
        if (strlen($row['phone']) !== 11) return null;  // 过滤无效号码
    }
    return $row;
});

// 转换3：日期格式统一
$pipeline->addTransform(function ($row) {
    if (isset($row['date'])) {
        $row['date'] = date('Y-m-d', strtotime($row['date']));
    }
    return $row;
});

$processed = $pipeline->process('/data/raw/customers.csv', '/data/clean/customers.csv');
echo "处理完成：{$processed} 条有效记录";
```

### 与数据分析工具的集成

```python
# Python Pandas 读取PHP导出的CSV
import pandas as pd

df = pd.read_csv('export.csv', encoding='utf-8-sig')
print(df.describe())

# Spark 读取CSV
from pyspark.sql import SparkSession
spark = SparkSession.builder.appName("CSVAnalysis").getOrCreate()
df = spark.read.csv("hdfs:///data/large_export.csv", header=True, inferSchema=True)
df.groupBy("category").count().show()
```

---

## 总结

| 场景 | 推荐格式 | 原因 |
|------|---------|------|
| 系统间数据交换 | **CSV** | 轻量、兼容、性能最优 |
| Web API 通信 | JSON | 结构化、JavaScript原生支持 |
| 文档/配置交换 | XML | 严格schema验证 |
| 用户可视化报表 | Excel | 丰富的格式和图表支持 |
| 大数据ETL | **CSV** | 流式处理、可拆分、压缩友好 |

CSV格式虽然简单，但正是这种简单成就了它的普适性。在数据导入导出的场景中，CSV始终是最务实、最高效的选择。

---

## 相关阅读

- [Swift并发模型对比](/categories/Misc/Swift-Structured-Concurrency-async-await-TaskGroup-Actor-PHP-Fibers-Go-goroutine/) — 深入对比 Swift Structured Concurrency、PHP Fibers 与 Go goroutine 的并发模型
- [Rust错误处理对比](/categories/Misc/Rust-错误处理哲学-Result-Option-thiserror-anyhow-对比PHP-Exception与Go-error的设计权衡/) — Result/Option 与 PHP Exception、Go error 的设计哲学差异
- [Web3集成实战](/categories/Misc/Web3-集成实战-ethers-js-web3-php-钱包连接与智能合约交互-Laravel-DApp-后端的签名验证与事件监听/) — 使用 ethers.js 与 web3-php 构建 DApp 后端的完整实战
