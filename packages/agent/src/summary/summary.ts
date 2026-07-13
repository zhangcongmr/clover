/**
 * Work Summary
 *
 * ## Objective
 * Extract common Express + API endpoint code into shared `@luxio/agent` package,
 * refactor consumers, and set up production SSR build for the editor with a
 * portable server bundle.
 *
 * ## Important Details
 * - Editor SSR: Express + static files (prod) or Vite middleware (dev); ports 5178.
 *   No React SSR rendering.
 * - `node-pty` loaded dynamically via `require()` in `pty-manager.ts` –
 *   must use `createRequire` / dynamic `import('node:module')` to work in ESM.
 * - `@luxio/agent` built with tsup (CJS + ESM + DTS), `"type": "module"`.
 * - Node.js 24 eagerly resolves `import()` calls statically, even behind dead
 *   code branches, `new Function`, or char-code encoding. Tree-shaking at build
 *   time (esbuild `define`) is the only effective workaround.
 * - Esbuild bundled ESM output cannot use bare `require()` for Node.js builtins;
 *   banner injects `var require = createRequire(import.meta.url)` for CJS interop.
 * - `lightningcss` (native addon, transitive dep of `@tailwindcss/vite` / `vite`)
 *   cannot be bundled by esbuild.
 * - Pre-existing changes (not ours): `nginx-conf/shared-locations.conf`,
 *   `packages/assistant/src/main.server.ts`, `pnpm-workspace.yaml` (excluded
 *   from commit).
 *
 * ## Work State
 *
 * ### Completed
 * - Created `packages/agent/` (14 source files + tsup/tsconfig configs);
 *   builds CJS + ESM + DTS.
 * - Refactored `packages/editor/src/server/server.ts` (86 lines) and
 *   `packages/assistant/src/server.ts` (85 lines) to use `@luxio/agent`.
 * - Deleted `packages/editor/src/server/agent/` (5 files moved to agent pkg).
 * - Updated package.jsons: added `@luxio/agent`, removed
 *   `uuid`/`ws`/`@a2a-js/sdk`/`@types/uuid`.
 * - `pty-manager.ts` bugfix: `loadNodePty()` / `create()` made async; uses
 *   `await import('node:module')` (dynamic) instead of static `import` (which
 *   caused Angular esbuild route-extraction and Angular `already declared`
 *   errors).
 * - Editor production SSR pipeline:
 *   - `scripts/build-server.mjs` — esbuild bundles all JS deps (except `vite`),
 *     outputs `dist-server/server.js`
 *   - Path resolution: `basename(__dirname) === 'dist-server'` and separate
 *     `distDir` logic handle both source-and-compiled depths; `distDir` is
 *     sibling of `dist-server/` for portability
 *   - SSL path: `join(rootDir, 'ssl')`
 *   - `isDev` checks `dist/index.html` existence → no `vite` load in prod
 *   - Vite import tree-shaken via `define: { isProdBuild: 'true' }` —
 *     `if (!isProdBuild && isDev)` block removed by esbuild from bundle
 *   - CJS interop via banner:
 *     `var require = createRequire(import.meta.url)` — makes bundled express
 *     etc. able to `require()` Node.js builtins in ESM context
 *   - Scripts: `build:server`, `serve:ssr: node dist-server/server.js`
 *   - `.gitignore`: `/dist-server` added
 * - **Server portability verified**: copy `dist/` and `dist-server/` to any
 *   location → `node dist-server/server.js` → production mode with zero deps.
 * - Cleaned up obsolete `bootstrap.mjs` and `tsup.server.config.ts`.
 *
 * ### Out of scope / unchanged
 * - `nginx-conf/shared-locations.conf` (pre-existing)
 * - `packages/assistant/src/main.server.ts` (pre-existing)
 * - `pnpm-workspace.yaml` (always excluded from git)
 */
