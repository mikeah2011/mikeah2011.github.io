---

title: 冒泡排序算法详解：优化策略与 PHP/Go/JS 实现
cover: https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&h=630&fit=crop
tags:
- 排序算法
- 冒泡排序
- 数据结构
- 算法
- bubble-sort
categories:
  - engineering
keywords: [PHP, Go, JS, 冒泡排序算法详解, 优化策略与, 实现]
date: 2020-03-20 15:05:07
description: 冒泡排序是最基础的排序算法之一，通过重复遍历数组，依次比较相邻元素并交换，使较大元素逐渐"浮"到数组末端。本文深入讲解冒泡排序的多语言实现（PHP、Python、JavaScript）、时间复杂度分析（最好O(n)、平均O(n²)、最差O(n²)），介绍提前终止优化和双向冒泡排序（Cocktail Sort）等算法优化技巧，并提供与其他排序算法的对比，帮助开发者全面掌握冒泡排序。
---



冒泡排序（Bubble Sort）是最基础、最直观的排序算法之一。它的核心思想是：在要排序的一组数中，对当前还未排好的序列，从前往后对相邻的两个数依次进行比较和调整，让较大的数往下沉，较小的往上冒。即，每当两相邻的数比较后发现它们的排序与排序要求相反时，就将它们互换。

<!-- more -->

## 基本原理

冒泡排序的工作流程如下：

1. 从数组的第一个元素开始，依次比较相邻的两个元素
2. 如果前一个元素大于后一个元素，则交换它们的位置
3. 每一轮遍历都会将当前未排序部分的最大元素"冒泡"到正确位置
4. 重复以上步骤，直到整个数组有序

可以想象成水中的气泡：较大的气泡会逐渐浮到水面（数组末尾），较小的气泡则沉到水底（数组开头）。

## PHP 实现

### 基础版本

```php
$arr = [1, 43, 54, 62, 21, 66, 32, 78, 36, 76, 39];

function bubble_sort($arr)
{
  $len = count($arr);
  // 该层循环控制 需要冒泡的轮数
  for ($i = 0; $i < $len - 1; $i++) {
    // 该层循环用来控制每轮 冒出一个数 需要比较的次数
    for ($k = 0; $k < $len - $i - 1; $k++) {
      // 下一个键
      $nk = $k + 1;
      // 如果当前值比下一个值大
      if ($arr[$k] > $arr[$nk]) {
        // 把下一个值先存起来
        $tmp      = $arr[$nk];
        // 把当前值给下一个键，覆盖
        $arr[$nk] = $arr[$k];
        // 再把存起来的值，给当前键
        $arr[$k]  = $tmp;
      }
    }
  }
  
  return $arr;
}

print_r(bubble_sort($arr));
// 输出: [1, 21, 32, 36, 39, 43, 54, 62, 66, 76, 78]
```

### 优化版本：提前终止

如果在某一轮遍历中没有发生任何交换，说明数组已经有序，可以提前结束排序：

```php
function bubble_sort_optimized($arr)
{
  $len = count($arr);
  for ($i = 0; $i < $len - 1; $i++) {
    $swapped = false;  // 标记本轮是否发生交换
    for ($k = 0; $k < $len - $i - 1; $k++) {
      if ($arr[$k] > $arr[$k + 1]) {
        $tmp           = $arr[$k + 1];
        $arr[$k + 1]   = $arr[$k];
        $arr[$k]       = $tmp;
        $swapped = true;
      }
    }
    // 如果本轮没有发生交换，数组已有序
    if (!$swapped) {
      break;
    }
  }
  return $arr;
}
```

### 优化版本：双向冒泡排序（Cocktail Sort）

双向冒泡排序（也称为鸡尾酒排序）交替从左到右和从右到左遍历数组，可以有效解决"乌龟问题"（小元素在数组末尾需要很多轮才能移到前面）：

