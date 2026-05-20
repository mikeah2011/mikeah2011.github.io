---
title: Git基础
tags: [Git]categories:
  - git
date: 2020-03-20 15:05:07
description: 'GIT 以行的模式查看提交日志： git log --pretty=oneline 撤销某次提交，并保留修改 –soft git reset --soft d3c2257b08ffefd69130d9e2bdd1d0328c7d4085 将…'
---
## GIT



> 以行的模式查看提交日志：

git log --pretty=oneline



> 撤销某次提交，并保留修改 –soft

git reset --soft d3c2257b08ffefd69130d9e2bdd1d0328c7d4085



> 将修改暂存到缓存区保存起来：

git stash save 'url_scheme’



> 回滚某次提交

git revert e08e6b103d72a793cc0c21b06f187884c3943f83

回滚后，记得提交

git push



> 回到指定分支

git checkout T910_URLSchemeLink

> 取出缓存区的修改内容

git stash pop

