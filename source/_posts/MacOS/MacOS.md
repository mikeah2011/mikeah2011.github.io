---
title: MacOS基础
tags: [macOS]
categories:
  - macOS
date: 2021-03-20 15:05:07
description: 'MacOS macOS 使用pecl安装PHP扩展 安装kafka扩展前，确保MacOS已经安装了librdkafka，如果没有，可以使用 brew 安装 librdkafka： 因为mongodb在默认版本下，对PHP的版本要求是7.2…'
---
## MacOS



macOS 使用pecl安装PHP扩展



安装kafka扩展前，确保MacOS已经安装了librdkafka，如果没有，可以使用 brew 安装 librdkafka：

```bash
brew install librdkafka
```

因为mongodb在默认版本下，对PHP的版本要求是7.2，所以可以指定版本安装

```
pecl i redis rdkafka mongodb-1.11.1
```



[pecl安装PHP扩展的版本地址](https://pecl.php.net/packages.php)



拷贝文件内容的命令`pbcopy`

```bash
pbcopy < ~/.ssh/id_rsa.pub
```

