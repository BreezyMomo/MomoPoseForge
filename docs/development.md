# 本地开发与 GitHub Pages 部署

[简体中文](development.md) · [English](development.en.md)

[手册目录](README.md) · [项目首页](../README.md)

## 独立运行仓库

使用 Node.js 24，在仓库根目录执行：

```sh
npm ci
npm run dev
```

默认地址为 `http://127.0.0.1:5173/`。共享框架固定包在 `vendor/momo-workbench-0.2.0.tgz`；它与依赖锁必须配套，不要求另一个仓库存在。不要手改 `node_modules/`、vendor 包或生成文件来修依赖。

```sh
npm run check:setup
npm run test:setup
npm test
npm run check:docs
npm run build
npm run preview
```

`dist/` 是生成的静态网站，不提交到源码仓库。普通构建以网站根路径发布，预览默认端口 4173。没有单 HTML 离线版；需要 HTTP 静态服务，不能把入口 HTML 单独拷走。

## 用户文档与截图

用户文档源在 `docs/`，中文 `.md` 与相邻 `.en.md` 同步维护；README 同样有两版。中文截图在 `docs/images/`，英文实际界面截图在 `docs/images/en/`。文案应区分各骨架能力，不把兼容读取旧工程写成可新建能力。

`npm run check:docs` 检查语言配对、本地链接、图片和 Markdown 锚点。`tools/build-docs.mjs` 将手册生成到 `dist/docs/`，保留语言切换、章节导航和编辑器返回入口；生成页不依赖 GitHub 仓库可见性。`tools/docs-pages.mjs` 定义发布的用户章节，不把全部内部验证资料复制到网站。

开发服务的帮助入口指向已发布手册；要检查本次修改生成的 HTML，请使用静态构建和预览。用独立演示地址拍摄截图，避免覆盖个人草稿。复核每个操作对象和标签可见，并检查桌面与窄屏布局。

## Pages 构建

```sh
npm run build:pages
```

该构建设置 Vite base 为 `/MomoPoseForge/`。Three.js 模型、配置、内置外观、首页与模型说明链接通过 `sitePaths.ts` 按实际 base 解析；骨架标识和工程里的规范资产路径不随部署地址改变。

本地执行 `npm run preview -- --base=/MomoPoseForge/`，访问 `http://127.0.0.1:4173/MomoPoseForge/`；手册位于同一站点的 `docs/index.html`，英文为 `docs/index.en.html`。改用其他仓库名或自定义域名时，按实际路径调整构建和预览的 `--base`。

## 自动部署

仓库 Settings → Pages 的 Source 设为 **GitHub Actions**。`.github/workflows/pages.yml` 在推送 `main` 或手动运行时执行：安装锁定依赖、依赖检查测试、功能测试、Pages 构建、上传 `dist/` 并发布。部署任务仅使用 Pages 所需的权限，不把源码树整体当站点上传。

在线入口为 [MomoPoseForge](https://breezymomo.github.io/MomoPoseForge/)。以 Actions 成功状态和实际页面可用为准，不把推送完成当作已上线。首次开通需要仓库管理权限与支持该仓库的 GitHub Pages 计划；不应为开通 Pages 自动修改仓库可见性。

方法参考：[Vite 静态部署](https://vite.dev/guide/static-deploy.html#github-pages) · [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
