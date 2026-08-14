'use strict';

/*
 * 补回被 hexo-plugin-aurora 删掉的 Hexo 默认 generator。
 *
 * Aurora 在 lib/generators/index.js 里有这么一段：
 *
 *   ['page', 'archive', 'category', 'tag', 'links'].forEach(
 *     (name) => delete hexo.extend.generator.store[name]
 *   );
 *
 * 它假定这些路由由 SPA 前端从 /api/*.json 渲染，所以不需要服务端产物。但本仓库
 * 的 package.json 里同时装着 hexo-generator-tag / -category，两边谁先执行取决于
 * Hexo 加载插件的顺序 —— 而那个顺序在构建之间并不稳定。
 *
 * 实测四次连续的干净构建，同样的代码和配置，出现了三种结果：
 *
 *   构建   tags/   categories/
 *   #1     2623        1          ← tag 赢
 *   #2     2623        1          ← tag 赢
 *   #3        2       85          ← category 赢，tag 输
 *   #4        2        1          ← 都输
 *
 * 两个 generator 各自独立地赢或输。线上那次正好是「都输」，于是 sitemap.xml 里
 * 2511 个 /tags/ 和 26 个 /categories/ URL 全部 404 —— 等于持续向 Google 和百度
 * 提交两千多个死链，而构建退出码是 0，日志里没有任何异常。
 *
 * before_generate 在所有插件加载完毕之后、_runGenerators() 之前触发（见 hexo
 * dist/hexo/index.js 的 _generate），在这里注册就不再有顺序问题。
 *
 * 只补 tag 和 category，其余三个维持 Aurora 的删除：
 *   - page    已由 aurora-page 接管，补回会让每个页面生成两次
 *   - links   没装对应的 generator 插件
 *   - archive /archives/ 已由 aurora-page 提供，且 hexo-generator-sitemap
 *             本来就不收录归档页，补回只会多出无人访问的产物
 *
 * 代价实测约 +2 秒、+2623 个文件、+9MB —— 换 2537 个 URL 从 404 变回 200。
 */

const RESTORE = [
  { name: 'tag', pkg: 'hexo-generator-tag', configKey: 'tag_generator' },
  { name: 'category', pkg: 'hexo-generator-category', configKey: 'category_generator' }
];

hexo.extend.filter.register('before_generate', function () {
  for (const { name, pkg, configKey } of RESTORE) {
    if (this.extend.generator.get(name)) continue;

    let generator;
    try {
      generator = require(`${pkg}/lib/generator`);
    } catch (err) {
      // 依赖被移除时不要让整个构建挂掉，但必须响 —— 静默跳过就回到了这次修的问题。
      this.log.warn(`[restore-generators] ${pkg} 加载失败，${name} 页不会生成：${err.message}`);
      continue;
    }

    // 正常情况下 pkg 的 index.js 已经写好了默认值；这里兜底，避免 generator
    // 读 config[configKey].per_page 时抛 TypeError。
    if (!this.config[configKey]) {
      this.config[configKey] = { per_page: this.config.per_page == null ? 10 : this.config.per_page };
    }

    this.extend.generator.register(name, generator);
    this.log.debug(`[restore-generators] 已补回 ${name} generator`);
  }
});
