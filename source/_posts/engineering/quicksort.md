---

title: 快速排序算法详解：分治思想与 PHP/Go/JS 实现
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
tags:
- 算法
- 排序
- PHP
- 数据结构
- quicksort
- 分治法
categories:
  - engineering
  - algorithms
keywords: [PHP, Go, JS, 快速排序算法详解, 分治思想与, 实现]
date: 2020-03-20 15:05:07
description: 快速排序（Quicksort）是基于分治法的经典排序算法，通过选择基准元素将数组划分为两部分递归排序。本文深入分析快速排序的算法复杂度（最好O(n log n)、平均O(n log n)、最坏O(n²)），提供原地排序、三路快排的PHP实现代码，对比归并排序与堆排序的性能差异，并介绍PHP内置sort()函数的实现原理及常见踩坑案例。
---



## 什么是快速排序

快速排序（Quicksort）是一种基于**分治法**（Divide and Conquer）的高效排序算法，由 C.A.R. Hoare 于 1960 年提出。其核心思想是：

1. **选择基准（Pivot）**：从数组中选取一个元素作为"基准"。
2. **分区（Partition）**：将数组重新排列，使得所有小于基准的元素位于其左侧，所有大于等于基准的元素位于其右侧。此时基准元素恰好处于排序后的最终位置。
3. **递归排序**：对基准左侧和右侧的子数组分别递归执行上述过程，直到子数组长度为 0 或 1。

这三个步骤构成了快速排序的完整框架。下面先通过一个图解来直观理解分区过程。

## 分区过程图解

以数组 `[6, 3, 8, 1, 5, 9, 2, 7]` 为例，选择最后一个元素 `7` 作为基准（pivot），使用 Lomuto 分区方案：

**初始状态：**

```
数组: [6, 3, 8, 1, 5, 9, 2, 7]
                                  ↑ pivot = 7
      i                          j
```

指针 `i` 标记"小于 pivot 区域"的右边界，`j` 从左到右扫描。

---

**第 1 步：j=0，arr[0]=6 ≤ 7？✅ 是**

交换 `arr[i]` 和 `arr[j]`（这里 i==j，无实际变化），`i++`：

```
数组: [6, 3, 8, 1, 5, 9, 2, 7]
      i→                        j
         ↑ i 移到位置 1
```

**第 2 步：j=1，arr[1]=3 ≤ 7？✅ 是**

交换 `arr[i]` 和 `arr[j]`（i==j），`i++`：

```
数组: [6, 3, 8, 1, 5, 9, 2, 7]
         i→                     j
            ↑ i 移到位置 2
```

**第 3 步：j=2，arr[2]=8 ≤ 7？❌ 否**

不交换，`i` 不动，`j` 继续前进：

```
数组: [6, 3, 8, 1, 5, 9, 2, 7]
         i                       j
```

**第 4 步：j=3，arr[3]=1 ≤ 7？✅ 是**

交换 `arr[i]=8` 和 `arr[j]=1`，`i++`：

```
数组: [6, 3, 1, 8, 5, 9, 2, 7]
            i→                  j
               ↑ i 移到位置 3
```

**第 5 步：j=4，arr[4]=5 ≤ 7？✅ 是**

交换 `arr[i]=8` 和 `arr[j]=5`，`i++`：

```
数组: [6, 3, 1, 5, 8, 9, 2, 7]
               i→               j
                  ↑ i 移到位置 4
```

**第 6 步：j=5，arr[5]=9 ≤ 7？❌ 否**

不交换：

```
数组: [6, 3, 1, 5, 8, 9, 2, 7]
               i                j
```

**第 7 步：j=6，arr[6]=2 ≤ 7？✅ 是**

交换 `arr[i]=8` 和 `arr[j]=2`，`i++`：

```
数组: [6, 3, 1, 5, 2, 9, 8, 7]
                  i→            j (扫描结束)
                     ↑ i 移到位置 5
```

**最终：将 pivot `7` 与 `arr[i]` 交换：**

```
数组: [6, 3, 1, 5, 2, 7, 8, 9]
                     ↑ 基准归位
      ├──────────┤   │  ├────┤
       < pivot    pivot  > pivot
```

