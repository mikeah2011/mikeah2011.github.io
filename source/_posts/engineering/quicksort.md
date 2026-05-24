---
title: 快速排序
tags: []
categories:
  - Engineering
  - Algorithms
date: 2020-03-20 15:05:07
description: '选择一个基准元素，通常选择第一个元素或者最后一个元素。 通过一趟扫描，将待排序列分成两部分， 一部分比基准元素小，一部分大于等于基准元素。 此时基准元素在其排好序后的正确位置， 然后再用同样的方法递归地排序划分的两部分。'



---
选择一个基准元素，通常选择第一个元素或者最后一个元素。

通过一趟扫描，将待排序列分成两部分，

一部分比基准元素小，一部分大于等于基准元素。

此时基准元素在其排好序后的正确位置，

然后再用同样的方法递归地排序划分的两部分。



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

