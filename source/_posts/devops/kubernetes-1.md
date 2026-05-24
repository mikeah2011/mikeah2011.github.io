---
title: Kubernetes 基础操作命令
tags: [Kubernetes]
categories:
  - DevOps
  - Kubernetes
date: 2021-03-20 10:23:13
description: '| 初始版本 | 2014年6月7日，7年前 | | :------- | ------------------------------------------------------ | | 稳定版本 | 1.23.1（2021年12月1…'



---
| 初始版本 | 2014年6月7日，7年前                                    |
| :------- | ------------------------------------------------------ |
| 稳定版本 | 1.23.1（2021年12月16日，2个月前）                      |
| 源代码库 | [kubernetes](https://github.com/kubernetes/kubernetes) |
| 编程语言 | Go                                                     |
| 操作系统 | 跨平台                                                 |
| 类型     | 集群管理                                               |
| 许可协议 | Apache许可证 2.0                                       |
| 网站     | [kubernetes.io](https://kubernetes.io/)                |

**Kubernetes**（常简称为**K8s**）是用于自动部署、扩展和管理“容器化（containerized）应用程序”的开源系统。该系统由 Google 设计并捐赠给Cloud Native Computing Foundation（今属Linux基金会）来使用。

它旨在提供“跨主机集群的自动部署、扩展以及运行应用程序容器的平台”。它支持一系列容器工具，包括Docker等。

More info: [Kubernetes](https://zh.wikipedia.org/wiki/Kubernetes)

## Bash Command

### 查看默认命名空间下的pod

``` bash
kubectl get pods
```

或

```shell
kubectl get pod
```

或

```bash
kubectl get po
```



### 查看所有的命名空间

``` bash
kubectl get po -A
```



### 查看指定命名空间下的所有pod

``` bash
kubectl get po -n dev-jingsocial
```



### 进入某一个pod默认的容器

``` bash
kubectl exec user-deployment-66f996944c-9b4qq bash -itn dev-jingsocial
```



### 查看配置里某一个配置项的集合

```bash
kubectl get po -o jsonpath={.items..metadata.labels.k8s-app} -n dev-jingsocial 
```



### 查看某一个label的pod容器名称

```bash
kubectl get po -o jsonpath={.items..metadata.name} -n dev-jingsocial
```



### 进入某一个动态指定的容器

```bash
kubectl exec $(kubectl get po -l k8s-app=user -o jsonpath={.items..metadata.name} -n dev-jingsocial) bash -itn dev-jingsocial
```



### 拷贝本地文件到容器

```bash
kubectl cp /Users/michael/.kube/config user-deployment-66f996944c-9b4qq:/var/www/.kube/config -n dev-jingsocial
```



### 拷贝容器文件到本地

```bash
kubectl cp user-deployment-66f996944c-9b4qq:/var/www/.kube/config /Users/michael/.kube/config -n dev-jingsocial
```