一趟分区后，`7` 已经处于最终排序位置。左侧 `[6, 3, 1, 5, 2]` 均 ≤ 7，右侧 `[8, 9]` 均 > 7。接下来对左右两部分递归执行相同操作。

## 基准选择策略

基准的选择直接影响快速排序的性能。不同的选择策略在不同数据分布下表现差异很大：

### 策略一：选第一个元素

最简单的策略，但对已排序或接近有序的数组表现极差：

```php
// 基准 = $arr[$left]
$pivot = $arr[$left];
```

- ✅ 实现最简单
- ❌ 已排序数组直接退化为 O(n²)
- ❌ 逆序数组同样退化

### 策略二：选最后一个元素

Lomuto 分区方案的默认做法，与选第一个元素有相同缺陷：

```php
// 基准 = $arr[$right]
$pivot = $arr[$right];
```

- ✅ 实现简单，Lomuto 分区天然适配
- ❌ 已排序数组同样退化为 O(n²)

### 策略三：随机选择

通过随机选取基准来避免特定输入导致的退化：

```php
function random_pivot(&$arr, $left, $right)
{
    $randIndex = rand($left, $right);
    // 将随机选中的元素交换到 right 位置，再用标准分区
    [$arr[$randIndex], $arr[$right]] = [$arr[$right], $arr[$randIndex]];
    return $arr[$right];
}
```

- ✅ 期望时间复杂度始终为 O(n log n)，与输入顺序无关
- ✅ 对抗恶意构造的测试数据（如 OJ 平台的卡快排数据）
- ⚠️ `rand()` 调用有一定开销；极端情况下仍有小概率退化

### 策略四：三数取中（Median-of-Three）

取首、中、尾三个元素的中位数作为基准，是最常用的优化策略：

```php
function median_of_three_pivot(&$arr, $left, $right)
{
    $mid = intdiv($left + $right, 2);

    // 对三个位置排序，使 arr[$left] <= arr[$mid] <= arr[$right]
    if ($arr[$left] > $arr[$mid]) {
        [$arr[$left], $arr[$mid]] = [$arr[$mid], $arr[$left]];
    }
    if ($arr[$left] > $arr[$right]) {
        [$arr[$left], $arr[$right]] = [$arr[$right], $arr[$left]];
    }
    if ($arr[$mid] > $arr[$right]) {
        [$arr[$mid], $arr[$right]] = [$arr[$right], $arr[$mid]];
    }

    // 将中值交换到 right-1 位置（便于分区）
    [$arr[$mid], $arr[$right]] = [$arr[$right], $arr[$mid]];
    return $arr[$right];
}
```

- ✅ 对有序、逆序、大部分有序的数组都有良好表现
- ✅ PHP 内置 `sort()` 就采用此策略
- ✅ 额外开销极小（只需两次整数比较和最多三次交换）
- ⚠️ 三个元素相同时可能退化（可结合随机打破平局）

> 💡 **实践建议**：绝大多数场景使用**三数取中**即可。如果你的代码需要对抗恶意输入（如在线评测平台），则使用**随机选择**。

## 基本实现

```php
$arr = [1, 43, 54, 62, 21, 66, 32, 78, 36, 76, 39];

function quick_sort($arr)
{
  $len = count($arr);
  // 先判断是否需要继续进行
  if($len <= 1) {
    
    return $arr;
  }
  
  // 选择第一个元素作为基准
  $baseNum = $arr[0];
  // 遍历除了标尺外的所有元素，按照大小关系放入两个数组内
  // 初始化比基准值小和大的俩个数组:
  $leftArray = $rightArray = [];
  // 开始从第二个值开始比较
  for ($i = 1; $i < $len; $i++) {
    if ($baseNum > $arr[$i]) {
      // 放入左边数组
      $leftArray[]  = $arr[$i];
    } else {
      // 放入右边
      $rightArray[] = $arr[$i];
    }
  }
  
  // 再分别对左边和右边的数组进行相同的排序处理方式递归调用这个函数
  $leftArray  = quick_sort($leftArray);
  $rightArray = quick_sort($rightArray);
  
  // 合并返回结果
  return array_merge($leftArray, [$baseNum], $rightArray);
}
```

