# vue-pure-admin 管理后台

## 定义
vue-pure-admin 是基于 Vue 3、Vite、TypeScript、Pinia、Element Plus 的开源中后台管理系统模板。企业常基于它二次开发，定制自己的管理后台。

## 核心原理

### 技术栈
- Vue 3 + Composition API + `<script setup>`
- Vite 构建
- TypeScript 全量类型
- Pinia 状态管理
- Element Plus UI 组件库
- Vue Router 4 路由
- UnoCSS / Tailwind CSS 原子化样式

### 二次开发流程
```
fork 仓库 → 删除不需要的页面/组件
          → 配置自己的 API 地址
          → 定制登录/鉴权流程
          → 添加业务页面
          → 主题/品牌定制
          → 部署上线
```

### 权限管理
```typescript
// 路由权限
const routes = [
  {
    path: '/admin',
    meta: { roles: ['admin'] },
    component: AdminLayout
  }
]

// 指令权限
v-permission="'user:delete'"
```

### 常见定制点
1. 登录流程对接自己的 OAuth/LDAP
2. 菜单从后端 API 动态加载
3. 多标签页/面包屑定制
4. 表格/表单组件二次封装
5. 主题色/品牌定制

## 实战案例
来自博客文章：
- [vue-pure-admin 管理后台实战](/categories/Frontend/vue3-vue-pure-admin-guide-fork/) - 从 fork 到定制化的完整踩坑记录

## 相关概念
- [Vue 3 Composition API](Vue3-Composition-API.md) - 管理后台的核心 API
- [Pinia 状态管理](Pinia状态管理.md) - 全局状态管理
- [Vue 3 组件库开发](Vue3-组件库开发.md) - 管理后台中的组件封装

## 常见问题

**Q: vue-pure-admin vs vue-vben-admin？**
A: 两者都是优秀的中后台方案。pure-admin 更轻量，vben-admin 功能更全。根据团队偏好选择。

**Q: 生产能直接用吗？**
A: 需要二次开发。fork 后删除 demo 页面，添加业务逻辑，配置自己的 API 和鉴权。
