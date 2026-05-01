---
title: MySQL优化经验总结
tags:
  - MySQL
categories:
  - SQL
date: 2022-05-20 23:15:47
cover: https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/6411.png
feature: true
description: '线上SQL的调优经验 `slow_query_log` 日志中收集到的慢 SQL ，结合 `explain` 分析是否命中索引。 减少索引扫描行数，有针对性的优化慢 SQL。 建立联合索引，由于联合索引的每个叶子节点包含检索字段的信息，按最…'
---
![图片](https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/6411.png)

> 线上SQL的调优经验

- `slow_query_log` 日志中收集到的慢 SQL ，结合 `explain` 分析是否命中索引。
- 减少索引扫描行数，有针对性的优化慢 SQL。
- 建立联合索引，由于联合索引的每个叶子节点包含检索字段的信息，按最左前缀原则匹配后，再按其它条件过滤，减少回表的数据量。
- 还可以使用虚拟列和联合索引来提升复杂查询的执行效率。
- 监控sql执行情况，发邮件、短信报警，便于快速识别慢查询sql
- 打开数据库慢查询日志功能
- 简化业务逻辑
- 代码重构、优化
- 异步处理
- sql优化
- 索引优化

> SQL优化

1. 分页优化。比如电梯直达，`limit 100000,10` 先查找起始的主键id，再通过`id>#{value}`往后取10条

2. 尽量使用`覆盖索引`，索引的叶节点中已经包含要查询的字段，减少`回表查询`

3. SQL优化（索引优化、小表驱动大表、虚拟列、适当增加冗余字段减少连表查询、联合索引、排序优化、慢日志 Explain 分析执行计划）。

   1. `where`子句

      ​	避免对字段进行`null`值判断、表达式操作等；

      ​	`where`表之间的连接，必须写在其他`where`条件之前；

      ​	可过滤掉最大数量记录的条件必须写在 `where` 子句的末尾，`having`最后；

   2. 优先考虑在`where`及`order by`涉及的列上建立索引；

   3. 避免在索引列上使用函数运算、`is null`和`is not null`；

   4. 避免使用`select *`;

   5. 使用 

      `union all` 代替 `union`

      `exists`代替`in`

      `not exists` 代替` not in`

      连接查询代替子查询；

   6. 批量操作

   7. 小表驱动大表；

   8. 多用limit

   9. in中值太多  分页

   10. 增量查询

   11. 高效的分页

   12. join表不宜过多

   13. 控制索引数量

   14. 选择合理的字段类型

   15. 提升group by 的效率

   16. 索引优化

4. 设计优化（避免使用NULL、用简单数据类型如int、减少 text 类型、分库分表）。

5. 硬件优化（使用SSD 减少 I/O 时间、足够大的网络带宽、尽量大的内存）