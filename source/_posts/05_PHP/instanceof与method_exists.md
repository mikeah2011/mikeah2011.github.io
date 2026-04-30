---
title: instanceof 与 method_exists
date: 2026-05-01
categories:
  - PHP
tags:
  - PHP
  - 反射
---

[`instanceof`](https://www.php.net/manual/zh/language.operators.type.php)與[`method_exists`](https://www.php.net/manual/zh/function.method-exists.php)的用法區別。[參考StackoverFlow](https://stackoverflow.com/questions/28767294/instanceof-or-method-exist-which-one-should-use)

`instanceof`為保留關鍵字，用於檢查對象是否屬於某個類。如果對象是類的實例，則比較返回`true`，否則返回 `false`。通常我們理解為 類型運算符兩邊為對象或類進行比較，等同於`===`；所以，與CommonService的判斷比較也是可取的。

`method_exists`為內置函數，用於檢查對象或類是否具有指定的方法。通常我們理解為 對象或類中是否存在指定方法，返回值也為 `true` 或 `false`。



結論：倆者的比較維度不同。



| 比较项 | [`instanceof`](https://www.php.net/manual/zh/language.operators.type.php) | [`method_exists`](https://www.php.net/manual/zh/function.method-exists.php) |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 性质   | 关键保留字                                                   | 内置函数                                                     |
| 用途   | 检查对象是否属于某一个类                                     | 检查对象或类是否具有指定的方法                               |
| 返回   | `true` 或 `false`                                            | `true` 或 `false`                                            |
|        |                                                              |                                                              |

`instanceof`不会告诉你传递的对象是否包含该方法，只告诉你它是那个方法的一个实例。







dyld[43914]: Library not loaded: /opt/homebrew/opt/icu4c/lib/libicui18n.71.dylib
  Referenced from: <F5F1E51B-0E61-30B8-A4D3-2A7FBF9FFB91> /opt/homebrew/Cellar/php@7.3/7.3.33_3/bin/php
  Reason: tried: 

'/opt/homebrew/opt/icu4c/lib/libicui18n.71.dylib' (no such file),

'/System/Volumes/Preboot/Cryptexes/OS/opt/homebrew/opt/icu4c/lib/libicui18n.71.dylib' (no such file), 

'/opt/homebrew/opt/icu4c/lib/libicui18n.71.dylib' (no such file),

 '/usr/local/lib/libicui18n.71.dylib' (no such file), 

'/usr/lib/libicui18n.71.dylib' (no such file, not in dyld cache), 

'/opt/homebrew/Cellar/icu4c/72.1/lib/libicui18n.71.dylib' (no such file), 

'/System/Volumes/Preboot/Cryptexes/OS/opt/homebrew/Cellar/icu4c/72.1/lib/libicui18n.71.dylib' (no such file), 

'/opt/homebrew/Cellar/icu4c/72.1/lib/libicui18n.71.dylib' (no such file),

 '/usr/local/lib/libicui18n.71.dylib' (no such file), 

'/usr/lib/libicui18n.71.dylib' (no such file, not in dyld cache)