> ⚠️ **注意**：上面的基本实现会创建额外的数组空间（非原地排序），空间复杂度为 O(n)。在处理大规模数据时，推荐使用下面的**原地快速排序**。

## 多语言实现

快速排序的核心思想与语言无关，下面展示 JavaScript 和 Go 的原地排序实现，方便不同技术栈的开发者参考。

### JavaScript 实现

```javascript
/**
 * 原地快速排序（Lomuto 分区方案）
 * @param {number[]} arr - 待排序数组
 * @param {number} left - 左边界
 * @param {number} right - 右边界
 */
function quickSort(arr, left = 0, right = arr.length - 1) {
  if (left >= right) return;

  // 三数取中法选择基准
  const mid = left + ((right - left) >> 1);
  if (arr[left] > arr[mid]) [arr[left], arr[mid]] = [arr[mid], arr[left]];
  if (arr[left] > arr[right]) [arr[left], arr[right]] = [arr[right], arr[left]];
  if (arr[mid] > arr[right]) [arr[mid], arr[right]] = [arr[right], arr[mid]];
  // 将中值放到 right-1 位置
  [arr[mid], arr[right]] = [arr[right], arr[mid]];

  const pivot = arr[right];
  let i = left;

  for (let j = left; j < right; j++) {
    if (arr[j] <= pivot) {
      [arr[i], arr[j]] = [arr[j], arr[i]];
      i++;
    }
  }

  [arr[i], arr[right]] = [arr[right], arr[i]];

  quickSort(arr, left, i - 1);
  quickSort(arr, i + 1, right);
}

// 使用示例
const arr = [38, 27, 43, 3, 9, 82, 10];
quickSort(arr);
console.log(arr); // [3, 9, 10, 27, 38, 43, 82]
```

> 💡 JavaScript 中也可以直接使用 `arr.sort((a, b) => a - b)`，现代引擎（V8/SpiderMonkey）内部使用的是 **TimSort**（归并排序 + 插入排序的混合算法），在大多数场景下性能优秀。

### Go 实现

```go
package main

import "fmt"

// quickSort 原地快速排序（Hoare 分区方案）
func quickSort(arr []int, left, right int) {
	if left >= right {
		return
	}

	pivotIndex := partition(arr, left, right)
	quickSort(arr, left, pivotIndex)
	quickSort(arr, pivotIndex+1, right)
}

func partition(arr []int, left, right int) int {
	pivot := arr[(left+right)/2]
	i, j := left-1, right+1

	for {
		// 从左找到 >= pivot 的元素
		for {
			i++
			if arr[i] >= pivot {
				break
			}
		}
		// 从右找到 <= pivot 的元素
		for {
			j--
			if arr[j] <= pivot {
				break
			}
		}

		if i >= j {
			return j
		}
		arr[i], arr[j] = arr[j], arr[i]
	}
}

func main() {
	arr := []int{38, 27, 43, 3, 9, 82, 10}
	quickSort(arr, 0, len(arr)-1)
	fmt.Println(arr) // [3 9 10 27 38 43 82]
}
```

> 💡 Go 标准库 `sort.Slice()` 内部使用的是 **pdqsort**（Pattern-Defeating Quicksort），由 Orson Peters 提出，是一种结合了快排、堆排和插入排序优势的混合算法，在各种数据分布下都能保持良好性能。

## 算法复杂度分析

| 情况 | 时间复杂度 | 说明 |
|------|-----------|------|
| **最好情况** | O(n log n) | 每次划分都能将数组均分为两个大小相近的子数组 |
| **平均情况** | O(n log n) | 随机输入下的期望复杂度 |
| **最坏情况** | O(n²) | 每次选中的基准都是最大或最小元素（如已排序数组） |
| **空间复杂度** | O(log n) ~ O(n) | 原地版本取决于递归深度，最坏为 O(n) |

快速排序的平均性能在所有 O(n log n) 排序算法中表现最优，因为它的内部循环可以在大多数架构上被高效实现，且对缓存（cache）的利用效率极高。

### 为什么平均是 O(n log n)？

