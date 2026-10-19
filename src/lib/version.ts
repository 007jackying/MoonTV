'use client';

/**
 * 当前版本号, 由 scripts/convert-changelog.js 按 CHANGELOG 最新版本自动写入。
 *
 * 浏览器端不再去代码仓库查询「最新版本」或拉取远程变更日志:
 * 站点由运营者部署和更新, 访客无需也不应看到代码仓库地址。
 * 版本面板只展示随构建打包的 src/lib/changelog.ts。
 */
const CURRENT_VERSION = '3.14.0';

export { CURRENT_VERSION };
