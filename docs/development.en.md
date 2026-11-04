# Development and GitHub Pages

[简体中文](development.md) · [English](development.en.md)

[Manual](README.en.md) · [Project home](../README.en.md)

## Run a standalone clone

Use Node.js 24 and run from the repository root:

```sh
npm ci
npm run dev
```

The default URL is `http://127.0.0.1:5173/`. The fixed framework package is `vendor/momo-workbench-0.2.0.tgz`. Keep it consistent with the lockfile; no sibling repository is required. Do not repair setup by editing installed dependencies, vendor archives or generated files.

```sh
npm run check:setup
npm run test:setup
npm test
npm run check:docs
npm run build
npm run preview
```

`dist/` is generated static output and is not committed. A regular build uses the site root; preview defaults to port 4173. There is no single-file offline HTML build. Serve the complete output over HTTP instead of copying only its HTML entry.

## Documentation and screenshots

User docs live in `docs/`, with adjacent Chinese `.md` and English `.en.md` files, including both READMEs. Chinese screenshots are in `docs/images/`; English UI captures are in `docs/images/en/`. State each rig's actual capabilities and distinguish legacy project compatibility from newly selectable rigs.

`npm run check:docs` checks language pairs, local links, images and Markdown anchors. `tools/build-docs.mjs` renders the manual into `dist/docs/` with navigation, language switching and editor links, independently of source-repository visibility. `tools/docs-pages.mjs` lists the public handbook chapters; internal validation files are not copied wholesale.

Development-mode help opens the published manual; use a static build and preview to inspect newly generated HTML. Capture a separate demo origin to avoid modifying personal drafts. Keep control labels visible and check desktop/narrow layouts.

## Build for Pages

```sh
npm run build:pages
```

This sets Vite base to `/MomoPoseForge/`. `sitePaths.ts` resolves models, profiles, built-in appearances, home and asset-information links against the deployment base. Rig IDs and canonical asset paths remain stable in project data.

Run `npm run preview -- --base=/MomoPoseForge/`, then open `http://127.0.0.1:4173/MomoPoseForge/`; the manual is `docs/index.html`, or `docs/index.en.html` in English. Change both build and preview `--base` for another repository name or a custom domain.

## Official-site analytics

The official editor uses Baidu site **23663044**, separately from MomoTextureForge. `web/src/main.tsx` starts `siteAnalytics.ts` only in production builds. Its HTTPS allowlist accepts `breezymomo.github.io/MomoPoseForge/` and its `index.html`. Local development, static previews, other domains, other GitHub projects and manual pages do not load analytics.

Each editor load sends one manual PV for `/MomoPoseForge/`. Automatic PV and click collection are disabled. Query strings/fragments are excluded from that path and referrers are reduced to origin. The asynchronous SDK uses `referrerPolicy=origin`; `no-referrer` can cause Baidu to return an empty script. Project names, filenames, poses, actors, models, reference images and other user content are not actively reported. Baidu still processes the network/browser information and visitor identifiers needed for statistics.

In Baidu **Visit analysis → Event analysis**, select category `export`, action `download`. Fixed `format/scope` labels are `images-zip/five`, `images-zip/current`, `glb-static/scene`, `glb-static/selected`, `glb-rigged/scene` and `glb-rigged/selected`. One image ZIP counts once regardless of rig or actor count. Only completed generation followed by download initiation counts; cancellations, failures, previews and project saves do not. The browser cannot confirm final disk persistence. Blocked analytics or network errors do not affect editing/export.

Run `npm test -- web/src/siteAnalytics.test.ts` for host isolation, duplicate startup, sanitized URLs/referrers, bounded fields and the download completion boundary, then `npm run build:pages`. After deployment, verify a nonempty SDK and inspect the matching site's installation check and reports. New-site code and reports may lag; an inserted script alone does not prove data receipt.

API reference: [Baidu pageview API](https://tongji.baidu.com/holmes/Tongji/%E7%BB%9F%E8%AE%A1%E5%BC%80%E6%94%BE%E6%89%8B%E5%86%8C/JS-API%E6%8A%80%E6%9C%AF%E6%96%87%E6%A1%A3/_trackPageview/).

## Automatic deployment

Set repository Settings → Pages → Source to **GitHub Actions**. `.github/workflows/pages.yml` runs on `main` pushes or manual dispatch: locked dependency installation, setup tests, feature tests, Pages build, artifact upload and deployment. Only `dist/` is uploaded, with deployment-scoped Pages permissions.

The editor URL is [MomoPoseForge](https://breezymomo.github.io/MomoPoseForge/). Confirm both a successful workflow and a working page; a push alone is not deployment success. Initial setup needs repository administration permission and a Pages plan supporting the repository. Do not change repository visibility automatically to enable Pages.

References: [Vite static deployment](https://vite.dev/guide/static-deploy.html#github-pages) · [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