每层递归需要 O(n) 的时间来遍历和划分元素，而递归树的平均深度为 log n。因此总时间为 O(n) × O(log n) = O(n log n)。

更严格地说，快速排序的平均比较次数满足以下递推关系：

```
T(n) = T(i) + T(n - i - 1) + (n - 1)
```

其中 `i` 是基准在分区后的位置。对所有可能的 `i` 取平均值，可以推导出：

```
T(n) = 2n·ln(n) ≈ 1.39n·log₂(n)
```

这意味着快速排序的平均比较次数约为 **1.39 n log₂ n**，比归并排序的 n log₂ n 多约 39%。但由于快排的内部循环更紧凑（缓存命中率高、交换操作少），实际运行速度通常更快。

### 为什么最坏是 O(n²)？

当每次选中的基准恰好是最大或最小元素时，分区极不均衡：一侧有 n-1 个元素，另一侧有 0 个。递推关系变为：

```
T(n) = T(n-1) + T(0) + (n-1) = T(n-1) + (n-1)
```

展开后：

```
T(n) = (n-1) + (n-2) + ... + 1 + 0 = n(n-1)/2 = O(n²)
```

这也解释了为什么基准选择策略至关重要——选好基准就能保证分区尽量均衡，避免退化。

## 原地快速排序（In-Place Quicksort）

上面的基本实现每次递归都会创建新数组，在实际生产环境中通常使用原地排序版本，不需要额外的数组空间。原地快排有两种经典分区方案：**Lomuto 分区**和 **Hoare 分区**。

### Lomuto 分区方案

由 Nico Lomuto 提出，以最后一个元素为基准，使用单指针 `i` 标记小于 pivot 区域的边界：

```php
function quick_sort_inplace(&$arr, $left = 0, $right = null)
{
  if ($right === null) {
    $right = count($arr) - 1;
  }
  
  if ($left >= $right) {
    return;
  }
  
  // 使用 Lomuto 分区方案
  $pivot = $arr[$right]; // 选择最后一个元素作为基准
  $i = $left;
  
  for ($j = $left; $j < $right; $j++) {
    if ($arr[$j] <= $pivot) {
      // 交换
      [$arr[$i], $arr[$j]] = [$arr[$j], $arr[$i]];
      $i++;
    }
  }
  
  // 将基准放到正确位置
  [$arr[$i], $arr[$right]] = [$arr[$right], $arr[$i]];
  
  // 递归排序左右两部分
  quick_sort_inplace($arr, $left, $i - 1);
  quick_sort_inplace($arr, $i + 1, $right);
}

// 使用示例
$arr = [3, 6, 8, 10, 1, 2, 1];
quick_sort_inplace($arr);
print_r($arr); // [1, 1, 2, 3, 6, 8, 10]
```

- ✅ 实现简洁，易于理解
- ✅ 与三路快排配合良好
- ⚠️ 对全部相同元素的数组，分区不均（所有元素归入左侧），退化为 O(n²)

### Hoare 分区方案

由 C.A.R. Hoare 提出，使用双指针从两端向中间扫描，交换次数更少：

```php
function quick_sort_hoare(&$arr, $left = 0, $right = null)
{
    if ($right === null) {
        $right = count($arr) - 1;
    }

    if ($left >= $right) {
        return;
    }

    $pivotIndex = hoare_partition($arr, $left, $right);
    quick_sort_hoare($arr, $left, $pivotIndex);
    quick_sort_hoare($arr, $pivotIndex + 1, $right);
}

function hoare_partition(&$arr, $left, $right)
{
    $pivot = $arr[intdiv($left + $right, 2)]; // 选中间元素为基准
    $i = $left - 1;
    $j = $right + 1;

    while (true) {
        // 从左找到 >= pivot 的元素
        do { $i++; } while ($arr[$i] < $pivot);
        // 从右找到 <= pivot 的元素
        do { $j--; } while ($arr[$j] > $pivot);

        if ($i >= $j) {
            return $j;
        }

        [$arr[$i], $arr[$j]] = [$arr[$j], $arr[$i]];
    }
}

// 使用示例
$arr = [8, 3, 1, 7, 0, 10, 2];
quick_sort_hoare($arr);
print_r($arr); // [0, 1, 2, 3, 7, 8, 10]
```