```php
function cocktail_sort($arr)
{
  $len = count($arr);
  $start = 0;
  $end = $len - 1;
  $swapped = true;

  while ($swapped) {
    $swapped = false;
    
    // 从左到右冒泡（把最大值移到末尾）
    for ($i = $start; $i < $end; $i++) {
      if ($arr[$i] > $arr[$i + 1]) {
        $tmp         = $arr[$i + 1];
        $arr[$i + 1] = $arr[$i];
        $arr[$i]     = $tmp;
        $swapped = true;
      }
    }
    $end--;
    
    // 如果没有交换，数组已有序
    if (!$swapped) break;
    
    $swapped = false;
    
    // 从右到左冒泡（把最小值移到开头）
    for ($i = $end; $i > $start; $i--) {
      if ($arr[$i] < $arr[$i - 1]) {
        $tmp         = $arr[$i - 1];
        $arr[$i - 1] = $arr[$i];
        $arr[$i]     = $tmp;
        $swapped = true;
      }
    }
    $start++;
  }
  
  return $arr;
}
```

## Python 实现

### 基础版本

```python
def bubble_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        for k in range(n - i - 1):
            if arr[k] > arr[k + 1]:
                arr[k], arr[k + 1] = arr[k + 1], arr[k]
    return arr

arr = [1, 43, 54, 62, 21, 66, 32, 78, 36, 76, 39]
print(bubble_sort(arr))
# 输出: [1, 21, 32, 36, 39, 43, 54, 62, 66, 76, 78]
```

### 优化版本：提前终止

```python
def bubble_sort_optimized(arr):
    n = len(arr)
    for i in range(n - 1):
        swapped = False
        for k in range(n - i - 1):
            if arr[k] > arr[k + 1]:
                arr[k], arr[k + 1] = arr[k + 1], arr[k]
                swapped = True
        if not swapped:
            break
    return arr
```

### 双向冒泡排序（Cocktail Sort）

```python
def cocktail_sort(arr):
    n = len(arr)
    start = 0
    end = n - 1
    swapped = True
    
    while swapped:
        swapped = False
        for i in range(start, end):
            if arr[i] > arr[i + 1]:
                arr[i], arr[i + 1] = arr[i + 1], arr[i]
                swapped = True
        end -= 1
        
        if not swapped:
            break
        
        swapped = False
        for i in range(end, start, -1):
            if arr[i] < arr[i - 1]:
                arr[i], arr[i - 1] = arr[i - 1], arr[i]
                swapped = True
        start += 1
    
    return arr
```

## JavaScript 实现

### 基础版本

```javascript
function bubbleSort(arr) {
  const len = arr.length;
  for (let i = 0; i < len - 1; i++) {
    for (let k = 0; k < len - i - 1; k++) {
      if (arr[k] > arr[k + 1]) {
        // ES6 解构赋值交换
        [arr[k], arr[k + 1]] = [arr[k + 1], arr[k]];
      }
    }
  }
  return arr;
}

const arr = [1, 43, 54, 62, 21, 66, 32, 78, 36, 76, 39];
console.log(bubbleSort(arr));
// 输出: [1, 21, 32, 36, 39, 43, 54, 62, 66, 76, 78]
```

### 优化版本：提前终止

```javascript
function bubbleSortOptimized(arr) {
  const len = arr.length;
  for (let i = 0; i < len - 1; i++) {
    let swapped = false;
    for (let k = 0; k < len - i - 1; k++) {
      if (arr[k] > arr[k + 1]) {
        [arr[k], arr[k + 1]] = [arr[k + 1], arr[k]];
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return arr;
}
```

## Go 实现

### 基础版本

```go
package main

import "fmt"

func bubbleSort(arr []int) []int {
    n := len(arr)
    for i := 0; i < n-1; i++ {
        for k := 0; k < n-i-1; k++ {
            if arr[k] > arr[k+1] {
                arr[k], arr[k+1] = arr[k+1], arr[k]
            }
        }
    }
    return arr
}

func main() {
    arr := []int{1, 43, 54, 62, 21, 66, 32, 78, 36, 76, 39}
    fmt.Println(bubbleSort(arr))
    // 输出: [1 21 32 36 39 43 54 62 66 76 78]
}
```

