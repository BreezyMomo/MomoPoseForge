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

## Automatic deployment

Set repository Settings → Pages → Source to **GitHub Actions**. `.github/workflows/pages.yml` runs on `main` pushes or manual dispatch: locked dependency installation, setup tests, feature tests, Pages build, artifact upload and deployment. Only `dist/` is uploaded, with deployment-scoped Pages permissions.

The editor URL is [MomoPoseForge](https://breezymomo.github.io/MomoPoseForge/). Confirm both a successful workflow and a working page; a push alone is not deployment success. Initial setup needs repository administration permission and a Pages plan supporting the repository. Do not change repository visibility automatically to enable Pages.

References: [Vite static deployment](https://vite.dev/guide/static-deploy.html#github-pages) · [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