**两种分区方案对比：**

| 对比项 | Lomuto 分区 | Hoare 分区 |
|--------|------------|------------|
| **指针方向** | 单向（左→右） | 双向（两端→中间） |
| **交换次数** | 较多（每次 ≤ pivot 都交换） | 较少（只在两端不对称时交换） |
| **代码复杂度** | 简单 | 稍复杂（do-while 循环） |
| **性能** | 略慢 | 通常快 ~3 倍 |
| **三路快排兼容** | ✅ 友好 | ❌ 较难扩展 |
| **返回值含义** | 基准的最终位置 | 分界点（基准可能不在最终位置） |

> 💡 **实践建议**：如果需要三路快排或代码简洁性，选 Lomuto；如果追求纯二路分区的性能，选 Hoare。

## 迭代快速排序（Iterative Quicksort）

前面的实现都依赖递归，当数据规模很大且分区不均时，递归深度可能超出 PHP 的限制。迭代快排使用**显式栈（Stack）**来模拟递归调用，彻底避免递归深度问题：

```php
function quick_sort_iterative(&$arr)
{
    $n = count($arr);
    if ($n <= 1) {
        return;
    }

    // 使用数组模拟栈，存储待排序区间的左右边界
    $stack = [0, $n - 1]; // 压入初始区间

    while (!empty($stack)) {
        // 弹出区间
        $right = array_pop($stack);
        $left  = array_pop($stack);

        if ($left >= $right) {
            continue;
        }

        // Lomuto 分区
        $pivot = $arr[$right];
        $i = $left;
        for ($j = $left; $j < $right; $j++) {
            if ($arr[$j] <= $pivot) {
                [$arr[$i], $arr[$j]] = [$arr[$j], $arr[$i]];
                $i++;
            }
        }
        [$arr[$i], $arr[$right]] = [$arr[$right], $arr[$i]];
        $pivotIndex = $i;

        // 将右半部分先压栈（先处理左半部分 → 小栈深度）
        if ($pivotIndex + 1 < $right) {
            $stack[] = $pivotIndex + 1;
            $stack[] = $right;
        }
        // 将左半部分压栈
        if ($left < $pivotIndex - 1) {
            $stack[] = $left;
            $stack[] = $pivotIndex - 1;
        }
    }
}

// 使用示例
$arr = [38, 27, 43, 3, 9, 82, 10];
quick_sort_iterative($arr);
print_r($arr); // [3, 9, 10, 27, 38, 43, 82]
```

**迭代版 vs 递归版对比：**

| 对比项 | 递归版本 | 迭代版本 |
|--------|---------|---------|
| **空间** | O(log n) ~ O(n)（调用栈） | O(log n) ~ O(n)（显式栈） |
| **栈溢出风险** | 有（PHP 默认递归限制 ~256） | 无（栈在堆内存中） |
| **代码复杂度** | 简洁直观 | 稍复杂 |
| **可调试性** | 较难（调用栈深） | 较易（可观察栈内容） |

> 💡 迭代版的空间复杂度理论上相同，但 PHP 的调用栈深度有硬性限制，而堆内存中的数组没有此限制。处理超大规模数据时，迭代版更加稳健。

## 三路快速排序（3-Way Quicksort）

当数组中存在**大量重复元素**时，标准快速排序的效率会严重下降。三路快排将数组分为三部分：小于基准、等于基准、大于基准，从而跳过相等元素的重复比较。

### Dutch National Flag 问题

三路快排的思想来源于 Edsger Dijkstra 提出的**荷兰国旗问题（Dutch National Flag Problem）**：给定一个包含三种颜色的数组，将其排序使得相同颜色的元素相邻。在快排中，这三种"颜色"对应"小于、等于、大于基准"。

为什么这很重要？考虑一个极端例子：数组中所有元素都相同。标准二路快排的 Lomuto 分区会将所有元素归入左侧，递归深度为 O(n)，而三路快排在第一次分区后就能确定所有元素的位置，直接跳过它们。

### PHP 实现

