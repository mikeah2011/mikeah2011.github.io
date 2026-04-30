>   前提条件
>
>   node - 15.x.x		
>
>   Hexo - 6.x.x
>
>   vue - 3.x.x



`node`版本环境

```shell
nvm install v15.14.0
```



`yarn`、`vue`、`hexo-cli`版本

```shell
npm i -g yarn @vue/cli hexo-cli
```



`hexo`版本

```shell
npm install hexo
```



```shell
# 安装 Aurora 主题
git clone https://github.com/auroral-ui/hexo-theme-aurora.git aurora

# 进入主题目录, 安装 扩展包 并更新 db 数据
cd aurora && yarn install && npx browserslist@latest --update-db

# 修改 .env.production [二级目录名称，也是仓库名称]
VUE_APP_PUBLIC_PATH = '/mikeah2011/'

# 打包构建
yarn build

# 进入上上级目录，hexo 清理、构建并运行
cd ../../ && hexo cl && hexo g && hexo s

# deploy
hexo cl && hexo d

```