### 优化版本：提前终止

```go
func bubbleSortOptimized(arr []int) []int {
    n := len(arr)
    for i := 0; i < n-1; i++ {
        swapped := false
        for k := 0; k < n-i-1; k++ {
            if arr[k] > arr[k+1] {
                arr[k], arr[k+1] = arr[k+1], arr[k]
                swapped = true
            }
        }
        if !swapped {
            break
        }
    }
    return arr
}
```

### 双向冒泡排序（Cocktail Sort）

```go
func cocktailSort(arr []int) []int {
    n := len(arr)
    start, end := 0, n-1
    swapped := true

    for swapped {
        swapped = false
        // 从左到右冒泡
        for i := start; i < end; i++ {
            if arr[i] > arr[i+1] {
                arr[i], arr[i+1] = arr[i+1], arr[i]
                swapped = true
            }
        }
        end--
        if !swapped {
            break
        }
        swapped = false
        // 从右到左冒泡
        for i := end; i > start; i-- {
            if arr[i] < arr[i-1] {
                arr[i], arr[i-1] = arr[i-1], arr[i]
                swapped = true
            }
        }
        start++
    }
    return arr
}
```

## 逐步排序过程演示

以数组 `[5, 3, 8, 1, 2]` 为例，详细展示冒泡排序的每一步：

### 第一轮（i=0）

```
初始: [5, 3, 8, 1, 2]
比较 (5, 3) → 交换 → [3, 5, 8, 1, 2]
比较 (5, 8) → 不换 → [3, 5, 8, 1, 2]
比较 (8, 1) → 交换 → [3, 5, 1, 8, 2]
比较 (8, 2) → 交换 → [3, 5, 1, 2, 8]  ← 8 已就位
```

### 第二轮（i=1）

```
当前: [3, 5, 1, 2, 8]
比较 (3, 5) → 不换 → [3, 5, 1, 2, 8]
比较 (5, 1) → 交换 → [3, 1, 5, 2, 8]
比较 (5, 2) → 交换 → [3, 1, 2, 5, 8]  ← 5 已就位
```

### 第三轮（i=2）

```
当前: [3, 1, 2, 5, 8]
比较 (3, 1) → 交换 → [1, 3, 2, 5, 8]
比较 (3, 2) → 交换 → [1, 2, 3, 5, 8]  ← 3 已就位
```

### 第四轮（i=3）

```
当前: [1, 2, 3, 5, 8]
比较 (1, 2) → 不换 → [1, 2, 3, 5, 8]  ← 无交换，提前终止
```

**最终结果**: `[1, 2, 3, 5, 8]`

> 共经过 4 轮遍历，进行了 10 次比较，发生了 6 次交换。使用优化版本时，第四轮检测到无交换即可提前终止。

## 时间复杂度分析

| 情况 | 时间复杂度 | 说明 |
|------|-----------|------|
| 最好情况 | O(n) | 数组已经有序，使用优化版本只需遍历一轮即可确认 |
| 平均情况 | O(n²) | 随机排列的数组，需要进行 n(n-1)/2 次比较 |
| 最差情况 | O(n²) | 数组完全逆序，需要进行 n(n-1)/2 次比较和交换 |

**空间复杂度**：O(1) —— 冒泡排序是原地排序算法，只需要常数级别的额外空间。

**稳定性**：稳定 —— 相等元素的相对位置不会改变（前提是使用 `>` 而不是 `>=` 进行比较）。

## 排序算法对比

| 算法 | 最好时间 | 平均时间 | 最差时间 | 空间复杂度 | 稳定性 | 适用场景 |
|------|---------|---------|---------|-----------|--------|---------|
| 冒泡排序 | O(n) | O(n²) | O(n²) | O(1) | ✅ 稳定 | 教学演示、小数据量 |
| 选择排序 | O(n²) | O(n²) | O(n²) | O(1) | ❌ 不稳定 | 交换次数最少的场景 |
| 插入排序 | O(n) | O(n²) | O(n²) | O(1) | ✅ 稳定 | 小数据量、近乎有序 |
| 快速排序 | O(n log n) | O(n log n) | O(n²) | O(log n) | ❌ 不稳定 | 大数据量通用排序 |

