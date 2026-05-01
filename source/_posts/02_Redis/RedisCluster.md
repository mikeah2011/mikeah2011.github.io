---
title: Redis Cluster 原理探讨
tags:
  - redis
  - 高可用
  - 集群
categories:
  - Redis
date: 2020-07-25 20:55:57
feature: true
cover: https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/image-20221004222258747.png
description: 'Redis Cluster hash(key) % 16384 = slot 哈希槽 = hash(key) & 2^n^ slot - hash槽分布范围[0-5460] 、 [5461-10922]、[10923-16383] | 序号…'
---
>   Redis Cluster

![image-20221004222258747](https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/image-20221004222258747.png)

hash(key) % 16384 = slot 哈希槽 = hash(key) & 2^n^

slot - hash槽分布范围[0-5460] 、 [5461-10922]、[10923-16383]

```shell
# 创建RedisCluster配置的节点目录
[root@redis]$ mkdir -p rediscluster/node800{1,2,3,4,5,6}
# 复制Redis配置到每个节点目录
[root@redis]$ cp redis-5.0.2/redis.conf rediscluster/node8001/
# 修改节点配置
[root@redis]$ vim rediscluster/node8001/redis.conf
# 批量修改
:%s/8001/8002/g

# 启动集群配置
[root@redis]$ redis-server rediscluster/800*/redis.conf
# 校验启动情况
[root@reids]$ ps -ef | grep redis
# 集群命令帮助
[root@redis]$ redis-cli --cluster help
# 创建集群关系
[root@redis]$ redis-cli -a 111111 --cluster create --cluster-replicas 1 192.168.109.200:8001 192.168.109.200:8002 192.168.109.200:8003 192.168.109.200:8004 192.168.109.200:8005 192.168.109.200:8006  


# 连接任意一个节点客户端[带-c说明是集群方式 智能客户端]
[root@redis]$ redis-cli -a 111111 -c -h 192.168.109.200 -p 8001
# 验证集群信息
> cluster info 
> cluster nodes
> cluster slots
```



| 序号 | 配置项               | 选项                           | 释义                                 |
| ---- | -------------------- | ------------------------------ | ------------------------------------ |
| 1    | cluster-enabled      | yes                            | 启动集群模式                         |
| 2    | port                 | 8001                           | 端口                                 |
| 3    | dir                  | /usr/local/redis-cluster/8001/ | 指定数据目录，绝对目录               |
| 4    | cluster-config-file  | nodes-8001.conf                | 集群节点信息，hash crc16             |
| 5    | cluster-node-timeout | 5000                           | 集群节点超时时间,心跳时间            |
| 6    | bind                 | #127.0.0.1                     | 测试需要注释掉，生产需指定配置       |
| 7    | protected-mode       | no                             | 关闭保护模式                         |
| 8    | requirepass          | 111111                         | redis访问密码                        |
| 9    | masterauth           | 111111                         | 集群节点间的访问密码，与上述保持一致 |
| 10   | damonize             | yes                            | 后台启动                             |
| 11   | appendonly           | yes                            |                                      |



>   Laravel 框架 使用redis cluster需要修改的地方

```php
# .composer.lock
# ...
"require": {
    # ...
    "php": "^7.1.3",
    "predis/predis": "^1.1",
    # 如果安装horizon，请注意Redis密码必设且相同
    # config/horizon.php中'use'=>'horizon'
    # ...
},
# ...


# .env
# ...
CACHE_DRIVER=redis
# ...
    
# cache.php
# ...
'redis' => [
    'driver'     => 'redis',
    'connection' => 'default',
],
#...


# database.php
# ...
'redis' => [
    'client'  => env('REDIS_CLIENT', 'predis'),
    'options' => [
        'cluster' => env('REDIS_CLUSTER', 'redis'),
    ],
    'clusters' => [
        'default' => [
            [
                'host'     => env('REDIS_HOST_A'),
                'password' => env('REDIS_PASSWORD_A'),
                'port'     => env('REDIS_PORT_A', 6379),
                'database' => env('REDIS_DB_A', 0),
            ],
            [
                'host'	   => env('REDIS_HOST_B'),
                'password' => env('REDIS_PASSWORD_B'),
                'port'     => env('REDIS_PORT_B', 6379),
                'database' => env('REDIS_DB_B', 0),
            ],
            [
                'host'     => env('REDIS_HOST_C'),
                'password' => env('REDIS_PASSWORD_C'),
                'port'     => env('REDIS_PORT_C', 6379),
                'database' => env('REDIS_DB_C', 0),
            ],
            [
                'host'     => env('REDIS_HOST_D'),
                'password' => env('REDIS_PASSWORD_D'),
                'port'     => env('REDIS_PORT_D', 6379),
                'database' => env('REDIS_DB_D', 0),
            ],
            [
                'host'     => env('REDIS_HOST_E'),
                'password' => env('REDIS_PASSWORD_E'),
                'port'     => env('REDIS_PORT_E', 6379),
                'database' => env('REDIS_DB_E', 0),
            ],
            [
                'host'     => env('REDIS_HOST_F'),
                'password' => env('REDIS_PASSWORD_F'),
                'port'     => env('REDIS_PORT_F', 6379),
                'database' => env('REDIS_DB_F', 0),
            ],
        ],
    ],
],
# ...

```



>   Redis Cluster 注意事项

-   不完全支持批量操作：mset、mget
-   事务不能跨节点支持
-   不支持多实例
-   key 是最小粒度
-   最少 6 个才能保证组成完整高可用的集群
-   连接的时候只需要连接 1 台服务器即可。
-   如果 1 个主从连接宕机的话，那么集群就宕机了。



>   应用场景

计数器 string incr

分布式ID生成 incr

海量数据统计 - bitmap

会话缓存 key value

分布式队列/阻塞队列 list 双向链表 `lpush/rpush` `rpop/lpop`    `brpop/blpop`阻塞队列

分布式锁[setnx]

热键 HotKey  存储 [list] ltrim		用户路由		二级缓存		

社交类 - 好友推荐、文章 set

排行榜 sorted_set

延迟队列 - sorted_set & zadd + zrangbyscore + rem key

地址服务 [geo]

布隆过滤器  [0-1]