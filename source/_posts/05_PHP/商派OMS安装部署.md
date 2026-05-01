---
title: 商派OMS部署教程
tags:
  - 商派OMS
categories:
  - OMS
date: 2022-09-20 15:05:07
description: '[TOC] OMS本地环境部署(MacOS) 初始化项目代码 使用`brew`安装服务环境 使用`pecl`安装PHP扩展 下载指定系统环境的 Zend Guard Loader扩展，并解压，拷贝`.so`文件至扩展文件的所在路径 找出`…'
---
[TOC]

## OMS本地环境部署(MacOS)



### 初始化项目代码

```shell 
mkdir -p /Users/michael/Project/D1M
cd /Users/michael/Project/D1M
git clone https://git.d1m.cn/oms/kering_oms.git
```



### 使用`brew`安装服务环境

```shell
brew tap shivammathur/php
brew install nginx redis mysql@5.7 shivammathur/php/php@5.6 imagemagick
brew services restart nginx mysql@5.7 redis php@5.6
brew services list
```



### 使用`pecl`安装PHP扩展

```shell
pecl i imagick curl gd mysql pdo pdo_mysql redis-3.1.6
```

下载指定系统环境的 [Zend Guard Loader扩展](https://www.zend.com/downloads/zend-guard-loader)，并解压，拷贝`.so`文件至扩展文件的所在路径

```shell
cp -rf /Users/michael/Downloads/zend-loader-php5.6-darwin10.7-x86_64/*.so /usr/local/opt/php@5.6/lib/php/20131226
```

找出`.ini`配置文件编辑，并添加以下内容

```shell
php -i | grep .ini
# =====================================
Configuration File (php.ini) Path => /usr/local/etc/php/5.6
Loaded Configuration File => /usr/local/etc/php/5.6/php.ini
Scan this dir for additional .ini files => /usr/local/etc/php/5.6/conf.d
Additional .ini files parsed => /usr/local/etc/php/5.6/conf.d/ext-opcache.ini
# =====================================

vim /usr/local/etc/php/5.6/conf.d/ext-opcache.ini
# ======以下===为===添加===内容===========
[opcache]
zend_extension=/usr/local/opt/php@5.6/lib/php/20131226/opcache.so
zend_extension=/usr/local/opt/php@5.6/lib/php/20131226/ZendGuardLoader.so

;4. 可选：在php中添加附加行。用于启用ZendGuardLoader的ini
; 启用加载编码脚本。默认值为On
zend_loader.enable=1
     
;5. 可选：可以在php中添加以下行。ZendGuardLoader配置的ini文件：
; 禁用许可证检查（出于性能原因）
zend_loader.disable_licensing=0

;6. Zend Guard Loader支持的混淆级别。官方Zend Guard文档中详细介绍了这些级别。0-未启用模糊处理
zend_loader.obfuscation_level_support=3

;7. 许可的Zend产品应在哪里查找产品许可证的路径。有关如何创建许可文件的详细信息，请参阅《Zend Guard用户指南》
zend_loader.license_path=/Users/michael/Project/D1M/kering_oms/config/developer.zl
# ======以上===为===添加===内容===========
```



### 检查 PHP 扩展

*扩展依赖请自行解决*

```shell
~ $ php -m | grep -E 'gd|mysql|pdo|curl|imagick|redis|Zend' 
curl
gd
imagick
mysql
mysqli
mysqlnd
pdo_dblib
pdo_mysql
pdo_pgsql
pdo_sqlite
redis
Zend Guard Loader
Zend OPcache
[Zend Modules]
Zend Guard Loader
Zend OPcache
```



### Nginx 配置文件

```nginx
server {
    listen       80;
    listen  [::]:80;
    server_name  oms.test;
    
    # 访问日志 {更换第①处}
    access_log  /Users/michael/.nginx/servers/host.access.log;
    
    location / {
        # 项目路径 {更换第②处}
        root   /Users/michael/Project/D1M/kering_oms;
        
        index  index.php;
    }
    
    location ~ .*\.php.* {
        fastcgi_pass   127.0.0.1:9000;
        fastcgi_index  index.php;
        fastcgi_param  GATEWAY_INTERFACE  CGI/1.1;
        fastcgi_param  SERVER_SOFTWARE    nginx;
        fastcgi_param  QUERY_STRING       $query_string;
        fastcgi_param  REQUEST_METHOD     $request_method;
        fastcgi_param  CONTENT_TYPE       $content_type;
        fastcgi_param  CONTENT_LENGTH     $content_length;
        # {更换第③处}
        fastcgi_param  SCRIPT_FILENAME    /Users/michael/Project/D1M/kering_oms$fastcgi_script_name;
        
        fastcgi_param  SCRIPT_NAME        $fastcgi_script_name;
        fastcgi_param  REQUEST_URI        $request_uri;
        fastcgi_param  DOCUMENT_URI       $document_uri;
        fastcgi_param  DOCUMENT_ROOT      $document_root;
        fastcgi_param  SERVER_PROTOCOL    $server_protocol;
        fastcgi_param  REMOTE_ADDR        $remote_addr;
        fastcgi_param  REMOTE_PORT        $remote_port;
        fastcgi_param  SERVER_ADDR        $server_addr;
        fastcgi_param  SERVER_PORT        $server_port;
        fastcgi_param  SERVER_NAME        $server_name;
        fastcgi_param  REDIRECT_STATUS    200;
        # 需要支持 PATH_INFO
        set $real_script_name $fastcgi_script_name;
        if ($fastcgi_script_name ~ "^(.+?\.php)(/.+)$") {
            set $real_script_name $1;
            set $path_info $2;
        }
        # {更换第④处}
        fastcgi_param SCRIPT_FILENAME /Users/michael/Project/D1M/kering_oms/$real_script_name;
        
        fastcgi_param SCRIPT_NAME $real_script_name;
        fastcgi_param PATH_INFO $path_info;
    }
}
```

配置并验证hosts域名

```shell
# 检验Nginx配置
nginx -t
# 重启Nginx服务
brew services restart nginx

# 映射hosts域名
vim /etc/hosts
127.0.0.1 oms.test

# 验证
ping oms.test
```



### MySQL建库

```mysql
CREATE DATABASE IF NOT EXISTS `kering_oms` DEFAULT CHARSET utf8 COLLATE utf8_general_ci;
```

验证数据库

```shell
mysql -uroot -p

mysql> show databases;
```



### 部署OMS

```php
# 第①处注释 @ D1M/kering_oms/app/setup/check.php:155-163
/*if (check_pathinfo()) {*/
    $url = $_COOKIE['LOCAL_SETUP_URL'];
    setCookie('LOCAL_SETUP_URL', '', 0, '/');
    Header('Location: ' . $url);    //todo:进入安装流程
    exit;
/*} else {
    Header('Location: view/notice_pathinfo.html');   //todo:不支持pathinfo，警告页
    exit;
}*/

# 第②处注释 @ D1M/kering_oms/app/entermembercenter/controller/register.php:12
/*header("HTTP/1.1 403 XSS OR CSRF "); exit;*/

# 第③处新增 @ D1M/kering_oms/config/config.php:155
define('CUSTOM_CORE_DIR', ROOT_DIR . '/custom');
```



### shopexID

账号：`88180401883225`

密码：`d1m1234`



### 结尾

```shell
# 项目根目录下，初始化项目代码
~/Project/D1M/kering_oms<master!2?16> 
$ git reset --hard
```