## 踩坑案例

### 1. 数组越界问题

初学者常见的错误是在内层循环中使用 `k < len - i` 而不是 `k < len - i - 1`，导致 `arr[k + 1]` 访问越界：

```php
// ❌ 错误写法
for ($k = 0; $k < $len - $i; $k++) {
  if ($arr[$k] > $arr[$k + 1]) { ... }  // 最后一轮 k+1 会越界
}

// ✅ 正确写法
for ($k = 0; $k < $len - $i - 1; $k++) {
  if ($arr[$k] > $arr[$k + 1]) { ... }
}
```

### 2. 混淆比较符号导致不稳定

使用 `>=` 进行比较会导致相等元素也被交换，破坏排序的稳定性：

```php
// ❌ 不稳定写法
if ($arr[$k] >= $arr[$nk]) { ... }  // 相等元素也会交换

// ✅ 稳定写法
if ($arr[$k] > $arr[$nk]) { ... }   // 只有严格大于才交换
```

### 3. 忘记优化导致性能浪费

对于已经接近有序的数组，不使用提前终止优化会白白浪费时间：

```php
// 输入已基本有序的数组：[1, 2, 3, 5, 4, 6, 7, 8]
// 未优化版本：仍需完整执行所有轮次，O(n²)
// 优化版本：第2轮后检测到无交换，提前终止，接近 O(n)
```

## 实际应用场景

虽然冒泡排序在大数据量下效率较低，但在以下场景中仍有其价值：

1. **教学演示**：冒泡排序逻辑简单直观，是学习排序算法的最佳入门选择
2. **小数据量排序**：当数据量很小（如 n < 20）时，冒泡排序的简单实现可能比复杂算法更快
3. **检测数组是否有序**：利用优化版本的提前终止特性，可以用 O(n) 的时间检测数组是否已经有序
4. **嵌入式系统**：在内存极度受限的环境中，冒泡排序的 O(1) 空间复杂度是优势
5. **竞赛中的特殊场景**：某些编程竞赛中，数据特征特殊时冒泡排序可能有意外表现

## 总结

冒泡排序虽然是最简单的排序算法之一，但它包含了排序算法的核心思想：比较和交换。通过学习冒泡排序，我们可以：

- 理解算法时间复杂度的概念
- 掌握原地排序的思想
- 学会如何通过标志位优化算法
- 为学习更复杂的排序算法打下基础

在实际开发中，建议优先使用语言内置的排序函数（如 PHP 的 `sort()`、Python 的 `sorted()`、JavaScript 的 `Array.sort()`），它们通常采用更高效的混合排序算法（如 Timsort）。

## 性能基准测试

以下是对 1000 个随机整数进行排序的 Python 基准测试结果（仅供参考，实际性能因数据和环境而异）：

```python
import time
import random
import sys

def benchmark(name, sort_func, arr, runs=100):
    times = []
    for _ in range(runs):
        test_arr = arr.copy()
        start = time.perf_counter()
        sort_func(test_arr)
        end = time.perf_counter()
        times.append(end - start)
    avg = sum(times) / len(times)
    print(f"{name:20s} 平均耗时: {avg*1000:.3f} ms")
    return avg

# 冒泡排序（优化版）
def bubble_sort_opt(arr):
    n = len(arr)
    for i in range(n - 1):
        swapped = False
        for k in range(n - i - 1):
            if arr[k] > arr[k+1]:
                arr[k], arr[k+1] = arr[k+1], arr[k]
                swapped = True
        if not swapped:
            break
    return arr

# 插入排序
def insertion_sort(arr):
    for i in range(1, len(arr)):
        key = arr[i]
        j = i - 1
        while j >= 0 and arr[j] > key:
            arr[j + 1] = arr[j]
            j -= 1
        arr[j + 1] = key
    return arr

# 选择排序
def selection_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        min_idx = i
        for j in range(i + 1, n):
            if arr[j] < arr[min_idx]:
                min_idx = j
        arr[i], arr[min_idx] = arr[min_idx], arr[i]
    return arr

# 快速排序
def quick_sort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quick_sort(left) + middle + quick_sort(right)

# 测试数据
n = 1000
data = [random.randint(0, 10000) for _ in range(n)]

print(f"排序 {n} 个随机整数，每种算法运行 100 次取平均值：\n")
benchmark("冒泡排序 (优化)", bubble_sort_opt, data)
benchmark("插入排序", insertion_sort, data)
benchmark("选择排序", selection_sort, data)
benchmark("快速排序", lambda a: quick_sort(a), data)
```

