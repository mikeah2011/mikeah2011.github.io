---
title: MySQL的三种日志
tags:
  - MySQL
categories:
  - SQL
date: 2018-03-20 15:05:07
description: '`redo log`日志也叫做`WAL`技术（`Write- Ahead Logging`），他是一种**先写日志，并更新内存，最后再更新磁盘的技术**，为了就是减少sql执行期间的数据库io操作，并且更新磁盘往往是在Mysql比较闲的时候…'
---
`redo log`日志也叫做`WAL`技术（`Write- Ahead Logging`），他是一种**先写日志，并更新内存，最后再更新磁盘的技术**，为了就是减少sql执行期间的数据库io操作，并且更新磁盘往往是在Mysql比较闲的时候，这样就大大减轻了Mysql的压力。

`redo log`是固定大小，是物理日志，属于InnoDB引擎的，并且写redo log是环状写日志的形式：

![图片](/images/redolog.png)

如上图所示：若是四组的redo log文件，一组为1G的大小，那么四组就是4G的大小，其中`write pos`是**记录当前的位置**，有数据写入当前位置，那么write pos就会边写入边往后移。

`check point`记录**擦除的位置**，因为redo log是固定大小，所以当redo log满的时候，也就是`write pos`追上`check point`的时候，需要清除`redo log`的部分数据，清除的数据会被持久化到磁盘中，然后将`check point`向前移动。

`redo log`日志实现了即使在数据库出现异常宕机的时候，重启后之前的记录也不会丢失，这就是`crash-safe`能力。





`binlog`称为**归档日志**，是逻辑上的日志，它属于Mysql的Server层面的日志，记录着sql的原始逻辑，主要有两种模式：**一个是statement格式记录的是原始的sql，而row格式则是记录行内容**。

redo log和binlog记录的形式、内容不同，这两者日志都能通过自己记录的内容恢复数据。

之所以这两个日志同时存在，是因为刚开始Mysql自带的引擎MyISAM就没有crash-safe功能的，并且在此之前Mysql还没有InnoDB引擎，Mysql自带的binlog日志只是用来归档日志的，所以InnoDB引擎也就通过自己redo log日志来实现crash-safe功能。





redolog 是重做日志，提供前滚操作，

undolog是回滚日志，提供回滚操作。

binlog   是归档日志