---
title: 前缀索引
tags: [MySQL]
categories: Databases
date: 2015-03-20 15:05:07
description: '因为可能我们索引的字段非常长，这既占内存空间，也不利于维护。所以我们就想，如果只把很长字段的前面的公共部分作为一个索引，就会产生超级加倍的效果。但是，我们需要注意，order by不支持前缀索引 。 流程是： 先计算完整列的选择性 :`se…'



---
因为可能我们索引的字段非常长，这既占内存空间，也不利于维护。所以我们就想，如果只把很长字段的前面的公共部分作为一个索引，就会产生超级加倍的效果。但是，我们需要注意，order by不支持前缀索引 。

流程是：

先计算完整列的选择性 :`select count(distinct col_1)/count(1) from table_1`

再计算不同前缀长度的选择性 :`select count(distinct left(col_1,4))/count(1) from table_1`

找到最优长度之后，创建前缀索引 :`create index idx_front on table_1 (col_1(4))`