```php
function quick_sort_3way(&$arr, $left = 0, $right = null)
{
  if ($right === null) {
    $right = count($arr) - 1;
  }
  
  if ($left >= $right) {
    return;
  }
  
  // 三路分区
  $pivot = $arr[$left];
  $lt = $left;     // arr[left..lt-1] < pivot
  $gt = $right;    // arr[gt+1..right] > pivot
  $i = $left + 1;  // arr[lt..i-1] == pivot
  
  while ($i <= $gt) {
    if ($arr[$i] < $pivot) {
      [$arr[$lt], $arr[$i]] = [$arr[$i], $arr[$lt]];
      $lt++;
      $i++;
    } elseif ($arr[$i] > $pivot) {
      [$arr[$i], $arr[$gt]] = [$arr[$gt], $arr[$i]];
      $gt--;
    } else {
      $i++;
    }
  }
  
  // 递归排序小于和大于基准的部分
  // 注意：等于基准的部分已经就位，不需要再排序！
  quick_sort_3way($arr, $left, $lt - 1);
  quick_sort_3way($arr, $gt + 1, $right);
}

// 测试：大量重复元素
$arr = [4, 9, 4, 4, 1, 9, 4, 4, 9, 4, 4, 1, 4];
quick_sort_3way($arr);
print_r($arr); // [1, 1, 4, 4, 4, 4, 4, 4, 4, 4, 9, 9, 9]
```

### 三路分区过程图解

以数组 `[4, 9, 4, 4, 1, 9]` 为例，`pivot = 4`：

```
初始: [4, 9, 4, 4, 1, 9]
       ↑ pivot=4
       lt
       i                gt

分区区域：arr[lt..i-1] == pivot, arr[left..lt-1] < pivot, arr[gt+1..right] > pivot
```

**i=1：arr[1]=9 > 4** → 与 arr[gt] 交换，`gt--`：
```
[4, 9, 4, 4, 1, 9]  →  [4, 9, 4, 4, 1, 9]  (gt 位置的 9 没变)
 lt i              gt    lt i          gt
```

**i=1：arr[1]=9 > 4** → 与 arr[gt] 交换，`gt--`：
```
[4, 9, 4, 4, 1, 9]  →  [4, 1, 4, 4, 9, 9]
 lt i          gt        lt i       gt
```

**i=1：arr[1]=1 < 4** → 与 arr[lt] 交换，`lt++, i++`：
```
[4, 1, 4, 4, 9, 9]  →  [1, 4, 4, 4, 9, 9]
 lt i       gt            lt i      gt
```

**i=2：arr[2]=4 == 4** → `i++`：
```
[1, 4, 4, 4, 9, 9]
    lt i      gt
```

**i=3：arr[3]=4 == 4** → `i++`：
```
[1, 4, 4, 4, 9, 9]
    lt   i   gt
```

**i > gt → 分区结束！**

```
结果: [1, 4, 4, 4, 9, 9]
      ├──┤  ├──┤  ├──┤
      < 4   == 4   > 4
```

等于 pivot 的 `[4, 4, 4]` 已经就位，只需递归处理 `[1]` 和 `[9, 9]`。

三路快排对于全部相同的元素数组能达到 **O(n)** 的时间复杂度，因为相等元素在一次分区后就不再参与后续递归。

## 快速排序 vs 归并排序 vs 堆排序

| 特性 | 快速排序 | 归并排序 | 堆排序 |
|------|---------|---------|--------|
| **平均时间复杂度** | O(n log n) | O(n log n) | O(n log n) |
| **最坏时间复杂度** | O(n²) | O(n log n) | O(n log n) |
| **最好时间复杂度** | O(n log n) | O(n log n) | O(n log n) |
| **空间复杂度** | O(log n) | O(n) | O(1) |
| **是否稳定** | ❌ 不稳定 | ✅ 稳定 | ❌ 不稳定 |
| **是否原地排序** | ✅ 是 | ❌ 否 | ✅ 是 |
| **缓存友好性** | ⭐⭐⭐ 优秀 | ⭐⭐ 良好 | ⭐ 较差 |
| **实际速度** | 通常最快 | 稳定且可预测 | 稍慢 |
| **适用场景** | 通用排序 | 需要稳定排序、链表排序 | 内存受限、需要保证最坏情况 |

