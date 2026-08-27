# packages/assistant agent guidance

This is a package-level AI instruction file for the `packages/assistant` workspace package.

## What this package is

- Angular 21 application / library package with server-side rendering support.
- Package name is `clover` in `packages/assistant/package.json`.
- Built output is `dist/clover`.
- Intended to run as both a web app and an embeddable library via `src/index.ts`.

## Key behaviors

- `pnpm --filter ./packages/assistant start` runs `ng serve --host=0.0.0.0 --ssl`.
- `pnpm --filter ./packages/assistant build` runs `ng build`, then `node scripts/inline-styles.mjs`, then `tsc -p tsconfig.declaration.json`.
- `pnpm --filter ./packages/assistant test` runs `ng test`.
- `pnpm --filter ./packages/assistant serve:ssr:clover` starts the SSR server from `dist/clover/server/server.mjs`.
- `src/main.ts` initializes the browser app and reads initial data via `opfs-tools`.
- `src/main.server.ts` and `src/server.ts` implement SSR rendering and an Express server.
- `src/index.ts` exports `Clover(domId, doc?, fileName?)` for third-party embedding.

## Important files

- `package.json` — package metadata, workspace dependencies, and scripts.
- `angular.json` — Angular CLI project configuration, build targets, and dev server proxy.
- `src/main.common.ts` — shared bootstrap logic for browser + SSR.
- `src/main.ts` — client initialization flow.
- `src/main.server.ts` / `src/server.ts` — SSR and Node request handling.
- `src/index.ts` — embeddable public export entrypoint.
- `src/app` — main application components, shared UI widgets, and services.
- `scripts/inline-styles.mjs` — build-time inline CSS step.
- `src/proxy.conf_1.json` — development proxy configuration.

## Agent guidance

- Preserve the Angular SSR hydration setup and existing bootstrap providers.
- Avoid changing `scripts/inline-styles.mjs` or `tsconfig.declaration.json` unless the build is explicitly failing and the fix is validated.
- If adding or updating features, keep in mind the package is part of a pnpm workspace and depends on other workspace packages such as `@julyware/common` and `@julyware/community-widget`.
- Prefer using `ng` / Angular CLI for application changes and `pnpm` from the repo root for install/build/test commands.
- When refactoring, prioritize `src/app` shared components and token/provider patterns rather than creating unrelated new runtime globals.
- There is no existing package-specific documentation beyond a placeholder README; rely on code and package manifests.

## Verification

After implementing code changes, run the following to verify correctness:

```bash
pnpm --filter ./packages/assistant build
```

This runs `ng build` + `scripts/inline-styles.mjs` + `tsc`, which validates TypeScript compilation, Angular template compilation, and CSS inlining.

### Test command status

`pnpm --filter ./packages/assistant test` (`ng test --watch=false`) has **pre-existing failures** unrelated to feature changes (Chrome extension type stubs missing, Angular 21 API deprecations in spec files). Do not rely on it for verification until the test files are fixed.

## Useful note

- This package uses both a browser entrypoint and a public library export. Changes to `src/index.ts` or `src/main.common.ts` may affect embedded consumers.