**典型测试结果**（n=1000）：

| 算法 | 平均耗时 | 相对速度 |
|------|---------|---------|
| 冒泡排序（优化版） | ~35 ms | 1x（基准） |
| 插入排序 | ~18 ms | ~2x 快 |
| 选择排序 | ~25 ms | ~1.4x 快 |
| 快速排序 | ~0.8 ms | ~44x 快 |

> ⚠️ 以上数据仅为演示参考。冒泡排序和插入排序均为 O(n²)，但在小数据量下插入排序通常更快，因为其内层循环的内存访问模式更友好（局部性好）。快速排序作为 O(n log n) 算法，在大数据量下优势极为明显。

## 面试常见问题

### Q1: 冒泡排序的最好、最坏和平均时间复杂度分别是什么？

**答**：最好情况 O(n)（数组已有序，优化版仅需一轮遍历）；最坏和平均情况均为 O(n²)。空间复杂度为 O(1)（原地排序）。

### Q2: 如何优化冒泡排序？

**答**：主要优化手段：
1. **提前终止**：记录每轮是否发生交换，若无交换则数组已有序，提前退出
2. **记录最后交换位置**：记录每轮最后一次交换的位置，该位置之后的元素已有序，下一轮只需比较到该位置
3. **双向冒泡（Cocktail Sort）**：交替从左到右和从右到左遍历，解决"乌龟问题"（小元素在数组尾部移动缓慢）

### Q3: 什么是冒泡排序的"乌龟"和"兔子"问题？

**答**：
- **兔子**（Rabbit）：大元素在数组开头，会快速"冒泡"到末尾，移动速度快
- **乌龟**（Turtle）：小元素在数组末尾，每次遍历只能向左移动一位，移动速度慢

Cocktail Sort 通过反向遍历可以有效解决乌龟问题。

### Q4: 冒泡排序是稳定排序吗？为什么？

**答**：是的，冒泡排序是稳定排序。因为交换只在 `arr[k] > arr[k+1]` 时发生，相等元素不会被交换，保持了它们的原始相对顺序。但如果使用 `>=` 进行比较，就会破坏稳定性。

### Q5: 给你一个几乎有序的数组，你会选择哪种排序算法？

**答**：如果数据量不大，可以使用冒泡排序或插入排序的优化版本。两者在几乎有序的情况下都能达到接近 O(n) 的性能。对于较大规模的数据，推荐使用 Timsort（Python/Java 的内置排序），它专门为处理部分有序数据做了优化。

### Q6: 为什么生产环境不推荐使用冒泡排序？

**答**：冒泡排序的平均时间复杂度为 O(n²)，在大数据量下性能远不如 O(n log n) 的算法（如快速排序、归并排序、Timsort）。现代编程语言的内置排序函数已经高度优化，直接使用 `sort()` 等方法是最佳实践。冒泡排序的主要价值在于教学和理解排序算法的基本原理。

## 相关阅读

- [插入排序](/posts/engineering/insertion-sort) - 将元素插入到已排序部分的正确位置
- [选择排序](/posts/engineering/selection-sort) - 每轮选择最小元素放到已排序末尾
- [快速排序](/posts/engineering/quicksort) - 基于分治思想的高效排序算法