### 如何选择？

- **大多数场景**：选择快速排序。它的实际运行速度通常最快，缓存命中率高。
- **需要稳定排序**：选择归并排序（PHP 的 `usort()` 在某些实现中可能使用归并排序）。
- **内存受限**：选择堆排序，它只需要 O(1) 的额外空间。
- **数据有大量重复**：使用三路快速排序。
- **链表排序**：归并排序更合适（快排的随机访问优势在链表上消失）。
- **外部排序（数据在磁盘上）**：归并排序的顺序访问模式更适合。

## 常见踩坑案例

### 1. 已排序数组导致退化

**问题描述**：当数组已经有序（升序或降序），选择第一个或最后一个元素作为基准时，每次分区只能减少一个元素，导致时间复杂度退化为 O(n²)。

```php
// 最坏情况示例
$arr = range(1, 10000); // 已排序数组
// 如果用 $arr[0] 或 $arr[$right] 作为基准，递归深度为 n
// quick_sort_inplace($arr); // 可能导致栈溢出！
```

**解决方案**：使用**随机基准**或**三数取中法**（Median-of-Three）：

```php
function median_of_three(&$arr, $left, $right)
{
  $mid = intdiv($left + $right, 2);
  
  // 将 left、mid、right 三个位置的值排序
  if ($arr[$left] > $arr[$mid]) {
    [$arr[$left], $arr[$mid]] = [$arr[$mid], $arr[$left]];
  }
  if ($arr[$left] > $arr[$right]) {
    [$arr[$left], $arr[$right]] = [$arr[$right], $arr[$left]];
  }
  if ($arr[$mid] > $arr[$right]) {
    [$arr[$mid], $arr[$right]] = [$arr[$right], $arr[$mid]];
  }
  
  // 将中值放到 right-1 的位置作为基准
  return $arr[$mid];
}
```

### 2. 递归深度限制

**问题描述**：PHP 默认的递归深度限制约为 100~256 层（取决于 Xdebug 等扩展的配置）。当数据规模较大且分区不均时，可能触发 `Maximum function nesting level of '256' reached` 错误。

**解决方案**：

```php
// 方案一：对较小的子数组使用递归，对较大的子数组使用迭代（尾递归优化）
function quick_sort_tail(&$arr, $left = 0, $right = null)
{
  if ($right === null) {
    $right = count($arr) - 1;
  }
  
  while ($left < $right) {
    $pivotIndex = partition($arr, $left, $right);
    
    // 递归排序较小的分区，迭代处理较大的分区
    if ($pivotIndex - $left < $right - $pivotIndex) {
      quick_sort_tail($arr, $left, $pivotIndex - 1);
      $left = $pivotIndex + 1; // 迭代处理右半部分
    } else {
      quick_sort_tail($arr, $pivotIndex + 1, $right);
      $right = $pivotIndex - 1; // 迭代处理左半部分
    }
  }
}

function partition(&$arr, $left, $right)
{
  $pivot = $arr[$right];
  $i = $left;
  
  for ($j = $left; $j < $right; $j++) {
    if ($arr[$j] <= $pivot) {
      [$arr[$i], $arr[$j]] = [$arr[$j], $arr[$i]];
      $i++;
    }
  }
  
  [$arr[$i], $arr[$right]] = [$arr[$right], $arr[$i]];
  return $i;
}

// 方案二：对于超大规模数据，改用堆排序或归并排序
// 方案三：增大 PHP 的递归限制（治标不治本）
ini_set('xdebug.max_nesting_level', 10000);
```

### 3. 基准选择不当导致空间浪费

**问题描述**：在基本实现中，创建大量临时数组会导致内存占用剧增。

**解决方案**：始终使用原地快速排序，避免创建额外数组。

## PHP 内置 `sort()` 函数的实现原理

你可能会好奇：PHP 自带的 `sort()` 和我们手写的快速排序相比，哪个更快？

答案是：**PHP 内置 `sort()` 几乎总是更快**。

### 实现细节

PHP 的 `sort()` 函数底层使用的是 C 语言实现的**改进版快速排序**，具体来说：

1. **算法选择**：PHP 7 及以后版本的 `sort()` 内部使用的是**混合排序算法**：
   - 对于小数组（通常 ≤ 16 个元素），使用**插入排序**（Insertion Sort），因为插入排序在小规模数据上由于常数因子小，实际速度更快。
   - 对于大规模数组，使用**快速排序**。
   - 这种策略类似于 C++ 标准库中 `std::sort` 的实现。

2. **优化措施**：
   - **三数取中法**选择基准，避免最坏情况
   - **小数组切换**到插入排序
   - **内联交换**操作，减少函数调用开销
   - 直接操作 zval（PHP 内部变量结构），避免 PHP 层面的开销

3. **时间复杂度**：
   - 平均/最好：O(n log n)
   - 最坏情况：已通过三数取中法大幅避免，但理论上仍为 O(n²)

### 性能对比

下面的基准测试在随机打乱的 10,000 元素数组上进行比较。测试分别比较了 PHP 内置 `sort()`、手写基本快排（非原地）、手写原地快排三种方案：

```php
$arr = range(1, 10000);
shuffle($arr);

// 内置 sort()
$start = microtime(true);
$arr1 = $arr;
sort($arr1);
echo '内置 sort(): ' . (microtime(true) - $start) . " 秒\n";

// 手写基本快排（非原地，使用 array_merge）
$start = microtime(true);
$arr2 = quick_sort($arr);
echo '手写基本快排: ' . (microtime(true) - $start) . " 秒\n";

// 手写原地快排
$start = microtime(true);
$arr3 = $arr;
quick_sort_inplace($arr3);
echo '手写原地快排: ' . (microtime(true) - $start) . " 秒\n";
```

典型的测试结果如下（实际数值因硬件和 PHP 版本而异）：

| 方案 | 10,000 元素 | 100,000 元素 | 说明 |
|------|------------|-------------|------|
| **PHP 内置 `sort()`** | ~0.002 秒 | ~0.02 秒 | C 底层实现 + 三数取中 + 小数组插入排序 |
| **手写原地快排** | ~0.015 秒 | ~0.18 秒 | PHP 层面实现，无 C 优化 |
| **手写基本快排** | ~0.025 秒 | ~0.35 秒 | 额外 array_merge 开销 + 内存分配 |

> ⚠️ 以上数据为参考值，不同环境差异可能很大。建议在自己的服务器上运行基准测试以获取准确数据。关键结论不变：**PHP 内置 `sort()` 比手写快排快 5~10 倍**。

> 💡 **实践建议**：在生产环境中，优先使用 PHP 内置的 `sort()`、`usort()`、`asort()` 等函数。它们的底层实现经过高度优化，性能远超 PHP 层面手写的排序算法。手写排序主要用于学习算法原理和面试准备。

---

## 实战优化总结

经过上面的分析，整理出快速排序的**最佳实践清单**：

| 优化手段 | 效果 | 适用场景 |
|---------|------|---------|
| 三数取中选基准 | 避免 O(n²) 退化 | 所有场景（默认推荐） |
| 随机选基准 | 对抗恶意输入 | OJ 题目、不可信输入 |
| 小数组切换插入排序 | 减少常数因子 | n < 16 时切换 |
| 尾递归优化/迭代版 | 控制栈深度 | 大规模数据 |
| 三路快排 | 避免重复元素退化 | 数据中重复元素多 |
| 优先用内置 `sort()` | 5~10 倍性能提升 | 生产环境 |

### 一句话总结

> 🎯 **生产代码用 `sort()`，面试写原地 Lomuto 快排，数据重复多用三路快排，大规模数据用迭代版避免栈溢出。**

## 相关阅读

- [冒泡排序](/engineering/bubble-sort) - 最基础的排序算法，通过相邻元素比较交换实现排序
- [选择排序](/engineering/selection-sort) - 每轮选出最小元素放到已排序末尾，O(n²) 简单排序
- [插入排序](/engineering/insertion-sort) - 对近乎有序数据表现最佳的排序算法
- [约瑟夫环问题](/engineering/josephus) - 经典的算法问题，涉及数组和循环操作，分治与递归思维
- [数组去重算法](/engineering/dedup) - 多种去重策略对比，含哈希与排序方案
